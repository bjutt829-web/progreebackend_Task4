"use client";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { LoginCard } from "@/components/dashboard/login-card";
import { AppHeader } from "@/components/dashboard/app-header";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { TransactionsPanel } from "@/components/dashboard/transactions-panel";
import { BrokerPanel } from "@/components/dashboard/broker-panel";
import { AuditPanel } from "@/components/dashboard/audit-panel";
import { TestsPanel } from "@/components/dashboard/tests-panel";
import { ArchitecturePanel } from "@/components/dashboard/architecture-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, ArrowRightLeft, Radio, ScrollText, FlaskConical, Boxes } from "lucide-react";

export default function Home() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-6 w-full">
        {!user ? (
          <LoginCard />
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-6 mb-6 h-auto">
              <TabsTrigger value="overview" className="gap-1.5">
                <LayoutDashboard className="w-4 h-4" /> Overview
              </TabsTrigger>
              <TabsTrigger value="transactions" className="gap-1.5">
                <ArrowRightLeft className="w-4 h-4" /> Transactions
              </TabsTrigger>
              <TabsTrigger value="broker" className="gap-1.5">
                <Radio className="w-4 h-4" /> Broker
              </TabsTrigger>
              <TabsTrigger value="audit" className="gap-1.5">
                <ScrollText className="w-4 h-4" /> Audit
              </TabsTrigger>
              <TabsTrigger value="tests" className="gap-1.5">
                <FlaskConical className="w-4 h-4" /> Tests
              </TabsTrigger>
              <TabsTrigger value="architecture" className="gap-1.5">
                <Boxes className="w-4 h-4" /> Architecture
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview"><OverviewPanel /></TabsContent>
            <TabsContent value="transactions"><TransactionsPanel /></TabsContent>
            <TabsContent value="broker"><BrokerPanel /></TabsContent>
            <TabsContent value="audit"><AuditPanel /></TabsContent>
            <TabsContent value="tests"><TestsPanel /></TabsContent>
            <TabsContent value="architecture"><ArchitecturePanel /></TabsContent>
          </Tabs>
        )}
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="container mx-auto max-w-7xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            Role-Based Microservice API Ecosystem · Task 4 · JWT + RBAC · Async Message Broker · Docker Compose
          </p>
          <p className="flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            gateway · auth · broker · transaction microservices
          </p>
        </div>
      </footer>
    </div>
  );
}
