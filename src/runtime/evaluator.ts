import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { resolveAgentExecutionContext } from "../agents/files";
import { computeWeightedScore, efficiencyScoreFromMetrics } from "../core/scoring";
import {
  AgentSkillReference,
  BenchmarkSuiteRecord,
  BenchmarkTaskRecord,
  RunInput,
  RuntimeEvaluationRequest,
  ScoreConfidence,
  ScoreProfileKey
} from "../types";
import { runSandboxedCommand, SandboxCommandResult } from "./sandbox";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.003;
const DEFAULT_SYSTEM_PROMPT = [
  "You are AgentBenchReview, a strict evaluator for agent specifications.",
  "Assess whether the provided agent instructions appear capable of completing the requested benchmark task.",
  "Score task fit, workflow clarity, verification steps, and operational safety.",
  "Do not invent execution results, tests, or artifacts that are not present.",
  "Return compact JSON only in this exact format:",
  "{\"score\": number, \"reason\": string}"
].join(" ");

interface JudgeResult {
  score: number;
  latencyMs: number;
  totalTokens: number;
  rawText: string;
  reason: string;
  mode: "gateway" | "gateway-cache" | "rules";
}

interface ParsedJudgeResponse {
  score: number;
  reason: string;
}

interface JudgeCacheEntry {
  score: number;
  rawText: string;
  totalTokens: number;
  reason: string;
}

interface RulesAssessment {
  outcomeScore: number;
  processScore: number;
  reviewScore: number;
  matchedSignals: string[];
  missingSignals: string[];
  reason: string;
}

interface ObjectiveChecksSummary {
  available: number;
  passed: number;
  deterministic: boolean;
  items: string[];
}

interface SandboxExecutionResult {
  mode: "review-only" | "sandbox";
  outcomeScore: number;
  processScore: number;
  matchedSignals: string[];
  missingSignals: string[];
  reason: string;
  objectiveChecks: ObjectiveChecksSummary;
  workspaceDir?: string;
  taskBriefPath?: string;
  provider?: SandboxCommandResult["provider"];
  networkAccess?: SandboxCommandResult["networkAccess"];
  runner?: SandboxCommandResult;
  verifier?: SandboxCommandResult;
  durationMs: number;
}

type JudgeCacheMap = Record<string, JudgeCacheEntry>;

interface ResolvedAgentMaterial {
  agentPathLabel: string;
  entryMarkdown: string;
  previewMarkdown: string;
  absoluteEntryPath?: string;
  absoluteBundlePath?: string;
  bundleMode: "flat" | "bundle";
  skills: AgentSkillReference[];
  assetFileCount: number;
}

function clampScore(raw: number): number {
  if (raw < 0) return 0;
  if (raw > 10) return 10;
  return Number(raw.toFixed(2));
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(input: string): string {
  return input.toLowerCase();
}

function hasAny(text: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function normalizeKeyword(tag: string): string[] {
  const normalized = tag.toLowerCase().trim();
  if (!normalized) return [];
  const withSpaces = normalized.replace(/-/g, " ");
  return normalized === withSpaces ? [normalized] : [normalized, withSpaces];
}

function parseJudgeResponse(content: string): ParsedJudgeResponse {
  try {
    const parsed = JSON.parse(content) as { score?: number; reason?: string };
    if (typeof parsed.score === "number") {
      return {
        score: clampScore(parsed.score),
        reason: typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "Gateway review returned a numeric score without an explicit reason."
      };
    }
  } catch {
    // Continue to regex parsing below.
  }

  const match = content.match(/-?\d+(\.\d+)?/);
  if (match) {
    return {
      score: clampScore(Number(match[0])),
      reason: content.trim().slice(0, 280) || "Gateway review returned a numeric score without an explicit reason."
    };
  }

  throw new Error("Gateway judge response did not include a parseable numeric score.");
}

export async function judgeWithVercelAiSdk(input: {
  apiKey: string;
  model: string;
  benchmarkKey: string;
  taskKey?: string;
  agentPath: string;
  agentName: string;
  agentVersion: string;
  agentTextPreview: string;
  generateTextFn?: typeof generateText;
}): Promise<JudgeResult> {
  const prompt = [
    `Benchmark: ${input.benchmarkKey}`,
    `Task: ${input.taskKey ?? "all"}`,
    `Agent Name: ${input.agentName}`,
    `Agent Version: ${input.agentVersion}`,
    `Agent File: ${input.agentPath}`,
    "Review whether this agent specification appears capable of completing the requested work.",
    "Respond with compact JSON only: {\"score\": <number>, \"reason\": \"...\"}.",
    `Evaluation Context:\n${input.agentTextPreview}`
  ].join("\n\n");

  const started = Date.now();
  const callGenerateText = input.generateTextFn ?? generateText;
  const { text, usage } = await callGenerateText({
    model: input.model,
    prompt,
    system: process.env.LLM_JUDGE_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
    temperature: 0,
    providerOptions: {
      gateway: {
        apiKey: input.apiKey
      }
    }
  });
  const latencyMs = Date.now() - started;

  const rawText = text?.trim() ?? "";
  if (!rawText) {
    throw new Error("AI SDK judge returned an empty response.");
  }

  const parsed = parseJudgeResponse(rawText);
  const usageSafe = usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
  const totalTokens = usageSafe?.totalTokens ?? ((usageSafe?.inputTokens ?? 0) + (usageSafe?.outputTokens ?? 0));
  return {
    score: parsed.score,
    reason: parsed.reason,
    latencyMs,
    totalTokens,
    rawText,
    mode: "gateway"
  };
}

function collectAgentPreviewFiles(bundleRoot: string, limit = 8): string[] {
  const results: string[] = [];
  const excludedDirs = new Set(["node_modules", ".git", ".next", "dist", "test-results"]);

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    entries.forEach((entry) => {
      if (results.length >= limit) return;

      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name)) return;
        walk(absolutePath);
        return;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (![".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".sh", ".js", ".ts", ".py"].includes(extension)) {
        return;
      }
      results.push(absolutePath);
    });
  }

  walk(bundleRoot);
  return results;
}

