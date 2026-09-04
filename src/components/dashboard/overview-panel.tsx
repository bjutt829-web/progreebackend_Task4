"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiServicesHealth } from "@/lib/api";
import { PERMISSIONS, hasPermission, type ServicesHealth, type ServiceHealth, type Role } from "@/lib/eco";
import { useAuthStore } from "@/lib/auth-store";
import { ShieldCheck, Network, Cpu, Server, Activity, CheckCircle2, XCircle } from "lucide-react";

const ALL_PERMISSIONS = [
  "users:read", "users:write",
  "transactions:read:all", "transactions:read:own", "transactions:write", "transactions:write:own", "transactions:approve",
  "broker:read", "audit:read", "tests:run", "consumer:control",
];

const PERMISSION_LABELS: Record<string, string> = {
  "users:read": "Users · read",
  "users:write": "Users · write",
  "transactions:read:all": "Txns · read all",
  "transactions:read:own": "Txns · read own",
  "transactions:write": "Txns · submit",
  "transactions:write:own": "Txns · submit own",
  "transactions:approve": "Txns · approve",
  "broker:read": "Broker · read",
  "audit:read": "Audit · read",
  "tests:run": "Tests · run",
  "consumer:control": "Consumer · start/stop",
};

export function OverviewPanel() {
  const user = useAuthStore((s) => s.user);
  const [health, setHealth] = useState<ServicesHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const r = await apiServicesHealth();
      if (!cancelled) setHealth(r.data);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const role: Role = user?.role || "USER";

  return (
    <div className="space-y-6">
      {/* Architecture diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="w-4 h-4" /> System Architecture
          </CardTitle>
          <CardDescription>
            Next.js API gateway orchestrates three isolated mini-services over HTTP.
            The transaction-service publishes to the message broker and a background
            consumer drains the queue without holding database locks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArchitectureDiagram health={health} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Service health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4" /> Service Health
            </CardTitle>
            <CardDescription>Live probes against each mini-service <code className="text-xs">/health</code>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(health?.services || []).map((s) => (
              <ServiceHealthRow key={s.name} s={s} />
            ))}
            {!health && <p className="text-sm text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>

        {/* RBAC permission matrix */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-4 h-4" /> RBAC — your permissions
            </CardTitle>
            <CardDescription>
              Tier <span className="font-semibold">{role}</span> — enforced by JWT claims at the gateway + each service.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_PERMISSIONS.map((p) => {
                const granted = hasPermission(role, p);
                return (
                  <div
                    key={p}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                      granted
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-muted/40 text-muted-foreground border-border line-through opacity-70"
                    }`}
                  >
                    {granted ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="truncate">{PERMISSION_LABELS[p] || p}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              Matrix: ADMIN ⊇ MANAGER ⊇ USER. Manager lacks user management + test/consumer controls; USER sees only own transactions.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ServiceHealthRow({ s }: { s: ServiceHealth }) {
  const ok = s.status === "ok";
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />}
        <div>
          <p className="text-sm font-medium">{s.name}</p>
          <p className="text-[11px] text-muted-foreground truncate max-w-[14rem]">{s.url}</p>
        </div>
      </div>
      <div className="text-right">
        <Badge variant="outline" className={ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
          {s.status}
        </Badge>
        {typeof s.latencyMs === "number" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{s.latencyMs}ms</p>
        )}
      </div>
    </div>
  );
}

function ArchitectureDiagram({ health }: { health: ServicesHealth | null }) {
  const services = health?.services || [];
  const stat = (name: string) => services.find((s) => s.name === name)?.status === "ok";
  const okAuth = stat("auth-service");
  const okBroker = stat("message-broker");
  const okTxn = stat("transaction-service");

  return (
    <div className="rounded-lg border bg-gradient-to-b from-muted/30 to-background p-4 md:p-6">
      <div className="flex flex-col items-center gap-3">
        {/* Browser */}
        <Box icon={<Activity className="w-4 h-4" />} title="Browser / Dashboard" sub="port 3000 (Caddy → Next.js)" tone="neutral" />

        <Connector label="relative /api/* + io('/?XTransformPort=3002')" />

        {/* Gateway */}
        <Box icon={<Network className="w-4 h-4" />} title="API Gateway (Next.js)" sub="RBAC enforcement · JWT verify via auth-service" tone="primary" />

        <Connector label="server→server HTTP (localhost:3001/3002/3003)" />

        {/* Three services */}
        <div className="grid gap-3 md:grid-cols-3 w-full max-w-3xl">
          <Box icon={<ShieldCheck className="w-4 h-4" />} title="auth-service" sub="JWT HS256 · RBAC · User/AuthAudit" tone={okAuth ? "ok" : "down"} />
          <Box icon={<Network className="w-4 h-4" />} title="message-broker" sub="in-memory pub/sub · ack/nack · socket.io" tone={okBroker ? "ok" : "down"} />
          <Box icon={<Cpu className="w-4 h-4" />} title="transaction-service" sub="producer + consumer · Txn/Queue/TxnAudit" tone={okTxn ? "ok" : "down"} />
        </div>

        {/* Broker ↔ transaction loop */}
        <div className="w-full max-w-3xl mt-1">
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">transaction-service</span>
            <span>→ publish / poll / ack / nack →</span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">message-broker</span>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-2">
            Async queue decouples submission from processing — no long-held DB locks under load.
          </p>
        </div>
      </div>
    </div>
  );
}

function Box({
  icon, title, sub, tone,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: "neutral" | "primary" | "ok" | "down";
}) {
  const toneCls =
    tone === "primary"
      ? "bg-foreground text-background border-foreground"
      : tone === "ok"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
      : tone === "down"
      ? "bg-rose-50 border-rose-300 text-rose-900"
      : "bg-card border-border text-foreground";
  return (
    <div className={`rounded-lg border px-4 py-3 min-w-[15rem] w-full md:w-auto ${toneCls}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <p className={`text-[11px] mt-0.5 ${tone === "primary" ? "text-background/70" : "opacity-75"}`}>{sub}</p>
    </div>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-5 bg-border" />
      <span className="text-[10px] text-muted-foreground px-2">{label}</span>
      <div className="w-px h-5 bg-border" />
    </div>
  );
}
