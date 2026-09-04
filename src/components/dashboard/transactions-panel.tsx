"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiSubmitTransaction, apiListTransactions, apiApproveTransaction } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  TXN_STATUS_META, type Transaction, type TxnType, type TxnStatus, type Role,
} from "@/lib/eco";
import { hasPermission } from "@/lib/eco";
import { Send, CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";

const TXN_TYPES: TxnType[] = ["DEPOSIT", "WITHDRAWAL", "TRANSFER", "PAYMENT"];
const CURRENCIES = ["USD", "EUR", "GBP", "PKR", "JPY"];

export function TransactionsPanel() {
  const user = useAuthStore((s) => s.user);
  const role: Role = user?.role || "USER";
  const canApprove = hasPermission(role, "transactions:approve");
  const { toast } = useToast();

  const [type, setType] = useState<TxnType>("DEPOSIT");
  const [amount, setAmount] = useState("25");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await apiListTransactions(200);
    if (r.ok) setTxns(r.data?.transactions || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh]);

  const counts = useMemo(() => {
    const c: Record<TxnStatus, number> = { PENDING: 0, QUEUED: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    for (const t of txns) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [txns]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Invalid amount", description: "Amount must be a positive number.", variant: "destructive" });
      return;
    }
    if (!reference.trim()) {
      toast({ title: "Reference required", description: "Provide a transaction reference.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const r = await apiSubmitTransaction({ type, amount: amt, currency, reference: reference.trim() });
    setSubmitting(false);
    if (r.ok) {
      toast({
        title: "Transaction enqueued",
        description: `${type} ${amt} ${currency} → status: ${r.data?.transaction?.status} (messageId ${(r.data?.messageId || "").slice(0, 8)})`,
      });
      setReference("");
      refresh();
    } else {
      toast({ title: "Submit failed", description: r.data?.error || `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  async function seedOne() {
    const ref = `seed-${Date.now().toString(36)}`;
    setSubmitting(true);
    const types: TxnType[] = ["DEPOSIT", "WITHDRAWAL", "TRANSFER", "PAYMENT"];
    const t = types[Math.floor(Math.random() * types.length)];
    const amt = Math.floor(Math.random() * 990 + 10);
    const r = await apiSubmitTransaction({ type: t, amount: amt, reference: ref });
    setSubmitting(false);
    if (r.ok) {
      toast({ title: "Seeded transaction", description: `${t} ${amt} USD ref=${ref}` });
      refresh();
    } else {
      toast({ title: "Seed failed", description: r.data?.error || `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  async function approve(id: string) {
    setApprovingId(id);
    const r = await apiApproveTransaction(id);
    setApprovingId(null);
    if (r.ok) {
      toast({ title: "Approved", description: `Transaction ${id.slice(0, 8)} marked COMPLETED.` });
      refresh();
    } else {
      toast({ title: "Approve failed", description: r.data?.error || `HTTP ${r.status}`, variant: "destructive" });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      {/* Submit form */}
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4" /> Submit Transaction
          </CardTitle>
          <CardDescription>
            Published to the <code className="text-xs">transactions</code> topic; the consumer drains the queue asynchronously.
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3.5">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TxnType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TXN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input placeholder="e.g. invoice-1024" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                Enqueue
              </Button>
              <Button type="button" variant="outline" onClick={seedOne} disabled={submitting} title="Submit a random transaction">
                <Sparkles className="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={refresh} disabled={loading}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      {/* Transaction list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span>Transactions {canApprove ? "· all accounts" : "· your account"}</span>
            <StatusTally counts={counts} />
          </CardTitle>
          <CardDescription>
            Auto-refreshes every 2.5s. Status flows PENDING → QUEUED → PROCESSING → COMPLETED (or FAILED after 3 nacks).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[28rem] rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-[8rem]">Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[8rem]">Created</TableHead>
                  {canApprove && <TableHead className="w-[5rem] text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canApprove ? 6 : 5} className="text-center text-muted-foreground py-8">
                      No transactions yet. Submit one to see it flow through the broker → consumer.
                    </TableCell>
                  </TableRow>
                )}
                {txns.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs truncate max-w-[8rem]">{t.reference}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono text-[10px]">{t.type}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-xs">{t.amount.toFixed(2)} {t.currency}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TXN_STATUS_META[t.status].className}>
                        {TXN_STATUS_META[t.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleTimeString()}</TableCell>
                    {canApprove && (
                      <TableCell className="text-right">
                        {t.status !== "COMPLETED" && t.status !== "FAILED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approvingId === t.id}
                            onClick={() => approve(t.id)}
                          >
                            {approvingId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                            Approve
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTally({ counts }: { counts: Record<TxnStatus, number> }) {
  const order: TxnStatus[] = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "PENDING"];
  return (
    <div className="flex items-center gap-1">
      {order.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <Badge variant="outline" className={`text-[10px] ${TXN_STATUS_META[s].className}`}>
            {counts[s] || 0}
          </Badge>
        </span>
      ))}
    </div>
  );
}
