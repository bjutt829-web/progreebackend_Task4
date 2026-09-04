import { requireRole, proxyFetch, BROKER_URL } from "@/lib/services";

// POST /api/broker/publish { topic, payload, durable? } → broker /broker/publish
// RBAC: ADMIN only.
export async function POST(req: Request) {
  const r = await requireRole(req, ["ADMIN"]);
  if (!r.ok) return r.response;
  return proxyFetch(`${BROKER_URL}/broker/publish`, req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
