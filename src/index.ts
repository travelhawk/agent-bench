#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { listBenchmarkSuitesFromFiles } from "./benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "./core/runner";
import { createDb, initializeSchema } from "./db/schema";
import { getBestScore, getRunByKey, insertRun, listRuns } from "./db/store";
import { startUi } from "./ui/server";

const program = new Command();
const cwd = process.cwd();

function resolveDbPath(input?: string): string {
  if (input) return path.resolve(cwd, input);
  return path.join(os.homedir(), ".agent-bench", "data.db");
}

function ensureProjectDirs(dbPath: string): { root: string; artifacts: string } {
  const root = path.dirname(dbPath);
  const artifacts = path.join(root, "artifacts");
  mkdirSync(root, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  return { root, artifacts };
}

function resolveBenchmarksDir(): string {
  return path.join(cwd, "benchmarks");
}

function ensureDbReady(dbPath: string) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = createDb(dbPath);
  initializeSchema(db);
  return db;
}

program
  .name("agent-bench")
  .description("Benchmark AI agent configurations with reproducible scoring")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize local sqlite database and defaults")
  .option("--local", "Initialize using local defaults", true)
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(opts.db);
    const dirs = ensureProjectDirs(dbPath);
    ensureDbReady(dbPath);

    // eslint-disable-next-line no-console
    console.log(`Initializing sqlite database at ${dbPath}...`);
    // eslint-disable-next-line no-console
    console.log("Database ready.");
    // eslint-disable-next-line no-console
    console.log(`Artifacts path: ${dirs.artifacts}`);
  });

program
  .command("run")
  .description("Execute one benchmark suite run for an agent")
  .option("--agent <path>", "Path to agent definition", "./agent.md")
  .option("--benchmark <key>", "Benchmark suite key", "core-engineering")
  .option("--task <key>", "Optional task key inside benchmark")
  .option("--model <provider/model>", "Vercel AI Gateway model identifier")
  .option("--db <path>", "Custom sqlite path")
  .action(async (opts) => {
    const dbPath = resolveDbPath(opts.db);
    const dirs = ensureProjectDirs(dbPath);
    const db = ensureDbReady(dbPath);

    const bestBefore = getBestScore(db);
    const benchmarks = listBenchmarkSuitesFromFiles(resolveBenchmarksDir());
    const runKey = newRunKey();
    const runInput = await runEvaluationInRuntime({
      runKey,
      agentPath: path.resolve(cwd, opts.agent),
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      artifactsRoot: dirs.artifacts,
      benchmarks,
      model: opts.model
    });
    const inserted = insertRun(db, runInput);

    // eslint-disable-next-line no-console
    console.log(`Run ${inserted.runKey} completed with score ${inserted.score}`);
    // eslint-disable-next-line no-console
    console.log(`Duration: ${(inserted.durationMs / 1000).toFixed(1)}s | Cost: $${inserted.costUsd.toFixed(2)}`);

    if (bestBefore !== null && inserted.score < bestBefore) {
      // eslint-disable-next-line no-console
      console.warn(`Regression alert: current score ${inserted.score} is below best ${bestBefore.toFixed(2)}.`);
    }
  });

program
  .command("history")
  .description("Show recent runs")
  .option("--limit <n>", "Number of runs", "10")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(opts.db);
    const db = ensureDbReady(dbPath);
    const limit = Number(opts.limit);
    const runs = listRuns(db, Number.isFinite(limit) ? limit : 10);

    runs.forEach((run) => {
      // eslint-disable-next-line no-console
      console.log(`${run.runKey} | ${run.agentName} | score=${run.score} | ${run.durationMs}ms | $${run.costUsd.toFixed(2)}`);
    });
  });

program
  .command("compare")
  .description("Compare two run keys")
  .requiredOption("--left <runKey>", "Left run key")
  .requiredOption("--right <runKey>", "Right run key")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(opts.db);
    const db = ensureDbReady(dbPath);
    const left = getRunByKey(db, opts.left);
    const right = getRunByKey(db, opts.right);

    if (!left || !right) {
      throw new Error("Both run keys must exist. Use `agent-bench history` to list available keys.");
    }

    const delta = Number((right.score - left.score).toFixed(2));
    const direction = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";

    // eslint-disable-next-line no-console
    console.log(`${opts.left} (${left.score}) -> ${opts.right} (${right.score})`);
    // eslint-disable-next-line no-console
    console.log(`Performance change: ${delta > 0 ? "+" : ""}${delta} (${direction})`);
  });

program
  .command("ui")
  .description("Start local web dashboard")
  .option("--port <n>", "Server port", "4173")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(opts.db);
    ensureDbReady(dbPath);
    startUi(dbPath, Number(opts.port));
  });

void program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
