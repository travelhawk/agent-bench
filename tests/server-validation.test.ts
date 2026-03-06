import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertBatchCapacity, normalizeTagList, resolveBatchAgents } from "../src/server/validation";

test("normalizeTagList sanitizes and de-duplicates tags", () => {
  const tags = normalizeTagList("Browser, browser, multi agent, trace-check");
  assert.deepEqual(tags, ["browser", "multi-agent", "trace-check"]);
});

test("resolveBatchAgents de-duplicates valid agent paths inside the workspace", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-server-"));

  try {
    const agentPath = path.join(workspace, "agents", "team", "coder.md");
    mkdirSync(path.dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, "# Coder\nReliable patches.\n");

    const records = resolveBatchAgents(workspace, [
      "agents/team/coder.md",
      "./agents/team/coder.md",
      "agents/team/coder.md"
    ]);

    assert.equal(records.length, 1);
    assert.equal(records[0].path, path.join("agents", "team", "coder.md"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("assertBatchCapacity rejects oversized run plans", () => {
  assert.throws(
    () => assertBatchCapacity(8, 7),
    /limit is 48/i
  );
});
