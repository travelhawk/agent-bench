import type { AgentSkillReference, RunRecord } from "../../src/types";

export type Confidence = "high" | "medium" | "low";
export type AsyncTone = "neutral" | "success" | "error";

/** Shape of the run summary.json payload the UI reads (best-effort; may be partial). */
export interface RunSummaryView {
  status?: "completed" | "failed"; executionMode?: string; reviewMode?: string; scoreProfile?: string; scoreConfidence?: Confidence;
  latencyMs?: number; costUsd?: number; failureReason?: string;
  agentSystem?: { entryFile?: string; bundleMode?: "flat" | "bundle"; bundlePath?: string | null; sharedAgentsPath?: string | null; skillCount?: number; assetFileCount?: number; skills?: AgentSkillReference[] };
  sandbox?: { provider?: string; networkAccess?: string; runner?: { exitCode?: number; cwd?: string }; verifier?: { exitCode?: number; command?: string } };
  objectiveChecks?: { available?: number; passed?: number; deterministic?: boolean; items?: string[] };
  scores?: { total?: number; outcome?: number; process?: number; review?: number; efficiency?: number; tests?: number; judge?: number; performance?: number };
  evidence?: { matchedSignals?: string[]; missingSignals?: string[]; artifacts?: string[] };
  recommendedNextActions?: string[];
  taskContract?: { whyThisTask?: string; inputs?: string; deliverableFormat?: string; successChecks?: string[]; failureModes?: string[] };
  diff?: { available?: boolean; filesChanged?: number; insertions?: number; deletions?: number };
  testMetrics?: { available?: boolean; total?: number; passed?: number; failed?: number };
  qualityScore?: number | null;
  agentUsage?: { available?: boolean; inputTokens?: number; outputTokens?: number; costUsd?: number | null };
}

export const formatMoney = (value: number) => `$${value.toFixed(2)}`;
export const formatInstalls = (value?: number) => typeof value === "number" ? `${value.toLocaleString()} installs` : "skills.sh";
export const humanizeToken = (value: string) => value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
export const splitListInput = (value: string) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
export const readRunSummary = (summary: Record<string, unknown> | null | undefined) => (summary ?? null) as RunSummaryView | null;

export function toneClass(tone: AsyncTone): string { return `status-line status-line-${tone}`; }
export function confidenceClass(confidence: Confidence): string {
  return confidence === "high" ? "status-chip-good" : confidence === "medium" ? "status-chip-warn" : "status-chip-muted";
}
export function runStatusClass(status: RunRecord["status"]): string {
  return status === "failed" ? "status-chip-bad" : "status-chip-good";
}

/** Diff/tests/quality/agent-usage read straight off the persisted RunRecord (always present). */
export function diffLabel(run: RunRecord): string {
  return run.diffAvailable ? `${run.diffFilesChanged} file${run.diffFilesChanged === 1 ? "" : "s"}` : "n/a";
}
export function testsLabel(run: RunRecord): string {
  return run.verifierTestsAvailable ? `${run.verifierTestsPassed}/${run.verifierTestsTotal}` : "n/a";
}
