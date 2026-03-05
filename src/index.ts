import { mkdirSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { simulateRun } from "./core/runner";
import { createDb, initializeSchema } from "./db/schema";
import { getBestScore, insertRun, listRuns, seedBenchmarks } from "./db/store";
import { startUi } from "./ui/server";

const program = new Command();
const cwd = process.cwd();

function resolveDbPath(input?: string): string {
  if (input) return path.resolve(cwd, input);
  return path.join(cwd, ".agent-bench", "data.db");
}

function ensureProjectDirs(): { root: string; artifacts: string } {
  const root = path.join(cwd, ".agent-bench");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(root, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  return { root, artifacts };
}

function ensureDbReady(dbPath: string) {
  const db = createDb(dbPath);
  initializeSchema(db);
  seedBenchmarks(db);
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
    const dirs = ensureProjectDirs();
    const dbPath = resolveDbPath(opts.db);
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
  .description("Execute one benchmark run for an agent")
  .requiredOption("--agent <path>", "Path to agent definition")
  .option("--suite <name>", "Benchmark suite key", "core")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dirs = ensureProjectDirs();
    const dbPath = resolveDbPath(opts.db);
    const db = ensureDbReady(dbPath);

    const bestBefore = getBestScore(db);
    const runInput = simulateRun(path.resolve(cwd, opts.agent), opts.suite, dirs.artifacts);
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
    const runs = listRuns(db, 500);
    const left = runs.find((r) => r.runKey === opts.left);
    const right = runs.find((r) => r.runKey === opts.right);

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

program.parse();
