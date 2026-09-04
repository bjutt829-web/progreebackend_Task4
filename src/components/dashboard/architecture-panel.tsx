"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Boxes, Network, ShieldCheck, Cpu, Copy, Check } from "lucide-react";

interface Tier {
  name: string;
  kind: "internal" | "bridge";
  color: string;
  members: { icon: React.ReactNode; name: string; note: string }[];
}

const TIERS: Tier[] = [
  {
    name: "gateway-tier (bridged · only exposed)",
    kind: "bridge",
    color: "border-foreground bg-foreground/5",
    members: [
      { icon: <Network className="w-4 h-4" />, name: "gateway (Next.js)", note: ":3000 → attached to ALL tiers" },
    ],
  },
  {
    name: "auth-tier (internal)",
    kind: "internal",
    color: "border-emerald-300 bg-emerald-50/60",
    members: [
      { icon: <ShieldCheck className="w-4 h-4" />, name: "auth-service", note: ":3001 · owns User + AuthAudit" },
    ],
  },
  {
    name: "broker-tier (internal)",
    kind: "internal",
    color: "border-amber-300 bg-amber-50/60",
    members: [
      { icon: <Network className="w-4 h-4" />, name: "message-broker", note: ":3002 · in-memory pub/sub" },
      { icon: <Boxes className="w-4 h-4" />, name: "rabbitmq:3-management", note: ":5672 · :15672 (prod reference)" },
    ],
  },
  {
    name: "txn-tier (internal)",
    kind: "internal",
    color: "border-purple-300 bg-purple-50/60",
    members: [
      { icon: <Cpu className="w-4 h-4" />, name: "transaction-service", note: ":3003 · also on broker-tier" },
    ],
  },
];

export function ArchitecturePanel() {
  const [content, setContent] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/docs/docker-compose")
      .then((r) => r.json())
      .then((d) => setContent(d?.content || "# docker-compose.yml not found"))
      .catch(() => setContent("# failed to load docker-compose.yml"));
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Copied", description: "docker-compose.yml copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="w-4 h-4" /> Docker Compose — isolated tier networks
          </CardTitle>
          <CardDescription>
            Each backend service lives on its own internal network; only the gateway is exposed.
            transaction-service bridges txn-tier and broker-tier so it can poll the broker without
            exposing it publicly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {TIERS.map((t) => (
              <div key={t.name} className={`rounded-lg border p-3 ${t.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs">{t.name}</span>
                  <Badge variant="outline" className="text-[9px]">{t.kind}</Badge>
                </div>
                <ul className="space-y-1.5">
                  {t.members.map((m) => (
                    <li key={m.name} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 text-foreground">{m.icon}</span>
                      <div>
                        <p className="font-medium leading-tight">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">{m.note}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="w-4 h-4" /> <code className="text-sm">docker-compose.yml</code>
              </CardTitle>
              <CardDescription>The production topology definition (served live from the repo).</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="w-4 h-4 mr-1 text-emerald-600" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[30rem] rounded-md border bg-muted/30">
            <pre className="text-[11px] leading-relaxed font-mono p-4 whitespace-pre-wrap break-words">
              {content || "loading…"}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
