"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiAudit } from "@/lib/api";
import type { AuditEntry } from "@/lib/eco";
import { useAuthStore } from "@/lib/auth-store";
import { ShieldCheck, ScrollText, RefreshCw, CheckCircle2, XCircle } from "lucide-react";

export function AuditPanel() {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [counts, setCounts] = useState<{ auth: number; transaction: number; merged: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "auth" | "transaction">("all");

  const refresh = useCallback(async () => {
    const r = await apiAudit(300);
    if (r.ok) {
      setEntries(r.data?.entries || []);
      setCounts(r.data?.counts || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const shown = filter === "all" ? entries : entries.filter((e) => e.source === filter);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="w-4 h-4" /> Audit Log
            </CardTitle>
            <CardDescription>
              {user?.role === "USER"
                ? "Your own auth + transaction events (USER scope)."
                : "Merged AuthAudit (auth-service) + TxnAudit (transaction-service)."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as any)} size="sm">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="auth">Auth</ToggleGroupItem>
              <ToggleGroupItem value="transaction">Txn</ToggleGroupItem>
            </ToggleGroup>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {counts && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">auth: {counts.auth}</Badge>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">txn: {counts.transaction}</Badge>
            <Badge variant="outline">merged: {counts.merged}</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[34rem] rounded-md border">
          <ul className="divide-y">
            {shown.length === 0 && (
              <li className="text-center text-muted-foreground py-8 text-sm">No audit entries yet.</li>
            )}
            {shown.map((e) => (
              <li key={`${e.source}-${e.id}`} className="flex items-start gap-3 px-3 py-2">
                <div className="mt-0.5">
                  {e.result === "SUCCESS"
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    : <XCircle className="w-4 h-4 text-rose-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] font-mono ${
                      e.source === "auth"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      {e.source === "auth" ? <ShieldCheck className="w-2.5 h-2.5 mr-1" /> : <ScrollText className="w-2.5 h-2.5 mr-1" />}
                      {e.source || "auth"}
                    </Badge>
                    <span className="font-mono text-xs font-medium">{e.action}</span>
                    <span className={`text-[10px] font-semibold ${e.result === "SUCCESS" ? "text-emerald-600" : "text-rose-600"}`}>
                      {e.result}
                    </span>
                    {e.resource && <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[14rem]">{e.resource}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {e.userEmail && <span className="text-[11px] text-muted-foreground">{e.userEmail}</span>}
                    {e.detail && <span className="text-[11px] text-muted-foreground truncate">— {e.detail}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