function buildAgentSystemPreview(input: {
  bundleRoot: string;
  entryPath: string;
  entryMarkdown: string;
  bundleMode: "flat" | "bundle";
  skills: AgentSkillReference[];
  assetFileCount: number;
}): string {
  if (input.bundleMode === "flat") {
    return input.entryMarkdown.trim().slice(0, 16000);
  }

  const sections: string[] = [
    `# Agent System`,
    "",
    `Entry File: ${path.basename(input.entryPath)}`,
    `Bundle Mode: ${input.bundleMode}`,
    `Skill Count: ${input.skills.length}`,
    `Asset File Count: ${input.assetFileCount}`,
    ...(input.skills.length > 0
      ? ["", "## Attached Skills", ...input.skills.map((skill) => `- ${skill.installSpec}`)]
      : []),
    "",
    "## Entry Markdown",
    input.entryMarkdown.trim()
  ];
  const previewFiles = collectAgentPreviewFiles(input.bundleRoot)
    .filter((filePath) => filePath !== input.entryPath);

  previewFiles.forEach((filePath) => {
    const relativePath = path.relative(input.bundleRoot, filePath).replace(/\\/g, "/");
    const content = readFileSync(filePath, "utf8").trim();
    if (!content) return;
    sections.push("", `## File: ${relativePath}`, content.slice(0, 2400));
  });

  return sections.join("\n").slice(0, 16000);
}

function buildTaskContext(benchmarks: RuntimeEvaluationRequest["benchmarks"], benchmarkKey: string, taskKey?: string): string {
  const benchmark = benchmarks.find((entry) => entry.key === benchmarkKey);
  const selectedTasks = taskKey
    ? (benchmark?.tasks.filter((task) => task.key === taskKey) ?? [])
    : (benchmark?.tasks ?? []);

  return JSON.stringify({
    selectedBenchmark: benchmark ?? null,
    selectedTaskKey: taskKey ?? null,
    selectedTasks
  }, null, 2);
}

function resolveAgentMaterial(input: RuntimeEvaluationRequest): ResolvedAgentMaterial {
  if (input.agentMarkdown && input.agentMarkdown.trim()) {
    const entryMarkdown = input.agentMarkdown.trim().slice(0, 12000);
    return {
      agentPathLabel: input.agentPath ?? "inline-agent",
      entryMarkdown,
      previewMarkdown: entryMarkdown,
      bundleMode: "flat",
      skills: [],
      assetFileCount: 0
    };
  }

  if (!input.agentPath) {
    throw new Error("Run request requires either agentPath or agentMarkdown.");
  }

  const resolved = resolveAgentExecutionContext(input.agentPath);
  return {
    agentPathLabel: input.agentPath,
    entryMarkdown: resolved.content.trim().slice(0, 12000),
    previewMarkdown: buildAgentSystemPreview({
      bundleRoot: resolved.absoluteBundlePath,
      entryPath: resolved.absoluteEntryPath,
      entryMarkdown: resolved.content,
      bundleMode: resolved.bundleMode,
      skills: resolved.skills,
      assetFileCount: resolved.assetFileCount
    }),
    absoluteEntryPath: resolved.absoluteEntryPath,
    absoluteBundlePath: resolved.absoluteBundlePath,
    bundleMode: resolved.bundleMode,
    skills: resolved.skills,
    assetFileCount: resolved.assetFileCount
  };
}

function estimateCostUsd(totalTokens: number): number {
  const configured = Number(process.env.AGENT_BENCH_COST_PER_1K_TOKENS_USD ?? DEFAULT_COST_PER_1K_TOKENS_USD);
  const costPer1K = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_PER_1K_TOKENS_USD;
  return Number(((totalTokens / 1000) * costPer1K).toFixed(4));
}

function cachePathFromArtifactsRoot(artifactsRoot: string): string {
  return path.join(path.dirname(artifactsRoot), "judge-cache.json");
}

