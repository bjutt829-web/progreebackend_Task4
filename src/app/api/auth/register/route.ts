import { proxyFetch, AUTH_URL } from "@/lib/services";

// POST /api/auth/register → auth-service /auth/register (requires admin token)
export async function POST(req: Request) {
  return proxyFetch(`${AUTH_URL}/auth/register`, req);
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
