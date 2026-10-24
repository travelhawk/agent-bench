#!/usr/bin/env node
import "dotenv/config";
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { readAgentRunnerCommand } from "./agents/files";
import { listBenchmarkSuitesFromFiles } from "./benchmarks/files";
import { newRunKey, runEvaluationInRuntime } from "./core/runner";
import { createDb, initializeSchema } from "./db/schema";
import { ensureProjectDirs, getWorkspaceRoot, resolveBenchmarksDir, resolveDbPath, resolvePackagedBenchmarksDir, resolvePackagedExamplesDir, TOOL_VERSION } from "./server/config";
import { getBestScore, getRunByKey, insertRun, listRuns } from "./db/store";
import { buildComparisonMatrix } from "./core/comparison";
import { renderMatrixLines } from "./core/matrix-print";
import { exportComparison, getComparisonMatrix, runBatch } from "./server/service";
import { runDoctorChecks } from "./server/doctor";
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
  .version(TOOL_VERSION);

/**
 * Copies one starter agent into the workspace. A comparison needs at least one
 * *executable* agent, and a fresh checkout has none, so `init` installs the
 * model-agnostic runner rather than leaving the first run to fail.
 */
function installStarterAgent(examplesDir: string): string[] {
  const notes: string[] = [];
  const agentsDir = path.join(cwd, "agents");
  const sourceFile = path.join(examplesDir, "agents", "model-coder.md");
  const sourceDir = path.join(examplesDir, "agents", "model-coder");
  if (!existsSync(sourceFile)) return notes;

  mkdirSync(agentsDir, { recursive: true });
  const targetFile = path.join(agentsDir, "model-coder.md");
  if (existsSync(targetFile)) {
    notes.push("agents/model-coder.md already present, left untouched.");
  } else {
    copyFileSync(sourceFile, targetFile);
    notes.push("Installed agents/model-coder.md (executable, benchmarks any gateway model).");
  }

  const targetDir = path.join(agentsDir, "model-coder");
  if (existsSync(sourceDir) && !existsSync(targetDir)) {
    cpSync(sourceDir, targetDir, { recursive: true });
    notes.push("Installed agents/model-coder/run.mjs.");
  }
  return notes;
}

/**
 * Seeds the benchmark suites. Without them `init` would leave a workspace that
 * has an agent but nothing to run it against, and `doctor` would then tell the
 * user to run `init` again.
 */
function installBenchmarks(): string[] {
  const target = resolveBenchmarksDir(cwd);
  if (existsSync(target)) return ["benchmarks/ already present, left untouched."];

  const source = resolvePackagedBenchmarksDir();
  if (!source) return ["Benchmarks not found in this install \u2014 copy a suite into ./benchmarks/."];
  if (path.resolve(source) === path.resolve(target)) return [];

  cpSync(source, target, { recursive: true });
  const suites = listBenchmarkSuitesFromFiles(target);
  const tasks = suites.reduce((total, suite) => total + suite.tasks.length, 0);
  return [`Installed benchmarks/ (${suites.length} suite(s), ${tasks} task(s)).`];
}

/** A missing .env is the most common reason a first run cannot reach a model. */
function installEnvFile(): string[] {
  const target = path.join(cwd, ".env");
  const sample = path.join(cwd, ".env.sample");
  if (existsSync(target) || !existsSync(sample)) return [];
  copyFileSync(sample, target);
  return ["Created .env from .env.sample — put your AI_GATEWAY_API_KEY in it."];
}

program
  .command("init")
  .description("Initialize the local database and install the starter agent")
  .option("--local", "Initialize using local defaults", true)
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    const dirs = ensureProjectDirs(dbPath);
    ensureDbReady(dbPath);

    const notes = [...installBenchmarks(), ...installEnvFile()];
    const examplesDir = resolvePackagedExamplesDir();
    if (examplesDir) {
      notes.push(...installStarterAgent(examplesDir));
    } else {
      notes.push("Starter agents not found in this install — copy one from examples/sample-workspace/agents/.");
    }

    // eslint-disable-next-line no-console
    console.log(`Database ready at ${dbPath}`);
    // eslint-disable-next-line no-console
    console.log(`Artifacts path: ${dirs.artifacts}`);
    for (const note of notes) {
      // eslint-disable-next-line no-console
      console.log(note);
    }
    // eslint-disable-next-line no-console
    console.log("\nNext: `agent-bench doctor` to check this machine, then `agent-bench compare-models --models <a>,<b>`.");
  });

