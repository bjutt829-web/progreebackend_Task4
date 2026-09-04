// HS256 JWT implementation with zero external deps (Node crypto only).
// Imports the shared secret from contracts so every service uses the same key.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { JWT_SECRET, type JwtPayload } from "../shared/contracts.ts";

// ---- base64url helpers (no padding) ----
function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function hmacSign(data: string): string {
  return createHmac("sha256", JWT_SECRET).update(data).digest();
}

// ---- public API ----
export function signToken(
  payload: Omit<JwtPayload, "iat" | "exp"> & { iat?: number; exp?: number },
  expiresInSec: number = 86400
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + expiresInSec,
  };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = hmacSign(signingInput);
  const sigB64 = sig
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}

export function verifyToken(
  token: string
): { ok: true; payload: JwtPayload } | { ok: false; reason: string } {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed token" };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  // Header check
  let header: any;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid header" };
  }
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    return { ok: false, reason: "unsupported header" };
  }

  // Signature check (timing-safe)
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = hmacSign(signingInput);
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "invalid signature encoding" };
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: "invalid signature" };
  }

  // Payload decode
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid payload" };
  }
  if (!payload || !payload.sub || !payload.role) {
    return { ok: false, reason: "incomplete payload" };
  }

  // Expiry check
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now >= payload.exp) {
    return { ok: false, reason: "token expired" };
  }

  return { ok: true, payload };
}

// Helper: short random id (used by some flows if needed elsewhere)
export function randomToken(len: number = 32): string {
  return randomBytes(len).toString("hex");
}
