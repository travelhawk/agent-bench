import { ComparisonMatrix, MetricStat, setupDisplayName } from "./comparison";

/**
 * The "metrics per setup" block shared by the terminal matrix and every export:
 * wall time, agent input/output tokens and agent cost as avg (min-max) over the
 * trials, plus batch totals that include what the blind reviewer spent.
 */

export interface BlindReviewerUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface MetricsRow {
  setup: string;
  runs: number;
  wallTime: string;
  inputTokens: string;
  outputTokens: string;
  agentCost: string;
}

export interface BatchTotals {
  wallTimeMs: number;
  agentInputTokens: number;
  agentOutputTokens: number;
  agentCostUsd: number;
  judgeCostUsd: number;
  blindReviewer: BlindReviewerUsage | null;
  totalCostUsd: number;
}

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function duration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** "12.3k (10.1k-14.0k)"; just the value for a single trial; "n/a" when never reported. */
export function formatMetricStat(stat: MetricStat | null, format: (value: number) => string): string {
  if (!stat) return "n/a";
  if (stat.count === 1 || stat.min === stat.max) return format(stat.avg);
  return `${format(stat.avg)} (${format(stat.min)}-${format(stat.max)})`;
}

export function buildMetricsRows(matrix: ComparisonMatrix): MetricsRow[] {
  return matrix.setups.map((setup) => ({
    setup: setupDisplayName(setup),
    runs: setup.runCount,
    wallTime: formatMetricStat(setup.metrics.durationMs, duration),
    inputTokens: formatMetricStat(setup.metrics.agentInputTokens, tokens),
    outputTokens: formatMetricStat(setup.metrics.agentOutputTokens, tokens),
    agentCost: formatMetricStat(setup.metrics.agentCostUsd, usd)
  }));
}

export function sumBlindUsage(usages: Array<BlindReviewerUsage | undefined | null>): BlindReviewerUsage | null {
  const present = usages.filter((usage): usage is BlindReviewerUsage => Boolean(usage));
  if (present.length === 0) return null;
  return present.reduce((sum, usage) => ({
    inputTokens: sum.inputTokens + usage.inputTokens,
    outputTokens: sum.outputTokens + usage.outputTokens,
    costUsd: sum.costUsd + usage.costUsd,
    durationMs: sum.durationMs + usage.durationMs
  }), { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 });
}

export function buildBatchTotals(matrix: ComparisonMatrix, blindReviewer: BlindReviewerUsage | null | undefined): BatchTotals {
  let wallTimeMs = 0;
  let agentInputTokens = 0;
  let agentOutputTokens = 0;
  for (const setup of matrix.setups) {
    const { durationMs, agentInputTokens: input, agentOutputTokens: output } = setup.metrics;
    if (durationMs) wallTimeMs += durationMs.avg * durationMs.count;
    if (input) agentInputTokens += input.avg * input.count;
    if (output) agentOutputTokens += output.avg * output.count;
  }
  const reviewer = blindReviewer ?? null;
  const totalCostUsd = matrix.totals.agentCostUsd + matrix.totals.judgeCostUsd + (reviewer?.costUsd ?? 0);
  return {
    wallTimeMs: Math.round(wallTimeMs),
    agentInputTokens: Math.round(agentInputTokens),
    agentOutputTokens: Math.round(agentOutputTokens),
    agentCostUsd: matrix.totals.agentCostUsd,
    judgeCostUsd: matrix.totals.judgeCostUsd,
    blindReviewer: reviewer,
    totalCostUsd: Number(totalCostUsd.toFixed(4))
  };
}

/** Plain lines of "label: value", the same in terminal, Markdown and HTML. */
export function formatBatchTotals(totals: BatchTotals): Array<[string, string]> {
  return [
    ["Agent wall time (sum of runs)", duration(totals.wallTimeMs)],
    ["Agent tokens", `${tokens(totals.agentInputTokens)} in / ${tokens(totals.agentOutputTokens)} out`],
    ["Agent cost", usd(totals.agentCostUsd)],
    ["Judge cost", usd(totals.judgeCostUsd)],
    ["Blind reviewer", totals.blindReviewer
      ? `${tokens(totals.blindReviewer.inputTokens)} in / ${tokens(totals.blindReviewer.outputTokens)} out, ${usd(totals.blindReviewer.costUsd)}, ${duration(totals.blindReviewer.durationMs)}`
      : "n/a"],
    ["Total cost", usd(totals.totalCostUsd)]
  ];
}

export function renderMetricsLines(matrix: ComparisonMatrix, blindReviewer?: BlindReviewerUsage | null): string[] {
  if (matrix.setups.length === 0) return [];
  const rows = buildMetricsRows(matrix);
  const header: MetricsRow = { setup: "setup", runs: 0, wallTime: "wall time", inputTokens: "agent in", outputTokens: "agent out", agentCost: "agent cost" };
  const cells = (row: MetricsRow, isHeader = false) => [row.setup, isHeader ? "runs" : String(row.runs), row.wallTime, row.inputTokens, row.outputTokens, row.agentCost];
  const all = [cells(header, true), ...rows.map((row) => cells(row))];
  const widths = all[0].map((_, index) => Math.max(...all.map((line) => line[index].length)));
  return [
    "",
    "Metrics per setup (avg, min-max over trials)",
    ...all.map((line) => line.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd()),
    "",
    "Batch totals",
    ...formatBatchTotals(buildBatchTotals(matrix, blindReviewer)).map(([label, value]) => `  ${label}: ${value}`)
  ];
}
