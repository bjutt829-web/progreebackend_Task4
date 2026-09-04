import { requireRole, proxyFetch, BROKER_URL } from "@/lib/services";

// GET /api/broker/messages?topic=&status=&limit= → broker /broker/messages (passthrough query)
// RBAC: ADMIN or MANAGER.
export async function GET(req: Request) {
  const r = await requireRole(req, ["ADMIN", "MANAGER"]);
  if (!r.ok) return r.response;
  const url = new URL(req.url);
  const target = `${BROKER_URL}/broker/messages${url.search}`;
  return proxyFetch(target, req);
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
