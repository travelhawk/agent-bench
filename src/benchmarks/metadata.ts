import {
  BenchmarkDifficulty,
  BenchmarkEvaluatorMode,
  BenchmarkInteractionMode,
  BenchmarkReliability,
  BenchmarkResolution,
  BenchmarkSuiteMetadata,
  BenchmarkTaskMetadata
} from "../types";

export const BENCHMARK_RESOLUTIONS: BenchmarkResolution[] = ["atomic", "workflow", "campaign", "swarm"];
export const BENCHMARK_INTERACTIONS: BenchmarkInteractionMode[] = ["artifact", "terminal", "browser", "tool-use", "computer-use", "multi-agent"];
export const BENCHMARK_EVALUATORS: BenchmarkEvaluatorMode[] = ["state", "artifact", "trace", "judge", "hybrid"];
export const BENCHMARK_DIFFICULTIES: BenchmarkDifficulty[] = ["low", "medium", "high"];
export const BENCHMARK_RELIABILITY_LEVELS: BenchmarkReliability[] = ["low", "medium", "high"];

const DEFAULT_SUITE_METADATA: BenchmarkSuiteMetadata = {
  resolution: "workflow",
  domain: "general",
  tags: []
};

const DEFAULT_TASK_METADATA: BenchmarkTaskMetadata = {
  resolution: "atomic",
  interaction: "artifact",
  evaluator: "hybrid",
  difficulty: "medium",
  reliability: "medium",
  tags: [],
  requiresIsolation: true,
  requiresNetwork: false,
  timeBudgetMs: 90000,
  costBudgetUsd: 1,
  defaultTrials: 1
};

interface SuiteMetadataInput {
  resolution?: string;
  domain?: string;
  tags?: unknown;
}

interface TaskMetadataInput {
  resolution?: string;
  interaction?: string;
  evaluator?: string;
  difficulty?: string;
  reliability?: string;
  tags?: unknown;
  requiresIsolation?: boolean;
  requiresNetwork?: boolean;
  timeBudgetMs?: number;
  costBudgetUsd?: number;
  defaultTrials?: number;
}

function sanitizeTag(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return fallback;
}

function parseChoice<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value.trim().toLowerCase() as T)
    ? value.trim().toLowerCase() as T
    : fallback;
}

function resolveDefaultTimeBudgetMs(difficulty: BenchmarkDifficulty): number {
  switch (difficulty) {
    case "low":
      return 30000;
    case "high":
      return 180000;
    default:
      return DEFAULT_TASK_METADATA.timeBudgetMs;
  }
}

function resolveDefaultCostBudgetUsd(difficulty: BenchmarkDifficulty): number {
  switch (difficulty) {
    case "low":
      return 0.3;
    case "high":
      return 2.5;
    default:
      return DEFAULT_TASK_METADATA.costBudgetUsd;
  }
}

function normalizePositiveInteger(input: number | undefined, fallback: number): number {
  if (!Number.isFinite(input) || (input ?? 0) <= 0) return fallback;
  return Math.round(input!);
}

function normalizePositiveNumber(input: number | undefined, fallback: number): number {
  if (!Number.isFinite(input) || (input ?? 0) <= 0) return fallback;
  return Number(input!.toFixed(2));
}

export function normalizeTags(input: unknown): string[] {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const seen = new Set<string>();
  const tags: string[] = [];

  rawValues.forEach((value) => {
    if (typeof value !== "string") return;
    const normalized = sanitizeTag(value);
    if (!normalized || normalized === "none" || seen.has(normalized)) return;
    seen.add(normalized);
    tags.push(normalized);
  });

  return tags;
}

export function parseMetadataLines(section: string): Record<string, string> {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, line) => {
      const index = line.indexOf(":");
      if (index === -1) return result;
      const key = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim();
      if (key) {
        result[key] = value;
      }
      return result;
    }, {});
}

export function normalizeSuiteMetadataInput(input: SuiteMetadataInput = {}): BenchmarkSuiteMetadata {
  return {
    resolution: parseChoice(input.resolution, BENCHMARK_RESOLUTIONS, DEFAULT_SUITE_METADATA.resolution),
    domain: typeof input.domain === "string" && input.domain.trim() ? input.domain.trim() : DEFAULT_SUITE_METADATA.domain,
    tags: normalizeTags(input.tags)
  };
}