function getJudgeCacheEnabled(): boolean {
  const raw = (process.env.LLM_JUDGE_RESPONSE_CACHE ?? process.env.AGENT_BENCH_DETERMINISTIC ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export function resolveGatewayApiKey(sessionKey?: string): string | undefined {
  return sessionKey?.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || undefined;
}

export function resolveJudgeModel(model?: string): string {
  return model?.trim() || process.env.AGENT_BENCH_JUDGE_MODEL?.trim() || DEFAULT_MODEL;
}

function makeJudgeFingerprint(input: { benchmarkKey: string; taskKey?: string; model: string; taskContext: string; agentMd: string }): string {
  return createHash("sha256")
    .update(input.benchmarkKey)
    .update("\n")
    .update(input.taskKey ?? "all")
    .update("\n")
    .update(input.model)
    .update("\n")
    .update(input.taskContext)
    .update("\n")
    .update(input.agentMd)
    .digest("hex");
}

function loadJudgeCache(cachePath: string): JudgeCacheMap {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as JudgeCacheMap;
  } catch {
    return {};
  }
}

function saveJudgeCache(cachePath: string, cache: JudgeCacheMap): void {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function resolveTaskFixtureDir(benchmarksDir: string | undefined, benchmarkKey: string, task: BenchmarkTaskRecord): string | null {
  if (!benchmarksDir) return null;
  if (!task.sandbox?.fixtureDir) return null;
  return path.join(benchmarksDir, benchmarkKey, task.sandbox.fixtureDir);
}

function buildTaskBrief(benchmark: BenchmarkSuiteRecord, task: BenchmarkTaskRecord): string {
  return [
    `# ${task.title}`,
    "",
    `Benchmark: ${benchmark.key}`,
    `Task: ${task.key}`,
    "",
    "## Description",
    task.description,
    "",
    "## Expected Outcome",
    task.expectedOutcome,
    "",
    ...(task.whyThisTask
      ? ["## Why This Task", task.whyThisTask, ""]
      : []),
    ...(task.inputs
      ? ["## Inputs", task.inputs, ""]
      : []),
    ...(task.deliverableFormat
      ? ["## Deliverable Format", task.deliverableFormat, ""]
      : []),
    ...(task.successChecks.length > 0
      ? ["## Success Checks", ...task.successChecks.map((entry) => `- ${entry}`), ""]
      : []),
    ...(task.failureModes.length > 0
      ? ["## Failure Modes", ...task.failureModes.map((entry) => `- ${entry}`), ""]
      : []),
    "## Metadata",
    `Resolution: ${task.metadata.resolution}`,
    `Interaction: ${task.metadata.interaction}`,
    `Evaluator: ${task.metadata.evaluator}`,
    `Difficulty: ${task.metadata.difficulty}`,
    `Reliability: ${task.metadata.reliability}`,
    `Tags: ${task.metadata.tags.join(", ") || "none"}`,
    `Requires Isolation: ${task.metadata.requiresIsolation ? "yes" : "no"}`,
    `Requires Network: ${task.metadata.requiresNetwork ? "yes" : "no"}`,
    `Time Budget Ms: ${task.metadata.timeBudgetMs}`,
    `Cost Budget Usd: ${task.metadata.costBudgetUsd}`,
    `Default Trials: ${task.metadata.defaultTrials}`,
    `Sandbox Provider: ${task.sandbox?.provider ?? "auto"}`,
    task.sandbox?.verifyCommand ? `Verify Command: ${task.sandbox.verifyCommand}` : "Verify Command: none",
    ""
  ].join("\n");
}

function summarizeSandboxExecution(
  runner: SandboxCommandResult,
  verifier?: SandboxCommandResult
): Pick<SandboxExecutionResult, "outcomeScore" | "processScore" | "matchedSignals" | "missingSignals" | "reason" | "objectiveChecks"> {
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];
  let outcomeScore = 0;
  let processScore = 1.5;
  const objectiveItems: string[] = [];
  let availableChecks = 1;
  let passedChecks = 0;

  if (runner.exitCode === 0) {
    outcomeScore += 4.5;
    processScore += 3.5;
    passedChecks += 1;
    matchedSignals.push("agent runner exited successfully");
    objectiveItems.push("runner exit code 0");
  } else {
    missingSignals.push(runner.timedOut ? "agent runner timed out" : "agent runner failed");
    objectiveItems.push("runner exit code non-zero");
  }

  if (verifier) {
    availableChecks += 1;
    if (verifier.exitCode === 0) {
      outcomeScore += 5.5;
      processScore += 2.5;
      passedChecks += 1;
      matchedSignals.push(`verify command passed: ${verifier.command}`);
      objectiveItems.push(`verifier passed: ${verifier.command}`);
    } else {
      missingSignals.push(verifier.timedOut ? "verify command timed out" : `verify command failed: ${verifier.command}`);
      objectiveItems.push(`verifier failed: ${verifier.command}`);
    }
  } else if (runner.exitCode === 0) {
    outcomeScore += 2.5;
    processScore += 1;
    matchedSignals.push("no verify command configured; using runner exit status only");
    objectiveItems.push("no verifier configured");
  }

  if (runner.stdout || runner.stderr) {
    processScore += 1;
    matchedSignals.push("runner produced execution logs");
  }

  const reason = verifier
    ? verifier.exitCode === 0
      ? "Sandbox execution and verification both completed successfully."
      : "Sandbox execution finished, but verification failed."
    : runner.exitCode === 0
      ? "Sandbox execution completed without a separate verification command."
      : "Sandbox execution failed before verification could pass.";

  return {
    outcomeScore: clampScore(outcomeScore),
    processScore: clampScore(processScore),
    matchedSignals: matchedSignals.slice(0, 6),
    missingSignals: missingSignals.slice(0, 6),
    reason,
    objectiveChecks: {
      available: availableChecks,
      passed: passedChecks,
      deterministic: true,
      items: objectiveItems
    }
  };
}

function copyAgentSystemToArtifacts(input: {
  artifactsPath: string;
  agentPath?: string;
  bundlePath?: string;
  bundleMode: "flat" | "bundle";
}): string | undefined {
  if (!input.agentPath) return undefined;

  const targetDir = path.join(input.artifactsPath, "agent-system");
  mkdirSync(targetDir, { recursive: true });

  if (input.bundleMode === "bundle" && input.bundlePath) {
    cpSync(input.bundlePath, targetDir, {
      recursive: true,
      filter: (sourcePath) => {
        const baseName = path.basename(sourcePath);
        return !["node_modules", ".git", ".next", "dist", "test-results"].includes(baseName);
      }
    });
    return targetDir;
  }

  const fileName = path.basename(input.agentPath);
  cpSync(input.agentPath, path.join(targetDir, fileName));
  return targetDir;
}

async function maybeRunSandboxExecution(input: {
  runKey: string;
  artifactsPath: string;
  benchmark: BenchmarkSuiteRecord;
  task?: BenchmarkTaskRecord;
  benchmarksDir?: string;
  agentPath?: string;
  agentBundlePath?: string;
  agentBundleMode: "flat" | "bundle";
  agentSkills: AgentSkillReference[];
  agentAssetFileCount: number;
  agentPathLabel: string;
  agentMarkdown: string;
  agentRunnerCommand?: string;
  strictSandbox?: boolean;
  resolvedSandboxProvider?: RuntimeEvaluationRequest["resolvedSandboxProvider"];
  model?: string;
  providerApiKey?: string;
}): Promise<SandboxExecutionResult> {
  if (!input.task?.sandbox || !input.agentRunnerCommand) {
    return {
      mode: "review-only",
      outcomeScore: 0,
      processScore: 0,
      matchedSignals: [],
      missingSignals: [],
      reason: "Sandbox execution not configured for this run.",
      objectiveChecks: {
        available: 0,
        passed: 0,
        deterministic: false,
        items: []
      },
      durationMs: 0
    };
  }

  const fixtureDir = resolveTaskFixtureDir(input.benchmarksDir, input.benchmark.key, input.task);
  if (!fixtureDir || !existsSync(fixtureDir)) {
    throw new Error(`Sandbox fixture not found for ${input.benchmark.key}/${input.task.key}.`);
  }

  const workspaceDir = path.join(input.artifactsPath, "workspace");
  const taskBriefPath = path.join(input.artifactsPath, "task-brief.md");
  const agentFilePath = path.join(input.artifactsPath, "agent.md");
  const agentDir = input.agentPath ? path.dirname(input.agentPath) : workspaceDir;
  const agentBundleDir = input.agentBundlePath ?? agentDir;
  const agentSkillsDir = path.join(agentBundleDir, ".agents", "skills");
  const agentArtifactDir = copyAgentSystemToArtifacts({
    artifactsPath: input.artifactsPath,
    agentPath: input.agentPath,
    bundlePath: input.agentBundlePath,
    bundleMode: input.agentBundleMode
  });
  const allowNetwork = input.task.metadata.requiresNetwork;
  cpSync(fixtureDir, workspaceDir, { recursive: true });
  writeFileSync(taskBriefPath, buildTaskBrief(input.benchmark, input.task), "utf8");
  writeFileSync(agentFilePath, input.agentMarkdown, "utf8");

  const commandEnv: Record<string, string> = {
    AGENT_BENCH_RUN_KEY: input.runKey,
    AGENT_BENCH_WORKSPACE: workspaceDir,
    AGENT_BENCH_TASK_FILE: taskBriefPath,
    AGENT_BENCH_AGENT_FILE: agentFilePath,
    AGENT_BENCH_AGENT_DIR: agentDir,
    AGENT_BENCH_AGENT_BUNDLE: agentBundleDir,
    AGENT_BENCH_AGENT_ENTRY_FILE: input.agentPath ?? agentFilePath,
    AGENT_BENCH_AGENT_BUNDLE_MODE: input.agentBundleMode,
    AGENT_BENCH_AGENT_SKILL_COUNT: String(input.agentSkills.length),
    AGENT_BENCH_AGENT_ASSET_FILE_COUNT: String(input.agentAssetFileCount),
    AGENT_BENCH_ARTIFACTS_DIR: input.artifactsPath,
    AGENT_BENCH_BENCHMARK_KEY: input.benchmark.key,
    AGENT_BENCH_TASK_KEY: input.task.key,
    AGENT_BENCH_SANDBOX_NETWORK: allowNetwork ? "enabled" : "disabled"
  };
  if (existsSync(agentSkillsDir)) {
    commandEnv.AGENT_BENCH_AGENT_SKILLS_DIR = agentSkillsDir;
  }
  if (agentArtifactDir) {
    commandEnv.AGENT_BENCH_AGENT_ARTIFACT_DIR = agentArtifactDir;
  }
  const timeoutMs = input.task.sandbox.timeoutMs;
  const provider = input.resolvedSandboxProvider && input.resolvedSandboxProvider !== "mixed"
    ? input.resolvedSandboxProvider
    : input.task.sandbox.provider && input.task.sandbox.provider !== "auto"
      ? input.task.sandbox.provider
      : undefined;
  const runner = await runSandboxedCommand({
    command: input.agentRunnerCommand,
    cwd: agentDir,
    workspaceDir,
    artifactsDir: input.artifactsPath,
    readOnlyDirs: [agentBundleDir],
    timeoutMs,
    allowNetwork,
    label: "runner",
    provider,
    strictProvider: Boolean(input.strictSandbox && provider),
    env: commandEnv as unknown as NodeJS.ProcessEnv,
    providerApiKey: input.providerApiKey,
    model: input.model
  });
  const verifier = runner.exitCode === 0 && input.task.sandbox.verifyCommand
    ? await runSandboxedCommand({
      command: input.task.sandbox.verifyCommand,
      cwd: workspaceDir,
      workspaceDir,
      artifactsDir: input.artifactsPath,
      readOnlyDirs: [agentBundleDir],
      timeoutMs,
      allowNetwork,
      label: "verifier",
      provider,
      strictProvider: Boolean(input.strictSandbox && provider),
      env: commandEnv as unknown as NodeJS.ProcessEnv
    })
    : undefined;
  const summary = summarizeSandboxExecution(runner, verifier);

  return {
    mode: "sandbox",
    provider: runner.provider,
    networkAccess: runner.networkAccess,
    workspaceDir,
    taskBriefPath,
    runner,
    verifier,
    durationMs: runner.durationMs + (verifier?.durationMs ?? 0),
    ...summary
  };
}

function buildRulesAssessment(benchmark: BenchmarkSuiteRecord, task: BenchmarkTaskRecord | undefined, agentMd: string): RulesAssessment {
  const agentText = normalizeText(agentMd);
  const resolution = task?.metadata.resolution ?? benchmark.metadata.resolution;
  const interaction = task?.metadata.interaction;
  const requiresNetwork = task?.metadata.requiresNetwork ?? false;
  const requiresIsolation = task?.metadata.requiresIsolation ?? false;
  const difficulty = task?.metadata.difficulty ?? "medium";
  const taskTags = [
    ...benchmark.metadata.tags,
    ...(task?.metadata.tags ?? [])
  ];

  const hasRole = hasAny(agentText, ["role:", "behavior:", "instruction", "responsibil"]);
  const hasPlanning = hasAny(agentText, ["plan", "research", "synthes", "analy", "step", "decompose", "approach"]);
  const hasVerification = hasAny(agentText, ["test", "verify", "validation", "check", "acceptance", "pass/fail", "assert"]);
  const hasSafety = hasAny(agentText, ["rollback", "failure", "risk", "guardrail", "constraint", "safety", "secure"]);
  const hasDeliverable = hasAny(agentText, ["deliver", "return", "output", "report", "summary", "artifact", "patch"]);
  const hasToolUse = hasAny(agentText, ["tool", "api", "function", "search", "fetch", "call"]);
  const hasTerminal = hasAny(agentText, ["terminal", "shell", "command", "bash", "zsh", "repo", "git", "patch", "build", "test"]);
  const hasBrowser = hasAny(agentText, ["browser", "page", "click", "form", "dom", "navigate", "tab", "selector"]);
  const hasComputer = hasAny(agentText, ["computer", "desktop", "window", "screen", "mouse", "keyboard", "application"]);
  const hasDelegation = hasAny(agentText, ["delegate", "handoff", "reviewer", "specialist", "merge", "coordination", "orchestrat"]);
  const hasNetwork = hasAny(agentText, ["network", "web", "browse", "http", "api", "search", "online"]);
  const hasIsolation = hasAny(agentText, ["isolate", "sandbox", "workspace", "repo", "local", "artifact", "test env"]);
  const hasStructuredMarkdown = /(^|\n)#+\s+/.test(agentMd) || /(^|\n)-\s+/.test(agentMd);
  const hasDetailedSpec = agentMd.trim().length >= 180;
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];
  let outcomeScore = 2.8;
  let processScore = resolution === "atomic" ? 2.4 : 2.9;
  let reviewScore = 3.1;

  function bonus(condition: boolean, target: "outcome" | "process" | "review", delta: number, matchedLabel: string): void {
    if (!condition) return;
    if (target === "outcome") outcomeScore += delta;
    if (target === "process") processScore += delta;
    if (target === "review") reviewScore += delta;
    matchedSignals.push(matchedLabel);
  }

  function requirement(
    condition: boolean,
    target: "outcome" | "process" | "review",
    delta: number,
    matchedLabel: string,
    missingLabel: string
  ): void {
    if (condition) {
      bonus(true, target, delta, matchedLabel);
      return;
    }

    if (target === "outcome") outcomeScore -= delta * 0.7;
    if (target === "process") processScore -= delta * 0.7;
    if (target === "review") reviewScore -= delta * 0.6;
    missingSignals.push(missingLabel);
  }

  bonus(hasRole, "review", 0.8, "clear role or behavior contract");
  bonus(hasStructuredMarkdown, "review", 0.5, "structured instructions");
  bonus(hasDetailedSpec, "review", 0.5, "enough instruction detail for stable execution");
  requirement(hasVerification, "outcome", 1.1, "explicit verification or acceptance checks", "verification or acceptance checks are missing");
  bonus(hasSafety, "review", 0.8, "failure handling or rollback guidance");
  requirement(hasDeliverable, "outcome", 0.8, "clear output expectations", "deliverable or output expectations are not explicit");

  if (resolution === "workflow") {
    requirement(hasPlanning, "process", 1.2, "workflow planning signals", "workflow planning guidance is missing");
  } else if (resolution === "campaign") {
    requirement(hasPlanning && hasSafety, "process", 1.5, "long-horizon planning and recovery signals", "campaign-level planning or recovery guidance is missing");
  } else if (resolution === "swarm") {
    requirement(hasPlanning && hasDelegation, "process", 1.9, "multi-agent orchestration guidance", "swarm orchestration or handoff guidance is missing");
  } else {
    bonus(hasVerification, "outcome", 0.4, "atomic task acceptance focus");
  }

  if (interaction === "artifact") {
    requirement(hasDeliverable || hasVerification, "outcome", 1.0, "artifact-oriented completion signals", "artifact completion criteria are not described");
  }
  if (interaction === "terminal") {
    requirement(hasTerminal, "process", 1.4, "terminal and repo operations capability", "terminal or repo operations are not described");
  }
  if (interaction === "browser") {
    requirement(hasBrowser, "process", 1.8, "browser workflow capability", "browser interaction capability is missing");
  }
  if (interaction === "computer-use") {
    requirement(hasComputer, "process", 1.8, "computer-use capability", "computer-use capability is missing");
  }
  if (interaction === "tool-use") {
    requirement(hasToolUse || hasBrowser || hasTerminal, "process", 1.5, "tool invocation capability", "tool invocation capability is missing");
  }
  if (interaction === "multi-agent") {
    requirement(hasDelegation, "process", 2.0, "delegation and handoff capability", "delegation or handoff guidance is missing");
  }

  if (requiresNetwork) {
    requirement(hasNetwork, "process", 0.9, "network or web access intent", "task requires network use but the agent spec does not mention web or API work");
  }
  if (requiresIsolation) {
    requirement(hasIsolation || hasTerminal, "process", 0.8, "workspace or isolation awareness", "task expects isolated workspace handling but the agent spec does not mention it");
  }

  const matchedKeywords = taskTags.filter((tag) => normalizeKeyword(tag).some((keyword) => agentText.includes(keyword)));
  if (matchedKeywords.length > 0) {
    outcomeScore += Math.min(1.1, matchedKeywords.length * 0.3);
    reviewScore += Math.min(0.8, matchedKeywords.length * 0.2);
    matchedSignals.push(`task keywords present: ${matchedKeywords.slice(0, 4).join(", ")}`);
  } else if (taskTags.length > 0) {
    outcomeScore -= 0.7;
    reviewScore -= 0.4;
    missingSignals.push("task-specific keywords are not reflected in the agent spec");
  }

  if (difficulty === "high" && !hasDetailedSpec) {
    processScore -= 0.8;
    reviewScore -= 0.6;
    missingSignals.push("high-difficulty task but the agent instructions are still very thin");
  }

  const matchedSummary = matchedSignals.slice(0, 3).join("; ");
  const missingSummary = missingSignals.slice(0, 2).join("; ");
  const reason = [
    matchedSummary ? `Matched: ${matchedSummary}.` : "",
    missingSummary ? `Gaps: ${missingSummary}.` : ""
  ].filter(Boolean).join(" ");

  return {
    outcomeScore: clampScore(outcomeScore),
    processScore: clampScore(processScore),
    reviewScore: clampScore(reviewScore),
    matchedSignals: matchedSignals.slice(0, 6),
    missingSignals: missingSignals.slice(0, 6),
    reason: reason || "Rules review found a basic but weak agent specification with limited task-specific evidence."
  };
}

