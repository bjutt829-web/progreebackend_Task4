import { AUTH_URL, BROKER_URL, TRANSACTION_URL, jsonResponse } from "@/lib/services";

interface ServiceHealth {
  name: string;
  url: string;
  status: "ok" | "down";
  detail?: any;
  latencyMs?: number;
}

// GET /api/services/health → ping all three backend services in parallel and
// report a unified health snapshot. Used by the dashboard header + the test
// suite's first case.
export async function GET() {
  const t0 = Date.now();
  const checks: ServiceHealth[] = [
    { name: "auth-service", url: `${AUTH_URL}/health` },
    { name: "message-broker", url: `${BROKER_URL}/health` },
    { name: "transaction-service", url: `${TRANSACTION_URL}/health` },
  ];

  const results = await Promise.all(
    checks.map(async (c) => {
      const start = Date.now();
      try {
        const res = await fetch(c.url, { headers: { "Content-Type": "application/json" } });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          let detail: any = undefined;
          try {
            detail = await res.json();
          } catch {
            /* ignore */
          }
          return { ...c, status: "ok" as const, detail, latencyMs };
        }
        return { ...c, status: "down" as const, detail: `HTTP ${res.status}`, latencyMs };
      } catch (e: unknown) {
        return {
          ...c,
          status: "down" as const,
          detail: e instanceof Error ? e.message : String(e),
          latencyMs: Date.now() - start,
        };
      }
    })
  );

  const allOk = results.every((r) => r.status === "ok");
  return jsonResponse(
    {
      status: allOk ? "ok" : "degraded",
      gateway: { name: "gateway", status: "ok", uptimeSec: Math.floor((Date.now() - t0) / 1000) + 0 },
      services: results,
      checkedAt: new Date().toISOString(),
    },
    200
  );
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
