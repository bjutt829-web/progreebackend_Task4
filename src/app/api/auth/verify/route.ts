import { proxyFetch, AUTH_URL } from "@/lib/services";

// GET /api/auth/verify → auth-service /auth/verify (forwards Authorization)
export async function GET(req: Request) {
  return proxyFetch(`${AUTH_URL}/auth/verify`, req);
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
