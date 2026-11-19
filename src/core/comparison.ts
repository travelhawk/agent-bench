import { RunRecord } from "../types";

/**
 * Comparison aggregation over persisted runs.
 *
 * Everything in this module is computed from RunRecord rows that already live
 * in SQLite, so building or re-rendering a comparison never spends LLM tokens.
 */

/** True when an LLM judge (fresh or cached) reviewed the run; rules/off runs carry no score or quality signal. */
export function isJudgedRun(run: Pick<RunRecord, "reviewMode">): boolean {
  return run.reviewMode !== "rules" && run.reviewMode !== "off";
}

export interface ComparisonTaskCell {
  taskKey: string;
  runCount: number;
  failedCount: number;
  avgScore: number | null;
  bestScore: number | null;
  testsPassed: number;
  testsTotal: number;
}

export interface ComparisonSetup {
  setupKey: string;
  agentName: string;
  modelLabel: string;
  runCount: number;
  completedCount: number;
  failedCount: number;
  avgScore: number | null;
  avgQuality: number | null;
  testsPassed: number;
  testsTotal: number;
  totalDurationMs: number;
  avgDurationMs: number | null;
  agentTokens: number;
  agentUsageRuns: number;
  judgeTokens: number;
  judgeCostUsd: number;
  agentCostUsd: number;
  reviewModes: Record<string, number>;
  tasks: Record<string, ComparisonTaskCell>;
  lastRunAt: string | null;
  /** Hidden-check outcomes per trap id, summed over this setup's runs. */
  traps: Record<string, ComparisonTrapCell>;
  /** Average blind-review rank (1 = best), null when never blind-reviewed. */
  blindRank: number | null;
  blindNotes: string | null;
  /** Per-trial spread over this setup's runs (avg + min/max). */
  metrics: ComparisonSetupMetrics;
}

/** avg/min/max over the runs that reported the value; null when none did. */
export interface MetricStat {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface ComparisonSetupMetrics {
  durationMs: MetricStat | null;
  agentInputTokens: MetricStat | null;
  agentOutputTokens: MetricStat | null;
  agentCostUsd: MetricStat | null;
}

export interface ComparisonTrapCell {
  passed: number;
  failed: number;
  unknown: number;
  /** Trap command broke before any test ran (see `errorDetail`). */
  error?: number;
  errorDetail?: string;
}

export function metricStat(values: number[]): MetricStat | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return { avg: sum / values.length, min: Math.min(...values), max: Math.max(...values), count: values.length };
}

export interface ComparisonTotals {
  runs: number;
  judgeTokens: number;
  judgeCostUsd: number;
  agentTokens: number;
  agentCostUsd: number;
  gatewayReviews: number;
  cachedReviews: number;
  rulesReviews: number;
  offReviews: number;
}

export interface ComparisonMatrix {
  setups: ComparisonSetup[];
  taskKeys: string[];
  benchmarkKeys: string[];
  /** Every trap id seen in the compared runs, in first-seen order. */
  trapIds: string[];
  totals: ComparisonTotals;
  /** Run keys aggregated into this matrix (lets exports look up blind-review usage). */
  runKeys?: string[];
}

export interface ComparisonFilter {
  benchmarkKey?: string;
  taskKey?: string;
  /** Narrow the comparison to specific setup keys (used when sharing a subset). */
  setupKeys?: string[];
}

export const NO_MODEL_LABEL = "rules / no model";

/** Older rows predate the benchmark_key/task_key columns; fall back to suiteName ("bench/task"). */
export function runBenchmarkKey(run: RunRecord): string {
  if (run.benchmarkKey) return run.benchmarkKey;
  const slash = run.suiteName.indexOf("/");
  return slash > 0 ? run.suiteName.slice(0, slash) : run.suiteName;
}

export function runTaskKey(run: RunRecord): string | null {
  if (run.taskKey) return run.taskKey;
  const slash = run.suiteName.indexOf("/");
  return slash > 0 ? run.suiteName.slice(slash + 1) : null;
}

export function runModelLabel(run: RunRecord): string {
  return run.modelId?.trim() || NO_MODEL_LABEL;
}

