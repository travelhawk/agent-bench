import { buildHeadlineWinners, ComparisonMatrix, ComparisonSetup, ComparisonSetupMetrics, ComparisonTrapCell, formatBlindRank, formatTrapCell, setupTrapTotals, NO_MODEL_LABEL, setupDisplayName, setupModelSuffix, trapErrorFootnotes } from "./comparison";
import { BatchTotals, BlindReviewerUsage, buildBatchTotals, buildMetricsRows, formatBatchTotals } from "./metrics-block";

/**
 * Shareable renderings of a comparison matrix.
 *
 * Every renderer here is pure and works off an already-built ComparisonMatrix,
 * so exporting or re-exporting a comparison costs zero tokens — same guarantee
 * the comparison board itself makes.
 */

export type ComparisonExportFormat = "json" | "md" | "csv" | "html";

export const COMPARISON_EXPORT_FORMATS: readonly ComparisonExportFormat[] = ["json", "md", "csv", "html"];

export interface ComparisonExportMeta {
  generatedAt: string;
  toolVersion?: string;
  benchmarkKey?: string | null;
  taskKey?: string | null;
  title?: string;
  /** Deep link back into the workbench comparison view, when the exporter knows the origin. */
  shareUrl?: string | null;
  /** What the blind reviewer of this batch spent (not stored per run, so passed in). */
  blindReviewer?: BlindReviewerUsage | null;
}

export interface ComparisonExportTaskCell {
  taskKey: string;
  avgScore: number | null;
  bestScore: number | null;
  runCount: number;
  failedCount: number;
  testsPassed: number;
  testsTotal: number;
}

export interface ComparisonExportRow {
  rank: number;
  setupKey: string;
  agentName: string;
  modelLabel: string;
  avgScore: number | null;
  avgQuality: number | null;
  testsPassed: number;
  testsTotal: number;
  testPassRate: number | null;
  avgDurationMs: number | null;
  agentTokens: number | null;
  judgeTokens: number;
  /** Agent + judge cost summed over all runs of the setup. */
  totalCostUsd: number;
  /** `totalCostUsd / runCount`. */
  avgCostUsd: number;
  trapsPassed: number | null;
  trapsTotal: number | null;
  runCount: number;
  completedCount: number;
  failedCount: number;
  lastRunAt: string | null;
  tasks: ComparisonExportTaskCell[];
  traps: Record<string, ComparisonTrapCell>;
  blindRank: number | null;
  blindNotes: string | null;
  metrics: ComparisonSetupMetrics;
}

export interface ComparisonExportWinners {
  /** One-line verdict from traps + blind rank; says "no clear winner" when they disagree. */
  verdict: string | null;
  /** Setup key(s) with the highest trap pass rate over all trials; ties joined with " = ". */
  traps: string | null;
  trapsPassed: number | null;
  trapsTotal: number | null;
  /** Setup key(s) with the lowest average blind rank; ties joined with " = ". */
  blindRank: string | null;
  blindRankValue: number | null;
  /** Top judge score; null when no LLM judge ran (rules/no-judge runs have no score). */
  score: string | null;
  /** Null when every setup has the same quality. */
  quality: string | null;
  tests: string | null;
  speed: string | null;
  leanestTokens: string | null;
  cheapest: string | null;
}

export interface ComparisonExportPayload {
  schema: "agent-bench.comparison/v1";
  meta: ComparisonExportMeta;
  totals: ComparisonMatrix["totals"] & { setups: number };
  benchmarkKeys: string[];
  taskKeys: string[];
  trapIds: string[];
  winners: ComparisonExportWinners;
  batchTotals: BatchTotals;
  setups: ComparisonExportRow[];
}

