import {
  BenchmarkDifficulty,
  BenchmarkEvaluatorMode,
  BenchmarkInteractionMode,
  BenchmarkResolution,
  BenchmarkSuiteMetadata,
  BenchmarkTaskMetadata
} from "../types";

export const BENCHMARK_RESOLUTIONS: BenchmarkResolution[] = ["atomic", "workflow", "campaign", "swarm"];
export const BENCHMARK_INTERACTIONS: BenchmarkInteractionMode[] = ["artifact", "terminal", "browser", "tool-use", "computer-use", "multi-agent"];
export const BENCHMARK_EVALUATORS: BenchmarkEvaluatorMode[] = ["state", "artifact", "trace", "judge", "hybrid"];
export const BENCHMARK_DIFFICULTIES: BenchmarkDifficulty[] = ["low", "medium", "high"];

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
  tags: [],
  requiresIsolation: true,
  requiresNetwork: false
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
  tags?: unknown;
  requiresIsolation?: boolean;
  requiresNetwork?: boolean;
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
  return {
    resolution: parseChoice(input.resolution, BENCHMARK_RESOLUTIONS, DEFAULT_TASK_METADATA.resolution),
    interaction: parseChoice(input.interaction, BENCHMARK_INTERACTIONS, DEFAULT_TASK_METADATA.interaction),
    evaluator: parseChoice(input.evaluator, BENCHMARK_EVALUATORS, DEFAULT_TASK_METADATA.evaluator),
    difficulty: parseChoice(input.difficulty, BENCHMARK_DIFFICULTIES, DEFAULT_TASK_METADATA.difficulty),
    tags: normalizeTags(input.tags),
    requiresIsolation: typeof input.requiresIsolation === "boolean" ? input.requiresIsolation : DEFAULT_TASK_METADATA.requiresIsolation,
    requiresNetwork: typeof input.requiresNetwork === "boolean" ? input.requiresNetwork : DEFAULT_TASK_METADATA.requiresNetwork
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
      tags: metadata.tags
    }),
    requiresIsolation: parseBoolean(metadata["requires isolation"], DEFAULT_TASK_METADATA.requiresIsolation),
    requiresNetwork: parseBoolean(metadata["requires network"], DEFAULT_TASK_METADATA.requiresNetwork)
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
    `Tags: ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "none"}`,
    `Requires Isolation: ${metadata.requiresIsolation ? "yes" : "no"}`,
    `Requires Network: ${metadata.requiresNetwork ? "yes" : "no"}`,
    ""
  ];
}
