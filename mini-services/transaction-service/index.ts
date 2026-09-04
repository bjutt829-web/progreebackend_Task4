// transaction-service — Bun.serve based mini-service (port 3003).
// Owns Transaction + QueueMessage + TxnAudit tables.
// Acts as a PRODUCER (POST /transactions -> publish to broker) and runs a
// background CONSUMER (setInterval poll loop) that processes transactions and
// acks/nacks the broker.
//
// No express. No jsonwebtoken. Just Bun.serve + fetch + Prisma.
import { db } from "./db.ts";
import * as broker from "./broker-client.ts";
import { BrokerError } from "./broker-client.ts";
import {
  PORTS,
  type Role,
  type TxnType,
  type TxnStatus,
  type SubmitTransactionRequest,
  type SubmitTransactionResponse,
  type Transaction,
  type AuditEntry,
  type HealthResponse,
} from "../shared/contracts.ts";

const SERVICE = "transaction-service";
const PORT = PORTS.transaction; // 3003
const startedAt = Date.now();
const CONSUMER_ID = "txn-consumer-1";
const CONSUMER_TOPIC = "transactions";
const CONSUMER_INTERVAL_MS = 600;
const SIM_FAILURE_RATE = 0.06; // ~6% random processing failure

let consumerRunning = false;
let consumerBusy = false; // guard against overlapping setInterval ticks
let consumerTimer: ReturnType<typeof setInterval> | null = null;

// ---- helpers ----
function uptimeSec(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-id, x-user-email, x-user-role",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(),
  });
}

async function parseJsonBody(req: Request): Promise<any | null> {
  if (req.method !== "POST" && req.method !== "PUT") return null;
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

// Read caller identity forwarded by the gateway (the gateway verifies the JWT
// via auth-service then injects x-user-* headers).
function callerFromRequest(req: Request): {
  userId?: string;
  userEmail?: string;
  role?: Role;
} {
  const userId = req.headers.get("x-user-id") || undefined;
  const userEmail = req.headers.get("x-user-email") || undefined;
  const roleRaw = req.headers.get("x-user-role") || undefined;
  let role: Role | undefined;
  if (roleRaw === "ADMIN" || roleRaw === "MANAGER" || roleRaw === "USER") {
    role = roleRaw;
  }
  return { userId, userEmail, role };
}

function isAdminOrManager(role?: Role): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

// Convert a DB row (with metadata as a JSON string) to the wire Transaction.
function toTxnWire(row: any): Transaction {
  let metadata: any = undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    type: row.type as TxnType,
    amount: row.amount,
    currency: row.currency,
    status: row.status as TxnStatus,
    reference: row.reference,
    messageId: row.messageId ?? undefined,
    metadata,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
    processedAt: row.processedAt
      ? row.processedAt instanceof Date
        ? row.processedAt.toISOString()
        : new Date(row.processedAt).toISOString()
      : undefined,
  };
}

function toAuditWire(row: any): AuditEntry {
  return {
    id: row.id,
    userId: row.userId ?? undefined,
    userEmail: row.userEmail ?? undefined,
    action: row.action,
    resource: row.resource ?? undefined,
    result: row.result as "SUCCESS" | "FAILURE",
    detail: row.detail ?? undefined,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
  };
}

// ---- audit writer ----
async function audit(input: {
  action: string;
  result: "SUCCESS" | "FAILURE";
  userId?: string;
  userEmail?: string;
  resource?: string;
  detail?: string;
}): Promise<void> {
  try {
    await db.txnAudit.create({
      data: {
        action: input.action,
        result: input.result,
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        resource: input.resource ?? null,
        detail: input.detail ?? null,
      },
    });
  } catch (e) {
    // Audit failures must never break the request flow.
    console.error("[audit] failed to write:", e);
  }
}

// ---- HTTP router ----
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const t0 = performance.now();

  // CORS preflight
  if (method === "OPTIONS") {
    const t1 = performance.now();
    console.log(`${method} ${path} -> 204 in ${Math.round(t1 - t0)}ms`);
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let response: Response;
  try {
    response = await route(req, url, path, method);
  } catch (e: any) {
    console.error("[route] unhandled:", e);
    response = json(
      { error: "internal server error", detail: String(e?.message || e) },
      500
    );
  }

  const t1 = performance.now();
  console.log(`${method} ${path} -> ${response.status} in ${Math.round(t1 - t0)}ms`);
  return response;
}

