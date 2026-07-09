#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { readAgentRunnerCommand } from "./agents/files";
import { listBenchmarkSuitesFromFiles } from "./benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "./core/runner";
import { createDb, initializeSchema } from "./db/schema";
import { ensureProjectDirs, getWorkspaceRoot, resolveBenchmarksDir, resolveDbPath } from "./server/config";
import { getBestScore, getRunByKey, insertRun, listRuns } from "./db/store";
import { startUi } from "./ui/server";

const program = new Command();
const cwd = getWorkspaceRoot();

function ensureDbReady(dbPath: string) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = createDb(dbPath);
  initializeSchema(db);
  return db;
}

program
  .name("agent-bench")
  .description("Benchmark AI agent configurations with reproducible scoring")
  .version("0.3.0");

program
  .command("init")
  .description("Initialize local sqlite database and defaults")
  .option("--local", "Initialize using local defaults", true)
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
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
  .option("--benchmark <key>", "Benchmark suite key", "repo-maintenance")
  .option("--task <key>", "Optional task key inside benchmark")
  .option("--model <provider/model>", "Vercel AI Gateway model identifier")
  .option("--db <path>", "Custom sqlite path")
  .action(async (opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    const dirs = ensureProjectDirs(dbPath);
    const db = ensureDbReady(dbPath);

    const bestBefore = getBestScore(db);
    const benchmarksDir = resolveBenchmarksDir(cwd);
    const benchmarks = listBenchmarkSuitesFromFiles(benchmarksDir);
    const runKey = newRunKey();
    const resolvedAgentPath = path.resolve(cwd, opts.agent);
    const agentRunnerCommand = readAgentRunnerCommand(resolvedAgentPath);

    const runInput = await runEvaluationInRuntime({
      runKey,
      agentPath: resolvedAgentPath,
      agentRunnerCommand,
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      artifactsRoot: dirs.artifacts,
      benchmarksDir,
      benchmarks,
      model: opts.model
    });
    const inserted = insertRun(db, runInput);

    // eslint-disable-next-line no-console
    console.log(`Run ${inserted.runKey} completed with score ${inserted.score}`);
    // eslint-disable-next-line no-console
    console.log(`Duration: ${(inserted.durationMs / 1000).toFixed(1)}s | Cost: $${inserted.costUsd.toFixed(2)}`);
    // eslint-disable-next-line no-console
    console.log(`Diff: ${inserted.diffAvailable ? `${inserted.diffFilesChanged} files (+${inserted.diffInsertions}/-${inserted.diffDeletions})` : "n/a"}`);
    // eslint-disable-next-line no-console
    console.log(`Tests: ${inserted.verifierTestsAvailable ? `${inserted.verifierTestsPassed}/${inserted.verifierTestsTotal} passed` : "n/a"}`);
    // eslint-disable-next-line no-console
    console.log(`Quality: ${inserted.qualityScore != null ? inserted.qualityScore.toFixed(2) : "n/a"}`);
    // eslint-disable-next-line no-console
    console.log(`Agent usage: ${inserted.agentUsageAvailable ? `${inserted.agentInputTokens}in/${inserted.agentOutputTokens}out, $${inserted.agentCostUsd.toFixed(4)}` : "n/a (self-report not implemented by this runner)"}`);

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
    const dbPath = resolveDbPath(cwd, opts.db);
    const db = ensureDbReady(dbPath);
    const limit = Number(opts.limit);
    const runs = listRuns(db, Number.isFinite(limit) ? limit : 10);

    runs.forEach((run) => {
      const diffLabel = run.diffAvailable ? `${run.diffFilesChanged}f` : "n/a";
      const testsLabel = run.verifierTestsAvailable ? `${run.verifierTestsPassed}/${run.verifierTestsTotal}` : "n/a";
      const qualityLabel = run.qualityScore ?? "n/a";
      // eslint-disable-next-line no-console
      console.log(`${run.runKey} | ${run.agentName} | score=${run.score} | ${run.durationMs}ms | $${run.costUsd.toFixed(2)} | diff=${diffLabel} | tests=${testsLabel} | quality=${qualityLabel}`);
    });
  });

program
  .command("compare")
  .description("Compare two run keys")
  .requiredOption("--left <runKey>", "Left run key")
  .requiredOption("--right <runKey>", "Right run key")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
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

    if (left.diffAvailable && right.diffAvailable) {
      const filesDelta = right.diffFilesChanged - left.diffFilesChanged;
      // eslint-disable-next-line no-console
      console.log(`Diff size change: ${filesDelta > 0 ? "+" : ""}${filesDelta} files (${left.diffFilesChanged} -> ${right.diffFilesChanged})`);
    }
    if (left.verifierTestsAvailable && right.verifierTestsAvailable) {
      // eslint-disable-next-line no-console
      console.log(`Test pass rate: ${left.verifierTestsPassed}/${left.verifierTestsTotal} -> ${right.verifierTestsPassed}/${right.verifierTestsTotal}`);
    }
    if (left.qualityScore != null && right.qualityScore != null) {
      const qualityDelta = Number((right.qualityScore - left.qualityScore).toFixed(2));
      // eslint-disable-next-line no-console
      console.log(`Quality change: ${qualityDelta > 0 ? "+" : ""}${qualityDelta} (${left.qualityScore} -> ${right.qualityScore})`);
    }
  });

program
  .command("ui")
  .description("Start local web dashboard")
  .option("--port <n>", "Server port", "4173")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    ensureDbReady(dbPath);
    startUi(dbPath, Number(opts.port));
  });

void program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
