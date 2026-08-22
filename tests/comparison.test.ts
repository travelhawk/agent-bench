import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildComparisonMatrix, runBenchmarkKey, runTaskKey, setupKeyForRun } from "../src/core/comparison";
import { createDb, initializeSchema } from "../src/db/schema";
import { getRunByKey, insertRun, listRuns } from "../src/db/store";
import { RunInput, RunRecord } from "../src/types";

function makeRunInput(overrides: Partial<RunInput> & { runKey: string }): RunInput {
  return {
    benchmarkKey: "repo-maintenance",
    taskKey: "fix-react-bug",
    modelId: "openai/gpt-4.1-mini",
    agentName: "coder-a",
    agentVersion: "v1",
    suiteName: "repo-maintenance/fix-react-bug",
    status: "completed",
    scores: { outcome: 8, process: 5, review: 7, efficiency: 6, tests: 8, judge: 7, performance: 6, total: 7.4 },
    scoreProfile: "hybrid",
    scoreConfidence: "high",
    latencyMs: 1200,
    costUsd: 0.02,
    durationMs: 4000,
    artifactsPath: "/tmp/none",
    logText: "log",
    verifierTestsAvailable: true,
    verifierTestsTotal: 4,
    verifierTestsPassed: 3,
    qualityScore: 6.5,
    agentUsageAvailable: true,
    agentInputTokens: 1000,
    agentOutputTokens: 500,
    agentCostUsd: 0.01,
    reviewMode: "gateway",
    judgeTotalTokens: 2200,
    ...overrides
  };
}

test("insertRun persists comparison metadata (model, benchmark, task, review mode, judge tokens)", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-comparison-"));
  const db = createDb(path.join(workspace, "runs.db"));

  try {
    initializeSchema(db);
    insertRun(db, makeRunInput({ runKey: "run-a" }));

    const run = getRunByKey(db, "run-a");
    assert.ok(run);
    assert.equal(run.benchmarkKey, "repo-maintenance");
    assert.equal(run.taskKey, "fix-react-bug");
    assert.equal(run.modelId, "openai/gpt-4.1-mini");
    assert.equal(run.reviewMode, "gateway");
    assert.equal(run.judgeTotalTokens, 2200);
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("legacy runs without benchmark_key fall back to suiteName parsing", () => {
  const legacy = {
    benchmarkKey: null,
    taskKey: null,
    suiteName: "product-builds/release-notes-cli",
    modelId: null,
    agentName: "old-agent"
  } as unknown as RunRecord;

  assert.equal(runBenchmarkKey(legacy), "product-builds");
  assert.equal(runTaskKey(legacy), "release-notes-cli");
  assert.equal(setupKeyForRun(legacy), "old-agent · rules / no model");
});

test("buildComparisonMatrix aggregates per agent × model setup with token totals", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-comparison-"));
  const db = createDb(path.join(workspace, "runs.db"));

  try {
    initializeSchema(db);
    insertRun(db, makeRunInput({ runKey: "run-1" }));
    insertRun(db, makeRunInput({
      runKey: "run-2",
      taskKey: "security-audit-report",
      suiteName: "repo-maintenance/security-audit-report",
      scores: { outcome: 4, process: 5, review: 5, efficiency: 6, tests: 4, judge: 5, performance: 6, total: 5.0 },
      verifierTestsTotal: 5,
      verifierTestsPassed: 2,
      qualityScore: 5.5,
      reviewMode: "gateway-cache",
      judgeTotalTokens: 0,
      durationMs: 6000
    }));
    insertRun(db, makeRunInput({
      runKey: "run-3",
      agentName: "coder-b",
      modelId: "anthropic/claude-sonnet-5",
      scores: { outcome: 9, process: 5, review: 8, efficiency: 7, tests: 9, judge: 8, performance: 7, total: 8.6 },
      reviewMode: "off",
      judgeTotalTokens: 0,
      costUsd: 0,
      agentUsageAvailable: false,
      agentInputTokens: 0,
      agentOutputTokens: 0,
      agentCostUsd: 0
    }));
    insertRun(db, makeRunInput({
      runKey: "run-4",
      agentName: "coder-b",
      modelId: "anthropic/claude-sonnet-5",
      status: "failed",
      scores: { outcome: 0, process: 0, review: 0, efficiency: 0, tests: 0, judge: 0, performance: 0, total: 0 },
      failureReason: "runner crashed",
      verifierTestsAvailable: false,
      verifierTestsTotal: 0,
      verifierTestsPassed: 0,
      qualityScore: null,
      reviewMode: null,
      judgeTotalTokens: 0,
      costUsd: 0,
      agentUsageAvailable: false,
      agentInputTokens: 0,
      agentOutputTokens: 0,
      agentCostUsd: 0
    }));

    const matrix = buildComparisonMatrix(listRuns(db, 50));

    assert.equal(matrix.setups.length, 2);
    assert.deepEqual(matrix.taskKeys, ["fix-react-bug", "security-audit-report"]);
    assert.deepEqual(matrix.benchmarkKeys, ["repo-maintenance"]);

    const setupB = matrix.setups[0];
    assert.equal(setupB.setupKey, "coder-b · anthropic/claude-sonnet-5");
    assert.equal(setupB.avgScore, 8.6);
    assert.equal(setupB.completedCount, 1);
    assert.equal(setupB.failedCount, 1);
    assert.equal(setupB.judgeTokens, 0);

    const setupA = matrix.setups[1];
    assert.equal(setupA.setupKey, "coder-a · openai/gpt-4.1-mini");
    assert.equal(setupA.avgScore, 6.2);
    assert.equal(setupA.avgQuality, 6);
    assert.equal(setupA.testsPassed, 5);
    assert.equal(setupA.testsTotal, 9);
    assert.equal(setupA.agentTokens, 3000);
    assert.equal(setupA.judgeTokens, 2200);
    assert.equal(setupA.avgDurationMs, 5000);
    assert.equal(setupA.tasks["fix-react-bug"].avgScore, 7.4);
    assert.equal(setupA.tasks["security-audit-report"].avgScore, 5);

    assert.equal(matrix.totals.runs, 4);
    assert.equal(matrix.totals.gatewayReviews, 1);
    assert.equal(matrix.totals.cachedReviews, 1);
    assert.equal(matrix.totals.offReviews, 1);
    assert.equal(matrix.totals.judgeTokens, 2200);
    assert.equal(matrix.totals.agentTokens, 3000);
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("buildComparisonMatrix filters by benchmark", () => {
  const runs: RunRecord[] = [];
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-comparison-"));
  const db = createDb(path.join(workspace, "runs.db"));

  try {
    initializeSchema(db);
    insertRun(db, makeRunInput({ runKey: "run-x" }));
    insertRun(db, makeRunInput({
      runKey: "run-y",
      benchmarkKey: "product-builds",
      taskKey: "release-notes-cli",
      suiteName: "product-builds/release-notes-cli"
    }));
    runs.push(...listRuns(db, 50));

    const filtered = buildComparisonMatrix(runs, { benchmarkKey: "product-builds" });
    assert.equal(filtered.totals.runs, 1);
    assert.deepEqual(filtered.taskKeys, ["release-notes-cli"]);
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
