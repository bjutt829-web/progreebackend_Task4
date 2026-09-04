import { proxyFetch, AUTH_URL } from "@/lib/services";

// GET /api/auth/users → auth-service /auth/users (admin only; auth-service enforces)
export async function GET(req: Request) {
  return proxyFetch(`${AUTH_URL}/auth/users`, req);
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
