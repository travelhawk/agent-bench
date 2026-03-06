import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { inspectAgentFile, listAgentFiles } from "../agents/files";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "../core/runner";
import { createDb, initializeSchema } from "../db/schema";
import { deleteRunByKey, getBestScore, getDashboardSummary, getRunByKey, insertRun, listRuns } from "../db/store";
import {
  AgentRecord,
  BenchmarkSuiteRecord,
  BenchmarkTaskRecord,
  RunEvaluationResult,
  RunMode,
  RunRecord,
  RunResultPayload,
  WorkbenchSnapshot
} from "../types";
import { ensureProjectDirs, getArtifactsRoot, getWorkspaceRoot, resolveBenchmarksDir, resolveDbPath } from "./config";

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
    const normalizedKey = input.key.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (!normalizedKey) {
      throw new Error("Benchmark key must contain letters or numbers.");
    }

    if (input.type === "task") {
      if (!input.benchmarkKey || !input.expectedOutcome) {
        throw new Error("benchmarkKey and expectedOutcome are required for tasks.");
      }

      return createBenchmarkTaskFile(context.benchmarksDir, {
        benchmarkKey: input.benchmarkKey,
        key: normalizedKey,
        title: input.title,
        description: input.description,
        expectedOutcome: input.expectedOutcome
      });
    }

    return createBenchmarkSuiteFile(context.benchmarksDir, {
      key: normalizedKey,
      title: input.title,
      description: input.description
    });
  }, dbPathInput);
}

export function runSingle(input: RunRequestInput, dbPathInput?: string): Promise<RunEvaluationResult> {
  return withContext(async (context) => {
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
    const agentPath = readOptionalString(input.agentPath)
      ? path.resolve(context.workspaceRoot, String(input.agentPath).trim())
      : undefined;
    const agentMarkdown = readOptionalString(input.agentMarkdown);

    if (!agentPath && !agentMarkdown) {
      throw new Error("Provide either agentPath or agentMarkdown.");
    }

    return executeRun(context, {
      benchmarkKey,
      taskKey: readOptionalString(input.taskKey),
      agentPath,
      agentMarkdown,
      model: readOptionalString(input.model),
      providerApiKey: readOptionalString(input.providerApiKey)
    });
  }, dbPathInput);
}

export function runBatch(input: BatchRunInput, dbPathInput?: string): Promise<{
  runMode: RunMode;
  benchmarkKey: string;
  taskPlan: string[];
  queueSize: number;
  runs: RunEvaluationResult[];
}> {
  return withContext(async (context) => {
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
    const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
    const runMode = resolveRunMode(input.runMode);
    const tasks = resolveTaskPlan(benchmarks, benchmarkKey, runMode, readOptionalString(input.taskKey));
    const agentPaths = input.agents
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => path.resolve(context.workspaceRoot, value.trim()));

    if (agentPaths.length === 0) {
      throw new Error("Select at least one agent to run.");
    }

    const runs: RunEvaluationResult[] = [];

    for (const agentPath of agentPaths) {
      for (const task of tasks) {
        runs.push(await executeRun(context, {
          benchmarkKey,
          taskKey: task.key,
          agentPath,
          model: readOptionalString(input.model),
          providerApiKey: readOptionalString(input.providerApiKey)
        }));
      }
    }

    return {
      runMode,
      benchmarkKey,
      taskPlan: tasks.map((task) => task.key),
      queueSize: runs.length,
      runs
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
