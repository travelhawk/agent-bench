export interface TestRunSummary {
  available: boolean;
  total: number;
  passed: number;
  failed: number;
}

export function isNodeTestRunnerCommand(verifyCommand: string): boolean {
  return /\bnode(\.exe)?\s+(--test\b|--experimental-test-runner\b)/.test(verifyCommand);
}

/**
 * `node --test` reports its totals in two shapes: `# pass 2` under a TAP
 * reporter, and `ℹ pass 2` under the default spec reporter. A task owns its
 * verify command, so the harness reads whichever shape that command produced
 * instead of rewriting it to force one reporter.
 */
function matchSummaryCount(stdout: string, label: "tests" | "pass" | "fail"): number | null {
  const pattern = new RegExp(String.raw`^(?:#|ℹ)\s+` + label + String.raw`\s+(\d+)\s*$`, "m");
  const match = stdout.match(pattern);
  return match ? Number(match[1]) : null;
}

export function parseNodeTestTapSummary(stdout: string): TestRunSummary | null {
  const total = matchSummaryCount(stdout, "tests");
  const passed = matchSummaryCount(stdout, "pass");
  const failed = matchSummaryCount(stdout, "fail");

  if (total == null || passed == null || failed == null) return null;

  return { available: true, total, passed, failed };
}

/**
 * Custom (non-`node --test`) verifiers can opt into graded scoring by printing a
 * single line `AGENT_BENCH_CHECKS: <passed>/<total>`. This lets tasks whose
 * verifier is a hand-written script still yield partial credit instead of a flat
 * pass/fail, so partially-correct workflows are ranked.
 */
export function parseVerifierChecksMarker(stdout: string): TestRunSummary | null {
  const match = stdout.match(/AGENT_BENCH_CHECKS:\s*(\d+)\s*\/\s*(\d+)/i);
  if (!match) return null;

  const passed = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total <= 0 || passed > total) return null;

  return { available: true, total, passed, failed: total - passed };
}
