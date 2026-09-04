import { requireRole, TRANSACTION_URL, jsonResponse } from "@/lib/services";

// GET /api/admin/consumer/status → consumer running? (ADMIN only)
export async function GET(req: Request) {
  const r = await requireRole(req, ["ADMIN"]);
  if (!r.ok) return r.response;
  try {
    const res = await fetch(`${TRANSACTION_URL}/admin/consumer/status`, {
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return jsonResponse(
      { error: "transaction-service unavailable", detail: e instanceof Error ? e.message : String(e) },
      502
    );
  }
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
