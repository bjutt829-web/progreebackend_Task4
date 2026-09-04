"use client";
import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiRunTests, apiConsumerStart, apiConsumerStop, apiConsumerStatus } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission, type TestSummary, type TestResult } from "@/lib/eco";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Loader2, FlaskConical, CheckCircle2, XCircle, MinusCircle,
  Gauge, Power, Square, Activity,
} from "lucide-react";

export function TestsPanel() {
  const user = useAuthStore((s) => s.user);
  const canRun = user ? hasPermission(user.role, "tests:run") : false;
  const canControl = user ? hasPermission(user.role, "consumer:control") : false;
  const { toast } = useToast();

  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [consumerRunning, setConsumerRunning] = useState<boolean | null>(null);
  const [consumerBusy, setConsumerBusy] = useState(false);

  const checkConsumer = useCallback(async () => {
    const r = await apiConsumerStatus();
    if (r.ok) setConsumerRunning(Boolean(r.data?.running));
  }, []);

  async function run() {
    setRunning(true);
    const t0 = Date.now();
    const r = await apiRunTests();
    setRunning(false);
    if (r.ok && r.data?.summary) {
      setSummary(r.data.summary);
      toast({
        title: `Verification complete in ${Date.now() - t0}ms`,
        description: `${r.data.summary.passed}/${r.data.summary.total} passed (${r.data.summary.passRate}%)`,
      });
    } else {
      toast({ title: "Test runner failed", description: r.data?.error || `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  async function startConsumer() {
    setConsumerBusy(true);
    await apiConsumerStart();
    setConsumerBusy(false);
    checkConsumer();
  }
  async function stopConsumer() {
    setConsumerBusy(true);
    await apiConsumerStop();
    setConsumerBusy(false);
    checkConsumer();
  }

  return (
    <div className="space-y-6">
      {/* Run + summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="w-4 h-4" /> Automated Endpoint Verification
              </CardTitle>
              <CardDescription>
                Black-box suite drives the whole ecosystem through the gateway: auth (JWT + RBAC), broker, transactions, audit.
              </CardDescription>
            </div>
            <Button onClick={run} disabled={!canRun || running}>
              {running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
              {running ? "Running…" : "Run suite"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!canRun && (
            <p className="text-sm text-muted-foreground mb-3">
              Running the verification suite requires the <strong>ADMIN</strong> role.
            </p>
          )}
          {summary ? (
            <div className="space-y-4">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
                <SummaryStat icon={<Gauge className="w-4 h-4" />} label="Pass rate" value={`${summary.passRate}%`} tone={summary.passRate === 100 ? "emerald" : summary.passRate >= 80 ? "amber" : "rose"} />
                <SummaryStat label="Total" value={summary.total} />
                <SummaryStat icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} label="Passed" value={summary.passed} tone="emerald" />
                <SummaryStat icon={<XCircle className="w-4 h-4 text-rose-600" />} label="Failed" value={summary.failed} tone="rose" />
                <SummaryStat icon={<MinusCircle className="w-4 h-4" />} label="Skipped" value={summary.skipped} tone="muted" />
              </div>
              <p className="text-xs text-muted-foreground">
                Generated {new Date(summary.generatedAt).toLocaleString()} · ran in {summary.durationMs}ms
              </p>
              <ScrollArea className="h-[26rem] rounded-md border">
                <ResultsTable results={summary.results} />
              </ScrollArea>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No results yet. {canRun ? "Click “Run suite” to verify every endpoint." : "Ask an admin to run it."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Admin consumer controls */}
      {canControl && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4" /> Consumer control (ADMIN)
            </CardTitle>
            <CardDescription>Start/stop the transaction-service background consumer that drains the broker queue.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Button variant="outline" onClick={startConsumer} disabled={consumerBusy}>
              <Power className="w-4 h-4 mr-1 text-emerald-600" /> Start
            </Button>
            <Button variant="outline" onClick={stopConsumer} disabled={consumerBusy}>
              <Square className="w-4 h-4 mr-1 text-rose-600" /> Stop
            </Button>
            <Button variant="ghost" onClick={checkConsumer} disabled={consumerBusy}>
              {consumerBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            </Button>
            <Badge variant="outline" className={consumerRunning ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground"}>
              {consumerRunning === null ? "status unknown" : consumerRunning ? "running" : "stopped"}
            </Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({ icon, label, value, tone }: { icon?: React.ReactNode; label: string; value: string | number; tone?: "emerald" | "rose" | "amber" | "muted" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-700" :
    tone === "rose" ? "text-rose-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`text-2xl font-semibold mt-0.5 font-mono ${toneCls}`}>{value}</p>
    </div>
  );
}

function ResultsTable({ results }: { results: TestResult[] }) {
  // Group by suite
  const suites = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = suites.get(r.suite) || [];
    arr.push(r);
    suites.set(r.suite, arr);
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 bg-card">
        <TableRow>
          <TableHead className="w-[2.5rem]">Res</TableHead>
          <TableHead>Test</TableHead>
          <TableHead className="w-[6rem]">Method</TableHead>
          <TableHead>Endpoint</TableHead>
          <TableHead className="w-[4rem] text-right">HTTP</TableHead>
          <TableHead className="w-[5rem] text-right">Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from(suites.entries()).map(([suite, cases]) => (
          <SuiteGroup key={suite} suite={suite} cases={cases} />
        ))}
      </TableBody>
    </Table>
  );
}

function SuiteGroup({ suite, cases }: { suite: string; cases: TestResult[] }) {
  const passed = cases.filter((c) => c.status === "PASS").length;
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={6} className="py-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs uppercase tracking-wide">{suite}</span>
            <Badge variant="outline" className="text-[10px]">{passed}/{cases.length} pass</Badge>
          </div>
        </TableCell>
      </TableRow>
      {cases.map((c) => (
        <TableRow key={c.id}>
          <TableCell>
            {c.status === "PASS" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
              c.status === "FAIL" ? <XCircle className="w-4 h-4 text-rose-600" /> :
              <MinusCircle className="w-4 h-4 text-muted-foreground" />}
          </TableCell>
          <TableCell className="text-xs">
            <div className="font-medium">{c.name}</div>
            {c.detail && <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[28rem]" title={c.detail}>{c.detail}</div>}
          </TableCell>
          <TableCell><Badge variant="outline" className="text-[10px] font-mono">{c.method}</Badge></TableCell>
          <TableCell className="font-mono text-[11px] text-muted-foreground">{c.endpoint}</TableCell>
          <TableCell className="text-right font-mono text-xs">{c.httpStatus ?? "—"}</TableCell>
          <TableCell className="text-right font-mono text-xs text-muted-foreground">{c.durationMs}ms</TableCell>
        </TableRow>
      ))}
    </>
  );
}
