import { requireRole, proxyFetch, TRANSACTION_URL } from "@/lib/services";

// POST /api/admin/consumer/start → start the transaction-service background consumer (ADMIN only)
export async function POST(req: Request) {
  const r = await requireRole(req, ["ADMIN"]);
  if (!r.ok) return r.response;
  return proxyFetch(`${TRANSACTION_URL}/admin/consumer/start`, req);
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
