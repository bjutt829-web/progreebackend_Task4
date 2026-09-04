// Endpoint verification runner.
//
// Exports `runTestSuite(gatewayUrl)` which executes the static `TEST_CASES`
// from `./suite` in order, resolves `${ADMIN_TOKEN}` / `${MANAGER_TOKEN}` /
// `${USER_TOKEN}` / `${TXN_ID}` placeholders at runtime, captures a
// `TestSummary`, and is ROBUST to individual case errors (a network failure or
// a service being down marks that case FAIL with a clear detail; the runner
// never throws).
//
// The gateway's future `/api/tests/run` route imports this function:
//   import { runTestSuite } from "../../mini-services/test-runner/runner";
//
// This module uses only the global `fetch` + the shared contracts — no extra
// dependencies — so it runs both under Bun (standalone) and inside the Next.js
// server bundle.

import type { TestSummary, TestResult } from "../shared/contracts";
import { TEST_CASES, type TestCase } from "./suite";

// -----------------------------------------------------------------------------
// Placeholder resolution.
// -----------------------------------------------------------------------------
// Tokens + the saved transaction id live in a flat string map keyed by the
// placeholder name (without the `${ }`). Login cases populate ADMIN_TOKEN,
// MANAGER_TOKEN, USER_TOKEN; the submit-txn case populates TXN_ID.
const PLACEHOLDER_RE = /\$\{([A-Z0-9_]+)\}/g;

function resolveString(input: string, tokens: Record<string, string>): string {
  return input.replace(PLACEHOLDER_RE, (_, key: string) =>
    tokens[key] !== undefined ? tokens[key] : `\${${key}}`,
  );
}

function resolveHeaders(
  headers: Record<string, string> | undefined,
  tokens: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = resolveString(v, tokens);
  return out;
}

function resolveBody(body: unknown, tokens: Record<string, string>): unknown {
  if (body === undefined || body === null) return body;
  if (typeof body === "string") return resolveString(body, tokens);
  // Object bodies: round-trip through JSON so nested placeholders in any string
  // value are substituted, then parse back so we send proper JSON.
  try {
    const str = JSON.stringify(body);
    const replaced = resolveString(str, tokens);
    return JSON.parse(replaced);
  } catch {
    return body;
  }
}

// -----------------------------------------------------------------------------
// JSON path lookup (dotted, e.g. "user.role" or "summary.total").
// -----------------------------------------------------------------------------
function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

