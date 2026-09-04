import { requireRole, proxyFetch, BROKER_URL, jsonResponse } from "@/lib/services";

// GET /api/broker/queues → broker /broker/queues
// RBAC: ADMIN or MANAGER.
export async function GET(req: Request) {
  const r = await requireRole(req, ["ADMIN", "MANAGER"]);
  if (!r.ok) return r.response;
  return proxyFetch(`${BROKER_URL}/broker/queues`, req);
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
