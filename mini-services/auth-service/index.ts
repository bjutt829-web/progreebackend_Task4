// auth-service — Bun.serve based mini-service (port 3001).
// Owns User + AuthAudit tables. Implements HS256 JWT issuance/verify + RBAC.
// No express, no jsonwebtoken, no bcrypt — uses Node crypto directly.
import { PrismaClient } from "@prisma/client";
import { db } from "./db.ts";
import { signToken, verifyToken } from "./jwt.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import {
  PORTS,
  type Role,
  type UserPublic,
  type JwtPayload,
  type LoginRequest,
  type RegisterRequest,
  type HealthResponse,
} from "../shared/contracts.ts";

const SERVICE = "auth-service";
const PORT = PORTS.auth; // 3001
const startedAt = Date.now();

// ---- helpers ----
function uptimeSec(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function toUserPublic(u: any): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    active: u.active,
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : new Date(u.createdAt).toISOString(),
  };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

// ---- audit writer ----
async function audit(input: {
  action: string;
  result: "SUCCESS" | "FAILURE";
  userId?: string;
  userEmail?: string;
  resource?: string;
  ip?: string;
  detail?: string;
}): Promise<void> {
  try {
    await db.authAudit.create({
      data: {
        action: input.action,
        result: input.result,
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        resource: input.resource ?? null,
        ip: input.ip ?? null,
        detail: input.detail ?? null,
      },
    });
  } catch (e) {
    // Audit failures must never break the request flow.
    console.error("[audit] failed to write:", e);
  }
}

// ---- auth helpers ----
function authFromRequest(req: Request): { user?: JwtPayload; reason?: string } {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return { reason: "missing token" };
  const v = verifyToken(m[1]);
  if (!v.ok) return { reason: v.reason };
  return { user: v.payload };
}

function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return undefined;
}

// requireAdmin returns the admin user or a Response (401/403). Caller must check.
async function requireAdmin(
  req: Request
): Promise<{ ok: true; user: JwtPayload } | { ok: false; response: Response }> {
  const a = authFromRequest(req);
  if (!a.user) {
    await audit({
      action: "ACCESS_DENIED",
      result: "FAILURE",
      resource: req.url,
      ip: clientIp(req),
      detail: `auth: ${a.reason}`,
    });
    if (a.reason === "missing token") {
      return { ok: false, response: json({ error: "Unauthorized", reason: a.reason }, 401) };
    }
    return { ok: false, response: json({ error: "Unauthorized", reason: a.reason }, 401) };
  }
  if (a.user.role !== "ADMIN") {
    await audit({
      action: "ACCESS_DENIED",
      result: "FAILURE",
      userId: a.user.sub,
      userEmail: a.user.email,
      resource: req.url,
      ip: clientIp(req),
      detail: `role ${a.user.role} requires ADMIN`,
    });
    return { ok: false, response: json({ error: "Forbidden", reason: "admin role required" }, 403) };
  }
  return { ok: true, user: a.user };
}

// ---- seed ----
const SEED_USERS: { email: string; name: string; password: string; role: Role }[] = [
  { email: "admin@corp.io", name: "Admin User", password: "admin123", role: "ADMIN" },
  { email: "manager@corp.io", name: "Manager User", password: "manager123", role: "MANAGER" },
  { email: "user@corp.io", name: "Plain User", password: "user123", role: "USER" },
];

async function autoSeedIfEmpty(): Promise<void> {
  try {
    const count = await db.user.count();
    if (count === 0) {
      for (const s of SEED_USERS) {
        const passwordHash = hashPassword(s.password);
        await db.user.create({
          data: { email: s.email, name: s.name, passwordHash, role: s.role, active: true },
        });
        await audit({
          action: "REGISTER",
          result: "SUCCESS",
          userEmail: s.email,
          resource: "auth/seed",
          detail: `auto-seeded role=${s.role}`,
        });
      }
      console.log(`[seed] created ${SEED_USERS.length} default users`);
    }
  } catch (e) {
    console.error("[seed] auto-seed failed:", e);
  }
}

// ---- router ----
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
    response = await route(req, path, method);
  } catch (e: any) {
    console.error("[route] unhandled:", e);
    response = json({ error: "internal server error", detail: String(e?.message || e) }, 500);
  }

  const t1 = performance.now();
  console.log(`${method} ${path} -> ${response.status} in ${Math.round(t1 - t0)}ms`);
  return response;
}