// -----------------------------------------------------------------------------
// Token / txn-id capture from a successful case's response body.
// -----------------------------------------------------------------------------
function extractToken(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object" && "token" in parsed) {
    const t = (parsed as { token: unknown }).token;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

function extractTxnId(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  // SubmitTransactionResponse is `{ transaction: { id, ... }, messageId }`.
  const txn = obj.transaction;
  if (txn && typeof txn === "object" && "id" in txn) {
    const id = (txn as { id: unknown }).id;
    return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
  }
  // Fallbacks for alternative response shapes.
  if ("transactionId" in obj) {
    const id = obj.transactionId;
    return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
  }
  if ("id" in obj) {
    const id = obj.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// runTestSuite — the single exported entry point.
// -----------------------------------------------------------------------------
export async function runTestSuite(gatewayUrl: string): Promise<TestSummary> {
  const base = (gatewayUrl || "").replace(/\/+$/, "");
  const tokens: Record<string, string> = {};
  const results: TestResult[] = [];
  const startedAt = Date.now();

  for (const tc of TEST_CASES) {
    const result: TestResult = {
      id: tc.id,
      suite: tc.suite,
      name: tc.name,
      method: tc.method,
      endpoint: tc.endpoint,
      status: "FAIL",
      durationMs: 0,
    };

    // ---- 1. Resolve placeholders against the tokens collected so far. ----
    const endpoint = resolveString(tc.endpoint, tokens);
    const headers = resolveHeaders(tc.headers, tokens);
    const body = resolveBody(tc.body, tokens);

    // If an endpoint still carries an unresolved placeholder (e.g. the
    // submit-txn case failed so ${TXN_ID} was never set), SKIP — there is
    // nothing meaningful to assert.
    if (PLACEHOLDER_RE.test(endpoint)) {
      result.status = "SKIP";
      result.detail = `unresolved placeholder in endpoint: ${tc.endpoint}`;
      results.push(result);
      continue;
    }

    // ---- 2. Issue the request. ----
    const url = `${base}${endpoint}`;
    const t0 = Date.now();
    try {
      const init: RequestInit = {
        method: tc.method,
        headers: {
          "Content-Type": "application/json",
          ...(headers || {}),
        },
      };
      if (tc.method !== "GET" && body !== undefined && body !== null) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
      }

      const res = await fetch(url, init);
      result.httpStatus = res.status;
      const text = await res.text();
      result.durationMs = Date.now() - t0;

      // ---- 3. Parse the body once (best-effort). ----
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      // ---- 4. Status check (expectStatus or acceptStatus[]). ----
      const acceptable =
        res.status === tc.expectStatus ||
        (Array.isArray(tc.acceptStatus) && tc.acceptStatus.includes(res.status));

      // ---- 5. expectField check. ----
      let fieldOk = true;
      let fieldDetail = "";
      if (tc.expectField) {
        const value = getByPath(parsed, tc.expectField);
        if (value === undefined) {
          fieldOk = false;
          fieldDetail = `field "${tc.expectField}" missing`;
        } else if (
          tc.expectFieldValue !== undefined &&
          value !== tc.expectFieldValue
        ) {
          fieldOk = false;
          fieldDetail = `field "${tc.expectField}"=${JSON.stringify(value)} expected ${JSON.stringify(tc.expectFieldValue)}`;
        } else if (
          tc.expectFieldMinLength !== undefined &&
          (typeof value !== "object" || !Array.isArray(value) || value.length < tc.expectFieldMinLength)
        ) {
          fieldOk = false;
          const len = Array.isArray(value) ? value.length : "non-array";
          fieldDetail = `field "${tc.expectField}" length ${len} < ${tc.expectFieldMinLength}`;
        }
      }

      // ---- 6. Aggregate PASS/FAIL detail. ----
      if (acceptable && fieldOk) {
        result.status = "PASS";
        result.detail = `HTTP ${res.status}`;
      } else {
        result.status = "FAIL";
        const want = tc.acceptStatus && tc.acceptStatus.length
          ? `${tc.expectStatus}/${tc.acceptStatus.join("/")}`
          : `${tc.expectStatus}`;
        const statusPart = acceptable
          ? ""
          : `expected HTTP ${want} got ${res.status}`;
        const parts = [statusPart, fieldDetail].filter(Boolean);
        const bodyPreview = text ? text.slice(0, 200) : "<empty body>";
        result.detail = `${parts.join("; ")} :: ${bodyPreview}`.slice(0, 400);
      }

      // ---- 7. Capture tokens / txn id on SUCCESS only. ----
      if (result.status === "PASS") {
        if (tc.saveTokenAs) {
          const tok = extractToken(parsed);
          if (tok) tokens[`${tc.saveTokenAs}_TOKEN`] = tok;
        }
        if (tc.saveTxnId) {
          const id = extractTxnId(parsed);
          if (id) tokens["TXN_ID"] = id;
        }
      }
    } catch (err: unknown) {
      // Network error, DNS failure, service down, etc. — NEVER throw.
      result.durationMs = Date.now() - t0;
      result.status = "FAIL";
      const msg = err instanceof Error ? err.message : String(err);
      result.detail = `network error: ${msg}`.slice(0, 300);
    }

    results.push(result);
  }

  // ---- Aggregate. ----
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const durationMs = Date.now() - startedAt;
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 100);

  const summary: TestSummary = {
    total,
    passed,
    failed,
    skipped,
    passRate,
    durationMs,
    results,
    generatedAt: new Date().toISOString(),
  };
  return summary;
}
