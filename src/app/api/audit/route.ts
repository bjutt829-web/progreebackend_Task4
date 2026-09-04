import { requireAuth, AUTH_URL, TRANSACTION_URL, identityHeaders, authHeader, jsonResponse } from "@/lib/services";
import type { AuditEntry } from "../../../../../mini-services/shared/contracts";

// GET /api/audit?limit= → verify JWT, then merge AuthAudit (auth-service) + TxnAudit
// (transaction-service). Each entry is tagged with `source`. RBAC: ADMIN/MANAGER
// see all; USER sees only their own entries (both services filter by userEmail for USER).
export async function GET(req: Request) {
  const r = await requireAuth(req);
  if (!r.ok) return r.response;
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") || "100";
  const idHeaders = identityHeaders(r.user);
  const fwd = authHeader(req);

  // Fetch both audit feeds in parallel.
  const [authRes, txnRes] = await Promise.allSettled([
    fetch(`${AUTH_URL}/audit?limit=${limit}`, { headers: { ...fwd } }),
    fetch(`${TRANSACTION_URL}/audit?limit=${limit}`, { headers: { ...idHeaders } }),
  ]);

  const merged: (AuditEntry & { source: "auth" | "transaction" })[] = [];
  let authCount = 0;
  let txnCount = 0;

  if (authRes.status === "fulfilled" && authRes.value.ok) {
    try {
      const data = (await authRes.value.json()) as { entries?: AuditEntry[] };
      if (Array.isArray(data.entries)) {
        authCount = data.entries.length;
        for (const e of data.entries) merged.push({ ...e, source: "auth" });
      }
    } catch {
      /* ignore parse error */
    }
  }
  if (txnRes.status === "fulfilled" && txnRes.value.ok) {
    try {
      const data = (await txnRes.value.json()) as { entries?: AuditEntry[] };
      if (Array.isArray(data.entries)) {
        txnCount = data.entries.length;
        for (const e of data.entries) merged.push({ ...e, source: "transaction" });
      }
    } catch {
      /* ignore parse error */
    }
  }

  // Sort newest first.
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const limitN = Math.max(1, Math.min(500, parseInt(limit, 10)));
  return jsonResponse({
    entries: merged.slice(0, limitN),
    counts: { auth: authCount, transaction: txnCount, merged: merged.length },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
