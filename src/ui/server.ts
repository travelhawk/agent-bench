import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { createDb } from "../db/schema";
import { newRunKey, runEvaluationInRuntime } from "../core/runner";
import { deleteRunByKey, getBestScore, getDashboardSummary, getRunByKey, insertRun, listRuns } from "../db/store";

export function startUi(dbPath: string, port: number): void {
  const app = express();
  const db = createDb(dbPath);
  const artifactsRoot = path.join(path.dirname(dbPath), "artifacts");
  const benchmarksDir = path.join(process.cwd(), "benchmarks");

  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(process.cwd(), "src", "ui", "public")));
  app.use("/artifacts", express.static(artifactsRoot));

  app.get("/api/summary", (_req, res) => {
    const summary = getDashboardSummary(db);
    const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
    res.json({
      ...summary,
      activeBenchmarks: benchmarks.length
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
    const benchmarkKey = typeof req.body?.benchmarkKey === "string" && req.body.benchmarkKey.trim()
      ? req.body.benchmarkKey.trim()
      : "core-engineering";
    const taskKey = typeof req.body?.taskKey === "string" && req.body.taskKey.trim()
      ? req.body.taskKey.trim()
      : undefined;
    const agentPath = typeof req.body?.agentPath === "string" && req.body.agentPath.trim()
      ? path.resolve(process.cwd(), req.body.agentPath.trim())
      : undefined;
    const agentMarkdown = typeof req.body?.agentMarkdown === "string" && req.body.agentMarkdown.trim()
      ? req.body.agentMarkdown
      : undefined;
    const model = typeof req.body?.model === "string" && req.body.model.trim()
      ? req.body.model.trim()
      : undefined;

    if (!agentPath && !agentMarkdown) {
      res.status(400).json({ error: "Provide either agentPath or agentMarkdown." });
      return;
    }

    try {
      const bestBefore = getBestScore(db);
      const runKey = newRunKey();
      const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
      const runInput = await runEvaluationInRuntime({
        runKey,
        agentPath,
        agentMarkdown,
        benchmarkKey,
        taskKey,
        artifactsRoot,
        benchmarks,
        model
      });
      const inserted = insertRun(db, runInput);

      res.json({
        run: inserted,
        bestBefore,
        regressed: bestBefore !== null ? inserted.score < bestBefore : false
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
