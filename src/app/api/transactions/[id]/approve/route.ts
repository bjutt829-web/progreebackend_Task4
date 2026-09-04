import { requireAuth, proxyFetch, TRANSACTION_URL, identityHeaders } from "@/lib/services";

// POST /api/transactions/:id/approve → verify JWT, forward x-user-* (MANAGER/ADMIN enforced by txn-service)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const r = await requireAuth(req);
  if (!r.ok) return r.response;
  const { id } = await params;
  return proxyFetch(
    `${TRANSACTION_URL}/transactions/${encodeURIComponent(id)}/approve`,
    req,
    identityHeaders(r.user)
  );
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