/**
 * Prefers the label the batch assigned to this setup, so a run launched as
 * "baseline" or "loop-agent @ sonnet" keeps that identity in the comparison.
 * Older rows (and CLI runs) fall back to the derived `agent · model` key.
 */
export function setupKeyForRun(run: RunRecord): string {
  return run.setupKey?.trim() || `${run.agentName} · ${runModelLabel(run)}`;
}

/**
 * A batch may label a setup itself ("baseline", "loop-agent @ sonnet"). Show
 * that label when it exists; otherwise the derived key would just repeat the
 * model that is already rendered next to it.
 */
export function setupDisplayName(setup: { setupKey: string; agentName: string; modelLabel: string }): string {
  return setup.setupKey === `${setup.agentName} · ${setup.modelLabel}` ? setup.agentName : setup.setupKey;
}

/**
 * The model to show beside the setup name, or null when the name already is the
 * model. `compare-models` labels each setup by the model it runs, so without
 * this the model would be printed twice in a row.
 */
export function setupModelSuffix(setup: { setupKey: string; agentName: string; modelLabel: string }): string | null {
  return setupDisplayName(setup) === setup.modelLabel ? null : setup.modelLabel;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function buildComparisonMatrix(runs: RunRecord[], filter: ComparisonFilter = {}): ComparisonMatrix {
  const setupKeyFilter = filter.setupKeys && filter.setupKeys.length > 0 ? new Set(filter.setupKeys) : null;
  const filtered = runs.filter((run) => {
    if (filter.benchmarkKey && runBenchmarkKey(run) !== filter.benchmarkKey) return false;
    if (filter.taskKey && runTaskKey(run) !== filter.taskKey) return false;
    if (setupKeyFilter && !setupKeyFilter.has(setupKeyForRun(run))) return false;
    return true;
  });

  const setupsByKey = new Map<string, ComparisonSetup>();
  const taskKeySet = new Set<string>();
  const benchmarkKeySet = new Set<string>();
  const totals: ComparisonTotals = {
    runs: filtered.length,
    judgeTokens: 0,
    judgeCostUsd: 0,
    agentTokens: 0,
    agentCostUsd: 0,
    gatewayReviews: 0,
    cachedReviews: 0,
    rulesReviews: 0,
    offReviews: 0
  };
  const scoreSums = new Map<string, { score: number; scored: number; quality: number; qualityCount: number }>();
  const taskScoreSums = new Map<string, { score: number; scored: number }>();
  const blindSums = new Map<string, { sum: number; count: number }>();
  const trapIds: string[] = [];
  const metricSamples = new Map<string, { duration: number[]; input: number[]; output: number[]; cost: number[] }>();

  for (const run of filtered) {
    benchmarkKeySet.add(runBenchmarkKey(run));
    const taskKey = runTaskKey(run) ?? "(suite)";
    taskKeySet.add(taskKey);

    const key = setupKeyForRun(run);
    let setup = setupsByKey.get(key);
    if (!setup) {
      setup = {
        setupKey: key,
        agentName: run.agentName,
        modelLabel: runModelLabel(run),
        runCount: 0,
        completedCount: 0,
        failedCount: 0,
        avgScore: null,
        avgQuality: null,
        testsPassed: 0,
        testsTotal: 0,
        totalDurationMs: 0,
        avgDurationMs: null,
        agentTokens: 0,
        agentUsageRuns: 0,
        judgeTokens: 0,
        judgeCostUsd: 0,
        agentCostUsd: 0,
        reviewModes: {},
        tasks: {},
        lastRunAt: null,
        traps: {},
        blindRank: null,
        blindNotes: null,
        metrics: { durationMs: null, agentInputTokens: null, agentOutputTokens: null, agentCostUsd: null }
      };
      setupsByKey.set(key, setup);
      scoreSums.set(key, { score: 0, scored: 0, quality: 0, qualityCount: 0 });
    }

    const sums = scoreSums.get(key)!;
    setup.runCount += 1;
    if (run.status === "failed") {
      setup.failedCount += 1;
    } else {
      setup.completedCount += 1;
      // Without an LLM judge the stored score/quality are not product signals
      // (the old rules mode rated the agent markdown and stored a constant
      // quality), so they are left out and render as n/a.
      if (isJudgedRun(run)) {
        sums.score += run.score;
        sums.scored += 1;
      }
      if (isJudgedRun(run) && run.qualityScore != null) {
        sums.quality += run.qualityScore;
        sums.qualityCount += 1;
      }
    }
    if (run.verifierTestsAvailable) {
      setup.testsPassed += run.verifierTestsPassed;
      setup.testsTotal += run.verifierTestsTotal;
    }
    setup.totalDurationMs += run.durationMs;
    const samples = metricSamples.get(key) ?? { duration: [], input: [], output: [], cost: [] };
    metricSamples.set(key, samples);
    samples.duration.push(run.durationMs);
    if (run.agentUsageAvailable) {
      samples.input.push(run.agentInputTokens);
      samples.output.push(run.agentOutputTokens);
      samples.cost.push(run.agentCostUsd);
    }
    if (run.agentUsageAvailable) {
      setup.agentTokens += run.agentInputTokens + run.agentOutputTokens;
      setup.agentUsageRuns += 1;
      setup.agentCostUsd += run.agentCostUsd;
    }
    setup.judgeTokens += run.judgeTotalTokens;
    setup.judgeCostUsd += run.costUsd;
    const reviewMode = run.reviewMode ?? "unknown";
    setup.reviewModes[reviewMode] = (setup.reviewModes[reviewMode] ?? 0) + 1;
    if (!setup.lastRunAt || run.createdAt > setup.lastRunAt) setup.lastRunAt = run.createdAt;
    for (const trap of run.trapResults ?? []) {
      if (!trapIds.includes(trap.id)) trapIds.push(trap.id);
      const trapCell = setup.traps[trap.id] ?? (setup.traps[trap.id] = { passed: 0, failed: 0, unknown: 0 });
      if (trap.status === "pass") trapCell.passed += 1;
      else if (trap.status === "fail") trapCell.failed += 1;
      else if (trap.status === "error") {
        trapCell.error = (trapCell.error ?? 0) + 1;
        if (trap.detail && !trapCell.errorDetail) trapCell.errorDetail = trap.detail;
      } else trapCell.unknown += 1;
    }
    if (run.blindRank != null) {
      const blind = blindSums.get(key) ?? { sum: 0, count: 0 };
      blind.sum += run.blindRank;
      blind.count += 1;
      blindSums.set(key, blind);
      if (run.blindNotes) setup.blindNotes = run.blindNotes;
    }

    const cellId = `${key}::${taskKey}`;
    let cell = setup.tasks[taskKey];
    if (!cell) {
      cell = { taskKey, runCount: 0, failedCount: 0, avgScore: null, bestScore: null, testsPassed: 0, testsTotal: 0 };
      setup.tasks[taskKey] = cell;
      taskScoreSums.set(cellId, { score: 0, scored: 0 });
    }
    const cellSums = taskScoreSums.get(cellId)!;
    cell.runCount += 1;
    if (run.status === "failed") {
      cell.failedCount += 1;
    } else if (isJudgedRun(run)) {
      cellSums.score += run.score;
      cellSums.scored += 1;
      cell.bestScore = cell.bestScore == null ? run.score : Math.max(cell.bestScore, run.score);
    }
    if (run.verifierTestsAvailable) {
      cell.testsPassed += run.verifierTestsPassed;
      cell.testsTotal += run.verifierTestsTotal;
    }
    cell.avgScore = cellSums.scored > 0 ? round2(cellSums.score / cellSums.scored) : null;

    totals.judgeTokens += run.judgeTotalTokens;
    totals.judgeCostUsd += run.costUsd;
    if (run.agentUsageAvailable) {
      totals.agentTokens += run.agentInputTokens + run.agentOutputTokens;
      totals.agentCostUsd += run.agentCostUsd;
    }
    if (run.reviewMode === "gateway") totals.gatewayReviews += 1;
    else if (run.reviewMode === "gateway-cache") totals.cachedReviews += 1;
    else if (run.reviewMode === "rules") totals.rulesReviews += 1;
    else if (run.reviewMode === "off") totals.offReviews += 1;
  }

  for (const setup of setupsByKey.values()) {
    const sums = scoreSums.get(setup.setupKey)!;
    setup.avgScore = sums.scored > 0 ? round2(sums.score / sums.scored) : null;
    setup.avgQuality = sums.qualityCount > 0 ? round2(sums.quality / sums.qualityCount) : null;
    setup.avgDurationMs = setup.runCount > 0 ? Math.round(setup.totalDurationMs / setup.runCount) : null;
    setup.judgeCostUsd = round2(setup.judgeCostUsd);
    setup.agentCostUsd = Number(setup.agentCostUsd.toFixed(4));
    const samples = metricSamples.get(setup.setupKey);
    if (samples) {
      setup.metrics = {
        durationMs: metricStat(samples.duration),
        agentInputTokens: metricStat(samples.input),
        agentOutputTokens: metricStat(samples.output),
        agentCostUsd: metricStat(samples.cost)
      };
    }
    const blind = blindSums.get(setup.setupKey);
    setup.blindRank = blind ? round2(blind.sum / blind.count) : null;
  }

  totals.judgeCostUsd = round2(totals.judgeCostUsd);
  totals.agentCostUsd = Number(totals.agentCostUsd.toFixed(4));

  const trapRate = (setup: ComparisonSetup) => {
    const totals = setupTrapTotals(setup);
    return totals && totals.total > 0 ? totals.passed / totals.total : -1;
  };
  const setups = [...setupsByKey.values()].sort((left, right) => {
    const leftScore = left.avgScore ?? -1;
    const rightScore = right.avgScore ?? -1;
    if (rightScore !== leftScore) return rightScore - leftScore;
    if (trapRate(right) !== trapRate(left)) return trapRate(right) - trapRate(left);
    const leftBlind = left.blindRank ?? Number.POSITIVE_INFINITY;
    const rightBlind = right.blindRank ?? Number.POSITIVE_INFINITY;
    if (leftBlind !== rightBlind) return leftBlind < rightBlind ? -1 : 1;
    return left.setupKey.localeCompare(right.setupKey);
  });

  return {
    setups,
    taskKeys: [...taskKeySet].sort(),
    benchmarkKeys: [...benchmarkKeySet].sort(),
    trapIds,
    totals,
    runKeys: filtered.map((run) => run.runKey)
  };
}

/**
 * Single run: "pass" / "FAIL" / "error" / "?". Several trials: passes over all
 * trials ("2/3"), with errors/unknowns counted as not passed and marked "*".
 */
export function formatTrapCell(cell: ComparisonTrapCell | undefined): string {
  if (!cell) return "—";
  const errors = cell.error ?? 0;
  const decided = cell.passed + cell.failed;
  const total = decided + errors + cell.unknown;
  if (decided === 0) return errors > 0 ? "error" : "?";
  if (total === 1) return cell.passed === 1 ? "pass" : "FAIL";
  return `${cell.passed}/${total}${total > decided ? "*" : ""}`;
}

/** Footnotes for the trap matrix: why a cell says "error" (first output line of the trap command). */
export function trapErrorFootnotes(
  trapIds: string[],
  setups: Array<{ traps: Record<string, ComparisonTrapCell> } & Parameters<typeof setupDisplayName>[0]>
): string[] {
  const notes: string[] = [];
  for (const setup of setups) {
    const details = new Set<string>();
    let errored = 0;
    for (const id of trapIds) {
      const cell = setup.traps[id];
      if (!cell?.error) continue;
      errored += 1;
      if (cell.errorDetail) details.add(cell.errorDetail);
    }
    if (errored === 0) continue;
    notes.push(`${setupDisplayName(setup)}: trap command failed before tests ran${details.size > 0 ? ` - ${[...details].join(" | ")}` : ""}`);
  }
  return notes;
}

/* ---------------- headline winners (traps + blind rank first) ---------------- */

export interface TrapTotals {
  passed: number;
  total: number;
}

/** Passed / all trap outcomes over every trial of a setup; null when no trap was decided. */
export function setupTrapTotals(setup: { traps: Record<string, ComparisonTrapCell> }): TrapTotals | null {
  const cells = Object.values(setup.traps);
  const decided = cells.reduce((sum, cell) => sum + cell.passed + cell.failed, 0);
  if (decided === 0) return null;
  const passed = cells.reduce((sum, cell) => sum + cell.passed, 0);
  const total = cells.reduce((sum, cell) => sum + cell.passed + cell.failed + cell.unknown + (cell.error ?? 0), 0);
  return { passed, total };
}

/** True when no run of the setup got an LLM judge, so it has no score or quality (n/a). */
export function isRulesOnlySetup(setup: { reviewModes: Record<string, number> }): boolean {
  const modes = Object.entries(setup.reviewModes).filter(([, count]) => count > 0).map(([mode]) => mode);
  return modes.length > 0 && modes.every((mode) => mode === "rules" || mode === "off");
}

export interface HeadlineWinners {
  /** Setup keys with the highest trap pass rate (several on a tie). */
  traps: { setupKeys: string[]; passed: number; total: number } | null;
  /** Setup keys with the lowest average blind rank (several on a tie). */
  blindRank: { setupKeys: string[]; rank: number } | null;
  /** One-line verdict text (without the "Verdict:" prefix), null when neither signal exists. */
  verdict: string | null;
  /** Every setup with a quality has the same quality, so "best quality" means nothing. */
  qualityAllEqual: boolean;
}

function joinKeys(keys: string[]): string {
  return keys.join(" = ");
}

export function buildHeadlineWinners(
  setups: Array<Pick<ComparisonSetup, "setupKey" | "traps" | "blindRank" | "reviewModes" | "avgScore" | "avgQuality">>
): HeadlineWinners {
  const trapRows = setups
    .map((setup) => ({ setup, totals: setupTrapTotals(setup) }))
    .filter((row): row is { setup: typeof row.setup; totals: TrapTotals } => row.totals != null && row.totals.total > 0);
  let traps: HeadlineWinners["traps"] = null;
  if (setups.length >= 2 && trapRows.length > 0) {
    const rate = (row: typeof trapRows[number]) => row.totals.passed / row.totals.total;
    const bestRate = Math.max(...trapRows.map(rate));
    const top = trapRows.filter((row) => Math.abs(rate(row) - bestRate) < 1e-9);
    traps = { setupKeys: top.map((row) => row.setup.setupKey), passed: top[0].totals.passed, total: top[0].totals.total };
  }

  const ranked = setups.filter((setup) => setup.blindRank != null);
  let blindRank: HeadlineWinners["blindRank"] = null;
  if (setups.length >= 2 && ranked.length > 0) {
    const bestRank = Math.min(...ranked.map((setup) => setup.blindRank!));
    blindRank = {
      setupKeys: ranked.filter((setup) => Math.abs(setup.blindRank! - bestRank) < 1e-9).map((setup) => setup.setupKey),
      rank: bestRank
    };
  }

  let verdict: string | null = null;
  const trapWinner = traps && traps.setupKeys.length === 1 ? traps.setupKeys[0] : null;
  const blindWinner = blindRank && blindRank.setupKeys.length === 1 ? blindRank.setupKeys[0] : null;
  if (traps && blindRank) {
    if (trapWinner && trapWinner === blindWinner) {
      verdict = `${trapWinner} (most traps passed and best blind rank)`;
    } else if (!trapWinner && blindWinner && traps.setupKeys.includes(blindWinner)) {
      const others = traps.setupKeys.filter((key) => key !== blindWinner);
      verdict = `${blindWinner} (tied on traps with ${joinKeys(others)}, best blind rank)`;
    } else {
      verdict = `no clear winner - traps favour ${joinKeys(traps.setupKeys)}, blind review favours ${joinKeys(blindRank.setupKeys)}`;
    }
  } else if (traps) {
    verdict = trapWinner ? `${trapWinner} (most traps passed; no blind review)` : `tie on traps between ${joinKeys(traps.setupKeys)}; no blind review`;
  } else if (blindRank) {
    verdict = blindWinner ? `${blindWinner} (best blind rank; no traps)` : `tie on blind rank between ${joinKeys(blindRank.setupKeys)}; no traps`;
  }

  const qualities = setups.filter((setup) => setup.avgQuality != null).map((setup) => setup.avgQuality!.toFixed(2));
  return {
    traps,
    blindRank,
    verdict,
    qualityAllEqual: qualities.length > 0 && new Set(qualities).size === 1
  };
}

export function formatBlindRank(rank: number): string {
  return rank.toFixed(1);
}
