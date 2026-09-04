// Standalone entry point for the endpoint verification suite.
//
// Usage:
//   GATEWAY_URL=http://localhost:3000 bun run run.ts
//   # or, from the test-runner dir:
//   bun run run.ts
//
// Behaviour:
//   - runs `runTestSuite(GATEWAY_URL)` against the live gateway
//   - prints a readable ASCII summary (colourised when stdout is a TTY)
//   - writes the full JSON summary next to this file (last-run.json)
//   - exits 0 when passRate === 100, otherwise 1
//
// The same `runTestSuite` function is imported by the gateway's future
// `/api/tests/run` route, so the standalone runner and the in-app runner always
// exercise the identical suite.

import { runTestSuite } from "./runner";
import type { TestResult, TestSummary } from "../shared/contracts";
import { GATEWAY_URL } from "./suite";

// ANSI colours - only emitted when writing to a TTY so CI logs stay clean.
const isTTY: boolean =
  typeof process !== "undefined" &&
  typeof process.stdout !== "undefined" &&
  Boolean(process.stdout.isTTY);

const C = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
} as const;

function statusBadge(status: TestResult["status"]): string {
  switch (status) {
    case "PASS":
      return `${C.green}PASS${C.reset}`;
    case "FAIL":
      return `${C.red}FAIL${C.reset}`;
    case "SKIP":
      return `${C.yellow}SKIP${C.reset}`;
    default:
      return status;
  }
}

function pad(str: string, len: number): string {
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

// Render the summary as a readable ASCII table grouped by suite.
export function renderSummary(summary: TestSummary): string {
  const lines: string[] = [];
  lines.push(`${C.bold}============================================================${C.reset}`);
  lines.push(`${C.bold} Endpoint Verification Suite - Results${C.reset}`);
  lines.push(`${C.bold}============================================================${C.reset}`);
  lines.push(`${C.dim}generated at :${C.reset} ${summary.generatedAt}`);
  lines.push(`${C.dim}duration    :${C.reset} ${summary.durationMs} ms`);
  lines.push(`${C.dim}gateway url :${C.reset} ${GATEWAY_URL}`);
  lines.push("");

  // Group results by suite (preserving first-seen order).
  const suites = new Map<string, TestResult[]>();
  for (const r of summary.results) {
    let bucket = suites.get(r.suite);
    if (!bucket) {
      bucket = [];
      suites.set(r.suite, bucket);
    }
    bucket.push(r);
  }

  const methodW = 6;
  const endpointW = 46;

  for (const [suite, rs] of suites) {
    const pass = rs.filter((r) => r.status === "PASS").length;
    const total = rs.length;
    // ASCII suite marker (avoids the 0x9C middle byte of U+2713/U+2717 which
    // some pagers/terminals mis-handle as a C1 String Terminator).
    const suiteTag =
      pass === total
        ? `${C.green}[+]${C.reset}`
        : `${C.red}[x]${C.reset}`;
    lines.push(`${suiteTag} ${C.cyan}[${suite}]${C.reset} ${pass}/${total} passed`);
    for (const r of rs) {
      const badge = statusBadge(r.status);
      const http = r.httpStatus != null ? `${C.dim}${r.httpStatus}${C.reset}` : `${C.dim}---${C.reset}`;
      const detail = r.detail ? ` ${C.dim}-${C.reset} ${r.detail.slice(0, 90)}` : "";
      lines.push(
        `    ${badge}  ${pad(r.method, methodW)}  ${pad(r.endpoint, endpointW)}  ${http}  ${r.durationMs}ms${detail}`,
      );
    }
    lines.push("");
  }

  const passedColored = `${C.green}${summary.passed}${C.reset}`;
  const failedColored =
    summary.failed > 0 ? `${C.red}${summary.failed}${C.reset}` : `${summary.failed}`;
  const skippedColored =
    summary.skipped > 0 ? `${C.yellow}${summary.skipped}${C.reset}` : `${summary.skipped}`;
  const passRateColored =
    summary.passRate === 100
      ? `${C.green}${summary.passRate}%${C.reset}`
      : `${C.red}${summary.passRate}%${C.reset}`;

  lines.push(`${C.bold}------------------------------------------------------------${C.reset}`);
  lines.push(
    `${C.bold}Totals:${C.reset}  ${summary.total} total  |  ${passedColored} passed  |  ${failedColored} failed  |  ${skippedColored} skipped`,
  );
  lines.push(`${C.bold}Pass rate:${C.reset}  ${passRateColored}`);
  lines.push(`${C.bold}------------------------------------------------------------${C.reset}`);

  return lines.join("\n");
}

// ---- Main -------------------------------------------------------------------
const summary = await runTestSuite(GATEWAY_URL);
console.log(renderSummary(summary));

// Persist the full JSON summary next to this file (independent of CWD) so it
// can be inspected/compared across runs. The orchestrator and the gateway can
// read this file too.
const outPath = `${import.meta.dir}/last-run.json`;
await Bun.write(outPath, JSON.stringify(summary, null, 2));

process.exit(summary.passRate === 100 ? 0 : 1);
