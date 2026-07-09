import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readAgentUsageReport } from "../src/runtime/agent-usage";

test("readAgentUsageReport reads a well-formed self-reported usage.json", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agent-usage-"));

  try {
    mkdirSync(path.join(workspace, "result"), { recursive: true });
    writeFileSync(
      path.join(workspace, "result", "usage.json"),
      JSON.stringify({ inputTokens: 1200, outputTokens: 300, costUsd: 0.012 })
    );

    const usage = readAgentUsageReport(workspace);
    assert.deepEqual(usage, { available: true, inputTokens: 1200, outputTokens: 300, costUsd: 0.012 });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readAgentUsageReport is unavailable when the runner never wrote usage.json", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agent-usage-"));

  try {
    const usage = readAgentUsageReport(workspace);
    assert.equal(usage.available, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("readAgentUsageReport is unavailable when usage.json is malformed", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agent-usage-"));

  try {
    mkdirSync(path.join(workspace, "result"), { recursive: true });
    writeFileSync(path.join(workspace, "result", "usage.json"), JSON.stringify({ inputTokens: "many" }));

    const usage = readAgentUsageReport(workspace);
    assert.equal(usage.available, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
