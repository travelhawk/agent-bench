import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectAgentFile, listAgentFiles } from "../agents/files";
import { createManagedAgentBundle } from "../agents/bundles";
import {
  installProjectSkills,
  listInstalledProjectSkills,
  removeProjectSkills,
  searchSkillsRegistry,
  SkillSearchResult,
  updateProjectSkills
} from "../agents/skills";
import { normalizeSuiteMetadataInput, normalizeTaskMetadataInput } from "../benchmarks/metadata";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "../core/runner";
import { createDb, initializeSchema } from "../db/schema";
import { deleteRunByKey, getBestScore, getDashboardSummary, getRunByKey, insertRun, listRuns, saveBlindReviewUsage, setBlindReview, sumBlindReviewUsageForRuns } from "../db/store";
import { mapBlindRanking, prepareBlindReview, readBlindRankingFile, type PreparedBlindReview } from "../core/blind";
import { runSandboxedCommand } from "../runtime/sandbox";
import {
  AgentRecord,
  BatchRunFailure,
  BatchRunResult,
  BatchSetupSummary,
  BenchmarkSuiteRecord,
  BlindReviewSummary,
  BlindReviewUsage,
  BenchmarkTaskRecord,
  InstalledSkillRecord,
  RunEvaluationResult,
  RunMode,
  RunRecord,
  RunResultPayload,
  WorkbenchSnapshot
} from "../types";
import { ensureProjectDirs, getArtifactsRoot, getWorkspaceRoot, resolveBenchmarksDir, resolveDbPath, TOOL_VERSION } from "./config";
import {
  assertBatchCapacity,
  INPUT_LIMITS,
  normalizeStringList,
  normalizeTagList,
  readBoundedString,
  resolveBatchAgents,
  resolveBatchSetups,
  ResolvedBatchSetup,
  sanitizeKey,
  setupsFromAgentList
} from "./validation";
import { buildComparisonMatrix, ComparisonMatrix, NO_MODEL_LABEL } from "../core/comparison";
import {
  ComparisonExportFormat,
  ComparisonExportMeta,
  comparisonExportFileName,
  contentTypeForFormat,
  isComparisonExportFormat,
  renderComparison
} from "../core/export";

interface ServiceContext {
  workspaceRoot: string;
  dbPath: string;
  artifactsRoot: string;
  benchmarksDir: string;
  db: ReturnType<typeof createDb>;
}

interface CreateBenchmarkInput {
  key: string;
  title: string;
  description: string;
  expectedOutcome?: string;
  whyThisTask?: string;
  inputs?: string;
  deliverableFormat?: string;
  successChecks?: string[];
  failureModes?: string[];
  benchmarkKey?: string;
  resolution?: string;
  interaction?: string;
  evaluator?: string;
  difficulty?: string;
  domain?: string;
  tags?: string[] | string;
  requiresIsolation?: boolean;
  requiresNetwork?: boolean;
  type: "suite" | "task";
}

interface RunRequestInput {
  benchmarkKey?: string;
  taskKey?: string;
  agentPath?: string;
  agentMarkdown?: string;
  model?: string;
  judgeModel?: string;
  providerApiKey?: string;
  review?: unknown;
}

interface BatchRunInput {
  benchmarkKey?: string;
  taskKey?: string;
  model?: string;
  judgeModel?: string;
  providerApiKey?: string;
  review?: unknown;
  runMode?: RunMode;
  agents?: string[];
  setups?: unknown;
  /** Reviewer command run once after all runs over anonymised workspaces. */
  blindReview?: string;
  trials?: number;
  jobs?: Array<{
    benchmarkKey?: string;
    taskKey?: string;
    agentPath?: string;
    model?: string | null;
    setupKey?: string | null;
    review?: "auto" | "off" | null;
  }>;
}

interface BatchRunJob {
  benchmarkKey: string;
  taskKey: string;
  agentPath: string;
  agentName: string;
  agentVersion: string;
  agentRunnerCommand?: string;
  setupKey: string;
  model?: string;
  review: "auto" | "off";
  followupPrompt?: string;
  buildPrompt?: string;
  env?: Record<string, string>;
  /** 1-based trial number when `--trials` asked for repeats, else undefined. */
  trialIndex?: number;
}

interface ManagedAgentBundleInput {
  name?: string;
  baseAgentPath?: string;
  agentMarkdown?: string;
  files?: Array<{
    path?: string;
    content?: string;
  }>;
  skills?: Array<{
    source?: string;
    skillName?: string;
    registryUrl?: string;
    installs?: number;
    title?: string;
  }>;
}

interface ManageProjectSkillsInput {
  skills?: Array<{
    source?: string;
    skillName?: string;
    registryUrl?: string;
    installs?: number;
    title?: string;
  }>;
  names?: string[];
}

