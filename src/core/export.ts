import { ComparisonMatrix, ComparisonSetup, NO_MODEL_LABEL, setupDisplayName, setupModelSuffix } from "./comparison";

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
  totalCostUsd: number;
  runCount: number;
  completedCount: number;
  failedCount: number;
  lastRunAt: string | null;
  tasks: ComparisonExportTaskCell[];
}

export interface ComparisonExportWinners {
  score: string | null;
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
  winners: ComparisonExportWinners;
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

export function buildComparisonWinners(matrix: ComparisonMatrix): ComparisonExportWinners {
  return {
    score: pickWinner(matrix.setups, (s) => s.avgScore != null, (a, b) => a.avgScore! > b.avgScore!),
    quality: pickWinner(matrix.setups, (s) => s.avgQuality != null, (a, b) => a.avgQuality! > b.avgQuality!),
    tests: pickWinner(matrix.setups, (s) => s.testsTotal > 0, (a, b) => testPassRate(a)! > testPassRate(b)!),
    speed: pickWinner(matrix.setups, (s) => s.avgDurationMs != null, (a, b) => a.avgDurationMs! < b.avgDurationMs!),
    leanestTokens: pickWinner(matrix.setups, (s) => s.agentUsageRuns > 0, (a, b) => a.agentTokens < b.agentTokens),
    cheapest: pickWinner(matrix.setups, () => true, (a, b) => totalCost(a) < totalCost(b))
  };
}

export function buildComparisonExport(matrix: ComparisonMatrix, meta: ComparisonExportMeta): ComparisonExportPayload {
  return {
    schema: "agent-bench.comparison/v1",
    meta,
    totals: { ...matrix.totals, setups: matrix.setups.length },
    benchmarkKeys: matrix.benchmarkKeys,
    taskKeys: matrix.taskKeys,
    winners: buildComparisonWinners(matrix),
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
      runCount: setup.runCount,
      completedCount: setup.completedCount,
      failedCount: setup.failedCount,
      lastRunAt: setup.lastRunAt,
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
  lines.push("| # | Setup | Score | Quality | Tests | Avg time | Agent tokens | Judge tokens | Cost | Runs |");
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
      `$${row.totalCostUsd.toFixed(2)}`,
      runs
    ].map((cell) => `| ${cell} `).join("") + "|");
  }
  lines.push("");

  const winnerLines = [
    payload.winners.score ? `- **Best score:** ${payload.winners.score}` : null,
    payload.winners.quality ? `- **Best quality:** ${payload.winners.quality}` : null,
    payload.winners.tests ? `- **Best test pass rate:** ${payload.winners.tests}` : null,
    payload.winners.speed ? `- **Fastest:** ${payload.winners.speed}` : null,
    payload.winners.leanestTokens ? `- **Leanest agent tokens:** ${payload.winners.leanestTokens}` : null,
    payload.winners.cheapest ? `- **Cheapest:** ${payload.winners.cheapest}` : null
  ].filter(Boolean) as string[];
  if (winnerLines.length > 0) {
    lines.push("## Winners", "", ...winnerLines, "");
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

  lines.push("## Token accounting", "");
  lines.push(`- Judge tokens: ${formatTokens(payload.totals.judgeTokens)} ($${payload.totals.judgeCostUsd.toFixed(2)})`);
  lines.push(`- Agent tokens: ${payload.totals.agentTokens > 0 ? formatTokens(payload.totals.agentTokens) : "n/a"} ($${payload.totals.agentCostUsd.toFixed(2)})`);
  lines.push(`- Reviews: ${payload.totals.gatewayReviews} fresh · ${payload.totals.cachedReviews} cached · ${payload.totals.rulesReviews} rules · ${payload.totals.offReviews} off`);
  lines.push("");
  lines.push("_Built from persisted runs — generating this report spent no model tokens._");

  return lines.join("\n");
}

/* ---------------- CSV ---------------- */

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderComparisonCsv(matrix: ComparisonMatrix, meta: ComparisonExportMeta): string {
  const payload = buildComparisonExport(matrix, meta);
  const header = [
    "rank", "setup_key", "agent", "model",
    "avg_score", "avg_quality", "tests_passed", "tests_total", "test_pass_rate",
    "avg_duration_ms", "agent_tokens", "judge_tokens", "total_cost_usd",
    "runs_completed", "runs_failed", "last_run_at",
    ...payload.taskKeys.map((taskKey) => `task:${taskKey}`)
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
    ...payload.taskKeys.map((taskKey) => row.tasks.find((entry) => entry.taskKey === taskKey)?.avgScore ?? null)
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/* ---------------- HTML ---------------- */

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
${cell(`$${row.totalCostUsd.toFixed(2)}`, row.totalCostUsd, maxCost, true, isBest(payload.winners.cheapest))}
<td class="num">${row.completedCount}${row.failedCount > 0 ? ` +${row.failedCount}✗` : ""}</td>
</tr>`;
  }).join("\n");

  const winnerItems = [
    payload.winners.score ? `<li><strong>Best score:</strong> ${escapeHtml(payload.winners.score)}</li>` : "",
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
<thead><tr><th>Setup (agent × model)</th><th>Score</th><th>Quality</th><th>Tests</th><th>Avg time</th><th>Agent tokens</th><th>Judge tokens</th><th>Cost</th><th>Runs</th></tr></thead>
<tbody>
${bodyRows}
</tbody></table></div>
${winnerItems ? `<h2 style="margin-top:1.1rem">Winners</h2><ul class="winners">${winnerItems}</ul>` : ""}
</section>
${heatmap}`}
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
