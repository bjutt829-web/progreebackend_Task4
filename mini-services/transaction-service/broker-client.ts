// HTTP client for the message-broker (port 3002).
// All calls go server-to-server to http://localhost:3002 — these are NOT
// browser requests, so Caddy's XTransformPort rules do not apply.
//
// Each helper retries transient errors up to MAX_RETRIES times with BACKOFF_MS
// between attempts. On hard failure (non-2xx after retries, or network throw),
// the helper throws so the caller can decide how to react.
import { PORTS } from "../shared/contracts.ts";

const BROKER_BASE = `http://localhost:${PORTS.broker}`; // http://localhost:3002
const MAX_RETRIES = 2; // 1 initial attempt + 2 retries = 3 total tries
const BACKOFF_MS = 200;

class BrokerError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "BrokerError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson(path: string, body: unknown): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BROKER_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      // Treat 5xx + network as transient -> retry. 4xx -> hard fail (caller bug).
      if (!res.ok) {
        let parsed: any = null;
        try {
          parsed = await res.json();
        } catch {
          try {
            parsed = await res.text();
          } catch {
            parsed = null;
          }
        }
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastErr = new BrokerError(
            `broker ${path} -> ${res.status}`,
            res.status,
            parsed
          );
          await sleep(BACKOFF_MS);
          continue;
        }
        throw new BrokerError(
          `broker ${path} -> ${res.status}`,
          res.status,
          parsed
        );
      }
      return await res.json();
    } catch (e: any) {
      // Network/transport error (fetch threw) — treat as transient.
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS);
        continue;
      }
      throw new BrokerError(
        `broker ${path} unreachable: ${e?.message || String(e)}`,
        0,
        null
      );
    }
  }
  // Should be unreachable, but keep the TS compiler happy.
  throw lastErr instanceof Error
    ? lastErr
    : new BrokerError(`broker ${path} failed`, 0, null);
}

// ---- public helpers ----

export interface PublishResult {
  messageId: string;
  topic: string;
  status: string;
  enqueuedAt?: string;
  [k: string]: any;
}

export async function publish(
  topic: string,
  payload: any
): Promise<PublishResult> {
  const r = await postJson("/broker/publish", { topic, payload });
  if (!r || !r.messageId) {
    throw new BrokerError(
      "broker publish response missing messageId",
      0,
      r
    );
  }
  return r as PublishResult;
}

export interface PollResult {
  message: any | null;
  [k: string]: any;
}

export async function poll(
  topic: string,
  consumerId: string
): Promise<PollResult> {
  const r = await postJson("/broker/poll", { topic, consumerId });
  // Defensive: some brokers may return { message: null } when empty.
  if (!r || typeof r !== "object") return { message: null };
  return r as PollResult;
}

export interface AckResult {
  ok: boolean;
  status?: string;
  [k: string]: any;
}

export async function ack(messageId: string): Promise<AckResult> {
  const r = await postJson("/broker/ack", { messageId });
  return { ok: true, ...r };
}

export interface NackResult {
  ok: boolean;
  status?: string; // "REQUEUED" | "DEAD" | "dead" | ...
  dead?: boolean;
  attempts?: number;
  message?: any;
  [k: string]: any;
}

export async function nack(messageId: string, reason?: string): Promise<NackResult> {
  const r = await postJson("/broker/nack", { messageId, reason });
  return { ok: true, ...r };
}

export { BrokerError };
