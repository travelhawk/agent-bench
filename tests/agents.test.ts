import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectAgentFile, listAgentFiles } from "../src/agents/files";

test("listAgentFiles finds agent markdown files and ignores task docs", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agents-"));

  try {
    mkdirSync(path.join(workspace, "agents", "team-a", "agents"), { recursive: true });
    mkdirSync(path.join(workspace, "agents", "team-a", "tasks"), { recursive: true });

    writeFileSync(path.join(workspace, "agents", "AGENTS.md"), "# global rules\n");
    writeFileSync(path.join(workspace, "agents", "team-a", "README.md"), "# docs\n");
    writeFileSync(path.join(workspace, "agents", "team-a", "tasks", "fix-react-bug.md"), "# task\n");
    writeFileSync(path.join(workspace, "agents", "team-a", "agents", "coder-v1.md"), "# Coder V1\nBuild reliable patches.\n");

    const agents = listAgentFiles(workspace);

    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, "Coder V1");
    assert.equal(agents[0].path, path.join("agents", "team-a", "agents", "coder-v1.md"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("inspectAgentFile rejects files outside the agents workspace", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agents-"));

  try {
    mkdirSync(path.join(workspace, "notes"), { recursive: true });
    writeFileSync(path.join(workspace, "notes", "not-an-agent.md"), "# Notes\n");

    assert.throws(
      () => inspectAgentFile(workspace, "./notes/not-an-agent.md"),
      /inside the workspace agents folder/i
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("inspectAgentFile exposes sandbox runner configuration when declared", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agents-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "coder.md");
    mkdirSync(path.dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, "# Sandbox Coder\nRunner: node ./scripts/run-agent.js\n");

    const agent = inspectAgentFile(workspace, "./agents/sandbox/coder.md");

    assert.equal(agent.executionMode, "sandbox");
    assert.equal(agent.runnerCommand, "node ./scripts/run-agent.js");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
