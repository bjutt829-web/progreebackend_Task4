// Shared contracts for the Role-Based Microservice API Ecosystem.
// Imported by every mini-service and the Next.js gateway so the wire format is identical everywhere.

export const PORTS = {
  auth: 3001,
  broker: 3002,
  transaction: 3003,
  gateway: 3000,
} as const;

// ---- RBAC ----
export type Role = "ADMIN" | "MANAGER" | "USER";
export const ROLES: Role[] = ["ADMIN", "MANAGER", "USER"];

// Role permission matrix. Higher tier => superset of lower tier.
export const PERMISSIONS = {
  ADMIN: ["users:read", "users:write", "transactions:read:all", "transactions:write", "transactions:approve", "broker:read", "audit:read", "tests:run"],
  MANAGER: ["transactions:read:all", "transactions:write", "transactions:approve", "broker:read", "audit:read"],
  USER: ["transactions:read:own", "transactions:write:own", "broker:read:own"],
} as const;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function hasPermission(role: Role, permission: string): boolean {
  const perms = PERMISSIONS[role] as readonly string[];
  return perms.includes(permission as any);
}

// ---- JWT ----
// Shared HS256 secret. In production each service would hold this via a secret manager.
export const JWT_SECRET =
  process.env.JWT_SECRET || "microservice-ecosystem-demo-secret-2026-please-rotate";

export interface JwtPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
  iat?: number;
  exp?: number;
}

// ---- Auth service ----
export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserPublic;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
  role?: Role;
}

export interface VerifyResponse {
  valid: boolean;
  user?: UserPublic;
  reason?: string;
}

// ---- Broker ----
export type QueueStatus = "PENDING" | "DELIVERED" | "ACK" | "NACK" | "DEAD";

export interface PublishRequest {
  topic: string;
  payload: any;
  durable?: boolean;
}

export interface PublishResponse {
  messageId: string;
  topic: string;
  status: QueueStatus;
  enqueuedAt: string;
}

export interface AckRequest {
  messageId: string;
}
export interface NackRequest {
  messageId: string;
  reason?: string;
}

export interface QueueStats {
  topic: string;
  pending: number;
  delivered: number;
  acked: number;
  dead: number;
  throughput: number; // messages acked per second (rolling)
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
  status: QueueStatus;
  attempts: number;
  consumerId?: string;
  error?: string;
  createdAt: string;
  deliveredAt?: string;
  ackedAt?: string;
}

// ---- Transaction service ----
export type TxnType = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "PAYMENT";
export type TxnStatus = "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface SubmitTransactionRequest {
  type: TxnType;
  amount: number;
  currency?: string;
  reference: string;
  metadata?: Record<string, any>;
}

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

export interface SubmitTransactionResponse {
  transaction: Transaction;
  messageId: string;
}

// ---- Audit ----
export interface AuditEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  action: string;
  resource?: string;
  result: "SUCCESS" | "FAILURE";
  detail?: string;
  createdAt: string;
}

// ---- Health ----
export interface HealthResponse {
  status: "ok";
  service: string;
  uptimeSec: number;
}

// ---- Test runner ----
export interface TestCase {
  id: string;
  suite: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string; // gateway-relative, e.g. /api/transactions
  body?: any;
  headers?: Record<string, string>;
  expectStatus: number;
  expectField?: string; // json path like "user.role"
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