async function route(req: Request, path: string, method: string): Promise<Response> {
  // ---- health ----
  if (path === "/health" && method === "GET") {
    const body: HealthResponse = { status: "ok", service: SERVICE, uptimeSec: uptimeSec() };
    return json(body);
  }

  // ---- /auth/seed ----
  if (path === "/auth/seed" && method === "POST") {
    const count = await db.user.count();
    if (count === 0) {
      for (const s of SEED_USERS) {
        const passwordHash = hashPassword(s.password);
        await db.user.create({
          data: { email: s.email, name: s.name, passwordHash, role: s.role, active: true },
        });
        await audit({
          action: "REGISTER",
          result: "SUCCESS",
          userEmail: s.email,
          resource: "auth/seed",
          detail: `seeded role=${s.role}`,
        });
      }
      const finalCount = await db.user.count();
      return json({ seeded: true, count: finalCount });
    }
    return json({ seeded: false, count });
  }

  // ---- /auth/login ----
  if (path === "/auth/login" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) return json({ error: "invalid JSON body" }, 400);
    const { email, password } = body as LoginRequest;
    if (!email || !password) return json({ error: "email and password required" }, 400);

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      await audit({
        action: "LOGIN",
        result: "FAILURE",
        userEmail: email,
        ip: clientIp(req),
        resource: "auth/login",
        detail: user ? "invalid password" : "user not found",
      });
      return json({ error: "Invalid credentials" }, 401);
    }

    await audit({
      action: "LOGIN",
      result: "SUCCESS",
      userId: user.id,
      userEmail: user.email,
      ip: clientIp(req),
      resource: "auth/login",
    });

    const token = signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    });
    return json({ token, user: toUserPublic(user) });
  }

  // ---- /auth/register ----
  if (path === "/auth/register" && method === "POST") {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;

    const body = await parseJsonBody(req);
    if (!body) return json({ error: "invalid JSON body" }, 400);
    const { email, name, password, role } = body as RegisterRequest;
    if (!email || !name || !password) {
      return json({ error: "email, name, and password are required" }, 400);
    }
    const finalRole: Role = role ?? "USER";
    if (!["ADMIN", "MANAGER", "USER"].includes(finalRole)) {
      return json({ error: "invalid role" }, 400);
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      await audit({
        action: "REGISTER",
        result: "FAILURE",
        userEmail: email,
        userId: admin.user.sub,
        resource: "auth/register",
        detail: "email already exists",
      });
      return json({ error: "email already exists" }, 409);
    }

    const created = await db.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(password),
        role: finalRole,
        active: true,
      },
    });
    await audit({
      action: "REGISTER",
      result: "SUCCESS",
      userId: created.id,
      userEmail: created.email,
      resource: "auth/register",
      detail: `registered by ${admin.user.email} role=${finalRole}`,
    });
    return json({ user: toUserPublic(created) }, 201);
  }

  // ---- /auth/verify ----
  if (path === "/auth/verify" && method === "GET") {
    const a = authFromRequest(req);
    if (!a.user) {
      await audit({
        action: "TOKEN_VERIFY",
        result: "FAILURE",
        ip: clientIp(req),
        resource: "auth/verify",
        detail: a.reason,
      });
      return json({ valid: false, reason: a.reason }, 401);
    }
    const user = await db.user.findUnique({ where: { id: a.user.sub } });
    if (!user || !user.active) {
      await audit({
        action: "TOKEN_VERIFY",
        result: "FAILURE",
        userId: a.user.sub,
        userEmail: a.user.email,
        ip: clientIp(req),
        resource: "auth/verify",
        detail: user ? "inactive user" : "user not found",
      });
      return json({ valid: false, reason: "user not found or inactive" }, 401);
    }
    await audit({
      action: "TOKEN_VERIFY",
      result: "SUCCESS",
      userId: user.id,
      userEmail: user.email,
      ip: clientIp(req),
      resource: "auth/verify",
    });
    return json({ valid: true, user: toUserPublic(user) });
  }

  // ---- /auth/me ----
  if (path === "/auth/me" && method === "GET") {
    const a = authFromRequest(req);
    if (!a.user) {
      return json({ error: "Unauthorized", reason: a.reason }, 401);
    }
    const user = await db.user.findUnique({ where: { id: a.user.sub } });
    if (!user || !user.active) {
      return json({ error: "Unauthorized", reason: "user not found or inactive" }, 401);
    }
    return json({ user: toUserPublic(user) });
  }

  // ---- /auth/users ----
  if (path === "/auth/users" && method === "GET") {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
    return json({ users: users.map(toUserPublic) });
  }

  // ---- /audit ----  (returns AuthAudit entries; gateway merges with TxnAudit)
  if (path === "/audit" && method === "GET") {
    const a = authFromRequest(req);
    if (!a.user) {
      await audit({
        action: "ACCESS_DENIED",
        result: "FAILURE",
        ip: clientIp(req),
        resource: "auth/audit",
        detail: `auth: ${a.reason}`,
      });
      return json({ error: "Unauthorized", reason: a.reason }, 401);
    }
    const limit = Math.max(1, Math.min(500, parseInt(new URL(req.url).searchParams.get("limit") || "100", 10)));
    let where: any;
    const role: Role = a.user.role as Role;
    if (role === "ADMIN" || role === "MANAGER") {
      where = {};
    } else {
      // USER: only their own entries (by userEmail or userId).
      where = { userEmail: a.user.email };
    }
    const rows = await db.authAudit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const entries = rows.map((r: any) => ({
      id: r.id,
      userId: r.userId ?? undefined,
      userEmail: r.userEmail ?? undefined,
      action: r.action,
      resource: r.resource ?? undefined,
      result: r.result as "SUCCESS" | "FAILURE",
      detail: r.detail ?? undefined,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(r.createdAt).toISOString(),
    }));
    return json({ entries, source: "auth" });
  }

  // ---- 404 ----
  return json({ error: "Not found", path, method }, 404);
}

// ---- startup + shutdown ----
async function main() {
  await db.$connect();
  await autoSeedIfEmpty();
  const server = Bun.serve({ port: PORT, fetch: handle });
  console.log(`auth-service listening on ${PORT}`);

  const shutdown = async (sig: string) => {
    console.log(`[auth-service] received ${sig}, shutting down...`);
    server.stop(true);
    try {
      await db.$disconnect();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[auth-service] fatal:", e);
  process.exit(1);
});
