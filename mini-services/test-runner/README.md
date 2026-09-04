# Endpoint Verification Test Runner

Black-box, end-to-end verification of the **Role-Based Microservice API Ecosystem**
through its Next.js API Gateway. The runner drives the WHOLE ecosystem
(auth-service, message-broker, transaction-service, audit + tests routes) the
same way an external client would — over HTTP, via the gateway only.

This is **not** a standalone bun project. The files here are imported by:

- **the standalone CLI** — `bun run run.ts` (this dir) or
  `bun run mini-services/test-runner/run.ts` (from the project root)
- **the Next.js gateway's future `/api/tests/run` route**, which imports
  `runTestSuite` from `../../mini-services/test-runner/runner` and returns the
  `TestSummary` as JSON.

No external dependencies are required — the runner uses the global `fetch`
(available in Bun ≥ 1 and Node ≥ 18) plus `Bun.write` for the JSON dump.

## Files

| File | Purpose |
| --- | --- |
| `suite.ts` | `TEST_CASES: TestCase[]` — the ordered verification suite, plus the in-line `TestCase` extension (token/txn chaining, field-value + min-length assertions, alternative acceptable status codes). |
| `runner.ts` | `runTestSuite(gatewayUrl): Promise<TestSummary>` — resolves placeholders, issues requests, captures tokens, aggregates results, never throws. |
| `run.ts` | Standalone CLI entry — prints an ASCII summary, writes `last-run.json`, exits 0/1 by pass rate. |
| `package.json` | Minimal — just the `run` script so `bun run run` works. |
| `last-run.json` | Written on every standalone run (gitignored) — full `TestSummary` for diffing. |

## What it verifies

22 cases across 6 suites:

- **health** — the gateway reports all backend services healthy.
- **auth** — admin/manager/user logins succeed; wrong password is rejected; the
  admin token resolves `/me` with `role=ADMIN`; a garbage token is rejected by
  `/verify`; admin can list users (≥3 seeded) but a USER cannot (403); a USER
  cannot register a new user (403). **The three login cases save JWTs** for the
  rest of the suite (token chaining).
- **broker** — admin reads stats + queues and publishes a message (expects a
  `messageId`).
- **transactions** — a USER submits a transaction (the `transactionId` is
  saved as `${TXN_ID}`); USER + ADMIN list transactions; USER fetches their txn
  by id; a USER trying to **approve** is denied (403); a MANAGER can approve
  (200).
- **audit** — admin reads the audit log; a USER's audit read is accepted as
  either 200 (own-scoped entries) or 403 (route-level denial) — both are
  defensible RBAC outcomes and the suite documents this.
- **tests** — admin triggers the suite itself via `POST /api/tests/run` and the
  response carries `summary.total`.

## Token & id chaining

`TestCase` (from `../shared/contracts`) is minimal. The suite extends it inline
with:

- `saveTokenAs?: "ADMIN" | "MANAGER" | "USER"` — after a successful case, the
  response's `.token` is stored under `${<ROLE>_TOKEN}`.
- `saveTxnId?: boolean` — after a successful case, `.transaction.id` (with
  `.transactionId` / `.id` fallbacks) is stored as `${TXN_ID}`.
- `expectFieldValue?` — expected value for the JSON path in `expectField`.
- `expectFieldMinLength?` — the field must be an array of at least this length.
- `acceptStatus?: number[]` — additional acceptable HTTP status codes.

The runner resolves `${ADMIN_TOKEN}`, `${MANAGER_TOKEN}`, `${USER_TOKEN}` and
`${TXN_ID}` placeholders in a case's `endpoint`, `headers` (values) and `body`
(stringified + re-parsed) at runtime. The cases are **ordered** so that:

1. all login cases run before any case that references a token, and
2. the submit-txn case runs before any case that references `${TXN_ID}`.

If a prerequisite case fails (e.g. login failed so `${ADMIN_TOKEN}` is unset),
subsequent cases referencing an unresolved placeholder in the *endpoint* are
**SKIP**ped with a clear detail; unresolved placeholders in headers/bodies are
left as-is (the request will likely 401, which is a meaningful FAIL).

## How to run

### Standalone (CLI)

```bash
# from the test-runner dir
GATEWAY_URL=http://localhost:3000 bun run run.ts

# or from the project root
GATEWAY_URL=http://localhost:3000 bun run mini-services/test-runner/run.ts
```

The CLI prints a colourised ASCII table (grouped by suite), writes the full
JSON summary to `mini-services/test-runner/last-run.json`, and exits:

- `0` when `passRate === 100`
- `1` otherwise

Colour codes are emitted only when stdout is a TTY, so CI logs stay clean.

### Via the gateway (HTTP)

Once the gateway's `/api/tests/run` route is wired up (it imports
`runTestSuite` from `../../mini-services/test-runner/runner`):

```bash
# log in as admin, then:
curl -X POST http://localhost:3000/api/tests/run \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json"
# -> { "summary": { total, passed, failed, skipped, passRate, durationMs, results, generatedAt } }
```

## Robustness

`runTestSuite` **never throws**:

- a network error / service down on a given case → that case is recorded
  `FAIL` with `detail = "network error: <message>"`; the runner continues with
  the next case.
- a non-JSON or empty body → `expectField` checks are simply reported as
  missing rather than crashing.
- an unresolved `${TXN_ID}` in an endpoint → the case is `SKIP`ped rather than
  sent to a malformed URL.

This means the suite can be run safely even when the system is partially up —
the failures will tell you exactly which tier is unreachable.
