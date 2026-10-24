import { inspectAgentFile } from "../agents/files";
import { NO_MODEL_LABEL } from "../core/comparison";
import { normalizeTags } from "../benchmarks/metadata";
import { AgentRecord, BatchSetupInput } from "../types";

export const INPUT_LIMITS = {
  maxKeyLength: 80,
  maxTitleLength: 120,
  maxDescriptionLength: 1600,
  maxExpectedOutcomeLength: 1600,
  maxTaskGuidanceLength: 1600,
  maxTaskListItems: 12,
  maxTaskListItemLength: 180,
  maxDomainLength: 64,
  maxTagCount: 12,
  maxTagLength: 32,
  maxModelLength: 160,
  maxApiKeyLength: 512,
  maxAgentMarkdownLength: 12000,
  maxSkillQueryLength: 120,
  maxManagedBundleNameLength: 80,
  maxManagedBundleFiles: 200,
  maxManagedBundleFilePathLength: 240,
  maxManagedBundleFileContentLength: 120000,
  maxAgentsPerBatch: 8,
  maxSetupsPerBatch: 12,
  maxModelsPerBatch: 6,
  maxSetupLabelLength: 80,
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

export function normalizeStringList(input: unknown, field: string): string[] {
  if (!Array.isArray(input)) return [];
  if (input.length > INPUT_LIMITS.maxTaskListItems) {
    throw new Error(`${field} exceeds the ${INPUT_LIMITS.maxTaskListItems}-item limit.`);
  }

  return input.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`${field} must contain strings only.`);
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error(`${field} cannot contain empty items.`);
    }
    if (trimmed.length > INPUT_LIMITS.maxTaskListItemLength) {
      throw new Error(`${field} items exceed the ${INPUT_LIMITS.maxTaskListItemLength}-character limit.`);
    }
    return trimmed;
  });
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

export function assertBatchCapacity(setupCount: number, taskCount: number): void {
  const queueSize = setupCount * taskCount;
  if (queueSize > INPUT_LIMITS.maxRunsPerBatch) {
    throw new Error(`Batch would create ${queueSize} runs. Limit is ${INPUT_LIMITS.maxRunsPerBatch}.`);
  }
}

export interface ResolvedBatchSetup {
  setupKey: string;
  agent: AgentRecord;
  model?: string;
  review: "auto" | "off";
}

function defaultSetupKey(agentName: string, model?: string): string {
  return `${agentName} · ${model?.trim() || NO_MODEL_LABEL}`;
}

/**
 * Normalizes the explicit `setups[]` form of a batch: each entry is one agent
 * paired with its own review model, so a single batch can hold three, four, or
 * a dozen comparable configurations. Duplicate agent+model pairs collapse.
 */
export function resolveBatchSetups(workspaceRoot: string, input: unknown, fallbackReview: "auto" | "off"): ResolvedBatchSetup[] {
  if (!Array.isArray(input)) {
    throw new Error("setups must be an array.");
  }

  const setups: ResolvedBatchSetup[] = [];
  const seen = new Set<string>();

  input.forEach((entry, index) => {
    const setup = entry as BatchSetupInput | null;
    const agentPath = readBoundedString(setup?.agentPath, `setups[${index}].agentPath`, INPUT_LIMITS.maxKeyLength * 4, true)!;
    const model = readBoundedString(setup?.model, `setups[${index}].model`, INPUT_LIMITS.maxModelLength);
    const label = readBoundedString(setup?.label, `setups[${index}].label`, INPUT_LIMITS.maxSetupLabelLength);
    const review = setup?.review === "off" ? "off" : setup?.review === "auto" ? "auto" : fallbackReview;
    const agent = inspectAgentFile(workspaceRoot, agentPath);

    const identity = `${agent.path}::${model ?? ""}::${label ?? ""}`;
    if (seen.has(identity)) return;
    seen.add(identity);

    setups.push({ setupKey: label ?? defaultSetupKey(agent.name, model), agent, model, review });
  });

  if (setups.length === 0) {
    throw new Error("Provide at least one setup to run.");
  }
  if (setups.length > INPUT_LIMITS.maxSetupsPerBatch) {
    throw new Error(`Compare at most ${INPUT_LIMITS.maxSetupsPerBatch} setups per batch.`);
  }

  const duplicateKeys = setups.map((setup) => setup.setupKey).filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new Error(`Setup labels must be unique. Duplicated: ${[...new Set(duplicateKeys)].join(", ")}.`);
  }

  return setups;
}

/** Legacy `agents[] × model` form, expanded into the same setup shape. */
export function setupsFromAgentList(agents: AgentRecord[], model: string | undefined, review: "auto" | "off"): ResolvedBatchSetup[] {
  return agents.map((agent) => ({ setupKey: defaultSetupKey(agent.name, model), agent, model, review }));
}
