import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { inspectAgentFile, listAgentFiles } from "../agents/files";
import { normalizeSuiteMetadataInput, normalizeTaskMetadataInput } from "../benchmarks/metadata";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "../core/runner";
import { createDb, initializeSchema } from "../db/schema";
import { deleteRunByKey, getBestScore, getDashboardSummary, getRunByKey, insertRun, listRuns } from "../db/store";
import {
  AgentRecord,
  BatchRunFailure,
  BatchRunResult,
  BenchmarkSuiteRecord,
  BenchmarkTaskRecord,
  RunEvaluationResult,
  RunMode,
  RunRecord,
  RunResultPayload,
  WorkbenchSnapshot
} from "../types";
import { ensureProjectDirs, getArtifactsRoot, getWorkspaceRoot, resolveBenchmarksDir, resolveDbPath } from "./config";
import { assertBatchCapacity, INPUT_LIMITS, normalizeTagList, readBoundedString, resolveBatchAgents, sanitizeKey } from "./validation";

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
  providerApiKey?: string;
}

interface BatchRunInput {
  benchmarkKey?: string;
  taskKey?: string;
  model?: string;
  providerApiKey?: string;
  runMode?: RunMode;
  agents: string[];
}

interface BatchRunJob {
  benchmarkKey: string;
  taskKey: string;
  agentPath: string;
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

export function resolveRunMode(value: unknown): RunMode {
  return value === "single-task" ? "single-task" : "benchmark-cycle";
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
      failures.push({
        agentPath: job.agentPath,
        taskKey: job.taskKey,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { results, failures };
}

async function executeRun(context: ServiceContext, input: {
  benchmarkKey: string;
  taskKey?: string;
  agentPath?: string;
  agentMarkdown?: string;
  model?: string;
  providerApiKey?: string;
}): Promise<RunEvaluationResult> {
  const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
  const bestBefore = getBestScore(context.db);
  const runInput = await runEvaluationInRuntime({
    runKey: newRunKey(),
    agentPath: input.agentPath,
    agentMarkdown: input.agentMarkdown,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    artifactsRoot: context.artifactsRoot,
    benchmarks,
    model: input.model,
    gatewayApiKey: input.providerApiKey
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
    const runs = listRuns(context.db, 100);

    return {
      summary: {
        ...summary,
        activeBenchmarks: benchmarks.length,
        availableAgents: agents.length
      },
      runs,
      benchmarks,
      agents,
      latestLogText: runs[0]?.logText ?? "No runs yet. Execute `agent-bench run` first."
    };
  }, dbPathInput);
}

export function inspectAgent(agentPath: string, dbPathInput?: string): Promise<AgentRecord> {
  return withContext((context) => inspectAgentFile(context.workspaceRoot, agentPath), dbPathInput);
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
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
    const agentPathInput = readOptionalString(input.agentPath);
    const agentPath = agentPathInput
      ? path.resolve(context.workspaceRoot, inspectAgentFile(context.workspaceRoot, agentPathInput).path)
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
      model: readBoundedString(input.model, "model", INPUT_LIMITS.maxModelLength),
      providerApiKey: readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength)
    });
  }, dbPathInput);
}

export function runBatch(input: BatchRunInput, dbPathInput?: string): Promise<BatchRunResult> {
  return withContext(async (context) => {
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
    const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
    const runMode = resolveRunMode(input.runMode);
    const tasks = resolveTaskPlan(benchmarks, benchmarkKey, runMode, readOptionalString(input.taskKey));
    const agents = resolveBatchAgents(context.workspaceRoot, input.agents);
    const agentPaths = agents.map((agent) => path.resolve(context.workspaceRoot, agent.path));

    if (agentPaths.length === 0) {
      throw new Error("Select at least one agent to run.");
    }

    assertBatchCapacity(agentPaths.length, tasks.length);

    const jobs = agentPaths.flatMap((agentPath) => tasks.map((task) => ({
      benchmarkKey,
      taskKey: task.key,
      agentPath
    })));
    const { results, failures } = await executeBatchPlan(jobs, (job) => executeRun(context, {
      benchmarkKey: job.benchmarkKey,
      taskKey: job.taskKey,
      agentPath: job.agentPath,
      model: readBoundedString(input.model, "model", INPUT_LIMITS.maxModelLength),
      providerApiKey: readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength)
    }));

    return {
      runMode,
      benchmarkKey,
      taskPlan: tasks.map((task) => task.key),
      queueSize: jobs.length,
      completedRuns: results.length,
      failedRuns: failures.length,
      runs: results,
      failures
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

    return {
      run,
      summary,
      screenshotUrl: `/api/artifacts/${run.runKey}/screenshot.svg`
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
    const artifactPath = path.join(run.artifactsPath, safeName);
    if (!existsSync(artifactPath)) {
      throw new Error("Artifact not found.");
    }

    const body = readFileSync(artifactPath);
    const contentType = safeName.endsWith(".svg")
      ? "image/svg+xml"
      : safeName.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8";

    return { body, contentType };
  }, dbPathInput);
}
