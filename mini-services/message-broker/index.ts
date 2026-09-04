// message-broker — lightweight in-memory async message broker (RabbitMQ-style)
// Topics/queues, publish / poll / ack / nack / retry (max 3 -> dead-letter),
// JSON snapshot durability, socket.io live stats. Port 3002.
//
// We use Node `http.createServer` + `socket.io` (NOT Bun.serve) so socket.io
// can attach to the same HTTP server.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import {
  PORTS,
  BrokerMessage,
  QueueStatus,
  QueueStats,
  BrokerStats,
  HealthResponse,
  PublishRequest,
  PublishResponse,
  AckRequest,
  NackRequest,
} from "../shared/contracts.ts";

const PORT = PORTS.broker; // 3002
// Snapshot path: prefer the BROKER_SNAPSHOT_PATH env var (used by the docker
// image; see mini-services/message-broker/Dockerfile) so the volume mount can
// be moved to /app/data without code changes. Fall back to the dev location.
const SNAPSHOT_PATH =
  process.env.BROKER_SNAPSHOT_PATH ||
  "/home/z/my-project/mini-services/message-broker/snapshot.json";
const ACKED_LOG_LIMIT = 500;
const DEAD_LOG_LIMIT = 500;
const MAX_ATTEMPTS = 3;
const THROUGHPUT_WINDOW_MS = 10_000; // last 10s of ack events
const STATS_INTERVAL_MS = 1_000;

// ---------- In-memory state ----------
const queues = new Map<string, BrokerMessage[]>(); // active: PENDING + DELIVERED + NACK-requeued
let ackedLog: BrokerMessage[] = []; // bounded last N
let deadLog: BrokerMessage[] = []; // bounded last N

// Lifetime global counters
let published = 0;
let delivered = 0;
let acked = 0;
let failed = 0;
let dead = 0;
const startTime = Date.now();

// Per-topic lifetime counters (for accurate QueueStats even when log is bounded)
interface TopicCounter { published: number; delivered: number; acked: number; dead: number; failed: number; }
const topicCounters = new Map<string, TopicCounter>();
function topicCounter(topic: string): TopicCounter {
  let c = topicCounters.get(topic);
  if (!c) { c = { published: 0, delivered: 0, acked: 0, dead: 0, failed: 0 }; topicCounters.set(topic, c); }
  return c;
}

// Rolling throughput: ring of {ts, topic} ack events (trimmed to last 10s)
const ackEvents: { ts: number; topic: string }[] = [];
function trimAcks() {
  const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
  while (ackEvents.length > 0 && ackEvents[0].ts < cutoff) ackEvents.shift();
}
function computeThroughput(topic?: string): number {
  trimAcks();
  const n = topic ? ackEvents.filter((e) => e.topic === topic).length : ackEvents.length;
  return n / (THROUGHPUT_WINDOW_MS / 1000);
}

function uptimeSec(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

// ---------- Snapshot persistence ----------
interface Snapshot {
  queues: [string, BrokerMessage[]][];
  ackedLog: BrokerMessage[];
  deadLog: BrokerMessage[];
  counters: { published: number; delivered: number; acked: number; failed: number; dead: number };
  topicCounters: [string, TopicCounter][];
}

function writeSnapshot() {
  try {
    const snap: Snapshot = {
      queues: Array.from(queues.entries()),
      ackedLog,
      deadLog,
      counters: { published, delivered, acked, failed, dead },
      topicCounters: Array.from(topicCounters.entries()),
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2), "utf-8");
  } catch (e) {
    console.error("snapshot write failed:", e);
  }
}

function loadSnapshot() {
  try {
    if (!existsSync(SNAPSHOT_PATH)) return;
    const raw = readFileSync(SNAPSHOT_PATH, "utf-8");
    if (!raw.trim()) return;
    const snap = JSON.parse(raw) as Snapshot;
    queues.clear();
    topicCounters.clear();
    for (const [topic, msgs] of snap.queues || []) {
      // Durable-queue semantic: any DELIVERED-without-ack message was being
      // processed when we died. Mark PENDING so it gets redelivered.
      for (const m of msgs) {
        if (m.status === "DELIVERED") {
          m.status = "PENDING";
          m.consumerId = undefined;
          m.deliveredAt = undefined;
        }
      }
      queues.set(topic, msgs);
    }
    ackedLog = snap.ackedLog || [];
    deadLog = snap.deadLog || [];
    published = snap.counters?.published || 0;
    delivered = snap.counters?.delivered || 0;
    acked = snap.counters?.acked || 0;
    failed = snap.counters?.failed || 0;
    dead = snap.counters?.dead || 0;
    for (const [t, c] of snap.topicCounters || []) topicCounters.set(t, c);
    const totalActive = Array.from(queues.values()).reduce((n, m) => n + m.length, 0);
    console.log(
      `snapshot restored: topics=${queues.size} active=${totalActive} acked=${ackedLog.length} dead=${deadLog.length} published=${published} acked=${acked}`
    );
  } catch (e) {
    console.error("snapshot load failed:", e);
  }
}