function withContext<T>(fn: (context: ServiceContext) => Promise<T> | T, dbPathInput?: string): Promise<T> {
  const workspaceRoot = getWorkspaceRoot();
  const dbPath = resolveDbPath(workspaceRoot, dbPathInput);
  ensureProjectDirs(dbPath);
  const db = createDb(dbPath);
  initializeSchema(db);

  const context: ServiceContext = {
    workspaceRoot,
    dbPath,
    artifactsRoot: getArtifactsRoot(dbPath),
    benchmarksDir: resolveBenchmarksDir(workspaceRoot),
    db
  };

  return Promise.resolve(fn(context)).finally(() => {
    db.close();
  });
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resolveRunMode(value: unknown): RunMode {
  return value === "single-task" ? "single-task" : "benchmark-cycle";
}

export function resolveReviewMode(value: unknown): "auto" | "off" {
  return value === "off" || value === false ? "off" : "auto";
}

export function resolveTaskPlan(benchmarks: BenchmarkSuiteRecord[], benchmarkKey: string, runMode: RunMode, taskKey?: string): BenchmarkTaskRecord[] {
  const benchmark = benchmarks.find((entry) => entry.key === benchmarkKey);
  if (!benchmark) {
    throw new Error(`Unknown benchmark: ${benchmarkKey}`);
  }

  if (runMode === "single-task") {
    if (!taskKey) {
      throw new Error("Select a task when using single-task mode.");
    }

    const task = benchmark.tasks.find((entry) => entry.key === taskKey);
    if (!task) {
      throw new Error(`Unknown task '${taskKey}' in benchmark '${benchmarkKey}'.`);
    }
    return [task];
  }

  if (benchmark.tasks.length === 0) {
    throw new Error(`Benchmark '${benchmarkKey}' does not contain any tasks yet.`);
  }

  return benchmark.tasks;
}

/** Runs per setup, 1-5. */
export function normalizeTrials(value: unknown): number {
  return Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
}

/** setups x trials x tasks, trials of one setup kept next to each other. */
export function expandTrialJobs<S, T>(setups: S[], tasks: T[], trials: number): Array<{ setup: S; task: T; trial: number }> {
  return setups.flatMap((setup) => Array.from({ length: normalizeTrials(trials) }, (_, trial) =>
    tasks.map((task) => ({ setup, task, trial: trial + 1 }))).flat());
}

export async function executeBatchPlan<T>(
  jobs: BatchRunJob[],
  executeJob: (job: BatchRunJob) => Promise<T>
): Promise<{ results: T[]; failures: BatchRunFailure[] }> {
  const results: T[] = [];
  const failures: BatchRunFailure[] = [];

  for (const job of jobs) {
    try {
      results.push(await executeJob(job));
    } catch (error: unknown) {
      const failureWithRun = error as { persistedFailureRun?: RunEvaluationResult } | undefined;
      const failure: BatchRunFailure = {
        agentPath: job.agentPath,
        taskKey: job.taskKey,
        setupKey: job.setupKey,
        message: error instanceof Error ? error.message : String(error)
      };
      if (failureWithRun?.persistedFailureRun) {
        failure.run = failureWithRun.persistedFailureRun;
      }
      failures.push(failure);
    }
  }

  return { results, failures };
}

function parseAgentIdentity(agentPath: string): { agentName: string; agentVersion: string } {
  const baseName = path.basename(agentPath, path.extname(agentPath)) || "agent";
  return {
    agentName: baseName,
    agentVersion: /v\d+/i.test(baseName) ? baseName.match(/v\d+/i)![0] : "v1"
  };
}

function resolveFailureScoreProfile(task: BenchmarkTaskRecord): RunRecord["scoreProfile"] {
  return task.sandbox
    ? (task.metadata.evaluator === "trace" ? "trace" : "hybrid")
    : task.metadata.evaluator;
}

function buildFailedRunReportSvg(input: { runKey: string; suiteName: string; agentName: string; message: string }): string {
  const safeMessage = input.message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">",
    "<rect width=\"1280\" height=\"720\" fill=\"#0f172a\"/>",
    "<rect x=\"64\" y=\"64\" width=\"1152\" height=\"592\" rx=\"28\" fill=\"#111827\" stroke=\"#7f1d1d\"/>",
    `<text x=\"96\" y=\"132\" fill=\"#fca5a5\" font-size=\"28\" font-family=\"Manrope, Arial\">agent-bench failed run</text>`,
    `<text x=\"96\" y=\"188\" fill=\"#f3f4f6\" font-size=\"24\" font-family=\"Manrope, Arial\">Run: ${input.runKey}</text>`,
    `<text x=\"96\" y=\"226\" fill=\"#d1d5db\" font-size=\"22\" font-family=\"Manrope, Arial\">Suite: ${input.suiteName}</text>`,
    `<text x=\"96\" y=\"264\" fill=\"#d1d5db\" font-size=\"22\" font-family=\"Manrope, Arial\">Agent: ${input.agentName}</text>`,
    `<text x=\"96\" y=\"328\" fill=\"#fca5a5\" font-size=\"26\" font-family=\"Manrope, Arial\">Failure</text>`,
    `<foreignObject x=\"96\" y=\"352\" width=\"1088\" height=\"240\"><div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"font-family:Manrope,Arial,sans-serif;font-size:22px;line-height:1.5;color:#e5e7eb;white-space:pre-wrap;\">${safeMessage}</div></foreignObject>`,
    "<text x=\"96\" y=\"640\" fill=\"#9ca3af\" font-size=\"20\" font-family=\"Manrope, Arial\">Open the run details and session log, then rerun the failed job once the contract or environment is fixed.</text>",
    "</svg>"
  ].join("");
}