function determineScoreProfile(task: BenchmarkTaskRecord | undefined, sandbox: SandboxExecutionResult): ScoreProfileKey {
  if (sandbox.mode === "sandbox") {
    return task?.metadata.evaluator === "trace" ? "trace" : "hybrid";
  }

  return task?.metadata.evaluator ?? "hybrid";
}

function determineScoreConfidence(task: BenchmarkTaskRecord | undefined, sandbox: SandboxExecutionResult): ScoreConfidence {
  if (sandbox.mode === "sandbox" && sandbox.objectiveChecks.deterministic && sandbox.objectiveChecks.available > 0) {
    return "high";
  }

  if (task && (task.whyThisTask || task.inputs || task.deliverableFormat || task.successChecks.length > 0 || task.failureModes.length > 0)) {
    return "medium";
  }

  return "low";
}

function buildRecommendedNextActions(input: {
  sandbox: SandboxExecutionResult;
  scoreConfidence: ScoreConfidence;
  matchedSignals: string[];
  missingSignals: string[];
  task?: BenchmarkTaskRecord;
}): string[] {
  const actions: string[] = [];

  if (input.sandbox.mode === "sandbox" && input.sandbox.runner && input.sandbox.runner.exitCode !== 0) {
    actions.push("Inspect the runner log and sandbox profile before rerunning.");
  } else if (input.sandbox.mode === "sandbox" && input.sandbox.verifier && input.sandbox.verifier.exitCode !== 0) {
    actions.push("Open the verifier output and fix the generated workspace state before rerunning.");
  }

  if (input.missingSignals.length > 0) {
    actions.push(`Tighten the agent/task contract around: ${input.missingSignals.slice(0, 2).join("; ")}.`);
  }

  if (input.scoreConfidence === "low") {
    actions.push("Treat this score as directional only; add a fixture or deterministic verifier for stronger evidence.");
  } else if (input.scoreConfidence === "medium") {
    actions.push("Promote this task to a deterministic benchmark by adding an executable verifier.");
  }

  if (actions.length === 0 && input.task) {
    actions.push(`Inspect the highest-signal evidence for ${input.task.key} and compare it against the best prior run.`);
  }

  return actions.slice(0, 3);
}

