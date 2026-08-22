import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";
import { runEvaluationInRuntime } from "../src/core/runner";

test("review 'off' skips the LLM judge even when a gateway key is configured", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-review-off-"));
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;

  try {
    // A real key in the environment must not trigger a judge call when the
    // caller opted out of review; a network call here would fail the test
    // because the key is fake and rules mode never touches the gateway.
    process.env.AI_GATEWAY_API_KEY = "fake-key-should-not-be-used";
    const agentPath = path.join(workspace, "agents", "agent.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    writeFileSync(agentPath, "# Agent\nDelivers patches.\n");

    const result = await runEvaluationInRuntime({
      runKey: "run-review-off",
      agentPath,
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir),
      review: "off"
    });

    assert.equal(result.reviewMode, "off");
    assert.equal(result.judgeTotalTokens, 0);
    assert.equal(result.costUsd, 0);

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-review-off", "summary.json"), "utf8")) as { reviewMode?: string };
    assert.equal(summary.reviewMode, "off");
  } finally {
    if (previousGatewayKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});
