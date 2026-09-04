import { requireRole, proxyFetch, BROKER_URL, jsonResponse } from "@/lib/services";

// GET /api/broker/stats → broker /broker/stats wrapped as { stats }
// RBAC: ADMIN or MANAGER (gateway enforces; broker has no auth).
export async function GET(req: Request) {
  const r = await requireRole(req, ["ADMIN", "MANAGER"]);
  if (!r.ok) return r.response;
  try {
    const res = await fetch(`${BROKER_URL}/broker/stats`, {
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    let stats: unknown = null;
    try {
      stats = JSON.parse(text);
    } catch {
      stats = { raw: text };
    }
    return jsonResponse({ stats }, res.status);
  } catch (e: unknown) {
    return jsonResponse(
      { error: "broker unavailable", detail: e instanceof Error ? e.message : String(e) },
      502
    );
  }
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
