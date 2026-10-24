import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonMatrix, setupModelSuffix } from "../src/core/comparison";
import {
  formatDurationMs,
  formatTokens,
  renderMatrixLines,
  renderMatrixWinners,
  scoreBar
} from "../src/core/matrix-print";
import { RunRecord } from "../src/types";

function makeRun(overrides: Partial<RunRecord> & { runKey: string }): RunRecord {
  return {
    id: 1,
    benchmarkKey: "repo-maintenance",
    taskKey: "fix-react-bug",
    setupKey: null,
    modelId: "openai/gpt-4.1-mini",
    reviewMode: "gateway",
    judgeTotalTokens: 2000,
    agentName: "model-coder",
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
  } as RunRecord;
}

test("formatTokens switches to thousands above 1k", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1.0k");
  assert.equal(formatTokens(15_400), "15.4k");
});

test("formatDurationMs switches to minutes and handles missing values", () => {
  assert.equal(formatDurationMs(null), "n/a");
  assert.equal(formatDurationMs(4200), "4.2s");
  assert.equal(formatDurationMs(90_000), "1.5m");
});

test("scoreBar fills proportionally and stays a fixed width", () => {
  assert.equal(scoreBar(null).length, 10);
  assert.equal(scoreBar(10), "█".repeat(10));
  assert.equal(scoreBar(5), "█".repeat(5) + "·".repeat(5));
  // Out-of-range scores clamp instead of overflowing the row.
  assert.equal(scoreBar(99), "█".repeat(10));
});

test("renderMatrixLines explains an empty matrix instead of printing nothing", () => {
  const lines = renderMatrixLines(buildComparisonMatrix([], {}));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /No runs found/);
});

test("renderMatrixWinners needs two setups before it ranks anything", () => {
  const single = buildComparisonMatrix([makeRun({ runKey: "r1", setupKey: "sonnet" })], {});
  assert.deepEqual(renderMatrixWinners(single), []);
});

test("renderMatrixWinners picks the best per metric, not the best overall", () => {
  const runs = [
    makeRun({
      runKey: "r1",
      setupKey: "anthropic/claude-sonnet-5",
      modelId: "anthropic/claude-sonnet-5",
      score: 6,
      durationMs: 2000,
      agentInputTokens: 400,
      agentOutputTokens: 100,
      agentCostUsd: 0.004,
      costUsd: 0.004,
      judgeTotalTokens: 500,
      verifierTestsTotal: 4,
      verifierTestsPassed: 2
    }),
    makeRun({
      runKey: "r2",
      setupKey: "anthropic/claude-opus-5",
      modelId: "anthropic/claude-opus-5",
      score: 9,
      durationMs: 9000,
      agentInputTokens: 3000,
      agentOutputTokens: 900,
      agentCostUsd: 0.2,
      costUsd: 0.2,
      judgeTotalTokens: 500,
      verifierTestsTotal: 4,
      verifierTestsPassed: 4
    })
  ];

  const winners = renderMatrixWinners(buildComparisonMatrix(runs, {})).join("\n");

  // The slow, expensive model wins on quality; the cheap one wins on cost and
  // speed. A single "winner" line would hide exactly that trade-off.
  assert.match(winners, /Best score:\s+anthropic\/claude-opus-5/);
  assert.match(winners, /Best tests:\s+anthropic\/claude-opus-5/);
  assert.match(winners, /Fastest:\s+anthropic\/claude-sonnet-5/);
  assert.match(winners, /Fewest tokens:\s+anthropic\/claude-sonnet-5/);
  assert.match(winners, /Cheapest:\s+anthropic\/claude-sonnet-5/);
});

test("setupModelSuffix drops the model when the label already is the model", () => {
  // `compare-models` labels each setup by its model, so repeating it would read
  // as "anthropic/claude-opus-5 · anthropic/claude-opus-5".
  assert.equal(setupModelSuffix({
    setupKey: "anthropic/claude-opus-5",
    agentName: "model-coder",
    modelLabel: "anthropic/claude-opus-5"
  }), null);

  // A workflow comparison still needs the model next to the agent name.
  assert.equal(setupModelSuffix({
    setupKey: "model-coder · anthropic/claude-opus-5",
    agentName: "model-coder",
    modelLabel: "anthropic/claude-opus-5"
  }), "anthropic/claude-opus-5");

  // A hand-written label keeps both parts.
  assert.equal(setupModelSuffix({
    setupKey: "baseline",
    agentName: "model-coder",
    modelLabel: "anthropic/claude-opus-5"
  }), "anthropic/claude-opus-5");
});

test("renderMatrixLines prints a model-labelled setup once, not twice", () => {
  const runs = [
    makeRun({ runKey: "r1", setupKey: "anthropic/claude-sonnet-5", modelId: "anthropic/claude-sonnet-5" }),
    makeRun({ runKey: "r2", setupKey: "anthropic/claude-opus-5", modelId: "anthropic/claude-opus-5", score: 9 })
  ];
  const text = renderMatrixLines(buildComparisonMatrix(runs, {})).join("\n");

  assert.doesNotMatch(text, /claude-opus-5 \u00b7 anthropic\/claude-opus-5/);
  assert.match(text, /^anthropic\/claude-opus-5$/m);
  assert.match(text, /Best score:\s+anthropic\/claude-opus-5 \(9\.00\)/);
});

test("renderMatrixLines reports failures and can drop the winners block", () => {
  const runs = [
    makeRun({ runKey: "r1", setupKey: "sonnet", modelId: "anthropic/claude-sonnet-5" }),
    makeRun({ runKey: "r2", setupKey: "opus", modelId: "anthropic/claude-opus-5", score: 9 }),
    makeRun({
      runKey: "r3",
      setupKey: "opus",
      modelId: "anthropic/claude-opus-5",
      status: "failed",
      score: 0,
      failureReason: "runner exited 1"
    })
  ];
  const matrix = buildComparisonMatrix(runs, {});

  const full = renderMatrixLines(matrix).join("\n");
  assert.match(full, /\+1 failed/);
  assert.match(full, /Best score:/);

  const bare = renderMatrixLines(matrix, { winners: false }).join("\n");
  assert.doesNotMatch(bare, /Best score:/);
});