async function route(
  req: Request,
  url: URL,
  path: string,
  method: string
): Promise<Response> {
  // ---- health ----
  if (path === "/health" && method === "GET") {
    const body: HealthResponse & { consumerRunning: boolean } = {
      status: "ok",
      service: SERVICE,
      uptimeSec: uptimeSec(),
      consumerRunning,
    };
    return json(body);
  }

  // ---- transactions ----
  if (path === "/transactions" && method === "POST") {
    return handleCreateTransaction(req);
  }
  if (path === "/transactions" && method === "GET") {
    return handleListTransactions(req, url);
  }
  // /transactions/:id
  const m1 = path.match(/^\/transactions\/([^/]+)$/);
  if (m1 && method === "GET") {
    return handleGetTransaction(req, m1[1]);
  }
  // /transactions/:id/approve
  const m2 = path.match(/^\/transactions\/([^/]+)\/approve$/);
  if (m2 && method === "POST") {
    return handleApproveTransaction(req, m2[1]);
  }

  // ---- audit ----
  if (path === "/audit" && method === "GET") {
    return handleListAudit(req, url);
  }

  // ---- admin consumer controls ----
  if (path === "/admin/consumer/start" && method === "POST") {
    consumerRunning = true;
    ensureConsumerLoop();
    return json({ running: consumerRunning });
  }
  if (path === "/admin/consumer/stop" && method === "POST") {
    consumerRunning = false;
    return json({ running: consumerRunning });
  }
  if (path === "/admin/consumer/status" && method === "GET") {
    return json({ running: consumerRunning });
  }

  // ---- 404 ----
  return json({ error: "Not found", path, method }, 404);
}

// ---- POST /transactions ----
async function handleCreateTransaction(req: Request): Promise<Response> {
  const caller = callerFromRequest(req);
  if (!caller.userId || !caller.userEmail || !caller.role) {
    return json(
      { error: "Unauthorized", reason: "missing x-user-* identity headers" },
      401
    );
  }

  const body = await parseJsonBody(req);
  if (!body) return json({ error: "invalid JSON body" }, 400);

  const { type, amount, currency, reference, metadata } =
    body as SubmitTransactionRequest;

  // Validation
  const validTypes: TxnType[] = ["DEPOSIT", "WITHDRAWAL", "TRANSFER", "PAYMENT"];
  if (!validTypes.includes(type)) {
    return json(
      { error: "invalid type", allowed: validTypes },
      400
    );
  }
  if (typeof amount !== "number" || !(amount > 0)) {
    return json({ error: "amount must be a positive number" }, 400);
  }
  if (!reference || typeof reference !== "string" || reference.trim() === "") {
    return json({ error: "reference is required" }, 400);
  }

  // 1. Create Transaction (PENDING)
  const txn = await db.transaction.create({
    data: {
      userId: caller.userId,
      userEmail: caller.userEmail,
      type,
      amount,
      currency: currency || "USD",
      status: "PENDING",
      reference,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
  await audit({
    action: "SUBMIT",
    result: "SUCCESS",
    userId: caller.userId,
    userEmail: caller.userEmail,
    resource: `transactions/${txn.id}`,
    detail: `type=${type} amount=${amount} ${currency || "USD"} ref=${reference}`,
  });

  // 2. Publish to broker
  const payload = {
    transactionId: txn.id,
    userId: caller.userId,
    userEmail: caller.userEmail,
    type,
    amount,
    currency: currency || "USD",
    reference,
  };
  let publishResult: broker.PublishResult;
  try {
    publishResult = await broker.publish(CONSUMER_TOPIC, payload);
  } catch (e: any) {
    // Publish failed — record failure audit + leave transaction PENDING.
    await audit({
      action: "QUEUE",
      result: "FAILURE",
      userId: caller.userId,
      userEmail: caller.userEmail,
      resource: `transactions/${txn.id}`,
      detail: `publish error: ${e?.message || String(e)}`,
    });
    return json(
      {
        error: "failed to enqueue transaction",
        reason: e?.message || String(e),
        transaction: toTxnWire(txn),
      },
      502
    );
  }

  // 3. Persist QueueMessage row (status PENDING, messageId)
  await db.queueMessage.create({
    data: {
      topic: CONSUMER_TOPIC,
      payload: JSON.stringify(payload),
      messageId: publishResult.messageId,
      status: "PENDING",
    },
  });

  // 4. Update transaction status -> QUEUED + messageId
  const updated = await db.transaction.update({
    where: { id: txn.id },
    data: { status: "QUEUED", messageId: publishResult.messageId },
  });

  await audit({
    action: "QUEUE",
    result: "SUCCESS",
    userId: caller.userId,
    userEmail: caller.userEmail,
    resource: `transactions/${txn.id}`,
    detail: `messageId=${publishResult.messageId} topic=${CONSUMER_TOPIC}`,
  });

  const resp: SubmitTransactionResponse = {
    transaction: toTxnWire(updated),
    messageId: publishResult.messageId,
  };
  return json(resp, 201);
}

// ---- GET /transactions ----
async function handleListTransactions(req: Request, url: URL): Promise<Response> {
  const caller = callerFromRequest(req);
  if (!caller.role) {
    return json(
      { error: "Unauthorized", reason: "missing x-user-role header" },
      401
    );
  }
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10)));

  // Optional query overrides (used by gateway which already enforces RBAC).
  // If role is ADMIN/MANAGER -> all. If USER -> only own.
  let where: any;
  if (isAdminOrManager(caller.role)) {
    const userIdFilter = url.searchParams.get("userId");
    where = userIdFilter ? { userId: userIdFilter } : {};
  } else {
    // USER: force filter to caller's own id.
    if (!caller.userId) {
      return json({ error: "Unauthorized", reason: "missing x-user-id" }, 401);
    }
    where = { userId: caller.userId };
  }

  const rows = await db.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ transactions: rows.map(toTxnWire) });
}