export function isComparisonExportFormat(value: unknown): value is ComparisonExportFormat {
  return typeof value === "string" && (COMPARISON_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function contentTypeForFormat(format: ComparisonExportFormat): string {
  switch (format) {
    case "json": return "application/json; charset=utf-8";
    case "csv": return "text/csv; charset=utf-8";
    case "html": return "text/html; charset=utf-8";
    default: return "text/markdown; charset=utf-8";
  }
}

export function comparisonExportFileName(format: ComparisonExportFormat, meta: ComparisonExportMeta): string {
  const scope = [meta.benchmarkKey, meta.taskKey].filter(Boolean).join("-") || "all";
  const stamp = meta.generatedAt.replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);
  return `agent-bench-comparison-${slug(scope)}-${stamp}.${format}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "all";
}

function totalCost(setup: ComparisonSetup): number {
  return Number((setup.judgeCostUsd + setup.agentCostUsd).toFixed(4));
}

function testPassRate(setup: ComparisonSetup): number | null {
  return setup.testsTotal > 0 ? Number((setup.testsPassed / setup.testsTotal).toFixed(4)) : null;
}

/** Label/value pairs for the summary list, traps and blind rank first; a score only when an LLM judge ran. */
export function headlineWinnerEntries(winners: ComparisonExportWinners): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (winners.traps) entries.push(["Most traps passed", `${winners.traps} (${winners.trapsPassed}/${winners.trapsTotal})`]);
  if (winners.blindRank && winners.blindRankValue != null) entries.push(["Best blind rank", `${winners.blindRank} (${formatBlindRank(winners.blindRankValue)})`]);
  if (winners.score) entries.push(["Best judge score", winners.score]);
  return entries;
}

function pickWinner(
  setups: ComparisonSetup[],
  eligible: (setup: ComparisonSetup) => boolean,
  better: (candidate: ComparisonSetup, current: ComparisonSetup) => boolean
): string | null {
  let winner: ComparisonSetup | null = null;
  for (const setup of setups) {
    if (!eligible(setup)) continue;
    if (!winner || better(setup, winner)) winner = setup;
  }
  return winner?.setupKey ?? null;
}

function avgCost(setup: ComparisonSetup): number {
  return Number((totalCost(setup) / Math.max(1, setup.runCount)).toFixed(4));
}

export function buildComparisonWinners(matrix: ComparisonMatrix): ComparisonExportWinners {
  const headline = buildHeadlineWinners(matrix.setups);
  return {
    verdict: headline.verdict,
    traps: headline.traps ? headline.traps.setupKeys.join(" = ") : null,
    trapsPassed: headline.traps?.passed ?? null,
    trapsTotal: headline.traps?.total ?? null,
    blindRank: headline.blindRank ? headline.blindRank.setupKeys.join(" = ") : null,
    blindRankValue: headline.blindRank?.rank ?? null,
    score: pickWinner(matrix.setups, (s) => s.avgScore != null, (a, b) => a.avgScore! > b.avgScore!),
    quality: headline.qualityAllEqual
      ? null
      : pickWinner(matrix.setups, (s) => s.avgQuality != null, (a, b) => a.avgQuality! > b.avgQuality!),
    tests: pickWinner(matrix.setups, (s) => s.testsTotal > 0, (a, b) => testPassRate(a)! > testPassRate(b)!),
    speed: pickWinner(matrix.setups, (s) => s.avgDurationMs != null, (a, b) => a.avgDurationMs! < b.avgDurationMs!),
    leanestTokens: pickWinner(matrix.setups, (s) => s.agentUsageRuns > 0, (a, b) => a.agentTokens < b.agentTokens),
    cheapest: pickWinner(matrix.setups, () => true, (a, b) => avgCost(a) < avgCost(b))
  };
}

export function buildComparisonExport(matrix: ComparisonMatrix, meta: ComparisonExportMeta): ComparisonExportPayload {
  return {
    schema: "agent-bench.comparison/v1",
    meta,
    totals: { ...matrix.totals, setups: matrix.setups.length },
    benchmarkKeys: matrix.benchmarkKeys,
    taskKeys: matrix.taskKeys,
    trapIds: matrix.trapIds,
    winners: buildComparisonWinners(matrix),
    batchTotals: buildBatchTotals(matrix, meta.blindReviewer),
    setups: matrix.setups.map((setup, index) => ({
      rank: index + 1,
      setupKey: setup.setupKey,
      agentName: setup.agentName,
      modelLabel: setup.modelLabel,
      avgScore: setup.avgScore,
      avgQuality: setup.avgQuality,
      testsPassed: setup.testsPassed,
      testsTotal: setup.testsTotal,
      testPassRate: testPassRate(setup),
      avgDurationMs: setup.avgDurationMs,
      agentTokens: setup.agentUsageRuns > 0 ? setup.agentTokens : null,
      judgeTokens: setup.judgeTokens,
      totalCostUsd: totalCost(setup),
      avgCostUsd: avgCost(setup),
      trapsPassed: setupTrapTotals(setup)?.passed ?? null,
      trapsTotal: setupTrapTotals(setup)?.total ?? null,
      runCount: setup.runCount,
      completedCount: setup.completedCount,
      failedCount: setup.failedCount,
      lastRunAt: setup.lastRunAt,
      traps: setup.traps,
      blindRank: setup.blindRank,
      blindNotes: setup.blindNotes,
      metrics: setup.metrics,
      tasks: matrix.taskKeys
        .map((taskKey) => setup.tasks[taskKey])
        .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell))
        .map((cell) => ({
          taskKey: cell.taskKey,
          avgScore: cell.avgScore,
          bestScore: cell.bestScore,
          runCount: cell.runCount,
          failedCount: cell.failedCount,
          testsPassed: cell.testsPassed,
          testsTotal: cell.testsTotal
        }))
    }))
  };
}

/* ---------------- shared formatting ---------------- */

function formatTokens(value: number | null): string {
  if (value == null) return "n/a";
  if (value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "n/a";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatScore(value: number | null): string {
  return value != null ? value.toFixed(2) : "n/a";
}

function formatTests(passed: number, total: number): string {
  return total > 0 ? `${passed}/${total}` : "n/a";
}

function scopeLabel(meta: ComparisonExportMeta): string {
  const parts: string[] = [];
  parts.push(meta.benchmarkKey ? `benchmark \`${meta.benchmarkKey}\`` : "all benchmarks");
  if (meta.taskKey) parts.push(`task \`${meta.taskKey}\``);
  return parts.join(" · ");
}

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
}

