import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { inspectAgentFile, listAgentFiles } from "../agents/files";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "../core/runner";
import { createDb } from "../db/schema";
import { deleteRunByKey, getBestScore, getDashboardSummary, getRunByKey, insertRun, listRuns } from "../db/store";
import { BenchmarkSuiteRecord, RunRecord } from "../types";

type RunMode = "single-task" | "benchmark-cycle";

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveRunMode(value: unknown): RunMode {
  return value === "single-task" ? "single-task" : "benchmark-cycle";
}

function resolveTaskPlan(benchmarks: BenchmarkSuiteRecord[], benchmarkKey: string, runMode: RunMode, taskKey?: string): string[] {
  const benchmark = benchmarks.find((entry) => entry.key === benchmarkKey);
  if (!benchmark) {
    throw new Error(`Unknown benchmark: ${benchmarkKey}`);
  }

  if (runMode === "single-task") {
    if (!taskKey) {
      throw new Error("Select a task when using single-task mode.");
    }
    if (!benchmark.tasks.some((task) => task.key === taskKey)) {
      throw new Error(`Unknown task '${taskKey}' in benchmark '${benchmarkKey}'.`);
    }
    return [taskKey];
  }

  if (benchmark.tasks.length === 0) {
    throw new Error(`Benchmark '${benchmarkKey}' does not contain any tasks yet.`);
  }

  return benchmark.tasks.map((task) => task.key);
}

async function executeRun(input: {
  artifactsRoot: string;
  benchmarks: BenchmarkSuiteRecord[];
  benchmarkKey: string;
  taskKey?: string;
  agentPath?: string;
  agentMarkdown?: string;
  model?: string;
  gatewayApiKey?: string;
  db: ReturnType<typeof createDb>;
}): Promise<{ run: RunRecord; bestBefore: number | null; regressed: boolean }> {
  const bestBefore = getBestScore(input.db);
  const runInput = await runEvaluationInRuntime({
    runKey: newRunKey(),
    agentPath: input.agentPath,
    agentMarkdown: input.agentMarkdown,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    artifactsRoot: input.artifactsRoot,
    benchmarks: input.benchmarks,
    model: input.model,
    gatewayApiKey: input.gatewayApiKey
  });
  const inserted = insertRun(input.db, runInput);

  return {
    run: inserted,
    bestBefore,
    regressed: bestBefore !== null ? inserted.score < bestBefore : false
  };
}

