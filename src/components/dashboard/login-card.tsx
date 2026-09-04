"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { apiLogin } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { DEMO_ACCOUNTS, ROLE_META } from "@/lib/eco";
import { Loader2, LogIn, ShieldCheck, Network, Cpu } from "lucide-react";

export function LoginCard() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    const r = await apiLogin(email, password);
    setBusy(false);
    if (r.ok && r.data?.token && r.data?.user) {
      setAuth(r.data.token, r.data.user);
    } else {
      setError(r.data?.error || `Login failed (HTTP ${r.status})`);
    }
  }

  async function quickLogin(em: string, pw: string) {
    setEmail(em);
    setPassword(pw);
    setError(null);
    setBusy(true);
    const r = await apiLogin(em, pw);
    setBusy(false);
    if (r.ok && r.data?.token && r.data?.user) {
      setAuth(r.data.token, r.data.user);
    } else {
      setError(r.data?.error || `Login failed (HTTP ${r.status})`);
    }
  }

  return (
    <div className="min-h-[calc(100vh-13rem)] flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl grid gap-6 lg:grid-cols-2">
        {/* Hero / architecture explainer */}
        <Card className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-card to-muted/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="grid place-items-center w-9 h-9 rounded-lg bg-emerald-600 text-white">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Role-Based Microservice API Ecosystem</CardTitle>
                <CardDescription>Asynchronous Message Brokers · Task 4 Mini Project</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              A modular multi-tier backend with JWT-secured RBAC tiers, an
              in-memory async message broker coordinating transactions without
              database locks, and Docker-Compose orchestration across isolated
              networks.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Feature icon={<ShieldCheck className="w-4 h-4" />} title="JWT + RBAC" desc="ADMIN · MANAGER · USER" />
              <Feature icon={<Network className="w-4 h-4" />} title="Async Broker" desc="pub/sub · ack · nack · retry" />
              <Feature icon={<Cpu className="w-4 h-4" />} title="Microservices" desc="auth · broker · transaction" />
              <Feature icon={<Network className="w-4 h-4" />} title="Docker Compose" desc="isolated tier networks" />
            </div>
          </CardContent>
        </Card>

        {/* Login form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="w-5 h-5" /> Sign in
            </CardTitle>
            <CardDescription>
              Authenticate against <code className="text-xs">auth-service</code> to receive a JWT.
            </CardDescription>
          </CardHeader>
          <form onSubmit={login}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@corp.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                Sign in
              </Button>
            </CardContent>
          </form>
          <Separator className="my-2" />
          <CardFooter className="flex-col items-stretch gap-2 pt-2">
            <p className="text-xs text-muted-foreground text-center">
              Quick sign-in as a demo RBAC tier
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <Button
                  key={a.email}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => quickLogin(a.email, a.password)}
                  className="flex flex-col h-auto py-2 items-center gap-0.5"
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${ROLE_META[a.role].dot}`} />
                  <span className="text-xs font-semibold">{a.role}</span>
                  <span className="text-[10px] text-muted-foreground">{a.email.split("@")[0]}</span>
                </Button>
              ))}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}
