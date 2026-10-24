import { ComparisonMatrix, setupDisplayName, setupModelSuffix } from "./comparison";

/**
 * Terminal rendering of a comparison matrix. Kept separate from the CLI command
 * wiring so `matrix` and `compare-models` print the same table from the same
 * code, and so the formatting can be tested without a database.
 */

export function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function formatDurationMs(value: number | null): string {
  if (value == null) return "n/a";
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function scoreBar(value: number | null, max = 10, width = 10): string {
  if (value == null || max <= 0) return "".padEnd(width, " ");
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * width);
  return "█".repeat(filled).padEnd(width, "·");
}

/** `name · model`, collapsed to one when the name already is the model. */
function setupLabel(setup: { setupKey: string; agentName: string; modelLabel: string }): string {
  const suffix = setupModelSuffix(setup);
  return suffix ? `${setupDisplayName(setup)} · ${suffix}` : setupDisplayName(setup);
}

function num(value: number | null, digits = 2): string {
  return value != null ? value.toFixed(digits) : "n/a";
}

export function renderMatrixHeadline(matrix: ComparisonMatrix): string {
  const free = matrix.totals.rulesReviews + matrix.totals.offReviews;
  const cost = matrix.totals.judgeCostUsd + matrix.totals.agentCostUsd;
  return [
    `Setups: ${matrix.setups.length}`,
    `Runs: ${matrix.totals.runs}`,
    `Judge tokens: ${formatTokens(matrix.totals.judgeTokens)} (${matrix.totals.gatewayReviews} fresh, ${matrix.totals.cachedReviews} cached, ${free} rules/off = 0 tokens)`,
    `Cost: $${cost.toFixed(2)}`
  ].join(" | ");
}

/** The per-metric winners, as the shared leaderboard would rank them. */
export function renderMatrixWinners(matrix: ComparisonMatrix): string[] {
  if (matrix.setups.length < 2) return [];

  const scored = matrix.setups.filter((setup) => setup.avgScore != null);
  const timed = matrix.setups.filter((setup) => setup.avgDurationMs != null);
  const metered = matrix.setups.filter((setup) => setup.agentUsageRuns > 0);
  const label = (setup: ComparisonMatrix["setups"][number]) => setupLabel(setup);

  const lines: string[] = [];
  const best = <T>(rows: T[], pick: (row: T) => number, prefer: "high" | "low"): T | null =>
    rows.length === 0
      ? null
      : rows.reduce((winner, row) =>
        (prefer === "high" ? pick(row) > pick(winner) : pick(row) < pick(winner)) ? row : winner);

  const topScore = best(scored, (setup) => setup.avgScore ?? 0, "high");
  if (topScore) lines.push(`Best score:    ${label(topScore)} (${num(topScore.avgScore)})`);

  const topTests = best(
    matrix.setups.filter((setup) => setup.testsTotal > 0),
    (setup) => setup.testsPassed / setup.testsTotal,
    "high"
  );
  if (topTests) lines.push(`Best tests:    ${label(topTests)} (${topTests.testsPassed}/${topTests.testsTotal})`);

  const fastest = best(timed, (setup) => setup.avgDurationMs ?? 0, "low");
  if (fastest) lines.push(`Fastest:       ${label(fastest)} (${formatDurationMs(fastest.avgDurationMs)})`);

  const leanest = best(metered, (setup) => setup.agentTokens, "low");
  if (leanest) lines.push(`Fewest tokens: ${label(leanest)} (${formatTokens(leanest.agentTokens)})`);

  const cheapest = best(matrix.setups, (setup) => setup.judgeCostUsd + setup.agentCostUsd, "low");
  if (cheapest) lines.push(`Cheapest:      ${label(cheapest)} ($${(cheapest.judgeCostUsd + cheapest.agentCostUsd).toFixed(2)})`);

  return lines;
}

export function renderMatrixLines(matrix: ComparisonMatrix, options: { winners?: boolean } = {}): string[] {
  if (matrix.setups.length === 0) {
    return ["No runs found. Launch runs first with `agent-bench compare-models` or from the workbench."];
  }

  const lines = [renderMatrixHeadline(matrix), ""];

  for (const setup of matrix.setups) {
    const tests = setup.testsTotal > 0 ? `${setup.testsPassed}/${setup.testsTotal}` : "n/a";
    const agentTokens = setup.agentUsageRuns > 0 ? formatTokens(setup.agentTokens) : "n/a";
    const failed = setup.failedCount > 0 ? ` (+${setup.failedCount} failed)` : "";

    lines.push(setupLabel(setup));
    lines.push(
      `  score ${scoreBar(setup.avgScore)} ${num(setup.avgScore)}`
      + ` | quality ${num(setup.avgQuality)}`
      + ` | tests ${tests}`
      + ` | avg ${formatDurationMs(setup.avgDurationMs)}`
      + ` | agent tokens ${agentTokens}`
      + ` | judge tokens ${formatTokens(setup.judgeTokens)}`
      + ` | $${(setup.judgeCostUsd + setup.agentCostUsd).toFixed(2)}`
      + ` | runs ${setup.completedCount}${failed}`
    );

    const taskLines = Object.values(setup.tasks)
      .sort((left, right) => left.taskKey.localeCompare(right.taskKey))
      .map((cell) => `${cell.taskKey}=${cell.avgScore != null ? cell.avgScore.toFixed(1) : cell.failedCount > 0 ? "failed" : "n/a"}`);
    if (taskLines.length > 1) lines.push(`  tasks: ${taskLines.join("  ")}`);
  }

  const winners = options.winners === false ? [] : renderMatrixWinners(matrix);
  if (winners.length > 0) lines.push("", ...winners);

  return lines;
}