// ---- GET /transactions/:id ----
async function handleGetTransaction(req: Request, id: string): Promise<Response> {
  const caller = callerFromRequest(req);
  if (!caller.role) {
    return json(
      { error: "Unauthorized", reason: "missing x-user-role header" },
      401
    );
  }
  const txn = await db.transaction.findUnique({ where: { id } });
  if (!txn) return json({ error: "Not found", id }, 404);

  // RBAC: USER can only see their own.
  if (!isAdminOrManager(caller.role) && txn.userId !== caller.userId) {
    return json({ error: "Forbidden", reason: "not your transaction" }, 403);
  }
  return json({ transaction: toTxnWire(txn) });
}

// ---- POST /transactions/:id/approve ----
async function handleApproveTransaction(req: Request, id: string): Promise<Response> {
  const caller = callerFromRequest(req);
  if (!caller.role) {
    return json(
      { error: "Unauthorized", reason: "missing x-user-role header" },
      401
    );
  }
  if (!isAdminOrManager(caller.role)) {
    await audit({
      action: "PROCESS",
      result: "FAILURE",
      userId: caller.userId,
      userEmail: caller.userEmail,
      resource: `transactions/${id}/approve`,
      detail: `role ${caller.role} requires MANAGER/ADMIN`,
    });
    return json({ error: "Forbidden", reason: "MANAGER or ADMIN role required" }, 403);
  }

  const txn = await db.transaction.findUnique({ where: { id } });
  if (!txn) return json({ error: "Not found", id }, 404);

  const updated = await db.transaction.update({
    where: { id },
    data: { status: "COMPLETED", processedAt: new Date() },
  });
  await audit({
    action: "COMPLETE",
    result: "SUCCESS",
    userId: caller.userId,
    userEmail: caller.userEmail,
    resource: `transactions/${id}`,
    detail: `manual approve by ${caller.userEmail} (${caller.role})`,
  });
  return json({ transaction: toTxnWire(updated) });
}

// ---- GET /audit ----
async function handleListAudit(req: Request, url: URL): Promise<Response> {
  const caller = callerFromRequest(req);
  if (!caller.role) {
    return json(
      { error: "Unauthorized", reason: "missing x-user-role header" },
      401
    );
  }
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10)));
  let where: any;
  if (isAdminOrManager(caller.role)) {
    where = {};
  } else {
    // USER: only their own entries by userEmail.
    if (!caller.userEmail) {
      return json({ error: "Unauthorized", reason: "missing x-user-email" }, 401);
    }
    where = { userEmail: caller.userEmail };
  }
  const rows = await db.txnAudit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return json({ entries: rows.map(toAuditWire) });
}

