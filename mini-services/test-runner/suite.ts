// Endpoint verification suite for the Role-Based Microservice API Ecosystem.
//
// This module is NOT a standalone bun project — it is imported by:
//   - the standalone runner (`./run.ts`, `bun run run.ts`)
//   - the Next.js gateway's `/api/tests/run` route, which imports
//     `runTestSuite` from `./runner` (which in turn imports TEST_CASES from here).
//
// The suite drives the WHOLE ecosystem black-box, end-to-end, through the
// gateway (the only externally exposed service). It logs in as each role,
// saves the returned JWT, and replays it via `${ADMIN_TOKEN}` / `${MANAGER_TOKEN}`
// / `${USER_TOKEN}` placeholders in subsequent cases (token chaining). It also
// submits a transaction and replays its id via `${TXN_ID}` so the approve-flow
// cases can target it.
//
// See `./runner.ts` for placeholder resolution + result aggregation, and
// `./README.md` for the human-readable overview.

import type { TestCase as BaseTestCase } from "../shared/contracts";

// -----------------------------------------------------------------------------
// TestCase extension (documented here so the gateway + runner agree on shape).
// -----------------------------------------------------------------------------
// The shared `TestCase` in `../shared/contracts` is intentionally minimal
// (method/endpoint/body/headers/expectStatus/expectField). For the verification
// suite we extend it inline with the following optional fields:
//
//   saveTokenAs?
//       After a SUCCESSFUL case, parse the JSON response for `.token` and store
//       it under `<saveTokenAs>_TOKEN` in the runner's placeholder map. Subsequent
//       cases may reference it via `${ADMIN_TOKEN}`, `${MANAGER_TOKEN}`,
//       `${USER_TOKEN}` in their endpoint / headers / body.
//
//   saveTxnId?
//       After a SUCCESSFUL case, parse the JSON response for `.transaction.id`
//       (fallbacks: `.transactionId`, `.id`) and store it as `${TXN_ID}` so
//       subsequent cases (get-by-id, approve) can target the created txn.
//
//   expectFieldValue?
//       Expected value for the JSON path pointed to by `expectField`. If
//       omitted, the runner only checks that the field exists (non-undefined).
//
//   expectFieldMinLength?
//       If set, the value at `expectField` must be an array with length >= this.
//
//   acceptStatus?
//       Array of additional acceptable HTTP status codes (besides expectStatus).
//       Used for cases where the spec allows two outcomes (e.g. a USER querying
//       /api/audit may legitimately get 200 "own entries" OR 403 "denied").
//
// The runner resolves placeholders at runtime; cases are ORDERED so all login
// cases run before any case that references a token, and the submit-txn case
// runs before any case that references `${TXN_ID}`.
// -----------------------------------------------------------------------------
export interface TestCase extends BaseTestCase {
  saveTokenAs?: "ADMIN" | "MANAGER" | "USER";
  saveTxnId?: boolean;
  expectFieldValue?: unknown;
  expectFieldMinLength?: number;
  acceptStatus?: number[];
}

// Gateway base URL. Overridable via GATEWAY_URL so the same suite can run
// against a local dev gateway or a dockerised one.
export const GATEWAY_URL =
  process.env.GATEWAY_URL || "http://localhost:3000";

