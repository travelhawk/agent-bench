import { inspectAgentFile } from "../agents/files";
import { normalizeTags } from "../benchmarks/metadata";
import { AgentRecord } from "../types";

export const INPUT_LIMITS = {
  maxKeyLength: 80,
  maxTitleLength: 120,
  maxDescriptionLength: 1600,
  maxExpectedOutcomeLength: 1600,
  maxDomainLength: 64,
  maxTagCount: 12,
  maxTagLength: 32,
  maxModelLength: 160,
  maxApiKeyLength: 512,
  maxAgentMarkdownLength: 12000,
  maxAgentsPerBatch: 8,
  maxRunsPerBatch: 48
} as const;

export function sanitizeKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function readBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false
): string | undefined {
  if (typeof value !== "string") {
    if (required) {
      throw new Error(`${field} is required.`);
    }
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw new Error(`${field} is required.`);
    }
    return undefined;
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds the ${maxLength}-character limit.`);
  }

  return trimmed;
}

export function normalizeTagList(input: unknown): string[] {
  const tags = normalizeTags(input).map((tag) => tag.slice(0, INPUT_LIMITS.maxTagLength));
  if (tags.length > INPUT_LIMITS.maxTagCount) {
    throw new Error(`tags exceed the ${INPUT_LIMITS.maxTagCount}-tag limit.`);
  }
  return tags;
}

export function resolveBatchAgents(workspaceRoot: string, input: unknown): AgentRecord[] {
  if (!Array.isArray(input)) {
    throw new Error("agents must be an array.");
  }

  const records: AgentRecord[] = [];
  const seen = new Set<string>();

  for (const entry of input) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const record = inspectAgentFile(workspaceRoot, entry.trim());
    if (seen.has(record.path)) continue;
    seen.add(record.path);
    records.push(record);
  }

  if (records.length > INPUT_LIMITS.maxAgentsPerBatch) {
    throw new Error(`Select at most ${INPUT_LIMITS.maxAgentsPerBatch} agents per batch.`);
  }

  return records;
}

export function assertBatchCapacity(agentCount: number, taskCount: number): void {
  const queueSize = agentCount * taskCount;
  if (queueSize > INPUT_LIMITS.maxRunsPerBatch) {
    throw new Error(`Batch would create ${queueSize} runs. Limit is ${INPUT_LIMITS.maxRunsPerBatch}.`);
  }
}