function buildRunReportSvg(input: {
  runKey: string;
  benchmarkKey: string;
  taskKey?: string;
  agentName: string;
  total: number;
  readiness: number;
  review: number;
  performance: number;
  reviewMode: string;
  executionDetail: string;
  matchedSignals: string[];
  missingSignals: string[];
}): string {
  const matchedLines = input.matchedSignals.length > 0 ? input.matchedSignals : ["No strong matched signals recorded."];
  const missingLines = input.missingSignals.length > 0 ? input.missingSignals : ["No major gaps detected in the rules review."];
  const renderLines = (lines: string[], x: number, startY: number, color: string) => lines
    .slice(0, 4)
    .map((line, index) => `<text x="${x}" y="${startY + index * 34}" fill="${color}" font-size="24" font-family="Manrope, Arial">${escapeXml(`• ${line}`)}</text>`)
    .join("");

  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">",
    "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0f172a\"/><stop offset=\"100%\" stop-color=\"#1e293b\"/></linearGradient></defs>",
    "<rect width=\"1280\" height=\"720\" fill=\"url(#bg)\"/>",
    "<text x=\"64\" y=\"84\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">agent-bench run report</text>",
    `<text x=\"64\" y=\"130\" fill=\"#e2e8f0\" font-size=\"22\" font-family=\"Manrope, Arial\">Run: ${escapeXml(input.runKey)}</text>`,
    `<text x=\"64\" y=\"162\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Benchmark: ${escapeXml(input.benchmarkKey)}</text>`,
    `<text x=\"64\" y=\"192\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Task: ${escapeXml(input.taskKey ?? "all")}</text>`,
    `<text x=\"64\" y=\"222\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Agent: ${escapeXml(input.agentName)}</text>`,
    `<text x=\"64\" y=\"252\" fill=\"#94a3b8\" font-size=\"18\" font-family=\"Manrope, Arial\">Execution: ${escapeXml(input.executionDetail)}</text>`,
    `<text x=\"64\" y=\"280\" fill=\"#94a3b8\" font-size=\"18\" font-family=\"Manrope, Arial\">Review mode: ${escapeXml(input.reviewMode)}</text>`,
    "<rect x=\"64\" y=\"288\" width=\"1152\" height=\"126\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    `<text x=\"100\" y=\"360\" fill=\"#34d399\" font-size=\"56\" font-family=\"Manrope, Arial\">Total ${input.total.toFixed(2)}</text>`,
    `<text x=\"100\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Readiness ${input.readiness.toFixed(2)}</text>`,
    `<text x=\"460\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Review ${input.review.toFixed(2)}</text>`,
    `<text x=\"760\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Performance ${input.performance.toFixed(2)}</text>`,
    "<rect x=\"64\" y=\"446\" width=\"544\" height=\"224\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    "<rect x=\"672\" y=\"446\" width=\"544\" height=\"224\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    "<text x=\"96\" y=\"490\" fill=\"#34d399\" font-size=\"26\" font-family=\"Manrope, Arial\">Matched Signals</text>",
    renderLines(matchedLines, 96, 536, "#e2e8f0"),
    "<text x=\"704\" y=\"490\" fill=\"#fca5a5\" font-size=\"26\" font-family=\"Manrope, Arial\">Open Gaps</text>",
    renderLines(missingLines, 704, 536, "#e2e8f0"),
    "</svg>"
  ].join("");
}

