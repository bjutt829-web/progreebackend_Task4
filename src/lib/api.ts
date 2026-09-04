// Thin fetch helpers for the gateway. All gateway routes are relative (same
// origin, port 3000 via the Caddy gateway). The Bearer token is attached
// automatically from the auth store.
import { useAuthStore } from "./auth-store";
import type {
  UserPublic,
  Transaction,
  BrokerStats,
  AuditEntry,
  ServicesHealth,
  TestSummary,
} from "./eco";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

// ---- Auth ----
export async function apiLogin(email: string, password: string) {
  const r = await apiFetch<{ token: string; user: UserPublic }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return r;
}

export async function apiMe() {
  return apiFetch<{ user: UserPublic }>("/api/auth/me");
}

export async function apiListUsers() {
  return apiFetch<{ users: UserPublic[] }>("/api/auth/users");
}

export async function apiRegister(body: { email: string; name: string; password: string; role?: string }) {
  return apiFetch<{ user: UserPublic }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiSeed() {
  return apiFetch<{ seeded: boolean; count: number }>("/api/auth/seed", { method: "POST" });
}

// ---- Transactions ----
export async function apiSubmitTransaction(body: {
  type: string;
  amount: number;
  currency?: string;
  reference: string;
  metadata?: Record<string, any>;
}) {
  return apiFetch<{ transaction: Transaction; messageId: string }>("/api/transactions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiListTransactions(limit = 100) {
  return apiFetch<{ transactions: Transaction[] }>(`/api/transactions?limit=${limit}`);
}

export async function apiApproveTransaction(id: string) {
  return apiFetch<{ transaction: Transaction }>(`/api/transactions/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
}

// ---- Broker ----
export async function apiBrokerStats() {
  return apiFetch<{ stats: BrokerStats }>("/api/broker/stats");
}

export async function apiBrokerQueues() {
  return apiFetch<{ queues: any[] }>("/api/broker/queues");
}

export async function apiBrokerPublish(topic: string, payload: any) {
  return apiFetch<{ messageId: string }>("/api/broker/publish", {
    method: "POST",
    body: JSON.stringify({ topic, payload }),
  });
}

// ---- Audit ----
export async function apiAudit(limit = 200) {
  return apiFetch<{ entries: AuditEntry[]; counts: { auth: number; transaction: number; merged: number } }>(
    `/api/audit?limit=${limit}`
  );
}

// ---- Health ----
export async function apiServicesHealth() {
  return apiFetch<ServicesHealth>("/api/services/health");
}

// ---- Tests ----
export async function apiRunTests() {
  return apiFetch<{ summary: TestSummary }>("/api/tests/run", { method: "POST" });
}

// ---- Consumer control (admin) ----
export async function apiConsumerStart() {
  return apiFetch<{ running: boolean }>("/api/admin/consumer/start", { method: "POST" });
}
export async function apiConsumerStop() {
  return apiFetch<{ running: boolean }>("/api/admin/consumer/stop", { method: "POST" });
}
export async function apiConsumerStatus() {
  return apiFetch<{ running: boolean }>("/api/admin/consumer/status");
}
