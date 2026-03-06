import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";
import { runEvaluationInRuntime } from "../src/core/runner";

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
