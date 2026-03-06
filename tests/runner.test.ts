import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";
import { runEvaluationInRuntime } from "../src/core/runner";
import { supportsSeatbeltSandbox } from "../src/runtime/sandbox";

test("runEvaluationInRuntime writes artifacts without requiring a dist-only evaluator path", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "agent.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    writeFileSync(agentPath, "# Agent\nDelivers patches.\n");

    const result = await runEvaluationInRuntime({
      runKey: "run-test",
      agentPath,
      benchmarkKey: "core-engineering",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const runArtifactsDir = path.join(artifactsRoot, "run-test");

    assert.equal(result.runKey, "run-test");
    assert.equal(result.suiteName, "core-engineering/fix-react-bug");
    assert.ok(existsSync(path.join(runArtifactsDir, "summary.json")));
    assert.ok(existsSync(path.join(runArtifactsDir, "session.log")));
    assert.ok(existsSync(path.join(runArtifactsDir, "report.svg")));

    const summary = JSON.parse(readFileSync(path.join(runArtifactsDir, "summary.json"), "utf8")) as {
      reviewMode?: string;
      assessment?: { matchedSignals?: string[] };
    };
    assert.equal(summary.reviewMode, "rules");
    assert.ok(Array.isArray(summary.assessment?.matchedSignals));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime can execute a sandboxed runner against a task fixture", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "core-engineering");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "core-engineering"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const target = path.join(process.env.AGENT_BENCH_WORKSPACE, 'Counter.js');",
      "const next = fs.readFileSync(target, 'utf8').replace('next = current + 1;\\n  next = current + 1;', 'next = current + 1;\\n  next = next + 1;');",
      "fs.writeFileSync(target, next);"
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-sandbox",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "core-engineering",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const runArtifactsDir = path.join(artifactsRoot, "run-sandbox");
    const summary = JSON.parse(readFileSync(path.join(runArtifactsDir, "summary.json"), "utf8")) as {
      executionMode?: string;
      sandbox?: { provider?: string; runner?: { cwd?: string }; verifier?: { exitCode?: number } };
      scores?: { tests?: number };
    };

    assert.equal(result.runKey, "run-sandbox");
    assert.equal(summary.executionMode, "sandbox");
    assert.ok(summary.sandbox?.provider);
    assert.equal(summary.sandbox?.runner?.cwd, path.dirname(agentPath));
    assert.equal(summary.sandbox?.verifier?.exitCode, 0);
    assert.ok((summary.scores?.tests ?? 0) >= 9.5);
    assert.ok(existsSync(path.join(runArtifactsDir, "workspace", "Counter.js")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("sandboxed runner cannot write outside the task workspace when seatbelt is available", { skip: !supportsSeatbeltSandbox() }, async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));
  const previousProvider = process.env.AGENT_BENCH_SANDBOX_PROVIDER;

  try {
    process.env.AGENT_BENCH_SANDBOX_PROVIDER = "macos-seatbelt";

    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "core-engineering");
    const forbiddenPath = path.join(workspace, "escape.txt");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "core-engineering"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(forbiddenPath)}, 'escape');`
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-seatbelt",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "core-engineering",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-seatbelt", "summary.json"), "utf8")) as {
      sandbox?: { runner?: { exitCode?: number; stderr?: string; provider?: string } };
      scores?: { tests?: number };
    };

    assert.equal(result.runKey, "run-seatbelt");
    assert.equal(summary.sandbox?.runner?.provider, "macos-seatbelt");
    assert.notEqual(summary.sandbox?.runner?.exitCode, 0);
    assert.ok((summary.sandbox?.runner?.stderr ?? "").length > 0);
    assert.equal(existsSync(forbiddenPath), false);
    assert.ok((summary.scores?.tests ?? 10) < 6);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AGENT_BENCH_SANDBOX_PROVIDER;
    } else {
      process.env.AGENT_BENCH_SANDBOX_PROVIDER = previousProvider;
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});