export async function evaluate(input: RuntimeEvaluationRequest): Promise<RunInput> {
  const now = new Date();
  const started = Date.now();
  const selectedBenchmark = input.benchmarks.find((benchmark) => benchmark.key === input.benchmarkKey);
  if (!selectedBenchmark) {
    throw new Error(`Unknown benchmark: ${input.benchmarkKey}`);
  }
  const selectedTask = input.taskKey
    ? selectedBenchmark.tasks.find((task) => task.key === input.taskKey)
    : undefined;
  if (input.taskKey && !selectedTask) {
    throw new Error(`Unknown task '${input.taskKey}' in benchmark '${input.benchmarkKey}'`);
  }

  const material = resolveAgentMaterial(input);
  const headingName = material.entryMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallbackName = path.basename(material.agentPathLabel, path.extname(material.agentPathLabel)) || "agent";
  const agentName = headingName || fallbackName;
  const agentVersion = /v\d+/i.test(agentName) ? agentName.match(/v\d+/i)![0] : "v1";
  const taskContext = buildTaskContext(input.benchmarks, input.benchmarkKey, input.taskKey);
  const assessment = buildRulesAssessment(selectedBenchmark, selectedTask, material.previewMarkdown);
  const model = resolveJudgeModel(input.model);
  const artifactsPath = path.join(input.artifactsRoot, input.runKey);
  mkdirSync(artifactsPath, { recursive: true });
  const sandbox = await maybeRunSandboxExecution({
    runKey: input.runKey,
    artifactsPath,
    benchmark: selectedBenchmark,
    task: selectedTask,
    benchmarksDir: input.benchmarksDir,
    agentPath: material.absoluteEntryPath ?? input.agentPath,
    agentBundlePath: material.absoluteBundlePath,
    agentBundleMode: material.bundleMode,
    agentSkills: material.skills,
    agentAssetFileCount: material.assetFileCount,
    agentPathLabel: material.agentPathLabel,
    agentMarkdown: material.entryMarkdown,
    agentRunnerCommand: input.agentRunnerCommand,
    strictSandbox: input.strictSandbox,
    resolvedSandboxProvider: input.resolvedSandboxProvider,
    model,
    providerApiKey: input.gatewayApiKey
  });
  const outcomeScore = sandbox.mode === "sandbox" ? sandbox.outcomeScore : assessment.outcomeScore;
  const processScore = sandbox.mode === "sandbox" && sandbox.processScore > 0 ? sandbox.processScore : assessment.processScore;

  const apiKey = resolveGatewayApiKey(input.gatewayApiKey);
  const cacheEnabled = getJudgeCacheEnabled();
  const judgePromptContent = [
    `Task Context:\n${taskContext}`,
    `Rules Assessment:\n${JSON.stringify(assessment, null, 2)}`,
    `Sandbox Execution:\n${JSON.stringify({
      mode: sandbox.mode,
      outcomeScore: sandbox.outcomeScore,
      processScore: sandbox.processScore,
      objectiveChecks: sandbox.objectiveChecks,
      reason: sandbox.reason,
      runner: sandbox.runner
        ? {
          provider: sandbox.runner.provider,
          cwd: sandbox.runner.cwd,
          exitCode: sandbox.runner.exitCode,
          durationMs: sandbox.runner.durationMs,
          timedOut: sandbox.runner.timedOut,
          stdout: sandbox.runner.stdout,
          stderr: sandbox.runner.stderr
        }
        : null,
      verifier: sandbox.verifier
        ? {
          provider: sandbox.verifier.provider,
          cwd: sandbox.verifier.cwd,
          command: sandbox.verifier.command,
          exitCode: sandbox.verifier.exitCode,
          durationMs: sandbox.verifier.durationMs,
          timedOut: sandbox.verifier.timedOut,
          stdout: sandbox.verifier.stdout,
          stderr: sandbox.verifier.stderr
        }
        : null
    }, null, 2)}`,
    `Agent System:\n${material.previewMarkdown}`
  ].join("\n\n");
  const fingerprint = makeJudgeFingerprint({
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    model,
    taskContext,
    agentMd: material.previewMarkdown
  });
  const cachePath = cachePathFromArtifactsRoot(input.artifactsRoot);
  const judgeCache = loadJudgeCache(cachePath);

  let judge: JudgeResult;
  if (apiKey) {
    if (cacheEnabled && judgeCache[fingerprint]) {
      const cached = judgeCache[fingerprint];
      judge = {
        score: cached.score,
        rawText: cached.rawText,
        totalTokens: cached.totalTokens,
        reason: cached.reason,
        latencyMs: 1,
        mode: "gateway-cache"
      };
    } else {
      judge = await judgeWithVercelAiSdk({
        apiKey,
        model,
        benchmarkKey: input.benchmarkKey,
        taskKey: input.taskKey,
        agentPath: material.agentPathLabel,
        agentName,
        agentVersion,
        agentTextPreview: judgePromptContent
      });
      if (cacheEnabled) {
        judgeCache[fingerprint] = {
          score: judge.score,
          rawText: judge.rawText,
          totalTokens: judge.totalTokens,
          reason: judge.reason
        };
        saveJudgeCache(cachePath, judgeCache);
      }
    }
  } else {
    const rulesReviewReason = sandbox.mode === "sandbox" ? `${assessment.reason} ${sandbox.reason}`.trim() : assessment.reason;
    const rulesReviewScore = clampScore(assessment.reviewScore + (sandbox.mode === "sandbox" && sandbox.verifier?.exitCode === 0 ? 0.6 : 0));
    judge = {
      score: rulesReviewScore,
      latencyMs: 1,
      totalTokens: 0,
      rawText: JSON.stringify({ score: rulesReviewScore, reason: rulesReviewReason }),
      reason: rulesReviewReason,
      mode: "rules"
    };
  }

  const costUsd = estimateCostUsd(judge.totalTokens);
  const latencyMs = sandbox.mode === "sandbox" ? Math.max(sandbox.durationMs, judge.latencyMs) : judge.latencyMs;
  const durationMs = Date.now() - started;
  const scoreProfile = determineScoreProfile(selectedTask, sandbox);
  const scoreConfidence = determineScoreConfidence(selectedTask, sandbox);
  const efficiencyScore = efficiencyScoreFromMetrics({
    latencyMs,
    costUsd,
    difficulty: selectedTask?.metadata.difficulty ?? "medium",
    timeoutMs: selectedTask?.sandbox?.timeoutMs,
    requiresNetwork: selectedTask?.metadata.requiresNetwork
  });
  const scores = computeWeightedScore({
    profile: scoreProfile,
    outcome: outcomeScore,
    process: processScore,
    review: judge.score,
    efficiency: efficiencyScore
  });
  const objectiveScore = sandbox.objectiveChecks.deterministic ? outcomeScore : 0;
  const objectivePass = sandbox.objectiveChecks.deterministic
    && sandbox.objectiveChecks.available > 0
    && sandbox.objectiveChecks.passed >= sandbox.objectiveChecks.available;
  const matchedSignals = [
    ...assessment.matchedSignals,
    ...sandbox.matchedSignals
  ].slice(0, 8);
  const missingSignals = [
    ...assessment.missingSignals,
    ...sandbox.missingSignals
  ].slice(0, 8);
  const recommendedNextActions = buildRecommendedNextActions({
    sandbox,
    scoreConfidence,
    matchedSignals,
    missingSignals,
    task: selectedTask
  });
  const logText = [
    `Run key: ${input.runKey}`,
    `Benchmark: ${input.benchmarkKey}`,
    `Task: ${input.taskKey ?? "all"}`,
    `Agent: ${material.agentPathLabel}`,
    `Agent bundle mode: ${material.bundleMode}`,
    `Agent skill count: ${material.skills.length}`,
    `Agent asset file count: ${material.assetFileCount}`,
    `Execution mode: ${sandbox.mode}`,
    `Sandbox provider: ${sandbox.provider ?? "n/a"}`,
    `Network access: ${sandbox.networkAccess ?? "n/a"}`,
    `Review mode: ${judge.mode}`,
    `Score profile: ${scoreProfile}`,
    `Score confidence: ${scoreConfidence}`,
    `Model: ${model}`,
    `Outcome score: ${outcomeScore}`,
    `Process score: ${processScore}`,
    `Review score: ${judge.score}`,
    `Efficiency score: ${efficiencyScore}`,
    `Latency: ${latencyMs}ms`,
    `Cost: $${costUsd.toFixed(4)}`,
    `Objective checks: ${sandbox.objectiveChecks.passed}/${sandbox.objectiveChecks.available}`,
    `Matched signals: ${matchedSignals.join("; ") || "none"}`,
    `Open gaps: ${missingSignals.join("; ") || "none"}`,
    `Recommended next actions: ${recommendedNextActions.join(" | ") || "none"}`,
    sandbox.runner ? `Runner exit: ${sandbox.runner.exitCode ?? "null"} (${sandbox.runner.durationMs}ms) @ ${sandbox.runner.cwd}` : "Runner exit: n/a",
    sandbox.verifier ? `Verify exit: ${sandbox.verifier.exitCode ?? "null"} (${sandbox.verifier.durationMs}ms) @ ${sandbox.verifier.cwd}` : "Verify exit: n/a",
    `Review reason: ${judge.reason}`,
    `Review response: ${judge.rawText}`
  ].join("\n");

  writeFileSync(path.join(artifactsPath, "summary.json"), JSON.stringify({
    runKey: input.runKey,
    experimentKey: input.experimentKey ?? null,
    setup: input.setupSnapshot ?? null,
    trialIndex: input.trialIndex ?? null,
    environmentFingerprint: input.environmentFingerprint ?? null,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey ?? null,
    suiteMetadata: selectedBenchmark.metadata,
    taskMetadata: selectedTask?.metadata ?? null,
    taskContract: selectedTask ? {
      whyThisTask: selectedTask.whyThisTask,
      inputs: selectedTask.inputs,
      deliverableFormat: selectedTask.deliverableFormat,
      successChecks: selectedTask.successChecks,
      failureModes: selectedTask.failureModes
    } : null,
    agentSystem: {
      entryFile: material.agentPathLabel,
      bundleMode: material.bundleMode,
      bundlePath: material.absoluteBundlePath ?? null,
      skillCount: material.skills.length,
      assetFileCount: material.assetFileCount,
      skills: material.skills
    },
    model,
    executionMode: sandbox.mode,
    reviewMode: judge.mode,
    resolvedSandboxProvider: input.resolvedSandboxProvider ?? sandbox.provider ?? null,
    scoreProfile,
    scoreConfidence,
    scoreLabels: {
      outcome: sandbox.mode === "sandbox" ? "execution outcome" : "task-fit outcome",
      process: "workflow/process",
      review: "review",
      efficiency: "efficiency"
    },
    scores,
    assessment,
    sandbox,
    objectiveChecks: sandbox.objectiveChecks,
    objectiveScore,
    objectivePass,
    evidence: {
      matchedSignals,
      missingSignals,
      artifacts: [
        "summary.json",
        "session.log",
        "report.svg",
        ...(material.bundleMode === "bundle" ? ["agent-system/"] : []),
        ...(sandbox.taskBriefPath ? ["task-brief.md"] : []),
        ...(sandbox.workspaceDir ? ["workspace/"] : [])
      ]
    },
    recommendedNextActions,
    latencyMs,
    costUsd,
    durationMs,
    createdAt: now.toISOString(),
    reportFile: "report.svg"
  }, null, 2));
  writeFileSync(path.join(artifactsPath, "session.log"), logText);
  writeFileSync(path.join(artifactsPath, "report.svg"), buildRunReportSvg({
    runKey: input.runKey,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    agentName,
    total: scores.total,
    readiness: scores.outcome,
    review: scores.review,
    performance: scores.efficiency,
    executionDetail: sandbox.mode === "sandbox"
      ? `${sandbox.provider ?? "sandbox"} | network ${sandbox.networkAccess ?? "n/a"}`
      : "review-only",
    reviewMode: judge.mode,
    matchedSignals,
    missingSignals
  }));

  return {
    runKey: input.runKey,
    experimentKey: input.experimentKey ?? null,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey ?? null,
    setupKey: input.setupSnapshot?.key ?? null,
    workflowPath: input.setupSnapshot?.workflowPath ?? input.agentPath ?? material.agentPathLabel,
    modelId: input.setupSnapshot?.modelId ?? input.model ?? null,
    trialIndex: input.trialIndex ?? null,
    agentName,
    agentVersion,
    suiteName: input.taskKey ? `${input.benchmarkKey}/${input.taskKey}` : input.benchmarkKey,
    status: "completed",
    scores,
    objectiveScore,
    objectivePass,
    objectiveChecksAvailable: sandbox.objectiveChecks.available,
    objectiveChecksPassed: sandbox.objectiveChecks.passed,
    deterministic: sandbox.objectiveChecks.deterministic,
    scoreProfile,
    scoreConfidence,
    failureReason: null,
    latencyMs,
    costUsd,
    durationMs,
    artifactsPath,
    logText
  };
}