program
  .command("run")
  .description("Execute one benchmark suite run for an agent")
  .option("--agent <path>", "Path to agent definition", "./agent.md")
  .option("--benchmark <key>", "Benchmark suite key", "repo-maintenance")
  .option("--task <key>", "Optional task key inside benchmark")
  .option("--model <provider/model>", "Model under test, handed to the agent runner")
  .option("--judge-model <provider/model>", "Model that reviews the work (default: AGENT_BENCH_JUDGE_MODEL)")
  .option("--no-judge", "Skip the LLM judge (deterministic review, zero grader tokens)")
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
      model: opts.model,
      judgeModel: opts.judgeModel,
      review: opts.judge === false ? "off" : "auto"
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
  .description("Compare two or more run keys against the first (baseline)")
  .argument("[runKeys...]", "Run keys to compare (two or more)")
  .option("--runs <runKeys...>", "Run keys to compare (two or more)")
  .option("--left <runKey>", "Baseline run key")
  .option("--right <runKey>", "Run key to compare against the baseline")
  .option("--db <path>", "Custom sqlite path")
  .action((runKeys: string[], opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    const db = ensureDbReady(dbPath);
    const requested = [
      ...(opts.left ? [String(opts.left)] : []),
      ...(opts.right ? [String(opts.right)] : []),
      ...(Array.isArray(opts.runs) ? opts.runs.map(String) : []),
      ...runKeys
    ].flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
    const unique = [...new Set(requested)];

    if (unique.length < 2) {
      throw new Error("Provide at least two run keys, e.g. `agent-bench compare run-a run-b run-c`.");
    }

    const runs = unique.map((runKey) => {
      const run = getRunByKey(db, runKey);
      if (!run) {
        throw new Error(`Unknown run key '${runKey}'. Use \`agent-bench history\` to list available keys.`);
      }
      return run;
    });

    const [baseline, ...challengers] = runs;
    const signed = (value: number, digits = 2) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

    // eslint-disable-next-line no-console
    console.log(`Baseline: ${baseline.runKey} | ${baseline.agentName} · ${baseline.modelId ?? "rules / no model"} | score ${baseline.score.toFixed(2)}`);
    // eslint-disable-next-line no-console
    console.log("");

    for (const run of challengers) {
      const delta = Number((run.score - baseline.score).toFixed(2));
      const direction = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
      // eslint-disable-next-line no-console
      console.log(`${run.runKey} | ${run.agentName} · ${run.modelId ?? "rules / no model"}`);
      // eslint-disable-next-line no-console
      console.log(`  score ${run.score.toFixed(2)} (${signed(delta)} vs baseline, ${direction})`);

      if (baseline.qualityScore != null && run.qualityScore != null) {
        // eslint-disable-next-line no-console
        console.log(`  quality ${run.qualityScore.toFixed(2)} (${signed(run.qualityScore - baseline.qualityScore)})`);
      }
      if (baseline.verifierTestsAvailable && run.verifierTestsAvailable) {
        // eslint-disable-next-line no-console
        console.log(`  tests ${run.verifierTestsPassed}/${run.verifierTestsTotal} (baseline ${baseline.verifierTestsPassed}/${baseline.verifierTestsTotal})`);
      }
      if (baseline.diffAvailable && run.diffAvailable) {
        // eslint-disable-next-line no-console
        console.log(`  diff ${run.diffFilesChanged} files (${signed(run.diffFilesChanged - baseline.diffFilesChanged, 0)})`);
      }
      // eslint-disable-next-line no-console
      console.log(`  duration ${(run.durationMs / 1000).toFixed(1)}s (${signed((run.durationMs - baseline.durationMs) / 1000, 1)}s) | cost $${run.costUsd.toFixed(2)} (${signed(run.costUsd - baseline.costUsd)})`);
    }

    const best = runs.reduce((leader, run) => (run.score > leader.score ? run : leader), baseline);
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(`Winner: ${best.runKey} (${best.agentName}) with score ${best.score.toFixed(2)}`);
  });

program
  .command("matrix")
  .description("Compare all agent × model setups side by side from persisted runs (zero token cost)")
  .option("--benchmark <key>", "Filter to one benchmark suite")
  .option("--limit <n>", "Number of recent runs to aggregate", "200")
  .option("--db <path>", "Custom sqlite path")
  .action((opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    const db = ensureDbReady(dbPath);
    const limit = Number(opts.limit);
    const runs = listRuns(db, Number.isFinite(limit) ? limit : 200);
    const matrix = buildComparisonMatrix(runs, opts.benchmark ? { benchmarkKey: opts.benchmark } : {});

    for (const line of renderMatrixLines(matrix)) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  });

