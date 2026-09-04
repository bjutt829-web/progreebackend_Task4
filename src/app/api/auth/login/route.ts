import { proxyFetch, AUTH_URL } from "@/lib/services";

// POST /api/auth/login → auth-service /auth/login (no token needed)
export async function POST(req: Request) {
  return proxyFetch(`${AUTH_URL}/auth/login`, req);
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
