// Client-safe types + RBAC helpers for the dashboard.
// NOTE: the shared `mini-services/shared/contracts.ts` file contains JWT_SECRET,
// which must NEVER be bundled into the client. We therefore re-declare the
// client-safe subset here (types + the RBAC permission matrix) so the browser
// bundle stays secret-free.

export type Role = "ADMIN" | "MANAGER" | "USER";

export const ROLES: Role[] = ["ADMIN", "MANAGER", "USER"];

export const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: [
    "users:read", "users:write",
    "transactions:read:all", "transactions:write", "transactions:approve",
    "broker:read", "audit:read", "tests:run", "consumer:control",
  ],
  MANAGER: [
    "transactions:read:all", "transactions:write", "transactions:approve",
    "broker:read", "audit:read",
  ],
  USER: [
    "transactions:read:own", "transactions:write:own", "broker:read:own",
  ],
};

export function hasPermission(role: Role, permission: string): boolean {
  return (PERMISSIONS[role] || []).includes(permission);
}

export const ROLE_META: Record<Role, { label: string; className: string; dot: string; description: string }> = {
  ADMIN: {
    label: "ADMIN",
    className: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    dot: "bg-emerald-500",
    description: "Full access. Manage users, all transactions, broker, audit, and run verification tests.",
  },
  MANAGER: {
    label: "MANAGER",
    className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
    description: "Operate all transactions, approve them, and inspect the broker + audit.",
  },
  USER: {
    label: "USER",
    className: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
    dot: "bg-rose-500",
    description: "Submit and view own transactions only.",
  },
};

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export type TxnType = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "PAYMENT";
export type TxnStatus = "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Transaction {
  id: string;
  userId: string;
  userEmail: string;
  type: TxnType;
  amount: number;
  currency: string;
  status: TxnStatus;
  reference: string;
  messageId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  processedAt?: string;
}

export const TXN_STATUS_META: Record<TxnStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-muted text-muted-foreground border-border" },
  QUEUED: { label: "Queued", className: "bg-purple-100 text-purple-800 border-purple-300" },
  PROCESSING: { label: "Processing", className: "bg-amber-100 text-amber-800 border-amber-300" },
  COMPLETED: { label: "Completed", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  FAILED: { label: "Failed", className: "bg-rose-100 text-rose-800 border-rose-300" },
};

export interface QueueStats {
  topic: string;
  pending: number;
  delivered: number;
  acked: number;
  dead: number;
  throughput: number;
}

export interface BrokerStats {
  published: number;
  delivered: number;
  acked: number;
  failed: number;
  dead: number;
  throughput: number;
  topics: QueueStats[];
  uptimeSec: number;
}

export interface BrokerMessage {
  id: string;
  topic: string;
  payload: any;
  status: "PENDING" | "DELIVERED" | "ACK" | "NACK" | "DEAD";
  attempts: number;
  consumerId?: string;
  error?: string;
  createdAt: string;
  deliveredAt?: string;
  ackedAt?: string;
}

export interface AuditEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  action: string;
  resource?: string;
  result: "SUCCESS" | "FAILURE";
  detail?: string;
  createdAt: string;
  source?: "auth" | "transaction";
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: "ok" | "down";
  detail?: any;
  latencyMs?: number;
}

export interface ServicesHealth {
  status: "ok" | "degraded";
  gateway: { name: string; status: string; uptimeSec: number };
  services: ServiceHealth[];
  checkedAt: string;
}

export interface TestResult {
  id: string;
  suite: string;
  name: string;
  method: string;
  endpoint: string;
  status: "PASS" | "FAIL" | "SKIP";
  httpStatus?: number;
  durationMs: number;
  detail?: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  durationMs: number;
  results: TestResult[];
  generatedAt: string;
}

// Default demo credentials surfaced in the login card.
export const DEMO_ACCOUNTS = [
  { email: "admin@corp.io", password: "admin123", role: "ADMIN" as Role, name: "Admin User" },
  { email: "manager@corp.io", password: "manager123", role: "MANAGER" as Role, name: "Manager User" },
  { email: "user@corp.io", password: "user123", role: "USER" as Role, name: "Plain User" },
];