program
  .command("export")
  .description("Export the comparison as a shareable report (markdown, csv, json, or self-contained html)")
  .option("--format <format>", "md | csv | json | html", "md")
  .option("--benchmark <key>", "Filter to one benchmark suite")
  .option("--task <key>", "Filter to one task")
  .option("--setups <keys>", "Comma-separated setup keys to include")
  .option("--limit <n>", "Number of recent runs to aggregate", "200")
  .option("--title <title>", "Custom report title")
  .option("--share-url <url>", "Workbench link embedded in the report")
  .option("--out <path>", "Write to a file instead of stdout")
  .option("--db <path>", "Custom sqlite path")
  .action(async (opts) => {
    const dbPath = resolveDbPath(cwd, opts.db);
    ensureDbReady(dbPath).close();

    const result = await exportComparison({
      format: opts.format,
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      setupKeys: opts.setups,
      limit: opts.limit,
      title: opts.title,
      shareUrl: opts.shareUrl
    }, dbPath);

    if (!opts.out) {
      // eslint-disable-next-line no-console
      console.log(result.body);
      return;
    }

    const outPath = path.resolve(cwd, opts.out === true ? result.fileName : String(opts.out));
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.body, "utf8");

    // eslint-disable-next-line no-console
    console.log(`Exported ${result.setupCount} setup(s) across ${result.runCount} run(s) to ${outPath}`);
  });

program
  .command("compare-models")
  .description("Run one task across several models and print the comparison")
  .requiredOption("--models <list>", "Comma-separated gateway model ids to compare")
  .option("--agent <path>", "Agent definition held constant across models", "agents/model-coder.md")
  .option("--benchmark <key>", "Benchmark suite key", "repo-maintenance")
  .option("--task <key>", "Task key inside the benchmark (omit to run the whole suite)")
  .option("--judge-model <provider/model>", "One judge for every setup (default: AGENT_BENCH_JUDGE_MODEL)")
  .option("--no-judge", "Skip the LLM judge entirely and compare on objective signals only")
  .option("--format <format>", "Also write an export: md | csv | json | html")
  .option("--out <path>", "File for --format (default: stdout)")
  .option("--db <path>", "Custom sqlite path")
  .action(async (opts) => {
    const models = String(opts.models)
      .split(/[\r\n,]+/)
      .map((entry: string) => entry.trim())
      .filter(Boolean);
    const uniqueModels = [...new Set(models)];
    if (uniqueModels.length < 2) {
      throw new Error("Pass at least two distinct models, e.g. --models anthropic/claude-sonnet-5,anthropic/claude-opus-5");
    }

    const dbPath = resolveDbPath(cwd, opts.db);
    ensureDbReady(dbPath).close();

    // One setup per model, labelled by the model so the comparison columns read
    // as the models themselves rather than as "agent x model".
    const setups = uniqueModels.map((model) => ({ agentPath: opts.agent, model, label: model }));

    // eslint-disable-next-line no-console
    console.log(`Running ${uniqueModels.length} model(s) on ${opts.benchmark}${opts.task ? `/${opts.task}` : " (full suite)"} with ${opts.agent}...`);

    const batch = await runBatch({
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      runMode: opts.task ? "single-task" : "benchmark-cycle",
      setups,
      judgeModel: opts.judgeModel,
      review: opts.judge === false ? "off" : "auto"
    }, dbPath);

    // eslint-disable-next-line no-console
    console.log(`${batch.completedRuns}/${batch.queueSize} run(s) completed${batch.failedRuns > 0 ? `, ${batch.failedRuns} failed` : ""}.\n`);
    for (const failure of batch.failures) {
      // eslint-disable-next-line no-console
      console.error(`FAILED ${failure.setupKey} on ${failure.taskKey}: ${failure.message}`);
    }

    const matrix = await getComparisonMatrix({
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      setupKeys: uniqueModels,
      limit: batch.queueSize
    }, dbPath);

    for (const line of renderMatrixLines(matrix)) {
      // eslint-disable-next-line no-console
      console.log(line);
    }

    if (!opts.format) return;

    const result = await exportComparison({
      format: opts.format,
      benchmarkKey: opts.benchmark,
      taskKey: opts.task,
      setupKeys: uniqueModels,
      limit: batch.queueSize
    }, dbPath);

    if (!opts.out) {
      // eslint-disable-next-line no-console
      console.log(`\n${result.body}`);
      return;
    }
    const outPath = path.resolve(cwd, String(opts.out));
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.body, "utf8");
    // eslint-disable-next-line no-console
    console.log(`\nReport written to ${outPath}`);
  });

program
  .command("doctor")
  .description("Check that this machine can run and compare benchmarks")
  .option("--db <path>", "Custom sqlite path")
  .action(async (opts) => {
    const report = await runDoctorChecks({ workspaceRoot: cwd, dbPath: resolveDbPath(cwd, opts.db) });

    for (const check of report.checks) {
      const mark = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
      // eslint-disable-next-line no-console
      console.log(`[${mark}] ${check.name}: ${check.detail}`);
      if (check.fix) {
        // eslint-disable-next-line no-console
        console.log(`       fix: ${check.fix}`);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`\n${report.summary}`);
    if (!report.ok) process.exit(1);
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
