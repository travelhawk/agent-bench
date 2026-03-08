import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightedScore, efficiencyScoreFromMetrics } from "../src/core/scoring";

test("weighted score follows evaluator-aware hybrid weighting", () => {
  const score = computeWeightedScore({
    profile: "hybrid",
    outcome: 8,
    review: 7,
    efficiency: 9
  });
  assert.equal(score.total, 7.9);
  assert.equal(score.tests, 8);
  assert.equal(score.judge, 7);
  assert.equal(score.performance, 9);
});

test("efficiency score penalizes high latency and cost against task-relative budgets", () => {
  const fastCheap = efficiencyScoreFromMetrics({ latencyMs: 3000, costUsd: 0.1, difficulty: "medium" });
  const slowExpensive = efficiencyScoreFromMetrics({ latencyMs: 70000, costUsd: 4, difficulty: "medium" });
  assert.ok(fastCheap > slowExpensive);
  assert.ok(slowExpensive >= 0);
});
