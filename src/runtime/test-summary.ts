export interface TestRunSummary {
  available: boolean;
  total: number;
  passed: number;
  failed: number;
}

export function isNodeTestRunnerCommand(verifyCommand: string): boolean {
  return /\bnode(\.exe)?\s+(--test\b|--experimental-test-runner\b)/.test(verifyCommand);
}

export function parseNodeTestTapSummary(stdout: string): TestRunSummary | null {
  const testsMatch = stdout.match(/^# tests (\d+)$/m);
  const passMatch = stdout.match(/^# pass (\d+)$/m);
  const failMatch = stdout.match(/^# fail (\d+)$/m);

  if (!testsMatch || !passMatch || !failMatch) return null;

  return {
    available: true,
    total: Number(testsMatch[1]),
    passed: Number(passMatch[1]),
    failed: Number(failMatch[1])
  };
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