function persistFailedRun(context: ServiceContext, job: BatchRunJob, message: string): RunEvaluationResult {
  const runKey = newRunKey();
  const artifactsPath = path.join(context.artifactsRoot, runKey);
  mkdirSync(artifactsPath, { recursive: true });

  const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
  const benchmark = benchmarks.find((entry) => entry.key === job.benchmarkKey);
  const task = benchmark?.tasks.find((entry) => entry.key === job.taskKey);
  const scoreProfile = task ? resolveFailureScoreProfile(task) : "hybrid";
  const logText = [
    `Run key: ${runKey}`,
    `Benchmark: ${job.benchmarkKey}`,
    `Task: ${job.taskKey}`,
    `Agent: ${job.agentPath}`,
    "Status: failed",
    `Failure reason: ${message}`
  ].join("\n");

  writeFileSync(path.join(artifactsPath, "summary.json"), JSON.stringify({
    runKey,
    benchmarkKey: job.benchmarkKey,
    taskKey: job.taskKey,
    status: "failed",
    executionMode: "failed-before-evaluation",
    reviewMode: "none",
    scoreProfile,
    scoreConfidence: "low",
    objectiveChecks: {
      available: 0,
      passed: 0,
      deterministic: false,
      items: []
    },
    evidence: {
      matchedSignals: [],
      missingSignals: [message],
      artifacts: ["summary.json", "session.log", "report.svg"]
    },
    recommendedNextActions: [
      "Open the failed run log and summary.",
      "Fix the task, runner, or environment contract.",
      "Rerun the failed job only after the blocker is resolved."
    ],
    failureReason: message,
    reportFile: "report.svg"
  }, null, 2), "utf8");
  writeFileSync(path.join(artifactsPath, "session.log"), logText, "utf8");
  writeFileSync(path.join(artifactsPath, "report.svg"), buildFailedRunReportSvg({
    runKey,
    suiteName: `${job.benchmarkKey}/${job.taskKey}`,
    agentName: job.agentName,
    message
  }), "utf8");

  const run = insertRun(context.db, {
    runKey,
    benchmarkKey: job.benchmarkKey,
    taskKey: job.taskKey,
    setupKey: job.setupKey,
    workflowPath: job.agentPath,
    modelId: job.model ?? null,
    agentName: job.agentName,
    agentVersion: job.agentVersion,
    trialIndex: job.trialIndex ?? null,
    suiteName: `${job.benchmarkKey}/${job.taskKey}`,
    status: "failed",
    scores: {
      outcome: 0,
      process: 0,
      review: 0,
      efficiency: 0,
      tests: 0,
      judge: 0,
      performance: 0,
      total: 0
    },
    scoreProfile,
    scoreConfidence: "low",
    failureReason: message,
    latencyMs: 0,
    costUsd: 0,
    durationMs: 0,
    artifactsPath,
    logText
  });

  return {
    run,
    bestBefore: getBestScore(context.db),
    regressed: false
  };
}

async function executeRun(context: ServiceContext, input: {
  benchmarkKey: string;
  taskKey?: string;
  agentPath?: string;
  agentMarkdown?: string;
  agentRunnerCommand?: string;
  model?: string;
  judgeModel?: string;
  providerApiKey?: string;
  review?: "auto" | "off";
  setupKey?: string;
  followupPrompt?: string;
  buildPrompt?: string;
  env?: Record<string, string>;
  trialIndex?: number;
}): Promise<RunEvaluationResult> {
  const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
  const bestBefore = getBestScore(context.db);
  const runInput = await runEvaluationInRuntime({
    runKey: newRunKey(),
    workspaceRoot: context.workspaceRoot,
    agentPath: input.agentPath,
    agentMarkdown: input.agentMarkdown,
    agentRunnerCommand: input.agentRunnerCommand,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    artifactsRoot: context.artifactsRoot,
    benchmarksDir: context.benchmarksDir,
    benchmarks,
    model: input.model,
    judgeModel: input.judgeModel,
    gatewayApiKey: input.providerApiKey,
    review: input.review,
    runnerEnv: input.followupPrompt || input.buildPrompt || input.env ? {
      ...(input.env ?? {}),
      ...(input.followupPrompt ? { AGENT_BENCH_FOLLOWUP_PROMPT: input.followupPrompt } : {}),
      ...(input.buildPrompt ? { AGENT_BENCH_BUILD_PROMPT: input.buildPrompt } : {})
    } : undefined,
    trialIndex: input.trialIndex ?? null,
    setupSnapshot: input.setupKey
      ? { key: input.setupKey, workflowPath: input.agentPath ?? null, modelId: input.model ?? null }
      : null
  });

  const run = insertRun(context.db, runInput);
  return {
    run,
    bestBefore,
    regressed: bestBefore !== null ? run.score < bestBefore : false
  };
}

export function getWorkbenchSnapshot(dbPathInput?: string): Promise<WorkbenchSnapshot> {
  return withContext((context) => {
    const summary = getDashboardSummary(context.db);
    const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
    const agents = listAgentFiles(context.workspaceRoot);
    const runs = listRuns(context.db, DEFAULT_COMPARISON_RUNS);
    let projectSkills: InstalledSkillRecord[] = [];

    try {
      projectSkills = listInstalledProjectSkills(context.workspaceRoot);
    } catch {
      projectSkills = [];
    }

    return {
      summary: {
        ...summary,
        activeBenchmarks: benchmarks.length,
        availableAgents: agents.length
      },
      runs,
      benchmarks,
      agents,
      projectSkills,
      latestLogText: runs[0]?.logText ?? "No runs yet. Start an evaluation from the Test Lab."
    };
  }, dbPathInput);
}

export function inspectAgent(agentPath: string, dbPathInput?: string): Promise<AgentRecord> {
  return withContext((context) => inspectAgentFile(context.workspaceRoot, agentPath), dbPathInput);
}

export function searchSkills(query: string, dbPathInput?: string): Promise<SkillSearchResult[]> {
  return withContext((context) => {
    const normalizedQuery = readBoundedString(query, "query", INPUT_LIMITS.maxSkillQueryLength, true)!;
    return searchSkillsRegistry(normalizedQuery, context.workspaceRoot);
  }, dbPathInput);
}

function normalizeSkillSelection(input: ManageProjectSkillsInput["skills"]): Array<{
  source: string;
  skillName: string;
  registryUrl?: string;
  installs?: number;
  title?: string;
}> {
  const skills = Array.isArray(input) ? input : [];
  return skills.map((skill, index) => ({
    source: readBoundedString(skill?.source, `skills[${index}].source`, INPUT_LIMITS.maxDescriptionLength, true)!,
    skillName: readBoundedString(skill?.skillName, `skills[${index}].skillName`, INPUT_LIMITS.maxTitleLength, true)!,
    registryUrl: readBoundedString(skill?.registryUrl, `skills[${index}].registryUrl`, INPUT_LIMITS.maxDescriptionLength),
    installs: readOptionalNumber(skill?.installs),
    title: readBoundedString(skill?.title, `skills[${index}].title`, INPUT_LIMITS.maxTitleLength)
  }));
}

