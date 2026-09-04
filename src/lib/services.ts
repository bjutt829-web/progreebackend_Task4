// Gateway orchestration helpers.
// The Next.js gateway is a pure API gateway / BFF: it verifies JWTs via
// auth-service, enforces RBAC, then forwards requests to the three backend
// mini-services. It owns NO database tables.
import type { Role, UserPublic, VerifyResponse } from "../../mini-services/shared/contracts";

export const AUTH_URL = process.env.AUTH_SERVICE_URL || "http://localhost:3001";
export const BROKER_URL = process.env.BROKER_URL || "http://localhost:3002";
export const TRANSACTION_URL =
  process.env.TRANSACTION_SERVICE_URL || "http://localhost:3003";
export const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000";

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Forward a request to an upstream service, passing through method + body and
// adding extra headers. Returns a fresh Response (so the body is readable).
export async function proxyFetch(
  upstreamUrl: string,
  req: Request,
  extraHeaders: Record<string, string> = {},
  methodOverride?: string
): Promise<Response> {
  const method = methodOverride || req.method;
  // Forward the caller's Authorization header by default so token-bearing
  // auth routes (/me, /verify, /users, /register) reach auth-service. Routes
  // that need to inject different headers (e.g. x-user-* to transaction-service)
  // pass them via extraHeaders; extraHeaders win over the forwarded token.
  const incomingAuth = req.headers.get("authorization");
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(incomingAuth ? { Authorization: incomingAuth } : {}),
      ...extraHeaders,
    },
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const res = await fetch(upstreamUrl, init);
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  } catch (e: unknown) {
    return jsonResponse(
      { error: "upstream unavailable", detail: e instanceof Error ? e.message : String(e) },
      502
    );
  }
}

// Verify the Bearer token in the incoming request via auth-service /auth/verify.
// Returns the user on success, or null.
export async function verifyAuth(req: Request): Promise<UserPublic | null> {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  try {
    const res = await fetch(`${AUTH_URL}/auth/verify`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VerifyResponse;
    return data.valid && data.user ? data.user : null;
  } catch {
    return null;
  }
}

// requireAuth: returns the authenticated user or a 401 Response.
export async function requireAuth(
  req: Request
): Promise<{ ok: true; user: UserPublic } | { ok: false; response: Response }> {
  const user = await verifyAuth(req);
  if (!user) return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  return { ok: true, user };
}

// requireRole: like requireAuth but also enforces the user's role.
export async function requireRole(
  req: Request,
  roles: Role[]
): Promise<{ ok: true; user: UserPublic } | { ok: false; response: Response }> {
  const r = await requireAuth(req);
  if (!r.ok) return r;
  if (!roles.includes(r.user.role)) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Forbidden", reason: `requires role: ${roles.join(" or ")}` },
        403
      ),
    };
  }
  return r;
}

// Build x-user-* identity headers to forward to transaction-service.
export function identityHeaders(user: UserPublic): Record<string, string> {
  return {
    "x-user-id": user.id,
    "x-user-email": user.email,
    "x-user-role": user.role,
  };
}

// Forward the caller's Authorization header.
export function authHeader(req: Request): Record<string, string> {
  const auth = req.headers.get("authorization");
  return auth ? { Authorization: auth } : {};
}

// Fetch an upstream URL with a GET and return parsed JSON, or null on error.
export async function getJson<T = any>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
