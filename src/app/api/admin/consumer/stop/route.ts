import { requireRole, proxyFetch, TRANSACTION_URL } from "@/lib/services";

// POST /api/admin/consumer/stop → stop the transaction-service background consumer (ADMIN only)
export async function POST(req: Request) {
  const r = await requireRole(req, ["ADMIN"]);
  if (!r.ok) return r.response;
  return proxyFetch(`${TRANSACTION_URL}/admin/consumer/stop`, req);
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