function normalizeSkillNames(input: ManageProjectSkillsInput["names"]): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((name, index) => readBoundedString(name, `names[${index}]`, INPUT_LIMITS.maxTitleLength, true)!);
}

export function listProjectSkills(dbPathInput?: string): Promise<InstalledSkillRecord[]> {
  return withContext((context) => listInstalledProjectSkills(context.workspaceRoot), dbPathInput);
}

export function installProjectSkillsSelection(input: ManageProjectSkillsInput, dbPathInput?: string): Promise<InstalledSkillRecord[]> {
  return withContext((context) => {
    const skills = normalizeSkillSelection(input.skills);
    if (skills.length === 0) {
      throw new Error("Select at least one skills.sh result to install.");
    }

    return installProjectSkills(context.workspaceRoot, skills);
  }, dbPathInput);
}

export function updateProjectSkillsSelection(input: ManageProjectSkillsInput, dbPathInput?: string): Promise<InstalledSkillRecord[]> {
  return withContext((context) => updateProjectSkills(context.workspaceRoot, normalizeSkillNames(input.names)), dbPathInput);
}

export function removeProjectSkillsSelection(input: ManageProjectSkillsInput, dbPathInput?: string): Promise<InstalledSkillRecord[]> {
  return withContext((context) => removeProjectSkills(context.workspaceRoot, normalizeSkillNames(input.names)), dbPathInput);
}

export function createAgentBundle(input: ManagedAgentBundleInput, dbPathInput?: string): Promise<AgentRecord> {
  return withContext((context) => {
    const name = readBoundedString(input.name, "name", INPUT_LIMITS.maxManagedBundleNameLength);
    const baseAgentPath = readBoundedString(input.baseAgentPath, "baseAgentPath", INPUT_LIMITS.maxKeyLength * 4);
    const agentMarkdown = readBoundedString(input.agentMarkdown, "agentMarkdown", INPUT_LIMITS.maxAgentMarkdownLength);
    const files = Array.isArray(input.files) ? input.files : [];
    const skills = Array.isArray(input.skills) ? input.skills : [];

    if (!baseAgentPath && !agentMarkdown) {
      throw new Error("Provide either baseAgentPath or agentMarkdown.");
    }
    if (files.length > INPUT_LIMITS.maxManagedBundleFiles) {
      throw new Error(`files exceed the ${INPUT_LIMITS.maxManagedBundleFiles}-file limit.`);
    }

    const normalizedFiles = files.map((file, index) => ({
      path: readBoundedString(file?.path, `files[${index}].path`, INPUT_LIMITS.maxManagedBundleFilePathLength, true)!,
      content: readBoundedString(file?.content, `files[${index}].content`, INPUT_LIMITS.maxManagedBundleFileContentLength, true)!
    }));
    const normalizedSkills = skills.map((skill, index) => ({
      source: readBoundedString(skill?.source, `skills[${index}].source`, INPUT_LIMITS.maxDescriptionLength, true)!,
      skillName: readBoundedString(skill?.skillName, `skills[${index}].skillName`, INPUT_LIMITS.maxTitleLength, true)!,
      registryUrl: readBoundedString(skill?.registryUrl, `skills[${index}].registryUrl`, INPUT_LIMITS.maxDescriptionLength),
      installs: readOptionalNumber(skill?.installs),
      title: readBoundedString(skill?.title, `skills[${index}].title`, INPUT_LIMITS.maxTitleLength)
    }));

    return createManagedAgentBundle(context.workspaceRoot, {
      name,
      baseAgentPath,
      agentMarkdown,
      files: normalizedFiles,
      skills: normalizedSkills
    });
  }, dbPathInput);
}

export function createBenchmark(input: CreateBenchmarkInput, dbPathInput?: string): Promise<BenchmarkSuiteRecord | BenchmarkTaskRecord> {
  return withContext((context) => {
    const normalizedKey = sanitizeKey(readBoundedString(input.key, "key", INPUT_LIMITS.maxKeyLength, true)!);
    if (!normalizedKey) {
      throw new Error("Benchmark key must contain letters or numbers.");
    }

    const title = readBoundedString(input.title, "title", INPUT_LIMITS.maxTitleLength, true)!;
    const description = readBoundedString(input.description, "description", INPUT_LIMITS.maxDescriptionLength, true)!;
    const tags = normalizeTagList(input.tags);

    if (input.type === "task") {
      const benchmarkKey = readBoundedString(input.benchmarkKey, "benchmarkKey", INPUT_LIMITS.maxKeyLength, true);
      const expectedOutcome = readBoundedString(input.expectedOutcome, "expectedOutcome", INPUT_LIMITS.maxExpectedOutcomeLength, true);

      if (!benchmarkKey || !expectedOutcome) {
        throw new Error("benchmarkKey and expectedOutcome are required for tasks.");
      }

      return createBenchmarkTaskFile(context.benchmarksDir, {
        benchmarkKey,
        key: normalizedKey,
        title,
        description,
        expectedOutcome,
        whyThisTask: readBoundedString(input.whyThisTask, "whyThisTask", INPUT_LIMITS.maxTaskGuidanceLength),
        inputs: readBoundedString(input.inputs, "inputs", INPUT_LIMITS.maxTaskGuidanceLength),
        deliverableFormat: readBoundedString(input.deliverableFormat, "deliverableFormat", INPUT_LIMITS.maxTaskGuidanceLength),
        successChecks: normalizeStringList(input.successChecks, "successChecks"),
        failureModes: normalizeStringList(input.failureModes, "failureModes"),
        metadata: normalizeTaskMetadataInput({
          resolution: input.resolution,
          interaction: input.interaction,
          evaluator: input.evaluator,
          difficulty: input.difficulty,
          tags,
          requiresIsolation: input.requiresIsolation,
          requiresNetwork: input.requiresNetwork
        })
      });
    }

    return createBenchmarkSuiteFile(context.benchmarksDir, {
      key: normalizedKey,
      title,
      description,
      metadata: normalizeSuiteMetadataInput({
        resolution: input.resolution,
        domain: readBoundedString(input.domain, "domain", INPUT_LIMITS.maxDomainLength) ?? undefined,
        tags
      })
    });
  }, dbPathInput);
}