/* ---------------- Markdown ---------------- */

export function renderComparisonMarkdown(matrix: ComparisonMatrix, meta: ComparisonExportMeta): string {
  const payload = buildComparisonExport(matrix, meta);
  const title = meta.title ?? "Agent × Model Comparison";
  const lines: string[] = [];

  lines.push(`# ${title}`, "");
  lines.push(
    `**Scope:** ${scopeLabel(meta).replace(/`/g, "`")} · ` +
    `**Setups:** ${payload.totals.setups} · ` +
    `**Runs:** ${payload.totals.runs} · ` +
    `**Total cost:** $${(payload.totals.judgeCostUsd + payload.totals.agentCostUsd).toFixed(2)}`
  );
  lines.push(`**Generated:** ${meta.generatedAt}${meta.toolVersion ? ` by agent-bench ${meta.toolVersion}` : ""}`);
  if (meta.shareUrl) lines.push(`**Workbench:** ${meta.shareUrl}`);
  lines.push("");

  if (payload.setups.length === 0) {
    lines.push("_No runs matched this comparison scope yet._", "");
    return lines.join("\n");
  }

  lines.push("## Leaderboard", "");
  lines.push(`| # | Setup | Judge score | Quality | Tests | Avg time | Agent tokens | Judge tokens | Cost (total over runs) | Runs |`);
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of payload.setups) {
    const runs = `${row.completedCount}${row.failedCount > 0 ? ` (+${row.failedCount} failed)` : ""}`;
    lines.push([
      medal(row.rank),
      `**${setupDisplayName(row)}**${setupModelSuffix(row) ? ` · ${setupModelSuffix(row)}` : ""}`,
      formatScore(row.avgScore),
      formatScore(row.avgQuality),
      formatTests(row.testsPassed, row.testsTotal),
      formatDuration(row.avgDurationMs),
      formatTokens(row.agentTokens),
      formatTokens(row.judgeTokens),
      `$${row.totalCostUsd.toFixed(2)} (avg $${row.avgCostUsd.toFixed(2)})`,
      runs
    ].map((cell) => `| ${cell} `).join("") + "|");
  }
  lines.push("");

  const winnerLines = [
    ...headlineWinnerEntries(payload.winners).map(([label, value]) => `- **${label}:** ${value}`),
    payload.winners.quality ? `- **Best quality:** ${payload.winners.quality}` : null,
    payload.winners.tests ? `- **Best test pass rate:** ${payload.winners.tests}` : null,
    payload.winners.speed ? `- **Fastest:** ${payload.winners.speed}` : null,
    payload.winners.leanestTokens ? `- **Leanest agent tokens:** ${payload.winners.leanestTokens}` : null,
    payload.winners.cheapest ? `- **Cheapest:** ${payload.winners.cheapest}` : null
  ].filter(Boolean) as string[];
  if (winnerLines.length > 0) {
    lines.push("## Winners", "");
    if (payload.winners.verdict) lines.push(`**Verdict:** ${payload.winners.verdict}`, "");
    lines.push(...winnerLines, "");
  }

  if (payload.taskKeys.length > 1) {
    lines.push("## Score per task", "");
    lines.push(`| Setup | ${payload.taskKeys.join(" | ")} |`);
    lines.push(`| --- | ${payload.taskKeys.map(() => "---:").join(" | ")} |`);
    for (const row of payload.setups) {
      const cells = payload.taskKeys.map((taskKey) => {
        const cell = row.tasks.find((entry) => entry.taskKey === taskKey);
        if (!cell) return "—";
        if (cell.avgScore != null) return cell.avgScore.toFixed(1);
        return cell.failedCount > 0 ? "✗" : "—";
      });
      lines.push(`| ${setupDisplayName(row)}${setupModelSuffix(row) ? ` · ${setupModelSuffix(row)}` : ""} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  if (payload.trapIds.length > 0) {
    lines.push("## Traps (hidden checks)", "");
    lines.push(`| Trap | ${payload.setups.map((row) => setupDisplayName(row)).join(" | ")} |`);
    lines.push(`| --- | ${payload.setups.map(() => ":---:").join(" | ")} |`);
    for (const trapId of payload.trapIds) {
      lines.push(`| ${trapId} | ${payload.setups.map((row) => formatTrapCell(row.traps[trapId])).join(" | ")} |`);
    }
    lines.push("");
    const footnotes = trapErrorFootnotes(payload.trapIds, payload.setups);
    if (footnotes.length > 0) lines.push(...footnotes.map((note) => `- error: ${note.replace(/\|/g, "/")}`), "");
  }

  const blindRanked = payload.setups.filter((row) => row.blindRank != null).sort((a, b) => a.blindRank! - b.blindRank!);
  if (blindRanked.length > 0) {
    lines.push("## Blind review", "");
    lines.push("| Rank | Setup | Notes |", "| ---: | --- | --- |");
    for (const row of blindRanked) {
      lines.push(`| ${row.blindRank} | ${mdCell(setupDisplayName(row))} | ${mdCell(row.blindNotes ?? "")} |`);
    }
    lines.push("");
  }

  lines.push("## Metrics per setup", "", "_avg (min-max) over trials_", "");
  lines.push("| Setup | Runs | Wall time | Agent input tokens | Agent output tokens | Agent cost |", "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of buildMetricsRows(matrix)) {
    lines.push(`| ${mdCell(row.setup)} | ${row.runs} | ${row.wallTime} | ${row.inputTokens} | ${row.outputTokens} | ${row.agentCost} |`);
  }
  lines.push("", "**Batch totals**", "", ...formatBatchTotals(payload.batchTotals).map(([label, value]) => `- ${label}: ${value}`), "");

  lines.push("## Token accounting", "");
  lines.push(`- Judge tokens: ${formatTokens(payload.totals.judgeTokens)} ($${payload.totals.judgeCostUsd.toFixed(2)})`);
  lines.push(`- Agent tokens: ${payload.totals.agentTokens > 0 ? formatTokens(payload.totals.agentTokens) : "n/a"} ($${payload.totals.agentCostUsd.toFixed(2)})`);
  lines.push(`- Reviews: ${payload.totals.gatewayReviews} fresh · ${payload.totals.cachedReviews} cached · ${payload.totals.rulesReviews} rules · ${payload.totals.offReviews} off`);
  lines.push("");
  lines.push("_Built from persisted runs — generating this report spent no model tokens._");

  return lines.join("\n");
}

/**
 * Setup labels are free text up to 80 characters, so a `|` in one would break
 * the table row it lands in. Reviewer notes were already escaped; the labels
 * were not.
 */
function mdCell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

/* ---------------- CSV ---------------- */

/**
 * A cell opening with `=`, `+`, `@` or a lone `-` runs as a formula when the CSV
 * is opened in Excel or Sheets, and setup labels are free text. A leading
 * apostrophe keeps the value readable and inert. This suite ships a
 * `csv-formula-roundtrip` trap for the same bug in the builds it measures.
 */
function csvFormulaSafe(text: string): string {
  const risky = /^[=+@\t\r]/.test(text) || (text.startsWith("-") && !Number.isFinite(Number(text)));
  return risky ? `'${text}` : text;
}

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const text = typeof value === "number" ? String(value) : csvFormulaSafe(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderComparisonCsv(matrix: ComparisonMatrix, meta: ComparisonExportMeta): string {
  const payload = buildComparisonExport(matrix, meta);
  const header = [
    "rank", "setup_key", "agent", "model",
    "avg_score", "avg_quality", "tests_passed", "tests_total", "test_pass_rate",
    "avg_duration_ms", "agent_tokens", "judge_tokens", "total_cost_usd",
    "runs_completed", "runs_failed", "last_run_at",
    "duration_ms_min", "duration_ms_max", "agent_input_tokens_avg", "agent_output_tokens_avg", "agent_cost_usd_avg", "agent_cost_usd_min", "agent_cost_usd_max",
    ...payload.taskKeys.map((taskKey) => `task:${taskKey}`),
    ...(payload.setups.some((row) => row.blindRank != null) ? ["blind_rank"] : []),
    ...payload.trapIds.map((trapId) => `trap:${trapId}`)
  ];

  const rows = payload.setups.map((row) => [
    row.rank,
    row.setupKey,
    row.agentName,
    row.modelLabel,
    row.avgScore,
    row.avgQuality,
    row.testsPassed,
    row.testsTotal,
    row.testPassRate,
    row.avgDurationMs,
    row.agentTokens,
    row.judgeTokens,
    row.totalCostUsd,
    row.completedCount,
    row.failedCount,
    row.lastRunAt,
    row.metrics.durationMs?.min ?? null,
    row.metrics.durationMs?.max ?? null,
    row.metrics.agentInputTokens ? Math.round(row.metrics.agentInputTokens.avg) : null,
    row.metrics.agentOutputTokens ? Math.round(row.metrics.agentOutputTokens.avg) : null,
    row.metrics.agentCostUsd ? Number(row.metrics.agentCostUsd.avg.toFixed(4)) : null,
    row.metrics.agentCostUsd ? Number(row.metrics.agentCostUsd.min.toFixed(4)) : null,
    row.metrics.agentCostUsd ? Number(row.metrics.agentCostUsd.max.toFixed(4)) : null,
    ...payload.taskKeys.map((taskKey) => row.tasks.find((entry) => entry.taskKey === taskKey)?.avgScore ?? null),
    ...(payload.setups.some((entry) => entry.blindRank != null) ? [row.blindRank] : []),
    ...payload.trapIds.map((trapId) => formatTrapCell(row.traps[trapId]))
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/* ---------------- HTML ---------------- */

function trapNotesHtml(payload: ComparisonExportPayload): string {
  const notes = trapErrorFootnotes(payload.trapIds, payload.setups);
  if (notes.length === 0) return "";
  return `<ul class="winners" style="margin-top:.6rem">${notes.map((note) => `<li><strong>error:</strong> ${escapeHtml(note)}</li>`).join("")}</ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function heatClass(score: number | null, failed: number): string {
  if (score == null) return failed > 0 ? "heat-bad" : "heat-none";
  if (score >= 7.5) return "heat-good";
  if (score >= 5) return "heat-warn";
  return "heat-bad";
}

function bar(value: number | null, max: number, invert: boolean, best: boolean): string {
  const ratio = value == null || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const tone = best ? "bar-best" : invert ? "bar-invert" : "bar-normal";
  return `<span class="bar"><span class="${tone}" style="width:${Math.round(ratio * 100)}%"></span></span>`;
}

/**
 * Self-contained single-file report: no scripts, no external assets, works
 * offline and in both colour schemes. This is the artefact you hand to someone
 * who does not have the workbench running.
 */
export function renderComparisonHtml(matrix: ComparisonMatrix, meta: ComparisonExportMeta): string {
  const payload = buildComparisonExport(matrix, meta);
  const title = meta.title ?? "Agent × Model Comparison";
  const maxDuration = Math.max(...payload.setups.map((row) => row.avgDurationMs ?? 0), 1);
  const maxAgentTokens = Math.max(...payload.setups.map((row) => row.agentTokens ?? 0), 1);
  const maxJudgeTokens = Math.max(...payload.setups.map((row) => row.judgeTokens), 1);
  const maxCost = Math.max(...payload.setups.map((row) => row.totalCostUsd), 0.0001);

  const styles = `
:root{color-scheme:light dark;--bg:#f7f7f8;--surface:#fff;--surface-2:#f0f1f3;--text:#16181d;--muted:#5c6270;--border:#dfe1e6;--accent:#4f46e5;--info:#0ea5e9;--good:#16a34a;--warn:#d97706;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f13;--surface:#151820;--surface-2:#1c202a;--text:#e9ebf0;--muted:#9aa2b1;--border:#2a2f3b;--accent:#818cf8;--info:#38bdf8;--good:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem 3rem;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:1.5rem}
h1{font-size:1.6rem;margin:0}
h2{font-size:1.05rem;margin:0 0 .6rem;letter-spacing:.02em}
.eyebrow{margin:0 0 .3rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.meta{margin:.5rem 0 0;color:var(--muted);font-size:.86rem}
.meta a{color:var(--accent)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.2rem}
.stats{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1rem}
.stat{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:.5rem .85rem;display:flex;flex-direction:column;min-width:8.5rem}
.stat span{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.stat strong{font-size:1.05rem;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;border:1px solid var(--border);border-radius:10px}
table{width:100%;border-collapse:collapse;font-size:.86rem}
th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
thead th{background:var(--surface-2);color:var(--muted);font-size:.7rem;letter-spacing:.09em;text-transform:uppercase}
tbody tr:last-child td{border-bottom:none}
td.num{font-variant-numeric:tabular-nums}
.setup strong{display:block}
.chip{display:inline-block;margin-top:.15rem;padding:.1rem .45rem;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);font-size:.72rem;color:var(--muted)}
.cell{display:flex;flex-direction:column;gap:.25rem;min-width:5.5rem}
.cell b{font-weight:600;font-variant-numeric:tabular-nums}
.bar{display:block;height:5px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.bar span{display:block;height:100%;border-radius:inherit}
.bar-normal{background:var(--accent)}.bar-invert{background:var(--info)}.bar-best{background:var(--good)}
.best b{color:var(--good)}
.heat-good{background:color-mix(in srgb,var(--good) 20%,transparent)}
.heat-warn{background:color-mix(in srgb,var(--warn) 20%,transparent)}
.heat-bad{background:color-mix(in srgb,var(--bad) 18%,transparent)}
.heat-none{color:var(--muted)}
.heat{text-align:center;font-variant-numeric:tabular-nums}
.heat small{display:block;font-size:.68rem;color:var(--muted)}
ul.winners{margin:0;padding-left:1.1rem;color:var(--muted)}
ul.winners strong{color:var(--text)}
.verdict{margin:0 0 .5rem}
.trap-winner{box-shadow:inset 2px 0 0 var(--good),inset -2px 0 0 var(--good)}
th.trap-winner{color:var(--good)}
.trap-total td{border-top:2px solid var(--border)}
footer{color:var(--muted);font-size:.8rem;text-align:center}
`.trim();

  const statsHtml = [
    ["Setups", String(payload.totals.setups)],
    ["Runs compared", String(payload.totals.runs)],
    ["Judge tokens", formatTokens(payload.totals.judgeTokens)],
    ["Agent tokens", payload.totals.agentTokens > 0 ? formatTokens(payload.totals.agentTokens) : "n/a"],
    ["Total cost", `$${(payload.totals.judgeCostUsd + payload.totals.agentCostUsd).toFixed(2)}`],
    ["Zero-token reviews", String(payload.totals.cachedReviews + payload.totals.rulesReviews + payload.totals.offReviews)]
  ].map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  const bodyRows = payload.setups.map((row) => {
    const cell = (label: string, value: number | null, max: number, invert: boolean, best: boolean) =>
      `<td class="cell-wrap ${best ? "best" : ""}"><div class="cell"><b>${escapeHtml(label)}</b>${bar(value, max, invert, best)}</div></td>`;
    const isBest = (key: string | null) => key === row.setupKey;
    return `<tr>
<td class="setup"><strong>${escapeHtml(`${medal(row.rank)} ${setupDisplayName(row)}`)}</strong>${setupModelSuffix(row) ? `<span class="chip">${escapeHtml(setupModelSuffix(row)!)}</span>` : ""}</td>
${cell(formatScore(row.avgScore), row.avgScore, 10, false, isBest(payload.winners.score))}
${cell(formatScore(row.avgQuality), row.avgQuality, 10, false, isBest(payload.winners.quality))}
${cell(formatTests(row.testsPassed, row.testsTotal), row.testPassRate != null ? row.testPassRate * 10 : null, 10, false, isBest(payload.winners.tests))}
${cell(formatDuration(row.avgDurationMs), row.avgDurationMs, maxDuration, true, isBest(payload.winners.speed))}
${cell(formatTokens(row.agentTokens), row.agentTokens, maxAgentTokens, true, isBest(payload.winners.leanestTokens))}
${cell(formatTokens(row.judgeTokens), row.judgeTokens, maxJudgeTokens, true, false)}
${cell(`$${row.totalCostUsd.toFixed(2)} (avg $${row.avgCostUsd.toFixed(2)})`, row.totalCostUsd, maxCost, true, isBest(payload.winners.cheapest))}
<td class="num">${row.completedCount}${row.failedCount > 0 ? ` +${row.failedCount}✗` : ""}</td>
</tr>`;
  }).join("\n");

  const winnerItems = [
    ...headlineWinnerEntries(payload.winners).map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`),
    payload.winners.quality ? `<li><strong>Best quality:</strong> ${escapeHtml(payload.winners.quality)}</li>` : "",
    payload.winners.tests ? `<li><strong>Best test pass rate:</strong> ${escapeHtml(payload.winners.tests)}</li>` : "",
    payload.winners.speed ? `<li><strong>Fastest:</strong> ${escapeHtml(payload.winners.speed)}</li>` : "",
    payload.winners.leanestTokens ? `<li><strong>Leanest agent tokens:</strong> ${escapeHtml(payload.winners.leanestTokens)}</li>` : "",
    payload.winners.cheapest ? `<li><strong>Cheapest:</strong> ${escapeHtml(payload.winners.cheapest)}</li>` : ""
  ].join("");

  const heatmap = payload.taskKeys.length > 1
    ? `<section class="panel">
<p class="eyebrow">Per task</p><h2>Score heatmap</h2>
<div class="scroll"><table><thead><tr><th>Setup</th>${payload.taskKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>
${payload.setups.map((row) => `<tr><td class="setup"><strong>${escapeHtml(setupDisplayName(row))}</strong>${setupModelSuffix(row) ? `<span class="chip">${escapeHtml(setupModelSuffix(row)!)}</span>` : ""}</td>${payload.taskKeys.map((taskKey) => {
      const taskCell = row.tasks.find((entry) => entry.taskKey === taskKey);
      if (!taskCell) return `<td class="heat heat-none">—</td>`;
      const label = taskCell.avgScore != null ? taskCell.avgScore.toFixed(1) : taskCell.failedCount > 0 ? "✗" : "—";
      const sub = formatTests(taskCell.testsPassed, taskCell.testsTotal) + (taskCell.runCount > 1 ? ` · ${taskCell.runCount}r` : "");
      return `<td class="heat ${heatClass(taskCell.avgScore, taskCell.failedCount)}"><b>${escapeHtml(label)}</b><small>${escapeHtml(sub)}</small></td>`;
    }).join("")}</tr>`).join("\n")}
</tbody></table></div></section>`
    : "";

  const trapClass = (label: string) => label === "pass" ? "heat-good" : label === "FAIL" || label === "error" ? "heat-bad" : label.includes("/") ? "heat-warn" : "heat-none";
  const trapWinnerKeys = new Set(payload.winners.traps ? payload.winners.traps.split(" = ") : []);
  const isTrapWinner = (setupKey: string) => trapWinnerKeys.has(setupKey);
  const trapPanel = payload.trapIds.length > 0
    ? `<section class="panel">
<p class="eyebrow">Hidden checks</p><h2>Traps</h2>
<div class="scroll"><table><thead><tr><th>Trap</th>${payload.setups.map((row) => `<th${isTrapWinner(row.setupKey) ? ` class="trap-winner"` : ""}>${escapeHtml(setupDisplayName(row))}${isTrapWinner(row.setupKey) ? " ★" : ""}</th>`).join("")}</tr></thead><tbody>
${payload.trapIds.map((trapId) => `<tr><td>${escapeHtml(trapId)}</td>${payload.setups.map((row) => {
      const label = formatTrapCell(row.traps[trapId]);
      return `<td class="heat ${trapClass(label)}${isTrapWinner(row.setupKey) ? " trap-winner" : ""}"><b>${escapeHtml(label)}</b></td>`;
    }).join("")}</tr>`).join("\n")}
<tr class="trap-total"><td><strong>total</strong></td>${payload.setups.map((row) => `<td class="heat${isTrapWinner(row.setupKey) ? " trap-winner best" : ""}"><b>${row.trapsTotal ? `${row.trapsPassed}/${row.trapsTotal}` : "n/a"}</b></td>`).join("")}</tr>
</tbody></table></div>${trapNotesHtml(payload)}</section>`
    : "";
  const metricsPanel = payload.setups.length > 0
    ? `<section class="panel">
<p class="eyebrow">Per trial: avg (min-max)</p><h2>Metrics per setup</h2>
<div class="scroll"><table><thead><tr><th>Setup</th><th>Runs</th><th>Wall time</th><th>Agent input tokens</th><th>Agent output tokens</th><th>Agent cost</th></tr></thead><tbody>
${buildMetricsRows(matrix).map((row) => `<tr><td>${escapeHtml(row.setup)}</td><td class="num">${row.runs}</td><td class="num">${escapeHtml(row.wallTime)}</td><td class="num">${escapeHtml(row.inputTokens)}</td><td class="num">${escapeHtml(row.outputTokens)}</td><td class="num">${escapeHtml(row.agentCost)}</td></tr>`).join("")}
</tbody></table></div>
<h2 style="margin-top:1.1rem">Batch totals</h2>
<ul class="winners">${formatBatchTotals(payload.batchTotals).map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>
</section>`
    : "";
  const blindRows = payload.setups.filter((row) => row.blindRank != null).sort((a, b) => a.blindRank! - b.blindRank!);
  const blindPanel = blindRows.length > 0
    ? `<section class="panel">
<p class="eyebrow">Blind reviewer</p><h2>Blind ranking</h2>
<div class="scroll"><table><thead><tr><th>Rank</th><th>Setup</th><th>Notes</th></tr></thead><tbody>
${blindRows.map((row) => `<tr><td class="num">${row.blindRank}</td><td>${escapeHtml(setupDisplayName(row))}</td><td style="white-space:normal">${escapeHtml(row.blindNotes ?? "")}</td></tr>`).join("\n")}
</tbody></table></div></section>`
    : "";

  const empty = `<section class="panel"><p>No runs matched this comparison scope yet.</p></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head><body><main>
<header class="panel">
<p class="eyebrow">agent-bench</p>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(scopeLabel(meta).replace(/`/g, ""))} · generated ${escapeHtml(meta.generatedAt)}${meta.toolVersion ? ` · agent-bench ${escapeHtml(meta.toolVersion)}` : ""}${meta.shareUrl ? ` · <a href="${escapeHtml(meta.shareUrl)}">open in workbench</a>` : ""}</p>
<div class="stats">${statsHtml}</div>
</header>
${payload.setups.length === 0 ? empty : `<section class="panel">
<p class="eyebrow">Side by side</p><h2>Leaderboard</h2>
<div class="scroll"><table>
<thead><tr><th>Setup (agent × model)</th><th>Judge score</th><th>Quality</th><th>Tests</th><th>Avg time</th><th>Agent tokens</th><th>Judge tokens</th><th>Cost (total over runs)</th><th>Runs</th></tr></thead>
<tbody>
${bodyRows}
</tbody></table></div>
${winnerItems ? `<h2 style="margin-top:1.1rem">Winners</h2>${payload.winners.verdict ? `<p class="verdict"><strong>Verdict:</strong> ${escapeHtml(payload.winners.verdict)}</p>` : ""}<ul class="winners">${winnerItems}</ul>` : ""}
</section>
${heatmap}
${metricsPanel}
${trapPanel}
${blindPanel}`}
<footer>Built from persisted agent-bench runs — rendering this report spent no model tokens.</footer>
</main></body></html>`;
}

/* ---------------- dispatch ---------------- */

export function renderComparison(
  matrix: ComparisonMatrix,
  meta: ComparisonExportMeta,
  format: ComparisonExportFormat
): string {
  switch (format) {
    case "json": return `${JSON.stringify(buildComparisonExport(matrix, meta), null, 2)}\n`;
    case "csv": return renderComparisonCsv(matrix, meta);
    case "html": return renderComparisonHtml(matrix, meta);
    default: return renderComparisonMarkdown(matrix, meta);
  }
}

export { NO_MODEL_LABEL };
