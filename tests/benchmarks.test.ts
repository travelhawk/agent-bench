import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBenchmarkSuiteFile, createBenchmarkTaskFile, listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";

test("listBenchmarkSuitesFromFiles backfills metadata for legacy markdown", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-benchmarks-"));

  try {
    const benchmarksDir = path.join(workspace, "benchmarks");
    const suiteDir = path.join(benchmarksDir, "legacy-suite");
    const tasksDir = path.join(suiteDir, "tasks");

    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(path.join(suiteDir, "benchmark.md"), "# Legacy Suite\n\nKey: legacy-suite\n\n## Description\nOld format suite.\n");
    writeFileSync(path.join(tasksDir, "legacy-task.md"), "# Legacy Task\n\nKey: legacy-task\n\n## Task\nDo the thing.\n\n## Expected Outcome\nThing is done.\n");

    const suites = listBenchmarkSuitesFromFiles(benchmarksDir);
    const suite = suites.find((entry) => entry.key === "legacy-suite");

    assert.ok(suite);
    assert.equal(suite.metadata.resolution, "workflow");
    assert.equal(suite.metadata.domain, "general");
    assert.deepEqual(suite.metadata.tags, []);
    assert.equal(suite.tasks[0].metadata.resolution, "atomic");
    assert.equal(suite.tasks[0].metadata.interaction, "artifact");
    assert.equal(suite.tasks[0].metadata.evaluator, "hybrid");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("createBenchmark* files persist metadata for richer eval structure", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-benchmarks-"));

  try {
    const benchmarksDir = path.join(workspace, "benchmarks");
    createBenchmarkSuiteFile(benchmarksDir, {
      key: "ops-escalations",
      title: "Ops Escalations",
      description: "Longer-horizon benchmark suite.",
      metadata: {
        resolution: "campaign",
        domain: "agent-operations",
        tags: ["workflow", "multi-agent"]
      }
    });

    createBenchmarkTaskFile(benchmarksDir, {
      benchmarkKey: "ops-escalations",
      key: "superagent-handoff",
      title: "Superagent Handoff",
      description: "Coordinate specialists and merge outputs.",
      expectedOutcome: "Return a merged output plus delegation trace.",
      metadata: {
        resolution: "swarm",
        interaction: "multi-agent",
        evaluator: "trace",
        difficulty: "high",
        tags: ["delegation", "orchestration"],
        requiresIsolation: true,
        requiresNetwork: false
      }
    });

    const suite = listBenchmarkSuitesFromFiles(benchmarksDir).find((entry) => entry.key === "ops-escalations");
    assert.ok(suite);
    assert.equal(suite.metadata.domain, "agent-operations");
    assert.deepEqual(suite.metadata.tags, ["workflow", "multi-agent"]);
    assert.equal(suite.tasks[0].metadata.resolution, "swarm");
    assert.equal(suite.tasks[0].metadata.interaction, "multi-agent");
    assert.equal(suite.tasks[0].metadata.evaluator, "trace");
    assert.equal(suite.tasks[0].metadata.difficulty, "high");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("default seeded benchmarks cover browser and computer-use surfaces", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-benchmarks-"));

  try {
    const benchmarksDir = path.join(workspace, "benchmarks");
    const suites = listBenchmarkSuitesFromFiles(benchmarksDir);
    const surfaceSuite = suites.find((entry) => entry.key === "interaction-surfaces");

    assert.ok(surfaceSuite);
    assert.equal(surfaceSuite.metadata.domain, "operator-systems");
    assert.ok(surfaceSuite.tasks.some((task) => task.metadata.interaction === "browser"));
    assert.ok(surfaceSuite.tasks.some((task) => task.metadata.interaction === "computer-use"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
