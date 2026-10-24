import assert from "node:assert/strict";
import test from "node:test";
import { buildComparisonMatrix, setupKeyForRun } from "../src/core/comparison";
import {
  buildComparisonExport,
  comparisonExportFileName,
  contentTypeForFormat,
  isComparisonExportFormat,
  renderComparison,
  renderComparisonCsv,
  renderComparisonHtml,
  renderComparisonMarkdown
} from "../src/core/export";
import { ComparisonExportMeta } from "../src/core/export";
import { RunRecord } from "../src/types";

const META: ComparisonExportMeta = {
  generatedAt: "2026-08-26T09:30:00.000Z",
  toolVersion: "0.3.0",
  benchmarkKey: "repo-maintenance",
  taskKey: null
};

function makeRun(overrides: Partial<RunRecord> & { runKey: string }): RunRecord {
  return {
    id: 1,
    benchmarkKey: "repo-maintenance",
    taskKey: "fix-react-bug",
    setupKey: null,
    modelId: "openai/gpt-4.1-mini",
    reviewMode: "gateway",
    judgeTotalTokens: 2000,
    agentName: "coder-a",
    agentVersion: "v1",
    suiteName: "repo-maintenance/fix-react-bug",
    status: "completed",
    score: 7,
    outcomeScore: 7,
    processScore: 5,
    reviewScore: 7,
    efficiencyScore: 6,
    testsScore: 7,
    llmScore: 7,
    perfScore: 6,
    scoreProfile: "hybrid",
    scoreConfidence: "high",
    failureReason: null,
    latencyMs: 1000,
    costUsd: 0.02,
    durationMs: 4000,
    artifactsPath: "/tmp/none",
    logText: "log",
    createdAt: "2026-08-26T09:00:00.000Z",
    diffAvailable: true,
    diffFilesChanged: 2,
    diffInsertions: 20,
    diffDeletions: 5,
    verifierTestsAvailable: true,
    verifierTestsTotal: 4,
    verifierTestsPassed: 3,
    qualityScore: 6.5,
    screenshotFile: null,
    videoFile: null,
    agentUsageAvailable: true,
    agentInputTokens: 1000,
    agentOutputTokens: 500,
    agentCostUsd: 0.01,
    ...overrides
  };
}

/** Three setups, so the comparison is genuinely N-way rather than a pair. */
function threeSetupMatrix() {
  return buildComparisonMatrix([
    makeRun({ runKey: "run-1" }),
    makeRun({
      runKey: "run-2",
      agentName: "coder-b",
      modelId: "anthropic/claude-sonnet-5",
      score: 9,
      qualityScore: 8.5,
      verifierTestsPassed: 4,
      durationMs: 2000,
      judgeTotalTokens: 0,
      costUsd: 0,
      agentInputTokens: 400,
      agentOutputTokens: 200,
      agentCostUsd: 0.004
    }),
    makeRun({
      runKey: "run-3",
      agentName: "coder-c",
      modelId: "openai/gpt-4.1",
      score: 5,
      qualityScore: 4,
      verifierTestsPassed: 1,
      durationMs: 9000,
      judgeTotalTokens: 5000,
      costUsd: 0.09,
      agentInputTokens: 5000,
      agentOutputTokens: 2500,
      agentCostUsd: 0.08
    })
  ]);
}

test("setupKeyForRun prefers the persisted setup label over the derived key", () => {
  assert.equal(setupKeyForRun(makeRun({ runKey: "run-x" })), "coder-a · openai/gpt-4.1-mini");
  assert.equal(setupKeyForRun(makeRun({ runKey: "run-y", setupKey: "baseline" })), "baseline");
  assert.equal(setupKeyForRun(makeRun({ runKey: "run-z", setupKey: "   " })), "coder-a · openai/gpt-4.1-mini");
});

test("buildComparisonMatrix narrows to the requested setup keys", () => {
  const runs = [
    makeRun({ runKey: "run-1" }),
    makeRun({ runKey: "run-2", agentName: "coder-b" }),
    makeRun({ runKey: "run-3", agentName: "coder-c" })
  ];

  const all = buildComparisonMatrix(runs);
  assert.equal(all.setups.length, 3);

  const narrowed = buildComparisonMatrix(runs, {
    setupKeys: ["coder-a · openai/gpt-4.1-mini", "coder-c · openai/gpt-4.1-mini"]
  });
  assert.equal(narrowed.setups.length, 2);
  assert.equal(narrowed.totals.runs, 2);
});

test("buildComparisonExport ranks every setup and names a winner per metric", () => {
  const payload = buildComparisonExport(threeSetupMatrix(), META);

  assert.equal(payload.schema, "agent-bench.comparison/v1");
  assert.equal(payload.totals.setups, 3);
  assert.equal(payload.setups.length, 3);
  assert.deepEqual(payload.setups.map((row) => row.rank), [1, 2, 3]);
  assert.equal(payload.setups[0].setupKey, "coder-b · anthropic/claude-sonnet-5");

  assert.equal(payload.winners.score, "coder-b · anthropic/claude-sonnet-5");
  assert.equal(payload.winners.quality, "coder-b · anthropic/claude-sonnet-5");
  assert.equal(payload.winners.tests, "coder-b · anthropic/claude-sonnet-5");
  assert.equal(payload.winners.speed, "coder-b · anthropic/claude-sonnet-5");
  assert.equal(payload.winners.leanestTokens, "coder-b · anthropic/claude-sonnet-5");
  assert.equal(payload.winners.cheapest, "coder-b · anthropic/claude-sonnet-5");

  const slowest = payload.setups.find((row) => row.setupKey === "coder-c · openai/gpt-4.1");
  assert.ok(slowest);
  assert.equal(slowest.agentTokens, 7500);
  assert.equal(slowest.totalCostUsd, 0.17);
  assert.equal(slowest.testPassRate, 0.25);
});

