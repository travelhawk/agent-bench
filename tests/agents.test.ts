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
      /inside \.\/agents or \.\/\.agent-bench\/agents/i
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

test("inspectAgentFile accepts a nested AGENTS.md bundle directory with attached skills", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agents-"));

  try {
    const bundleDir = path.join(workspace, "agents", "workflow-bundle");
    mkdirSync(path.join(bundleDir, ".agents", "skills", "lint-reviewer"), { recursive: true });
    writeFileSync(path.join(bundleDir, "AGENTS.md"), "# Workflow Bundle\nRunner: node ./runner.js\n");
    writeFileSync(path.join(bundleDir, "runner.js"), "console.log('runner');\n");
    writeFileSync(path.join(bundleDir, ".agents", "skills", "lint-reviewer", "SKILL.md"), "# Lint Reviewer\n");

    const agent = inspectAgentFile(workspace, "./agents/workflow-bundle");

    assert.equal(agent.path, path.join("agents", "workflow-bundle", "AGENTS.md"));
    assert.equal(agent.system.bundleMode, "bundle");
    assert.equal(agent.system.skillCount, 1);
    assert.ok(agent.system.assetFileCount >= 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("inspectAgentFile includes project .agents skills for flat workspace agents", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-agents-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "coder.md");
    const helperPath = path.join(workspace, "agents", "sandbox", "runner.js");
    const sharedSkillPath = path.join(workspace, ".agents", "skills", "find-skills", "SKILL.md");
    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(path.dirname(helperPath), { recursive: true });
    mkdirSync(path.dirname(sharedSkillPath), { recursive: true });
    writeFileSync(agentPath, "# Shared Skill Agent\nRunner: node ./runner.js\n");
    writeFileSync(helperPath, "console.log('runner');\n");
    writeFileSync(sharedSkillPath, "# Find Skills\n");

    const agent = inspectAgentFile(workspace, "./agents/sandbox/coder.md");

    assert.equal(agent.system.bundleMode, "flat");
    assert.equal(agent.system.sharedAgentsPath, ".agents");
    assert.equal(agent.system.skillCount, 1);
    assert.ok(agent.system.assetFileCount >= 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
