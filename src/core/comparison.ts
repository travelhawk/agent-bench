import { RunRecord } from "../types";

/**
 * Comparison aggregation over persisted runs.
 *
 * Everything in this module is computed from RunRecord rows that already live
 * in SQLite, so building or re-rendering a comparison never spends LLM tokens.
 */

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
  totals: ComparisonTotals;
}

export interface ComparisonFilter {
  benchmarkKey?: string;
  taskKey?: string;
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

export function setupKeyForRun(run: RunRecord): string {
  return `${run.agentName} · ${runModelLabel(run)}`;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function buildComparisonMatrix(runs: RunRecord[], filter: ComparisonFilter = {}): ComparisonMatrix {
  const filtered = runs.filter((run) => {
    if (filter.benchmarkKey && runBenchmarkKey(run) !== filter.benchmarkKey) return false;
    if (filter.taskKey && runTaskKey(run) !== filter.taskKey) return false;
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
        lastRunAt: null
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
      sums.score += run.score;
      sums.scored += 1;
      if (run.qualityScore != null) {
        sums.quality += run.qualityScore;
        sums.qualityCount += 1;
      }
    }
    if (run.verifierTestsAvailable) {
      setup.testsPassed += run.verifierTestsPassed;
      setup.testsTotal += run.verifierTestsTotal;
    }
    setup.totalDurationMs += run.durationMs;
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
    } else {
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
  }

  totals.judgeCostUsd = round2(totals.judgeCostUsd);
  totals.agentCostUsd = Number(totals.agentCostUsd.toFixed(4));

  const setups = [...setupsByKey.values()].sort((left, right) => {
    const leftScore = left.avgScore ?? -1;
    const rightScore = right.avgScore ?? -1;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.setupKey.localeCompare(right.setupKey);
  });

  return {
    setups,
    taskKeys: [...taskKeySet].sort(),
    benchmarkKeys: [...benchmarkKeySet].sort(),
    totals
  };
}