export function runSingle(input: RunRequestInput, dbPathInput?: string): Promise<RunEvaluationResult> {
  return withContext(async (context) => {
    const benchmarkKey = input.benchmarkKey ?? "repo-maintenance";
    const agentPathInput = readOptionalString(input.agentPath);
    const agentRecord = agentPathInput
      ? inspectAgentFile(context.workspaceRoot, agentPathInput)
      : undefined;
    const agentPath = agentRecord
      ? path.resolve(context.workspaceRoot, agentRecord.path)
      : undefined;
    const agentMarkdown = readBoundedString(input.agentMarkdown, "agentMarkdown", INPUT_LIMITS.maxAgentMarkdownLength);

    if (!agentPath && !agentMarkdown) {
      throw new Error("Provide either agentPath or agentMarkdown.");
    }

    return executeRun(context, {
      benchmarkKey,
      taskKey: readOptionalString(input.taskKey),
      agentPath,
      agentMarkdown,
      agentRunnerCommand: agentRecord?.runnerCommand,
      model: readBoundedString(input.model, "model", INPUT_LIMITS.maxModelLength),
      judgeModel: readBoundedString(input.judgeModel, "judgeModel", INPUT_LIMITS.maxModelLength),
      providerApiKey: readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength),
      review: resolveReviewMode(input.review)
    });
  }, dbPathInput);
}

function agentVersionFor(agentName: string): string {
  return /v\d+/i.test(agentName) ? agentName.match(/v\d+/i)![0] : "v1";
}

function summarizeSetups(setups: ResolvedBatchSetup[], workspaceRoot: string): BatchSetupSummary[] {
  return setups.map((setup) => ({
    setupKey: setup.setupKey,
    agentPath: path.resolve(workspaceRoot, setup.agent.path),
    agentName: setup.agent.name,
    modelLabel: setup.model ?? NO_MODEL_LABEL,
    review: setup.review
  }));
}

