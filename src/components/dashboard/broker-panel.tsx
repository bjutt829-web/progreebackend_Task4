"use client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBrokerSocket } from "@/hooks/use-broker-socket";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/eco";
import { apiBrokerPublish } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Activity, Radio, Send, TrendingUp, Layers, AlertOctagon, CheckCheck } from "lucide-react";

export function BrokerPanel() {
  const user = useAuthStore((s) => s.user);
  const canReadBroker = user ? hasPermission(user.role, "broker:read") : false;
  const canPublish = user ? hasPermission(user.role, "broker:read") && user.role === "ADMIN" : false;
  const { connected, stats, events } = useBrokerSocket(canReadBroker);
  const { toast } = useToast();
  const [topic, setTopic] = useState("test-topic");
  const [payload, setPayload] = useState('{"hello":"world"}');

  async function publish() {
    let body: any = { hello: "world" };
    try {
      body = JSON.parse(payload);
    } catch {
      toast({ title: "Invalid JSON payload", variant: "destructive" });
      return;
    }
    const r = await apiBrokerPublish(topic, body);
    if (r.ok) {
      toast({ title: "Published", description: `messageId ${(r.data?.messageId || "").slice(0, 8)} on "${topic}"` });
    } else {
      toast({ title: "Publish failed", description: r.data?.error || `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  if (!canReadBroker) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Your role ({user?.role}) cannot read the message broker.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection banner */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={connected ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-rose-50 text-rose-700 border-rose-300"}>
            <Radio className={`w-3 h-3 mr-1 ${connected ? "animate-pulse text-emerald-500" : "text-rose-500"}`} />
            {connected ? "LIVE · socket.io" : "disconnected"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            ws to message-broker (port 3002 via <code>XTransformPort</code>)
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          uptime {Math.floor((stats?.uptimeSec || 0))}s
        </span>
      </div>

      {/* Global counters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat icon={<Send className="w-4 h-4" />} label="Published" value={stats?.published ?? 0} tone="text-foreground" />
        <Stat icon={<Activity className="w-4 h-4" />} label="Delivered" value={stats?.delivered ?? 0} tone="text-amber-600" />
        <Stat icon={<CheckCheck className="w-4 h-4" />} label="Acked" value={stats?.acked ?? 0} tone="text-emerald-600" />
        <Stat icon={<AlertOctagon className="w-4 h-4" />} label="Failed" value={stats?.failed ?? 0} tone="text-rose-600" />
        <Stat icon={<Layers className="w-4 h-4" />} label="Dead-letter" value={stats?.dead ?? 0} tone="text-rose-700" />
        <Stat icon={<TrendingUp className="w-4 h-4" />} label="Throughput/s" value={Number((stats?.throughput || 0).toFixed(2))} tone="text-foreground" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queues */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="w-4 h-4" /> Queues
            </CardTitle>
            <CardDescription>Per-topic queue depth + delivery state.</CardDescription>
          </CardHeader>
          <CardContent>
            {(stats?.topics || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No topics yet. Submit a transaction or publish a message.</p>
            ) : (
              <div className="space-y-2">
                {(stats?.topics || []).map((q) => (
                  <div key={q.topic} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-medium">{q.topic}</span>
                      <Badge variant="outline" className="text-[10px]">{q.throughput.toFixed(2)}/s</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                      <MiniStat label="pending" value={q.pending} cls="bg-muted text-foreground" />
                      <MiniStat label="delivered" value={q.delivered} cls="bg-amber-50 text-amber-700" />
                      <MiniStat label="acked" value={q.acked} cls="bg-emerald-50 text-emerald-700" />
                      <MiniStat label="dead" value={q.dead} cls="bg-rose-50 text-rose-700" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live event feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="w-4 h-4" /> Live event feed
            </CardTitle>
            <CardDescription>Socket events from the broker (publish / ack / nack).</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72 rounded-md border p-2">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Waiting for events…</p>
              ) : (
                <ul className="space-y-1 text-xs font-mono">
                  {events.map((ev, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">{new Date(ev.ts).toLocaleTimeString()}</span>
                      <span className={
                        ev.kind === "ack" ? "text-emerald-600" :
                        ev.kind === "nack" ? "text-rose-600" :
                        ev.kind === "publish" ? "text-amber-600" :
                        ev.kind === "error" || ev.kind === "disconnect" ? "text-rose-600" :
                        "text-emerald-600"
                      }>[{ev.kind}]</span>
                      <span className="text-foreground">{ev.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Publish (admin only) */}
      {canPublish && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="w-4 h-4" /> Publish to broker (ADMIN)
            </CardTitle>
            <CardDescription>Inject a message directly into a topic to exercise pub/sub.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Topic</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[16rem]">
              <Label className="text-xs">Payload (JSON)</Label>
              <Input value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono" />
            </div>
            <Button onClick={publish}><Send className="w-4 h-4 mr-1" /> Publish</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className={`flex items-center gap-1.5 ${tone}`}>
        {icon}
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold mt-1 font-mono">{value}</p>
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded px-1 py-0.5 ${cls}`}>
      <div className="text-base font-semibold font-mono leading-tight">{value}</div>
      <div className="text-[9px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}
