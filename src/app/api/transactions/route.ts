import { requireAuth, proxyFetch, TRANSACTION_URL, identityHeaders, jsonResponse } from "@/lib/services";

// POST /api/transactions { type, amount, currency?, reference, metadata? }
//   → verify JWT, forward x-user-* to transaction-service /transactions
// GET /api/transactions?limit=
//   → verify JWT, forward x-user-*; transaction-service applies role-based filtering
export async function POST(req: Request) {
  const r = await requireAuth(req);
  if (!r.ok) return r.response;
  return proxyFetch(`${TRANSACTION_URL}/transactions`, req, identityHeaders(r.user));
}

export async function GET(req: Request) {
  const r = await requireAuth(req);
  if (!r.ok) return r.response;
  const url = new URL(req.url);
  return proxyFetch(`${TRANSACTION_URL}/transactions${url.search}`, req, identityHeaders(r.user));
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
