import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { assertBatchCapacity, INPUT_LIMITS, normalizeStringList, normalizeTagList, readBoundedString, resolveBatchAgents, sanitizeKey } from "./validation";

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
  providerApiKey?: string;
}

interface BatchRunInput {
  benchmarkKey?: string;
  taskKey?: string;
  model?: string;
  providerApiKey?: string;
  runMode?: RunMode;
  agents: string[];
  jobs?: Array<{
    benchmarkKey?: string;
    taskKey?: string;
    agentPath?: string;
  }>;
}

interface BatchRunJob {
  benchmarkKey: string;
  taskKey: string;
  agentPath: string;
  agentName: string;
  agentVersion: string;
  agentRunnerCommand?: string;
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
      const failureWithRun = error as { persistedFailureRun?: RunEvaluationResult } | undefined;
      const failure: BatchRunFailure = {
        agentPath: job.agentPath,
        taskKey: job.taskKey,
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
    agentName: job.agentName,
    agentVersion: job.agentVersion,
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
  providerApiKey?: string;
}): Promise<RunEvaluationResult> {
  const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
  const bestBefore = getBestScore(context.db);
  const runInput = await runEvaluationInRuntime({
    runKey: newRunKey(),
    agentPath: input.agentPath,
    agentMarkdown: input.agentMarkdown,
    agentRunnerCommand: input.agentRunnerCommand,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    artifactsRoot: context.artifactsRoot,
    benchmarksDir: context.benchmarksDir,
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
      latestLogText: runs[0]?.logText ?? "No runs yet. Start an evaluation from the Test Lab."
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
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
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
      providerApiKey: readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength)
    });
  }, dbPathInput);
}

export function runBatch(input: BatchRunInput, dbPathInput?: string): Promise<BatchRunResult> {
  return withContext(async (context) => {
    const benchmarks = listBenchmarkSuitesFromFiles(context.benchmarksDir);
    const benchmarkKey = input.benchmarkKey ?? "core-engineering";
    const runMode = resolveRunMode(input.runMode);
    const explicitJobs = Array.isArray(input.jobs) ? input.jobs : [];

    let jobs: BatchRunJob[];
    let taskPlan: string[];

    if (explicitJobs.length > 0) {
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
        return {
          benchmarkKey: resolvedBenchmarkKey,
          taskKey: resolvedTaskKey,
          agentPath: path.resolve(context.workspaceRoot, agentRecord.path),
          agentName: agentRecord.name,
          agentVersion: /v\\d+/i.test(agentRecord.name) ? agentRecord.name.match(/v\\d+/i)![0] : "v1",
          agentRunnerCommand: agentRecord.runnerCommand
        };
      });
      taskPlan = [...new Set(jobs.map((job) => job.taskKey))];
      assertBatchCapacity(jobs.length, 1);
    } else {
      const tasks = resolveTaskPlan(benchmarks, benchmarkKey, runMode, readOptionalString(input.taskKey));
      const agents = resolveBatchAgents(context.workspaceRoot, input.agents);
      if (agents.length === 0) {
        throw new Error("Select at least one agent to run.");
      }

      assertBatchCapacity(agents.length, tasks.length);
      taskPlan = tasks.map((task) => task.key);
      jobs = agents.flatMap((agent) => tasks.map((task) => ({
        benchmarkKey,
        taskKey: task.key,
        agentPath: path.resolve(context.workspaceRoot, agent.path),
        agentName: agent.name,
        agentVersion: /v\\d+/i.test(agent.name) ? agent.name.match(/v\\d+/i)![0] : "v1",
        agentRunnerCommand: agent.runnerCommand
      })));
    }

    const { results, failures } = await executeBatchPlan(jobs, async (job) => {
      try {
        return await executeRun(context, {
          benchmarkKey: job.benchmarkKey,
          taskKey: job.taskKey,
          agentPath: job.agentPath,
          agentRunnerCommand: job.agentRunnerCommand,
          model: readBoundedString(input.model, "model", INPUT_LIMITS.maxModelLength),
          providerApiKey: readBoundedString(input.providerApiKey, "providerApiKey", INPUT_LIMITS.maxApiKeyLength)
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const failedRun = persistFailedRun(context, job, message);
        throw Object.assign(new Error(message), { persistedFailureRun: failedRun });
      }
    });

    return {
      runMode,
      benchmarkKey,
      taskPlan,
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
      : safeName.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8";

    return { body, contentType };
  }, dbPathInput);
}
