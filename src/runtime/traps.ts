import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BenchmarkTrap, TrapResult } from "../types";

/**
 * Hidden checks ("traps"). A task declares them in `## Traps`; the test files
 * live in `Traps Dir` and are copied into the workspace only after the runner
 * has finished, so the agent under test never sees them.
 */

/** Folder name the traps land in inside the workspace (`<workspace>/traps`). */
export const TRAPS_WORKSPACE_DIR = "traps";
/** Report the trap command is expected to write (vitest or playwright JSON reporter). */
export const TRAP_RESULTS_FILE = "trap-results.json";

/** Parses `- <id>: <description>` lines. Ids are lower-case slugs. */
export function parseTrapsSection(section: string): BenchmarkTrap[] {
  const traps: BenchmarkTrap[] = [];
  const seen = new Set<string>();
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    traps.push({ id, description: match[2].trim() });
  }
  return traps;
}

export interface TrapTestCase {
  name: string;
  passed: boolean;
}

interface PlaywrightSuite {
  title?: string;
  specs?: Array<{ title?: string; ok?: boolean; tests?: Array<{ status?: string }> }>;
  suites?: PlaywrightSuite[];
}

/**
 * Reads test cases from a Vitest (`--reporter=json`) or Playwright (`json`
 * reporter) report. Unknown shapes yield an empty list.
 */
export function readTrapTestCases(report: unknown): TrapTestCase[] {
  if (!report || typeof report !== "object") return [];
  const data = report as {
    testResults?: Array<{ assertionResults?: Array<{ fullName?: string; title?: string; status?: string }> }>;
    suites?: PlaywrightSuite[];
  };

  if (Array.isArray(data.testResults)) {
    return data.testResults.flatMap((file) => (file.assertionResults ?? []).map((test) => ({
      name: String(test.fullName ?? test.title ?? ""),
      passed: test.status === "passed"
    })));
  }

  if (Array.isArray(data.suites)) {
    const out: TrapTestCase[] = [];
    const walk = (suite: PlaywrightSuite, prefix: string) => {
      const title = [prefix, suite.title ?? ""].filter(Boolean).join(" ");
      for (const spec of suite.specs ?? []) {
        const skipped = (spec.tests ?? []).every((test) => test.status === "skipped");
        out.push({ name: `${title} ${spec.title ?? ""}`.trim(), passed: Boolean(spec.ok) && !skipped });
      }
      for (const child of suite.suites ?? []) walk(child, title);
    };
    data.suites.forEach((suite) => walk(suite, ""));
    return out;
  }

  return [];
}

/**
 * A trap passes when every test whose name contains its id passed. No matching
 * test means "unknown" — the trap was declared but never exercised.
 */
export function mapTrapResults(traps: BenchmarkTrap[], cases: TrapTestCase[]): TrapResult[] {
  return traps.map((trap) => {
    const matching = cases.filter((test) => test.name.toLowerCase().includes(trap.id));
    const status: TrapResult["status"] = matching.length === 0
      ? "unknown"
      : matching.every((test) => test.passed) ? "pass" : "fail";
    return { id: trap.id, description: trap.description, status };
  });
}

/**
 * Like mapTrapResults, but a trap command that failed before any test ran
 * (server did not start, port in use, config error) marks every trap `error`
 * with the first output line, instead of a silent `unknown`.
 */
export function resolveTrapResults(
  traps: BenchmarkTrap[],
  cases: TrapTestCase[],
  runner: { exitCode: number | null; timedOut?: boolean; stdout: string; stderr: string }
): TrapResult[] {
  if (cases.length > 0 || runner.exitCode === 0) return mapTrapResults(traps, cases);
  const detail = runner.timedOut
    ? "trap command timed out before any test ran"
    : firstOutputLine(runner.stderr) ?? firstOutputLine(runner.stdout) ?? `trap command exited ${runner.exitCode ?? "without a code"}`;
  return traps.map((trap) => ({ id: trap.id, description: trap.description, status: "error", detail }));
}

/** First line that says something (skips blanks and npm/playwright banner noise). */
export function firstOutputLine(text: string | undefined): string | null {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!line || /^(>|npm (warn|notice)|Running \d+ tests?)/i.test(line)) continue;
    return line.length > 200 ? `${line.slice(0, 197)}...` : line;
  }
  return null;
}

export function failAllTraps(traps: BenchmarkTrap[]): TrapResult[] {
  return traps.map((trap) => ({ id: trap.id, description: trap.description, status: "fail" }));
}

/** Copies the holdout files into `<workspace>/traps` (replacing anything the agent put there). */
export function installTraps(trapsSourceDir: string, workspaceDir: string): string {
  if (!existsSync(trapsSourceDir)) {
    throw new Error(`Traps dir not found: ${trapsSourceDir}`);
  }
  const target = path.join(workspaceDir, TRAPS_WORKSPACE_DIR);
  rmSync(target, { recursive: true, force: true });
  rmSync(path.join(workspaceDir, TRAP_RESULTS_FILE), { force: true });
  cpSync(trapsSourceDir, target, { recursive: true });
  return target;
}

export function readTrapReport(workspaceDir: string): TrapTestCase[] {
  const reportPath = path.join(workspaceDir, TRAP_RESULTS_FILE);
  if (!existsSync(reportPath)) return [];
  try {
    return readTrapTestCases(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {
    return [];
  }
}

export function writeTrapArtifact(artifactsDir: string, results: TrapResult[], extra: Record<string, unknown> = {}): void {
  writeFileSync(path.join(artifactsDir, "traps.json"), JSON.stringify({ results, ...extra }, null, 2));
}

export function summarizeTraps(results: TrapResult[]): string {
  if (results.length === 0) return "n/a";
  const passed = results.filter((result) => result.status === "pass").length;
  return `${passed}/${results.length} passed (${results.map((result) => `${result.id}=${result.status}`).join(", ")})`;
}