// ---- background consumer ----
function ensureConsumerLoop(): void {
  if (consumerTimer) return;
  consumerTimer = setInterval(() => {
    void consumerTick().catch((e) => {
      console.error("[consumer] tick threw (should not happen):", e);
    });
  }, CONSUMER_INTERVAL_MS);
}

async function consumerTick(): Promise<void> {
  if (!consumerRunning) return;
  if (consumerBusy) return; // avoid overlap if a previous tick is still running
  consumerBusy = true;
  try {
    await consumeOne();
  } catch (e) {
    // One bad message must never kill the loop.
    console.error("[consumer] iteration error:", e);
  } finally {
    consumerBusy = false;
  }
}

async function consumeOne(): Promise<void> {
  let pollResp: broker.PollResult;
  try {
    pollResp = await broker.poll(CONSUMER_TOPIC, CONSUMER_ID);
  } catch (e: any) {
    // Broker unreachable — log + back off (the next tick will try again).
    if (e instanceof BrokerError && e.status === 0) {
      // Only log transport errors at debug-ish level — broker may simply be down.
      // (We still log so smoke tests can see the wiring.)
      console.log(`[consumer] broker unreachable: ${e.message}`);
    } else {
      console.error("[consumer] poll failed:", e);
    }
    return;
  }
  const message = pollResp?.message;
  if (!message) return; // empty queue
  const messageId: string = message.id || message.messageId;
  if (!messageId) {
    console.warn("[consumer] polled message missing id; skipping:", message);
    return;
  }

  // payload may live at message.payload (BrokerMessage) — be defensive.
  let payload: any = message.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      // leave as-is
    }
  }
  const transactionId: string | undefined =
    payload?.transactionId || payload?.transaction_id;
  if (!transactionId) {
    console.warn("[consumer] polled message missing transactionId; skipping:", message);
    // ack so we don't redeliver a malformed message forever.
    try {
      await broker.ack(messageId);
    } catch (e) {
      console.error("[consumer] ack(malformed) failed:", e);
    }
    return;
  }

  console.log(`[consumer] processing ${transactionId} (messageId=${messageId})`);

  // 1. Mark transaction PROCESSING
  let txn: any;
  try {
    txn = await db.transaction.findUnique({ where: { id: transactionId } });
  } catch (e) {
    console.error(`[consumer] cannot find transaction ${transactionId}:`, e);
    // nack so the broker requeues; we'll re-try.
    try {
      await broker.nack(messageId, "transaction lookup failed");
    } catch (ne) {
      console.error("[consumer] nack(lookup-failed) failed:", ne);
    }
    return;
  }
  if (!txn) {
    console.warn(`[consumer] transaction ${transactionId} not found; acking to drop`);
    try {
      await broker.ack(messageId);
    } catch (e) {
      console.error("[consumer] ack(missing-txn) failed:", e);
    }
    return;
  }

  // 2. Persist QueueMessage status DELIVERED
  await updateQueueMessage(messageId, {
    status: "DELIVERED",
    consumerId: CONSUMER_ID,
    deliveredAt: new Date(),
  });
  await db.transaction.update({
    where: { id: transactionId },
    data: { status: "PROCESSING" },
  });
  await audit({
    action: "PROCESS",
    result: "SUCCESS",
    userId: txn.userId,
    userEmail: txn.userEmail,
    resource: `transactions/${transactionId}`,
    detail: `consumer=${CONSUMER_ID} messageId=${messageId}`,
  });

  // 3. Simulate processing
  await sleep(randomBetween(200, 600));

  // 4. ~6% random failure to demonstrate nack/retry.
  if (Math.random() < SIM_FAILURE_RATE) {
    let nackResp: broker.NackResult;
    try {
      nackResp = await broker.nack(messageId, "simulated processing failure");
    } catch (e) {
      console.error(`[consumer] nack failed for ${transactionId}:`, e);
      await audit({
        action: "NACK",
        result: "FAILURE",
        userId: txn.userId,
        userEmail: txn.userEmail,
        resource: `transactions/${transactionId}`,
        detail: `nack transport error: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const dead = isDeadSignal(nackResp);
    if (dead) {
      // 3rd failure -> FAILED
      await db.transaction.update({
        where: { id: transactionId },
        data: { status: "FAILED" },
      });
      await updateQueueMessage(messageId, {
        status: "DEAD",
        error: "simulated processing failure (dead-lettered)",
      });
      await audit({
        action: "FAIL",
        result: "FAILURE",
        userId: txn.userId,
        userEmail: txn.userEmail,
        resource: `transactions/${transactionId}`,
        detail: `dead-lettered after max attempts messageId=${messageId}`,
      });
      console.log(`[consumer] DEAD ${transactionId} (messageId=${messageId})`);
    } else {
      // requeued -> QUEUED again
      await db.transaction.update({
        where: { id: transactionId },
        data: { status: "QUEUED" },
      });
      await updateQueueMessage(messageId, {
        status: "NACK",
        error: "simulated processing failure (requeued)",
      });
      await audit({
        action: "NACK",
        result: "FAILURE",
        userId: txn.userId,
        userEmail: txn.userEmail,
        resource: `transactions/${transactionId}`,
        detail: `requeued for retry messageId=${messageId}`,
      });
      console.log(`[consumer] NACK ${transactionId} (requeued)`);
    }
    return;
  }

  // 5. Success path: ack + COMPLETED
  try {
    await broker.ack(messageId);
  } catch (e) {
    console.error(`[consumer] ack failed for ${transactionId}:`, e);
    await audit({
      action: "ACK",
      result: "FAILURE",
      userId: txn.userId,
      userEmail: txn.userEmail,
      resource: `transactions/${transactionId}`,
      detail: `ack transport error: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }
  await db.transaction.update({
    where: { id: transactionId },
    data: { status: "COMPLETED", processedAt: new Date() },
  });
  await updateQueueMessage(messageId, {
    status: "ACK",
    ackedAt: new Date(),
  });
  await audit({
    action: "COMPLETE",
    result: "SUCCESS",
    userId: txn.userId,
    userEmail: txn.userEmail,
    resource: `transactions/${transactionId}`,
    detail: `processed+acked messageId=${messageId}`,
  });
  console.log(`[consumer] acked ${transactionId} (messageId=${messageId})`);
}

// Update a QueueMessage row by messageId (created during publish). If the row
// is missing for some reason (e.g. the publish step crashed before persist),
// we silently skip — the broker is still the source of truth for retry.
async function updateQueueMessage(
  messageId: string,
  patch: {
    status: string;
    consumerId?: string;
    error?: string;
    deliveredAt?: Date;
    ackedAt?: Date;
  }
): Promise<void> {
  try {
    const existing = await db.queueMessage.findUnique({ where: { messageId } });
    if (!existing) return;
    await db.queueMessage.update({
      where: { messageId },
      data: {
        status: patch.status,
        consumerId: patch.consumerId ?? existing.consumerId,
        error: patch.error ?? existing.error,
        deliveredAt: patch.deliveredAt ?? existing.deliveredAt,
        ackedAt: patch.ackedAt ?? existing.ackedAt,
      },
    });
  } catch (e) {
    console.error(`[consumer] updateQueueMessage(${messageId}) failed:`, e);
  }
}

// Detect "dead" signal across plausible broker response shapes.
function isDeadSignal(resp: any): boolean {
  if (!resp) return false;
  if (resp.status === "DEAD" || resp.status === "dead") return true;
  if (resp.dead === true) return true;
  if (resp.message && (resp.message.status === "DEAD" || resp.message.status === "dead")) return true;
  return false;
}

// ---- startup + shutdown ----
async function main(): Promise<void> {
  await db.$connect();
  // Start consuming immediately.
  consumerRunning = true;
  ensureConsumerLoop();
  const server = Bun.serve({ port: PORT, fetch: handle });
  console.log(
    `transaction-service listening on ${PORT}, consumer running`
  );

  const shutdown = async (sig: string) => {
    console.log(`[transaction-service] received ${sig}, shutting down...`);
    consumerRunning = false;
    if (consumerTimer) {
      clearInterval(consumerTimer);
      consumerTimer = null;
    }
    server.stop(true);
    try {
      await db.$disconnect();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[transaction-service] fatal:", e);
  process.exit(1);
});