test("markdown export lists every setup as its own leaderboard row", () => {
  const markdown = renderComparisonMarkdown(threeSetupMatrix(), META);

  assert.match(markdown, /# Agent × Model Comparison/);
  assert.match(markdown, /\*\*Setups:\*\* 3/);
  assert.match(markdown, /coder-a/);
  assert.match(markdown, /coder-b/);
  assert.match(markdown, /coder-c/);
  assert.match(markdown, /## Winners/);
  assert.match(markdown, /spent no model tokens/);

  const leaderboardRows = markdown
    .split("\n")
    .filter((line) => line.startsWith("| ") && /coder-[abc]/.test(line));
  assert.equal(leaderboardRows.length, 3);
});

test("csv export emits one row per setup plus a column per task", () => {
  const matrix = buildComparisonMatrix([
    makeRun({ runKey: "run-1" }),
    makeRun({
      runKey: "run-2",
      taskKey: "security-audit-report",
      suiteName: "repo-maintenance/security-audit-report",
      score: 4
    }),
    makeRun({ runKey: "run-3", agentName: "coder-b", score: 8 })
  ]);

  const csv = renderComparisonCsv(matrix, META);
  const lines = csv.split("\r\n");

  assert.equal(lines.length, 3, "header + two setups");
  assert.match(lines[0], /^rank,setup_key,agent,model,/);
  assert.match(lines[0], /task:fix-react-bug/);
  assert.match(lines[0], /task:security-audit-report/);
  assert.match(lines[1], /^1,/);
  assert.match(lines[2], /^2,/);
});

test("csv export quotes values that contain separators", () => {
  const matrix = buildComparisonMatrix([
    makeRun({ runKey: "run-1", setupKey: 'weird, "quoted" setup' })
  ]);

  const csv = renderComparisonCsv(matrix, META);
  assert.match(csv, /"weird, ""quoted"" setup"/);
});

test("html export is self-contained and escapes untrusted labels", () => {
  const matrix = buildComparisonMatrix([
    makeRun({ runKey: "run-1", agentName: "<script>alert(1)</script>", modelId: "<img onerror=x>" }),
    makeRun({ runKey: "run-2", agentName: "coder-b", score: 9 })
  ]);

  const html = renderComparisonHtml(matrix, META);

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Agent × Model Comparison<\/title>/);
  assert.ok(!html.includes("<script>alert(1)</script>"), "setup labels must be escaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!/<script[\s>]/i.test(html), "report must not embed executable script tags");
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), "report must not reference external hosts");
});

test("exports show a custom setup label instead of the derived agent name", () => {
  const matrix = buildComparisonMatrix([
    makeRun({ runKey: "run-1", setupKey: "baseline" }),
    makeRun({ runKey: "run-2", setupKey: "loop-agent", agentName: "coder-b", score: 9 })
  ]);

  const markdown = renderComparisonMarkdown(matrix, META);
  assert.match(markdown, /\*\*loop-agent\*\*/);
  assert.match(markdown, /\*\*baseline\*\*/);

  const html = renderComparisonHtml(matrix, META);
  assert.match(html, /🥇 loop-agent/);
  assert.match(html, /🥈 baseline/);
});

test("html export renders an explicit empty state rather than a broken table", () => {
  const html = renderComparisonHtml(buildComparisonMatrix([]), META);
  assert.match(html, /No runs matched this comparison scope yet/);
});

test("renderComparison dispatches on format and pairs with the right content type", () => {
  const matrix = threeSetupMatrix();

  assert.match(renderComparison(matrix, META, "md"), /# Agent × Model Comparison/);
  assert.match(renderComparison(matrix, META, "csv"), /^rank,setup_key/);
  assert.match(renderComparison(matrix, META, "html"), /^<!doctype html>/);

  const parsed = JSON.parse(renderComparison(matrix, META, "json"));
  assert.equal(parsed.schema, "agent-bench.comparison/v1");
  assert.equal(parsed.setups.length, 3);

  assert.equal(contentTypeForFormat("md"), "text/markdown; charset=utf-8");
  assert.equal(contentTypeForFormat("csv"), "text/csv; charset=utf-8");
  assert.equal(contentTypeForFormat("html"), "text/html; charset=utf-8");
  assert.equal(contentTypeForFormat("json"), "application/json; charset=utf-8");
});

test("isComparisonExportFormat gates unknown formats", () => {
  assert.equal(isComparisonExportFormat("md"), true);
  assert.equal(isComparisonExportFormat("html"), true);
  assert.equal(isComparisonExportFormat("pdf"), false);
  assert.equal(isComparisonExportFormat(undefined), false);
});

test("export file names are filesystem safe and carry the scope", () => {
  assert.equal(
    comparisonExportFileName("md", META),
    "agent-bench-comparison-repo-maintenance-2026-08-26_09-30-00.md"
  );
  assert.equal(
    comparisonExportFileName("html", { generatedAt: "2026-08-26T09:30:00.000Z" }),
    "agent-bench-comparison-all-2026-08-26_09-30-00.html"
  );
});
