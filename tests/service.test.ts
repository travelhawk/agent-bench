import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeBatchPlan, runBatch } from "../src/server/service";

test("executeBatchPlan keeps later jobs running when one job fails", async () => {
  const jobs = [
    { benchmarkKey: "agentic-workflows", taskKey: "research-synthesis-loop", agentPath: "agents/coder.md", agentName: "coder", agentVersion: "v1" },
    { benchmarkKey: "agentic-workflows", taskKey: "release-war-room", agentPath: "agents/coder.md", agentName: "coder", agentVersion: "v1" },
    { benchmarkKey: "agentic-workflows", taskKey: "superagent-handoff-mesh", agentPath: "agents/reviewer.md", agentName: "reviewer", agentVersion: "v1" }
  ];

  const order: string[] = [];
  const result = await executeBatchPlan(jobs, async (job) => {
    order.push(`${job.agentPath}:${job.taskKey}`);
    if (job.taskKey === "release-war-room") {
      throw new Error("judge gateway timed out");
    }
    return `${job.agentPath}:${job.taskKey}`;
  });

  assert.deepEqual(order, [
    "agents/coder.md:research-synthesis-loop",
    "agents/coder.md:release-war-room",
    "agents/reviewer.md:superagent-handoff-mesh"
  ]);
  assert.deepEqual(result.results, [
    "agents/coder.md:research-synthesis-loop",
    "agents/reviewer.md:superagent-handoff-mesh"
  ]);
  assert.deepEqual(result.failures, [
    {
      agentPath: "agents/coder.md",
      taskKey: "release-war-room",
      message: "judge gateway timed out"
    }
  ]);
});

test("runBatch persists failed jobs as failed runs", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-service-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);
    mkdirSync(path.join(workspace, "agents"), { recursive: true });
    mkdirSync(path.join(workspace, "benchmarks", "failing-suite", "tasks"), { recursive: true });
    writeFileSync(path.join(workspace, "agents", "coder.md"), "# Coder\nRunner: node ./runner.js\n");
    writeFileSync(path.join(workspace, "agents", "runner.js"), "console.log('runner');\n");
    writeFileSync(path.join(workspace, "benchmarks", "failing-suite", "benchmark.md"), [
      "# Failing Suite",
      "",
      "Key: failing-suite",
      "",
      "## Description",
      "Suite with a broken sandbox fixture.",
      ""
    ].join("\n"));
    writeFileSync(path.join(workspace, "benchmarks", "failing-suite", "tasks", "broken-task.md"), [
      "# Broken Task",
      "",
      "Key: broken-task",
      "",
      "## Task",
      "Attempt to run a task with a missing fixture.",
      "",
      "## Expected Outcome",
      "The failure should be persisted as a run.",
      "",
      "## Sandbox",
      "Fixture Dir: fixtures/does-not-exist",
      "Verify Command: node verify.js",
      "",
      "## Metadata",
      "Resolution: atomic",
      "Interaction: terminal",
      "Evaluator: hybrid",
      "Difficulty: medium",
      "Tags: failing, sandbox",
      "Requires Isolation: yes",
      "Requires Network: no",
      ""
    ].join("\n"));

    const dbPath = path.join(workspace, "runs.db");
    const result = await runBatch({
      benchmarkKey: "failing-suite",
      taskKey: "broken-task",
      runMode: "single-task",
      agents: ["agents/coder.md"]
    }, dbPath);

    assert.equal(result.completedRuns, 0);
    assert.equal(result.failedRuns, 1);
    assert.equal(result.failures[0].run?.run.status, "failed");
    assert.match(result.failures[0].message, /sandbox fixture not found/i);
    assert.equal(result.failures[0].run?.run.failureReason, result.failures[0].message);
  } finally {
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
});