export function runBatch(input: BatchRunInput, dbPathInput?: string): Promise<BatchRunResult> {
  return withContext(async (context) => {
    const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
    const benchmarkKey = input.benchmarkKey ?? "repo-maintenance";
    const runMode = resolveRunMode(input.runMode);
    const explicitJobs = Array.isArray(input.jobs) ? input.jobs : [];
    const batchReview = resolveReviewMode(input.review);
    const batchModel = readBoundedString(input.model, "model", INPUT_LIMITS.maxModelLength);
    // One judge across every setup, so a model comparison varies only the subject.
    const judgeModel = readBoundedString(input.judgeModel, "judgeModel", INPUT_LIMITS.maxModelLength);
    const providerApiKey = readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength);

    let jobs: BatchRunJob[];
    let taskPlan: string[];
    let setupSummaries: BatchSetupSummary[];

    if (explicitJobs.length > 0) {
      // Retry path: each job replays one already-planned cell of the matrix and
      // keeps its original setup identity so the rerun lands in the same column.
      //
      // Identity alone is not enough. A setup is also its prompts and its env,
      // and a job that carried only the label would file a plain run under the
      // column of a setup that has a follow-up prompt — a corrupted column that
      // still looks valid. So inherit the behaviour from the setup the label
      // names, when the caller sent the setups along.
      const retrySetups = new Map(
        (input.setups !== undefined ? resolveBatchSetups(context.workspaceRoot, input.setups, batchReview) : [])
          .map((setup) => [setup.setupKey, setup])
      );
      jobs = explicitJobs.map((job) => {
        const resolvedBenchmarkKey = readOptionalString(job.benchmarkKey) ?? benchmarkKey;
        const resolvedTaskKey = readOptionalString(job.taskKey);
        const resolvedAgentPath = readOptionalString(job.agentPath);
        if (!resolvedTaskKey || !resolvedAgentPath) {
          throw new Error("Explicit jobs require taskKey and agentPath.");
        }

        const benchmark = benchmarks.find((entry) => entry.key === resolvedBenchmarkKey);
        const task = benchmark?.tasks.find((entry) => entry.key === resolvedTaskKey);
        if (!benchmark || !task) {
          throw new Error(`Unknown benchmark/task combination: ${resolvedBenchmarkKey}/${resolvedTaskKey}`);
        }

        const agentRecord = inspectAgentFile(context.workspaceRoot, resolvedAgentPath);
        const jobModel = readBoundedString(job.model, "jobs[].model", INPUT_LIMITS.maxModelLength) ?? batchModel;
        const setupKey = readBoundedString(job.setupKey, "jobs[].setupKey", INPUT_LIMITS.maxSetupLabelLength)
          ?? `${agentRecord.name} \u00b7 ${jobModel ?? NO_MODEL_LABEL}`;
        const origin = retrySetups.get(setupKey);
        return {
          benchmarkKey: resolvedBenchmarkKey,
          taskKey: resolvedTaskKey,
          agentPath: path.resolve(context.workspaceRoot, agentRecord.path),
          agentName: agentRecord.name,
          agentVersion: agentVersionFor(agentRecord.name),
          agentRunnerCommand: agentRecord.runnerCommand,
          setupKey,
          model: jobModel,
          review: job.review === "off" ? "off" : job.review === "auto" ? "auto" : batchReview,
          followupPrompt: origin?.followupPrompt,
          buildPrompt: origin?.buildPrompt,
          env: origin?.env
        };
      });
      taskPlan = [...new Set(jobs.map((job) => job.taskKey))];
      setupSummaries = [...new Map(jobs.map((job) => [job.setupKey, {
        setupKey: job.setupKey,
        agentPath: job.agentPath,
        agentName: job.agentName,
        modelLabel: job.model ?? NO_MODEL_LABEL,
        review: job.review
      }])).values()];
      assertBatchCapacity(jobs.length, 1);
    } else {
      const tasks = resolveTaskPlan(benchmarks, benchmarkKey, runMode, readOptionalString(input.taskKey));
      // `setups[]` is the N-way form (agent + its own review model per entry);
      // `agents[] x model` stays supported as the single-model shorthand.
      const setups = input.setups !== undefined
        ? resolveBatchSetups(context.workspaceRoot, input.setups, batchReview)
        : setupsFromAgentList(resolveBatchAgents(context.workspaceRoot, input.agents), batchModel, batchReview);
      if (setups.length === 0) {
        throw new Error("Select at least one agent to run.");
      }

      taskPlan = tasks.map((task) => task.key);
      setupSummaries = summarizeSetups(setups, context.workspaceRoot);
      const trials = normalizeTrials(input.trials);
      assertBatchCapacity(setups.length * trials, tasks.length);
      jobs = expandTrialJobs(setups, tasks, trials).map(({ setup, task, trial }) => ({
        benchmarkKey,
        taskKey: task.key,
        agentPath: path.resolve(context.workspaceRoot, setup.agent.path),
        agentName: setup.agent.name,
        agentVersion: agentVersionFor(setup.agent.name),
        agentRunnerCommand: setup.agent.runnerCommand,
        setupKey: setup.setupKey,
        model: setup.model,
        review: setup.review,
        followupPrompt: setup.followupPrompt,
        buildPrompt: setup.buildPrompt,
        env: setup.env,
        // `runs.trial_index` stayed NULL for every trial of every batch because
        // this was dropped here: the only code path that produces trials.
        trialIndex: trials > 1 ? trial : undefined
      }));
    }

    const { results, failures } = await executeBatchPlan(jobs, async (job) => {
      try {
        return await executeRun(context, {
          benchmarkKey: job.benchmarkKey,
          taskKey: job.taskKey,
          agentPath: job.agentPath,
          agentRunnerCommand: job.agentRunnerCommand,
          model: job.model,
          judgeModel,
          providerApiKey,
          review: job.review,
          setupKey: job.setupKey,
          followupPrompt: job.followupPrompt,
          buildPrompt: job.buildPrompt,
          env: job.env,
          trialIndex: job.trialIndex
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const failedRun = persistFailedRun(context, job, message);
        throw Object.assign(new Error(message), { persistedFailureRun: failedRun });
      }
    });

    const blindCommand = readBoundedString(input.blindReview, "blindReview", INPUT_LIMITS.maxDescriptionLength);
    let blindReviews: BlindReviewSummary[] | undefined;
    if (blindCommand) {
      try {
        blindReviews = await runBlindReviews(context, { command: blindCommand, benchmarks, benchmarkKey, taskPlan, results });
      } catch (error: unknown) {
        // A broken blind review must never cost the batch its report.
        blindReviews = taskPlan.map((taskKey) => ({
          taskKey,
          blindDir: "",
          keyPath: "",
          verdicts: [],
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }

    return {
      runMode,
      benchmarkKey,
      taskPlan,
      setups: setupSummaries,
      queueSize: jobs.length,
      completedRuns: results.length,
      failedRuns: failures.length,
      runs: results,
      failures,
      ...(blindReviews ? { blindReviews } : {})
    };
  }, dbPathInput);
}

/** What the blind reviewer gets besides the code: the task and the hidden-check list (not the trap tests). */
function buildBlindTaskMarkdown(task: BenchmarkTaskRecord): string {
  return [
    `# ${task.title}`,
    "",
    "## Task",
    task.description,
    "",
    ...(task.expectedOutcome ? ["## Expected Outcome", task.expectedOutcome, ""] : []),
    ...(task.successChecks.length > 0 ? ["## Success Checks", ...task.successChecks.map((entry) => `- ${entry}`), ""] : []),
    ...((task.traps ?? []).length > 0
      ? ["## Known risk areas (check each one)", ...(task.traps ?? []).map((trap) => `- ${trap.id}: ${trap.description}`), ""]
      : []),
    "Each folder next to this file (A, B, C, ...) is one independent build of this task.",
    "Write ranking.json into this folder: [{\"letter\": \"A\", \"rank\": 1, \"notes\": \"...\"}, ...] (rank 1 = best).",
    ""
  ].join("\n");
}

const BLIND_ENV_PASSTHROUGH = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "AGENT_BENCH_BLIND_MODEL"];

/** `usage.json` the reviewer writes next to (never inside) the blind folder. */
export function readBlindUsageFile(rootDir: string): BlindReviewUsage | null {
  const file = path.join(rootDir, "usage.json");
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    return {
      inputTokens: num(raw.inputTokens),
      outputTokens: num(raw.outputTokens),
      costUsd: num(raw.costUsd),
      durationMs: num(raw.durationMs)
    };
  } catch {
    return null;
  }
}

/** Stores the reviewer's spend with the batch so later exports can show it; never fails the batch. */
function persistBlindUsage(context: ServiceContext, rootDir: string, taskKey: string, usage: BlindReviewUsage | null, runKeys: string[]): void {
  try {
    saveBlindReviewUsage(context.db, { reviewKey: path.basename(rootDir), taskKey, usage, runKeys });
  } catch {
    // Reporting only; the ranks are already stored.
  }
}

/**
 * Imports an earlier blind review folder (`blind-<stamp>-<task>/` with
 * blind-key.json and usage.json) so runs reviewed before usage was persisted
 * get their reviewer cost in exports. Returns the linked run count.
 */
export function importBlindReviewDir(rootDirInput: string, dbPathInput?: string): Promise<{ reviewKey: string; runKeys: string[]; usage: BlindReviewUsage | null }> {
  return withContext((context) => {
    const rootDir = path.resolve(rootDirInput);
    const keyPath = path.join(rootDir, "blind-key.json");
    if (!existsSync(keyPath)) throw new Error(`No blind-key.json in ${rootDir}.`);
    const entries = JSON.parse(readFileSync(keyPath, "utf8")) as Array<{ runKey?: unknown }>;
    const runKeys = entries.map((entry) => entry.runKey).filter((key): key is string => typeof key === "string" && Boolean(getRunByKey(context.db, key)));
    const usage = readBlindUsageFile(rootDir);
    const taskMatch = /^blind-.*?Z-(.+)$/.exec(path.basename(rootDir));
    saveBlindReviewUsage(context.db, { reviewKey: path.basename(rootDir), taskKey: taskMatch?.[1] ?? null, usage, runKeys });
    return { reviewKey: path.basename(rootDir), runKeys, usage };
  }, dbPathInput);
}

/**
 * After every run of a batch: anonymise each completed workspace per task, run
 * the reviewer once, and store the ranks on the runs. A failing reviewer never
 * fails the batch; the error is reported instead.
 */
async function runBlindReviews(context: ServiceContext, input: {
  command: string;
  benchmarks: BenchmarkSuiteRecord[];
  benchmarkKey: string;
  taskPlan: string[];
  results: RunEvaluationResult[];
}): Promise<BlindReviewSummary[]> {
  const benchmark = input.benchmarks.find((entry) => entry.key === input.benchmarkKey);
  const summaries: BlindReviewSummary[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const configuredTimeout = Number(process.env.AGENT_BENCH_BLIND_TIMEOUT_MS);
  const timeoutMs = configuredTimeout > 0 ? configuredTimeout : 60 * 60 * 1000;

  for (const taskKey of input.taskPlan) {
    const task = benchmark?.tasks.find((entry) => entry.key === taskKey);
    const runs = input.results
      .filter((result) => result.run.taskKey === taskKey && result.run.status === "completed")
      .map((result) => ({
        setupKey: result.run.setupKey ?? result.run.agentName,
        runKey: result.run.runKey,
        workspaceDir: path.join(result.run.artifactsPath, "workspace")
      }));
    if (!task || runs.length === 0) continue;

    // Laying out the folders is its own failure case (a locked file on Windows, a
    // dangling link). It used to sit outside the try, so one task losing its copy
    // threw away the whole batch's report, including tasks already reviewed.
    let prepared: PreparedBlindReview;
    try {
      prepared = prepareBlindReview({
        rootDir: path.join(context.artifactsRoot, `blind-${stamp}-${taskKey}`),
        runs,
        taskMarkdown: buildBlindTaskMarkdown(task)
      });
    } catch (error: unknown) {
      summaries.push({
        taskKey,
        blindDir: "",
        keyPath: "",
        verdicts: [],
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const summary: BlindReviewSummary = { taskKey, blindDir: prepared.blindDir, keyPath: prepared.keyPath, verdicts: [] };
    try {
      const env: Record<string, string> = {
        AGENT_BENCH_BLIND_DIR: prepared.blindDir,
        AGENT_BENCH_TASK_FILE: prepared.taskFile,
        AGENT_BENCH_TRAPS: (task.traps ?? []).map((trap) => `${trap.id}: ${trap.description}`).join("\n")
      };
      for (const key of BLIND_ENV_PASSTHROUGH) {
        const value = process.env[key];
        if (value) env[key] = value;
      }
      const reviewer = await runSandboxedCommand({
        command: input.command,
        cwd: context.workspaceRoot,
        workspaceDir: prepared.blindDir,
        artifactsDir: prepared.rootDir,
        timeoutMs,
        allowNetwork: true,
        label: "blind-reviewer",
        provider: "process",
        killLeftovers: true,
        env
      });
      writeFileSync(path.join(prepared.rootDir, "blind-reviewer.log"), `exit ${reviewer.exitCode}\n\n${reviewer.stdout}\n\n${reviewer.stderr}`);
      summary.usage = readBlindUsageFile(prepared.rootDir) ?? undefined;
      summary.verdicts = mapBlindRanking(prepared.entries, readBlindRankingFile(prepared.blindDir));
      for (const verdict of summary.verdicts) {
        setBlindReview(context.db, verdict.runKey, verdict.rank, verdict.notes);
      }
      writeFileSync(path.join(prepared.rootDir, "blind-result.json"), JSON.stringify(summary.verdicts, null, 2));
    } catch (error: unknown) {
      summary.error = error instanceof Error ? error.message : String(error);
      summary.usage ??= readBlindUsageFile(prepared.rootDir) ?? undefined;
    }
    persistBlindUsage(context, prepared.rootDir, taskKey, summary.usage ?? null, prepared.entries.map((entry) => entry.runKey));
    summaries.push(summary);
  }
  return summaries;
}

interface ComparisonRequestInput {
  benchmarkKey?: unknown;
  taskKey?: unknown;
  setupKeys?: unknown;
  limit?: unknown;
}

interface ComparisonExportRequestInput extends ComparisonRequestInput {
  format?: unknown;
  title?: unknown;
  shareUrl?: unknown;
  generatedAt?: unknown;
  /** Blind reviewer usage of the batch being reported (CLI); numbers only. */
  blindReviewer?: unknown;
}

export interface ComparisonExportResult {
  format: ComparisonExportFormat;
  fileName: string;
  contentType: string;
  body: string;
  setupCount: number;
  runCount: number;
}

const MAX_COMPARISON_RUNS = 2000;

/**
 * How many recent runs a comparison covers by default. The workbench loads the
 * same window, so the board on screen and the report its Copy/Download button
 * produces are built from the same rows. They used to differ (100 against 200),
 * which gave the exported artefact a different `Runs:` count and different
 * averages than the view it came from.
 */
export const DEFAULT_COMPARISON_RUNS = 200;

function resolveComparisonLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COMPARISON_RUNS;
  return Math.min(Math.floor(parsed), MAX_COMPARISON_RUNS);
}

function normalizeSetupKeyFilter(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const keys = raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (keys.length > INPUT_LIMITS.maxSetupsPerBatch * 4) {
    throw new Error("Too many setupKeys in the comparison filter.");
  }
  return keys.length > 0 ? keys : undefined;
}

function buildMatrixForRequest(context: ServiceContext, input: ComparisonRequestInput): {
  matrix: ComparisonMatrix;
  benchmarkKey?: string;
  taskKey?: string;
} {
  const benchmarkKey = readBoundedString(input.benchmarkKey, "benchmarkKey", INPUT_LIMITS.maxKeyLength);
  const taskKey = readBoundedString(input.taskKey, "taskKey", INPUT_LIMITS.maxKeyLength);
  const runs = listRuns(context.db, resolveComparisonLimit(input.limit));

  return {
    matrix: buildComparisonMatrix(runs, {
      benchmarkKey,
      taskKey,
      setupKeys: normalizeSetupKeyFilter(input.setupKeys)
    }),
    benchmarkKey,
    taskKey
  };
}

/** Aggregated comparison over persisted runs. Reads SQLite only — zero tokens. */
export function getComparisonMatrix(input: ComparisonRequestInput = {}, dbPathInput?: string): Promise<ComparisonMatrix> {
  return withContext((context) => buildMatrixForRequest(context, input).matrix, dbPathInput);
}

/**
 * Renders the comparison into a shareable artefact (markdown, csv, json, or a
 * self-contained html report). Nothing here calls a model, so re-exporting a
 * comparison as often as you like stays free.
 */
function readBlindUsageInput(value: unknown): BlindReviewUsage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const num = (entry: unknown) => (typeof entry === "number" && Number.isFinite(entry) && entry >= 0 ? entry : 0);
  return { inputTokens: num(raw.inputTokens), outputTokens: num(raw.outputTokens), costUsd: num(raw.costUsd), durationMs: num(raw.durationMs) };
}

export function exportComparison(input: ComparisonExportRequestInput = {}, dbPathInput?: string): Promise<ComparisonExportResult> {
  return withContext((context) => {
    const format: ComparisonExportFormat = isComparisonExportFormat(input.format) ? input.format : "md";
    if (input.format !== undefined && !isComparisonExportFormat(input.format)) {
      throw new Error("format must be one of json, md, csv, html.");
    }

    const { matrix, benchmarkKey, taskKey } = buildMatrixForRequest(context, input);
    const meta: ComparisonExportMeta = {
      generatedAt: readBoundedString(input.generatedAt, "generatedAt", 40) ?? new Date().toISOString(),
      toolVersion: TOOL_VERSION,
      benchmarkKey: benchmarkKey ?? null,
      taskKey: taskKey ?? null,
      title: readBoundedString(input.title, "title", INPUT_LIMITS.maxTitleLength),
      shareUrl: readBoundedString(input.shareUrl, "shareUrl", INPUT_LIMITS.maxDescriptionLength) ?? null,
      // The live batch passes its reviewer usage; otherwise read what was stored with the batch.
      blindReviewer: readBlindUsageInput(input.blindReviewer) ?? sumBlindReviewUsageForRuns(context.db, matrix.runKeys ?? [])
    };

    return {
      format,
      fileName: comparisonExportFileName(format, meta),
      contentType: contentTypeForFormat(format),
      body: renderComparison(matrix, meta, format),
      setupCount: matrix.setups.length,
      runCount: matrix.totals.runs
    };
  }, dbPathInput);
}

export function getRunResult(runKey: string, dbPathInput?: string): Promise<RunResultPayload> {
  return withContext((context) => {
    const run = getRunByKey(context.db, runKey);
    if (!run) {
      throw new Error("Run not found.");
    }

    const summaryPath = path.join(run.artifactsPath, "summary.json");
    const summary = existsSync(summaryPath)
      ? JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>
      : null;
    const reportFile = typeof summary?.reportFile === "string"
      ? summary.reportFile
      : typeof summary?.screenshotFile === "string"
        ? summary.screenshotFile
        : "report.svg";

    return {
      run,
      summary,
      reportUrl: `/api/artifacts/${run.runKey}/${reportFile}`
    };
  }, dbPathInput);
}

export function deleteRun(runKey: string, dbPathInput?: string): Promise<{ ok: true; runKey: string }> {
  return withContext((context) => {
    const run = getRunByKey(context.db, runKey);
    if (!run) {
      throw new Error("Run not found.");
    }

    const deleted = deleteRunByKey(context.db, runKey);
    if (!deleted) {
      throw new Error("Failed to delete run.");
    }

    rmSync(run.artifactsPath, { recursive: true, force: true });
    return { ok: true, runKey };
  }, dbPathInput);
}

export function readArtifact(runKey: string, fileName: string, dbPathInput?: string): Promise<{ body: Buffer; contentType: string }> {
  return withContext((context) => {
    const run = getRunByKey(context.db, runKey);
    if (!run) {
      throw new Error("Run not found.");
    }

    const safeName = path.basename(fileName);
    const requestedPath = path.join(run.artifactsPath, safeName);
    const artifactPath = !existsSync(requestedPath) && safeName === "report.svg"
      ? path.join(run.artifactsPath, "screenshot.svg")
      : requestedPath;
    if (!existsSync(artifactPath)) {
      throw new Error("Artifact not found.");
    }

    const body = readFileSync(artifactPath);
    const contentType = safeName.endsWith(".svg")
      ? "image/svg+xml"
      : safeName.endsWith(".png")
        ? "image/png"
        : safeName.endsWith(".webm")
          ? "video/webm"
          : safeName.endsWith(".json")
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8";

    return { body, contentType };
  }, dbPathInput);
}