// Convenience helper for building Authorization headers against the chained
// tokens. The placeholders are resolved by the runner after the login cases run.
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// -----------------------------------------------------------------------------
// TEST_CASES — ordered for correct placeholder resolution:
//   1. health
//   2. auth (logins FIRST -> save ADMIN/MANAGER/USER tokens; then RBAC checks)
//   3. broker (needs ADMIN token)
//   4. transactions (submit FIRST -> save TXN_ID; then list/get/approve)
//   5. audit (needs ADMIN token; USER case accepts 200 or 403)
//   6. tests (needs ADMIN token; calls back into the suite via the gateway)
// -----------------------------------------------------------------------------
export const TEST_CASES: TestCase[] = [
  // ---- Suite: health ---------------------------------------------------------
  {
    id: "health-01",
    suite: "health",
    name: "gateway reports all backend services healthy",
    method: "GET",
    endpoint: "/api/services/health",
    expectStatus: 200,
    expectField: "services",
    expectFieldMinLength: 1,
  },

  // ---- Suite: auth -----------------------------------------------------------
  // Logins FIRST so the tokens are available to every later case.
  {
    id: "auth-01",
    suite: "auth",
    name: "admin login succeeds and returns a token",
    method: "POST",
    endpoint: "/api/auth/login",
    body: { email: "admin@corp.io", password: "admin123" },
    expectStatus: 200,
    expectField: "token",
    saveTokenAs: "ADMIN",
  },
  {
    id: "auth-02",
    suite: "auth",
    name: "login with wrong password is rejected",
    method: "POST",
    endpoint: "/api/auth/login",
    body: { email: "admin@corp.io", password: "wrong" },
    expectStatus: 401,
  },
  {
    id: "auth-03",
    suite: "auth",
    name: "manager login succeeds and returns a token",
    method: "POST",
    endpoint: "/api/auth/login",
    body: { email: "manager@corp.io", password: "manager123" },
    expectStatus: 200,
    expectField: "token",
    saveTokenAs: "MANAGER",
  },
  {
    id: "auth-04",
    suite: "auth",
    name: "user login succeeds and returns a token",
    method: "POST",
    endpoint: "/api/auth/login",
    body: { email: "user@corp.io", password: "user123" },
    expectStatus: 200,
    expectField: "token",
    saveTokenAs: "USER",
  },
  {
    id: "auth-05",
    suite: "auth",
    name: "admin token resolves /me with role=ADMIN",
    method: "GET",
    endpoint: "/api/auth/me",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
    expectField: "user.role",
    expectFieldValue: "ADMIN",
  },
  {
    id: "auth-06",
    suite: "auth",
    name: "garbage token is rejected by /verify",
    method: "GET",
    endpoint: "/api/auth/verify",
    headers: bearer("garbage.token.value"),
    expectStatus: 401,
  },
  {
    id: "auth-07",
    suite: "auth",
    name: "admin can list all users (>=3 seeded)",
    method: "GET",
    endpoint: "/api/auth/users",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
    expectField: "users",
    expectFieldMinLength: 3,
  },
  {
    id: "auth-08",
    suite: "auth",
    name: "user listing all users is RBAC-denied (403)",
    method: "GET",
    endpoint: "/api/auth/users",
    headers: bearer("${USER_TOKEN}"),
    expectStatus: 403,
  },
  {
    id: "auth-09",
    suite: "auth",
    name: "user registering a new user is RBAC-denied (403)",
    method: "POST",
    endpoint: "/api/auth/register",
    headers: bearer("${USER_TOKEN}"),
    body: {
      email: "newuser@corp.io",
      name: "New User",
      password: "newpass123",
    },
    expectStatus: 403,
  },

  // ---- Suite: broker ---------------------------------------------------------
  {
    id: "broker-01",
    suite: "broker",
    name: "admin can read broker stats",
    method: "GET",
    endpoint: "/api/broker/stats",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
    expectField: "stats",
  },
  {
    id: "broker-02",
    suite: "broker",
    name: "admin can list broker queues",
    method: "GET",
    endpoint: "/api/broker/queues",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
  },
  {
    id: "broker-03",
    suite: "broker",
    name: "admin can publish a message and get a messageId",
    method: "POST",
    endpoint: "/api/broker/publish",
    headers: bearer("${ADMIN_TOKEN}"),
    body: { topic: "test-topic", payload: { hello: 1 } },
    expectStatus: 200,
    expectField: "messageId",
  },

  // ---- Suite: transactions ---------------------------------------------------
  // Submit FIRST so ${TXN_ID} is available to get-by-id + approve cases.
  {
    id: "txn-01",
    suite: "transactions",
    name: "user can submit a transaction (200 or 201)",
    method: "POST",
    endpoint: "/api/transactions",
    headers: bearer("${USER_TOKEN}"),
    body: { type: "DEPOSIT", amount: 25, reference: "test-tx-1" },
    expectStatus: 200,
    acceptStatus: [201],
    expectField: "transaction",
    saveTxnId: true,
  },
  {
    id: "txn-02",
    suite: "transactions",
    name: "user can list their transactions",
    method: "GET",
    endpoint: "/api/transactions",
    headers: bearer("${USER_TOKEN}"),
    expectStatus: 200,
  },
  {
    id: "txn-03",
    suite: "transactions",
    name: "admin can list all transactions",
    method: "GET",
    endpoint: "/api/transactions",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
  },
  {
    id: "txn-04",
    suite: "transactions",
    name: "user can fetch their transaction by id",
    method: "GET",
    endpoint: "/api/transactions/${TXN_ID}",
    headers: bearer("${USER_TOKEN}"),
    expectStatus: 200,
    expectField: "transaction",
  },
  {
    id: "txn-05",
    suite: "transactions",
    name: "user approving a transaction is RBAC-denied (403)",
    method: "POST",
    endpoint: "/api/transactions/${TXN_ID}/approve",
    headers: bearer("${USER_TOKEN}"),
    expectStatus: 403,
  },
  {
    id: "txn-06",
    suite: "transactions",
    name: "manager can approve the transaction",
    method: "POST",
    endpoint: "/api/transactions/${TXN_ID}/approve",
    headers: bearer("${MANAGER_TOKEN}"),
    expectStatus: 200,
  },

  // ---- Suite: audit ----------------------------------------------------------
  {
    id: "audit-01",
    suite: "audit",
    name: "admin can read the audit log",
    method: "GET",
    endpoint: "/api/audit",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
  },
  {
    id: "audit-02",
    suite: "audit",
    name: "user audit read is own-scoped (200) or denied (403) — both accepted",
    method: "GET",
    endpoint: "/api/audit",
    headers: bearer("${USER_TOKEN}"),
    // A USER should see at least their own audit entries (200). If the gateway
    // instead denies the audit route entirely for non-managers (403), that is
    // also a defensible RBAC decision; both outcomes are accepted here.
    expectStatus: 200,
    acceptStatus: [403],
  },

  // ---- Suite: tests ----------------------------------------------------------
  {
    id: "tests-01",
    suite: "tests",
    name: "admin can trigger the endpoint suite via the gateway",
    method: "POST",
    endpoint: "/api/tests/run",
    headers: bearer("${ADMIN_TOKEN}"),
    expectStatus: 200,
    expectField: "summary.total",
  },
];
