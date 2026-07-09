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