loadSnapshot();

// ---------- Stats helpers ----------
function queueStats(topic: string): QueueStats {
  const msgs = queues.get(topic) || [];
  let pending = 0;
  let inFlight = 0;
  for (const m of msgs) {
    if (m.status === "PENDING") pending++;
    else if (m.status === "DELIVERED") inFlight++;
  }
  const tc = topicCounter(topic);
  return {
    topic,
    pending,
    delivered: inFlight,
    acked: tc.acked,
    dead: tc.dead,
    throughput: computeThroughput(topic),
  };
}

function allTopics(): string[] {
  const set = new Set<string>();
  for (const t of queues.keys()) set.add(t);
  for (const m of ackedLog) set.add(m.topic);
  for (const m of deadLog) set.add(m.topic);
  for (const t of topicCounters.keys()) set.add(t);
  return Array.from(set);
}

function allQueueStats(): QueueStats[] {
  return allTopics().map(queueStats);
}

function brokerStats(): BrokerStats {
  return {
    published,
    delivered,
    acked,
    failed,
    dead,
    throughput: computeThroughput(),
    topics: allQueueStats(),
    uptimeSec: uptimeSec(),
  };
}

function findActiveMessage(messageId: string): { topic: string; msg: BrokerMessage; index: number } | null {
  for (const [topic, msgs] of queues.entries()) {
    const index = msgs.findIndex((m) => m.id === messageId);
    if (index >= 0) return { topic, msg: msgs[index], index };
  }
  return null;
}

// ---------- HTTP server ----------
// IMPORTANT: socket.io's `path: "/"` matches every URL (engine.io's path check is
// `path === req.url.slice(0, path.length)`, and "/" is a prefix of every URL). So if we
// attached our HTTP router via createServer(handler) before socket.io, socket.io would
// intercept every request and return {"code":0,"message":"Transport unknown"}.
// Instead we create the server with NO handler, let socket.io attach its wrapper, then
// re-wrap the request listener so engine.io only sees requests that have ?EIO=
// (polling transport) — everything else is routed to our httpHandler.
async function httpHandler(req: IncomingMessage, res: ServerResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`${new Date().toISOString()} ${req.method} ${path}${url.search || ""}`);

  const sendJson = (status: number, body: any) => {
    const json = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(json);
  };

  const readBody = (): Promise<any> =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      });
      req.on("error", () => resolve({}));
    });

  try {
    // GET /health
    if (path === "/health" && req.method === "GET") {
      const body: HealthResponse = { status: "ok", service: "message-broker", uptimeSec: uptimeSec() };
      return sendJson(200, body);
    }

    // POST /broker/publish
    if (path === "/broker/publish" && req.method === "POST") {
      const body = (await readBody()) as PublishRequest;
      if (!body.topic || typeof body.topic !== "string") return sendJson(400, { error: "topic required" });
      const now = new Date().toISOString();
      const msg: BrokerMessage = {
        id: randomUUID(),
        topic: body.topic,
        payload: body.payload,
        status: "PENDING",
        attempts: 0,
        createdAt: now,
      };
      if (!queues.has(body.topic)) queues.set(body.topic, []);
      queues.get(body.topic)!.push(msg);
      published++;
      topicCounter(body.topic).published++;
      io.to(body.topic).emit("message", msg);
      io.emit("queue-update", queueStats(body.topic));
      io.emit("stats", brokerStats());
      writeSnapshot();
      const resp: PublishResponse = {
        messageId: msg.id,
        topic: msg.topic,
        status: msg.status,
        enqueuedAt: now,
      };
      return sendJson(200, resp);
    }

    // POST /broker/poll
    if (path === "/broker/poll" && req.method === "POST") {
      const body = await readBody();
      if (!body.topic) return sendJson(400, { error: "topic required" });
      const msgs = queues.get(body.topic);
      if (!msgs) return sendJson(200, { message: null });
      const idx = msgs.findIndex((m) => m.status === "PENDING");
      if (idx < 0) return sendJson(200, { message: null });
      const m = msgs[idx];
      m.status = "DELIVERED";
      m.consumerId = body.consumerId;
      m.deliveredAt = new Date().toISOString();
      delivered++;
      topicCounter(body.topic).delivered++;
      io.emit("queue-update", queueStats(body.topic));
      io.emit("stats", brokerStats());
      writeSnapshot();
      return sendJson(200, { message: m });
    }

    // POST /broker/ack
    if (path === "/broker/ack" && req.method === "POST") {
      const body = (await readBody()) as AckRequest;
      if (!body.messageId) return sendJson(400, { error: "messageId required" });
      const found = findActiveMessage(body.messageId);
      if (!found || found.msg.status !== "DELIVERED") {
        return sendJson(404, { error: "not deliverable" });
      }
      const { topic, msg, index } = found;
      msg.status = "ACK";
      msg.ackedAt = new Date().toISOString();
      queues.get(topic)!.splice(index, 1);
      ackedLog.push(msg);
      if (ackedLog.length > ACKED_LOG_LIMIT) ackedLog.shift();
      acked++;
      topicCounter(topic).acked++;
      ackEvents.push({ ts: Date.now(), topic });
      io.to(topic).emit("ack", { messageId: msg.id, topic });
      io.emit("queue-update", queueStats(topic));
      io.emit("stats", brokerStats());
      writeSnapshot();
      return sendJson(200, { status: "acked", messageId: msg.id });
    }

    // POST /broker/nack
    if (path === "/broker/nack" && req.method === "POST") {
      const body = (await readBody()) as NackRequest;
      if (!body.messageId) return sendJson(400, { error: "messageId required" });
      const found = findActiveMessage(body.messageId);
      if (!found || found.msg.status !== "DELIVERED") {
        return sendJson(404, { error: "not deliverable" });
      }
      const { topic, msg } = found;
      msg.attempts += 1;
      if (body.reason) msg.error = body.reason;

      let statusOut: "requeued" | "dead";
      if (msg.attempts >= MAX_ATTEMPTS) {
        msg.status = "DEAD";
        const idx = queues.get(topic)!.findIndex((m) => m.id === msg.id);
        if (idx >= 0) queues.get(topic)!.splice(idx, 1);
        deadLog.push(msg);
        if (deadLog.length > DEAD_LOG_LIMIT) deadLog.shift();
        dead++;
        failed++;
        topicCounter(topic).dead++;
        topicCounter(topic).failed++;
        statusOut = "dead";
      } else {
        msg.status = "PENDING";
        msg.consumerId = undefined;
        msg.deliveredAt = undefined;
        statusOut = "requeued";
      }
      io.to(topic).emit("nack", { messageId: msg.id, topic, status: msg.status, attempts: msg.attempts });
      io.emit("queue-update", queueStats(topic));
      io.emit("stats", brokerStats());
      writeSnapshot();
      return sendJson(200, { status: statusOut, messageId: msg.id, attempts: msg.attempts });
    }

    // GET /broker/queues
    if (path === "/broker/queues" && req.method === "GET") {
      return sendJson(200, { queues: allQueueStats() });
    }

    // GET /broker/messages?topic=&status=&limit=
    if (path === "/broker/messages" && req.method === "GET") {
      const topic = url.searchParams.get("topic") || undefined;
      const statusParam = url.searchParams.get("status") as QueueStatus | null;
      const limit = Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10));
      const collect: BrokerMessage[] = [];
      for (const [t, msgs] of queues.entries()) {
        if (topic && t !== topic) continue;
        for (const m of msgs) collect.push(m);
      }
      for (const m of ackedLog) { if (topic && m.topic !== topic) continue; collect.push(m); }
      for (const m of deadLog) { if (topic && m.topic !== topic) continue; collect.push(m); }
      const filtered = statusParam ? collect.filter((m) => m.status === statusParam) : collect;
      filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return sendJson(200, { messages: filtered.slice(0, limit), total: filtered.length });
    }

    // GET /broker/stats
    if (path === "/broker/stats" && req.method === "GET") {
      return sendJson(200, brokerStats());
    }

    return sendJson(404, { error: "not found", path });
  } catch (err) {
    console.error("handler error:", err);
    return sendJson(500, { error: "internal" });
  }
}