export function startUi(dbPath: string, port: number): void {
  const app = express();
  const db = createDb(dbPath);
  const workspaceRoot = process.cwd();
  const artifactsRoot = path.join(path.dirname(dbPath), "artifacts");
  const benchmarksDir = path.join(workspaceRoot, "benchmarks");

  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(workspaceRoot, "src", "ui", "public")));
  app.use("/artifacts", express.static(artifactsRoot));

  app.get("/api/summary", (_req, res) => {
    const summary = getDashboardSummary(db);
    const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
    const agents = listAgentFiles(workspaceRoot);

    res.json({
      ...summary,
      activeBenchmarks: benchmarks.length,
      availableAgents: agents.length
    });
  });

  app.get("/api/runs", (req, res) => {
    const limitRaw = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 10;
    res.json(listRuns(db, limit));
  });

  app.get("/api/benchmarks", (_req, res) => {
    res.json(listBenchmarkSuitesFromFiles(benchmarksDir));
  });

  app.get("/api/agents", (_req, res) => {
    res.json({
      agents: listAgentFiles(workspaceRoot)
    });
  });

  app.post("/api/agents/inspect", (req, res) => {
    const agentPath = readOptionalString(req.body?.agentPath);
    if (!agentPath) {
      res.status(400).json({ error: "agentPath is required." });
      return;
    }

    try {
      res.json({
        agent: inspectAgentFile(workspaceRoot, agentPath)
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/benchmarks", (req, res) => {
    const keyRaw = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const descriptionRaw = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const expectedOutcomeRaw = typeof req.body?.expectedOutcome === "string" ? req.body.expectedOutcome.trim() : "";
    const benchmarkKeyRaw = typeof req.body?.benchmarkKey === "string" ? req.body.benchmarkKey.trim() : "";
    const typeRaw = typeof req.body?.type === "string" ? req.body.type.trim().toLowerCase() : "suite";

    if (!keyRaw || !titleRaw || !descriptionRaw) {
      res.status(400).json({ error: "key, title, and description are required." });
      return;
    }
    if (typeRaw === "task" && (!benchmarkKeyRaw || !expectedOutcomeRaw)) {
      res.status(400).json({ error: "benchmarkKey and expectedOutcome are required for tasks." });
      return;
    }

    const normalizedKey = keyRaw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    if (!normalizedKey) {
      res.status(400).json({ error: "Benchmark key must contain letters or numbers." });
      return;
    }

    try {
      const created = typeRaw === "task"
        ? createBenchmarkTaskFile(benchmarksDir, {
          benchmarkKey: benchmarkKeyRaw,
          key: normalizedKey,
          title: titleRaw,
          description: descriptionRaw,
          expectedOutcome: expectedOutcomeRaw
        })
        : createBenchmarkSuiteFile(benchmarksDir, {
          key: normalizedKey,
          title: titleRaw,
          description: descriptionRaw
        });
      res.status(201).json(created);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        res.status(409).json({ error: `Benchmark key already exists: ${normalizedKey}` });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/run/:runKey/result", (req, res) => {
    const run = getRunByKey(db, req.params.runKey);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }

    try {
      const summaryPath = path.join(run.artifactsPath, "summary.json");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>;
      res.json({
        run,
        summary,
        screenshotUrl: `/artifacts/${run.runKey}/screenshot.svg`
      });
    } catch {
      res.json({
        run,
        summary: null,
        screenshotUrl: `/artifacts/${run.runKey}/screenshot.svg`
      });
    }
  });

  app.get("/api/logs/latest", (_req, res) => {
    const latest = listRuns(db, 1)[0];
    res.type("text/plain").send(latest?.logText ?? "No runs yet. Execute `agent-bench run` first.");
  });

  app.post("/api/run", async (req, res) => {
    const benchmarkKey = readOptionalString(req.body?.benchmarkKey) ?? "core-engineering";
    const taskKey = readOptionalString(req.body?.taskKey);
    const agentPath = readOptionalString(req.body?.agentPath)
      ? path.resolve(workspaceRoot, String(req.body.agentPath).trim())
      : undefined;
    const agentMarkdown = readOptionalString(req.body?.agentMarkdown);
    const model = readOptionalString(req.body?.model);
    const gatewayApiKey = readOptionalString(req.body?.providerApiKey);

    if (!agentPath && !agentMarkdown) {
      res.status(400).json({ error: "Provide either agentPath or agentMarkdown." });
      return;
    }

    try {
      const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
      const result = await executeRun({
        artifactsRoot,
        benchmarks,
        benchmarkKey,
        taskKey,
        agentPath,
        agentMarkdown,
        model,
        gatewayApiKey,
        db
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/run/batch", async (req, res) => {
    const benchmarkKey = readOptionalString(req.body?.benchmarkKey) ?? "core-engineering";
    const taskKey = readOptionalString(req.body?.taskKey);
    const model = readOptionalString(req.body?.model);
    const gatewayApiKey = readOptionalString(req.body?.providerApiKey);
    const runMode = resolveRunMode(req.body?.runMode);
    const agentPaths = Array.isArray(req.body?.agents)
      ? req.body.agents
        .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value: string) => path.resolve(workspaceRoot, value.trim()))
      : [];

    if (agentPaths.length === 0) {
      res.status(400).json({ error: "Select at least one agent to run." });
      return;
    }

    try {
      const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
      const taskPlan = resolveTaskPlan(benchmarks, benchmarkKey, runMode, taskKey);
      const results: Array<{ run: RunRecord; bestBefore: number | null; regressed: boolean }> = [];

      for (const agentPath of agentPaths) {
        for (const plannedTaskKey of taskPlan) {
          results.push(await executeRun({
            artifactsRoot,
            benchmarks,
            benchmarkKey,
            taskKey: plannedTaskKey,
            agentPath,
            model,
            gatewayApiKey,
            db
          }));
        }
      }

      res.json({
        runMode,
        benchmarkKey,
        taskPlan,
        queueSize: results.length,
        runs: results
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/run/:runKey", (req, res) => {
    const run = getRunByKey(db, req.params.runKey);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }

    const deleted = deleteRunByKey(db, req.params.runKey);
    if (!deleted) {
      res.status(500).json({ error: "Failed to delete run." });
      return;
    }

    rmSync(run.artifactsPath, { recursive: true, force: true });
    res.json({ ok: true, runKey: req.params.runKey });
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-bench ui started at http://localhost:${port}`);
  });
}
