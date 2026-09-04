"use client";
import { useAuthStore } from "@/lib/auth-store";
import { useServicesHealth } from "@/hooks/use-services-health";
import { RoleBadge } from "./role-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Network, Activity, Circle } from "lucide-react";
import type { ServiceHealth } from "@/lib/eco";

export function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { health } = useServicesHealth(true, 5000);

  const services = health?.services || [];
  const allOk = services.length > 0 && services.every((s) => s.status === "ok");

  return (
    <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid place-items-center w-8 h-8 rounded-md bg-emerald-600 text-white shrink-0">
            <Network className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight truncate">
              Microservice API Ecosystem
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">
              JWT · RBAC · Async Broker · Docker Compose
            </p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1.5">
          {services.length === 0 ? (
            <Badge variant="outline" className="text-muted-foreground">
              <Activity className="w-3 h-3 mr-1" /> checking…
            </Badge>
          ) : (
            <>
              <ServicePill services={services} />
              <Badge
                variant="outline"
                className={
                  allOk
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : "bg-rose-50 text-rose-700 border-rose-300"
                }
              >
                <Circle className={`w-2 h-2 mr-1 rounded-full ${allOk ? "bg-emerald-500" : "bg-rose-500"}`} />
                {allOk ? "all healthy" : "degraded"}
              </Badge>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-muted-foreground truncate max-w-[10rem]">{user.email}</span>
              <RoleBadge role={user.role} />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={logout} className="shrink-0">
            <LogOut className="w-4 h-4 mr-1" /> Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

function ServicePill({ services }: { services: ServiceHealth[] }) {
  return (
    <div className="flex items-center gap-1">
      {services.map((s) => (
        <span
          key={s.name}
          title={`${s.name}: ${s.status} (${s.latencyMs ?? "?"}ms)`}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
            s.status === "ok"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-rose-50 text-rose-700 border-rose-200"
          }`}
        >
          <Circle className={`w-1.5 h-1.5 rounded-full ${s.status === "ok" ? "bg-emerald-500" : "bg-rose-500"}`} />
          {s.name.replace("-service", "").replace("message-", "broker-")}
        </span>
      ))}
    </div>
  );
}
