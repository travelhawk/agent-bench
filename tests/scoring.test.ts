import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightedScore, efficiencyScoreFromMetrics, isScoreProfileKey } from "../src/core/scoring";

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

test("hybrid ignores the quality component so the profile stays comparable", () => {
  const withoutQuality = computeWeightedScore({ profile: "hybrid", outcome: 8, review: 7, efficiency: 9 });
  const withQuality = computeWeightedScore({ profile: "hybrid", outcome: 8, review: 7, efficiency: 9, quality: 2 });
  assert.equal(withQuality.total, withoutQuality.total, "quality must not move the hybrid total");
  assert.equal(withQuality.total, 7.9);
});

test("craft profile folds quality and process into the total", () => {
  // craft weights: outcome 0.45, process 0.15, review 0.15, efficiency 0.1, quality 0.15
  const score = computeWeightedScore({
    profile: "craft",
    outcome: 8,
    process: 6,
    review: 7,
    efficiency: 9,
    quality: 4
  });
  const expected = Number((8 * 0.45 + 6 * 0.15 + 7 * 0.15 + 9 * 0.1 + 4 * 0.15).toFixed(2));
  assert.equal(score.total, expected);
  // A low quality score must drag craft below what hybrid would report.
  const hybrid = computeWeightedScore({ profile: "hybrid", outcome: 8, review: 7, efficiency: 9 });
  assert.ok(score.total < hybrid.total, "poor code quality should lower the craft total vs hybrid");
});

test("craft renormalizes when the quality component is unavailable", () => {
  // With quality omitted, craft weights renormalize over the remaining active components.
  const score = computeWeightedScore({ profile: "craft", outcome: 8, process: 6, review: 7, efficiency: 9 });
  const activeWeight = 0.45 + 0.15 + 0.15 + 0.1;
  const expected = Number(((8 * 0.45 + 6 * 0.15 + 7 * 0.15 + 9 * 0.1) / activeWeight).toFixed(2));
  assert.equal(score.total, expected);
});

test("isScoreProfileKey validates known profile keys", () => {
  assert.equal(isScoreProfileKey("craft"), true);
  assert.equal(isScoreProfileKey("hybrid"), true);
  assert.equal(isScoreProfileKey("nonsense"), false);
});

test("efficiency score penalizes high latency and cost against task-relative budgets", () => {
  const fastCheap = efficiencyScoreFromMetrics({ latencyMs: 3000, costUsd: 0.1, difficulty: "medium" });
  const slowExpensive = efficiencyScoreFromMetrics({ latencyMs: 70000, costUsd: 4, difficulty: "medium" });
  assert.ok(fastCheap > slowExpensive);
  assert.ok(slowExpensive >= 0);
});
