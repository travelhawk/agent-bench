import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightedScore, performanceScoreFromMetrics } from "../src/core/scoring";

test("weighted score follows 60/30/10 split", () => {
  const score = computeWeightedScore(8, 7, 9);
  assert.equal(score.total, 7.8);
});

test("performance score penalizes high latency and cost", () => {
  const fastCheap = performanceScoreFromMetrics(3000, 0.1);
  const slowExpensive = performanceScoreFromMetrics(70000, 4);
  assert.ok(fastCheap > slowExpensive);
  assert.ok(slowExpensive >= 0);
});
