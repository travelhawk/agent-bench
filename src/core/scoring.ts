import { ScoreBreakdown } from "../types";

const WEIGHTS = {
  tests: 0.6,
  judge: 0.3,
  performance: 0.1
} as const;

function clampScore(raw: number): number {
  if (raw < 0) return 0;
  if (raw > 10) return 10;
  return raw;
}

export function computeWeightedScore(tests: number, judge: number, performance: number): ScoreBreakdown {
  const t = clampScore(tests);
  const j = clampScore(judge);
  const p = clampScore(performance);
  const total = Number((t * WEIGHTS.tests + j * WEIGHTS.judge + p * WEIGHTS.performance).toFixed(2));
  return { tests: t, judge: j, performance: p, total };
}

export function performanceScoreFromMetrics(latencyMs: number, costUsd: number): number {
  const latencyPenalty = Math.min(latencyMs / 20000, 0.7);
  const costPenalty = Math.min(costUsd / 2, 0.3);
  const score = 10 - (latencyPenalty + costPenalty) * 10;
  return Number(clampScore(score).toFixed(2));
}