export function normalizeTaskMetadataInput(input: TaskMetadataInput = {}): BenchmarkTaskMetadata {
  const difficulty = parseChoice(input.difficulty, BENCHMARK_DIFFICULTIES, DEFAULT_TASK_METADATA.difficulty);
  return {
    resolution: parseChoice(input.resolution, BENCHMARK_RESOLUTIONS, DEFAULT_TASK_METADATA.resolution),
    interaction: parseChoice(input.interaction, BENCHMARK_INTERACTIONS, DEFAULT_TASK_METADATA.interaction),
    evaluator: parseChoice(input.evaluator, BENCHMARK_EVALUATORS, DEFAULT_TASK_METADATA.evaluator),
    difficulty,
    reliability: parseChoice(input.reliability, BENCHMARK_RELIABILITY_LEVELS, DEFAULT_TASK_METADATA.reliability),
    tags: normalizeTags(input.tags),
    requiresIsolation: typeof input.requiresIsolation === "boolean" ? input.requiresIsolation : DEFAULT_TASK_METADATA.requiresIsolation,
    requiresNetwork: typeof input.requiresNetwork === "boolean" ? input.requiresNetwork : DEFAULT_TASK_METADATA.requiresNetwork,
    timeBudgetMs: normalizePositiveInteger(input.timeBudgetMs, resolveDefaultTimeBudgetMs(difficulty)),
    costBudgetUsd: normalizePositiveNumber(input.costBudgetUsd, resolveDefaultCostBudgetUsd(difficulty)),
    defaultTrials: normalizePositiveInteger(input.defaultTrials, DEFAULT_TASK_METADATA.defaultTrials)
  };
}

export function parseSuiteMetadata(section: string): BenchmarkSuiteMetadata {
  const metadata = parseMetadataLines(section);
  return normalizeSuiteMetadataInput({
    resolution: metadata.resolution as BenchmarkResolution | undefined,
    domain: metadata.domain,
    tags: metadata.tags
  });
}

export function parseTaskMetadata(section: string): BenchmarkTaskMetadata {
  const metadata = parseMetadataLines(section);
  return {
    ...normalizeTaskMetadataInput({
      resolution: metadata.resolution as BenchmarkResolution | undefined,
      interaction: metadata.interaction as BenchmarkInteractionMode | undefined,
      evaluator: metadata.evaluator as BenchmarkEvaluatorMode | undefined,
      difficulty: metadata.difficulty as BenchmarkDifficulty | undefined,
      reliability: metadata.reliability as BenchmarkReliability | undefined,
      tags: metadata.tags
    }),
    requiresIsolation: parseBoolean(metadata["requires isolation"], DEFAULT_TASK_METADATA.requiresIsolation),
    requiresNetwork: parseBoolean(metadata["requires network"], DEFAULT_TASK_METADATA.requiresNetwork),
    timeBudgetMs: normalizePositiveInteger(Number(metadata["time budget ms"]), resolveDefaultTimeBudgetMs(
      parseChoice(metadata.difficulty, BENCHMARK_DIFFICULTIES, DEFAULT_TASK_METADATA.difficulty)
    )),
    costBudgetUsd: normalizePositiveNumber(Number(metadata["cost budget usd"]), resolveDefaultCostBudgetUsd(
      parseChoice(metadata.difficulty, BENCHMARK_DIFFICULTIES, DEFAULT_TASK_METADATA.difficulty)
    )),
    defaultTrials: normalizePositiveInteger(Number(metadata["default trials"]), DEFAULT_TASK_METADATA.defaultTrials)
  };
}

export function suiteMetadataToMarkdown(metadata: BenchmarkSuiteMetadata): string[] {
  return [
    "## Metadata",
    `Resolution: ${metadata.resolution}`,
    `Domain: ${metadata.domain}`,
    `Tags: ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "none"}`,
    ""
  ];
}

export function taskMetadataToMarkdown(metadata: BenchmarkTaskMetadata): string[] {
  return [
    "## Metadata",
    `Resolution: ${metadata.resolution}`,
    `Interaction: ${metadata.interaction}`,
    `Evaluator: ${metadata.evaluator}`,
    `Difficulty: ${metadata.difficulty}`,
    `Reliability: ${metadata.reliability}`,
    `Tags: ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "none"}`,
    `Requires Isolation: ${metadata.requiresIsolation ? "yes" : "no"}`,
    `Requires Network: ${metadata.requiresNetwork ? "yes" : "no"}`,
    `Time Budget Ms: ${metadata.timeBudgetMs}`,
    `Cost Budget Usd: ${metadata.costBudgetUsd}`,
    `Default Trials: ${metadata.defaultTrials}`,
    ""
  ];
}