const httpServer = createServer();

// ---------- socket.io ----------
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Re-wrap request listeners so engine.io only receives polling requests (?EIO=).
// WebSocket upgrades go through the "upgrade" event which socket.io also attaches
// and is unaffected by this re-wrap (we don't expose other websockets here).
const sioRequestListeners = httpServer.listeners("request").slice(0);
httpServer.removeAllListeners("request");
httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  try {
    const u = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (u.searchParams.has("EIO")) {
      for (const l of sioRequestListeners) l.call(httpServer, req, res);
      return;
    }
  } catch {
    // fall through to httpHandler
  }
  httpHandler(req, res);
});

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
  socket.emit("stats", brokerStats());
  socket.on("subscribe", (data: { topic?: string } | string) => {
    const topic = typeof data === "string" ? data : data?.topic;
    if (topic) {
      socket.join(topic);
      console.log(`socket ${socket.id} subscribed to ${topic}`);
    }
  });
  socket.on("unsubscribe", (data: { topic?: string } | string) => {
    const topic = typeof data === "string" ? data : data?.topic;
    if (topic) socket.leave(topic);
  });
  socket.on("disconnect", (reason) => {
    console.log(`socket disconnected: ${socket.id} (${reason})`);
  });
});

const statsTimer = setInterval(() => {
  io.emit("stats", brokerStats());
}, STATS_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`message-broker listening on ${PORT}`);
});

// ---------- Graceful shutdown ----------
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down...`);
  clearInterval(statsTimer);
  writeSnapshot();
  io.close(() => {
    httpServer.close(() => {
      console.log("message-broker closed");
      process.exit(0);
    });
  });
  // Force exit if close hangs
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
