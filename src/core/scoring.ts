import { BenchmarkDifficulty, ScoreBreakdown, ScoreProfileKey } from "../types";

export interface ScoreProfile {
  key: ScoreProfileKey;
  label: string;
  weights: {
    outcome: number;
    process: number;
    review: number;
    efficiency: number;
    quality: number;
  };
}

const SCORE_PROFILES: Record<ScoreProfileKey, ScoreProfile> = {
  hybrid: {
    key: "hybrid",
    label: "Hybrid",
    weights: { outcome: 0.7, process: 0, review: 0.2, efficiency: 0.1, quality: 0 }
  },
  artifact: {
    key: "artifact",
    label: "Artifact",
    weights: { outcome: 0.6, process: 0, review: 0.3, efficiency: 0.1, quality: 0 }
  },
  trace: {
    key: "trace",
    label: "Trace",
    weights: { outcome: 0.35, process: 0.4, review: 0.15, efficiency: 0.1, quality: 0 }
  },
  judge: {
    key: "judge",
    label: "Judge",
    weights: { outcome: 0, process: 0, review: 0.9, efficiency: 0.1, quality: 0 }
  },
  state: {
    key: "state",
    label: "State",
    weights: { outcome: 0.85, process: 0, review: 0, efficiency: 0.15, quality: 0 }
  },
  // Opt-in composite that spends every signal the evaluator already computes,
  // including the judge's code-quality score and the workflow/process score
  // that the default profiles leave unweighted.
  craft: {
    key: "craft",
    label: "Craft",
    weights: { outcome: 0.45, process: 0.15, review: 0.15, efficiency: 0.1, quality: 0.15 }
  }
};

function clampScore(raw: number): number {
  if (raw < 0) return 0;
  if (raw > 10) return 10;
  return raw;
}

export function resolveScoreProfile(profileKey: ScoreProfileKey): ScoreProfile {
  return SCORE_PROFILES[profileKey];
}

export function isScoreProfileKey(value: string): value is ScoreProfileKey {
  return Object.prototype.hasOwnProperty.call(SCORE_PROFILES, value);
}

export function computeWeightedScore(input: {
  profile: ScoreProfileKey;
  outcome?: number;
  process?: number;
  review?: number;
  efficiency?: number;
  quality?: number;
}): ScoreBreakdown {
  const profile = resolveScoreProfile(input.profile);
  const components = {
    outcome: input.outcome == null ? undefined : clampScore(input.outcome),
    process: input.process == null ? undefined : clampScore(input.process),
    review: input.review == null ? undefined : clampScore(input.review),
    efficiency: input.efficiency == null ? undefined : clampScore(input.efficiency),
    quality: input.quality == null ? undefined : clampScore(input.quality)
  };

  const activeEntries = Object.entries(profile.weights).filter(([key, weight]) => {
    const componentKey = key as keyof typeof components;
    return weight > 0 && components[componentKey] != null;
  }) as Array<[keyof typeof components, number]>;

  const totalWeight = activeEntries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const weightedTotal = activeEntries.reduce((sum, [key, weight]) => {
    return sum + ((components[key] ?? 0) * weight);
  }, 0) / totalWeight;

  const outcome = Number((components.outcome ?? 0).toFixed(2));
  const process = Number((components.process ?? 0).toFixed(2));
  const review = Number((components.review ?? 0).toFixed(2));
  const efficiency = Number((components.efficiency ?? 0).toFixed(2));

  return {
    outcome,
    process,
    review,
    efficiency,
    tests: outcome,
    judge: review,
    performance: efficiency,
    total: Number(weightedTotal.toFixed(2))
  };
}

export function efficiencyScoreFromMetrics(input: {
  latencyMs: number;
  costUsd: number;
  difficulty: BenchmarkDifficulty;
  timeoutMs?: number;
  requiresNetwork?: boolean;
}): number {
  const baselineTimeouts: Record<BenchmarkDifficulty, number> = {
    low: 12000,
    medium: 30000,
    high: 60000
  };
  const baselineCosts: Record<BenchmarkDifficulty, number> = {
    low: 0.2,
    medium: 0.75,
    high: 1.5
  };

  const timeoutBudget = Math.max(
    input.timeoutMs ?? baselineTimeouts[input.difficulty],
    baselineTimeouts[input.difficulty]
  );
  const latencyBudget = input.requiresNetwork ? timeoutBudget * 1.2 : timeoutBudget;
  const costBudget = baselineCosts[input.difficulty];
  const latencyPenalty = Math.min(input.latencyMs / latencyBudget, 1) * 0.65;
  const costPenalty = Math.min(input.costUsd / costBudget, 1) * 0.35;
  const score = 10 - (latencyPenalty + costPenalty) * 10;
  return Number(clampScore(score).toFixed(2));
}
