import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectAgentFile } from "../src/agents/files";
import { assertBatchCapacity, INPUT_LIMITS, resolveBatchSetups, setupsFromAgentList } from "../src/server/validation";

function makeWorkspace(agentNames: string[]): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-setups-"));
  mkdirSync(path.join(workspace, "agents"), { recursive: true });
  for (const name of agentNames) {
    writeFileSync(path.join(workspace, "agents", `${name}.md`), `# ${name}\nDo the work.\n`);
  }
  return workspace;
}

test("resolveBatchSetups builds more than two comparable setups in one batch", () => {
  const workspace = makeWorkspace(["coder", "reviewer"]);

  try {
    const setups = resolveBatchSetups(workspace, [
      { agentPath: "agents/coder.md", model: "openai/gpt-4.1-mini" },
      { agentPath: "agents/coder.md", model: "anthropic/claude-sonnet-5" },
      { agentPath: "agents/reviewer.md", model: "openai/gpt-4.1-mini" },
      { agentPath: "agents/reviewer.md" }
    ], "auto");

    assert.equal(setups.length, 4);
    assert.deepEqual(setups.map((setup) => setup.setupKey), [
      "coder · openai/gpt-4.1-mini",
      "coder · anthropic/claude-sonnet-5",
      "reviewer · openai/gpt-4.1-mini",
      "reviewer · rules / no model"
    ]);
    assert.equal(setups[3].model, undefined);
    assert.ok(setups.every((setup) => setup.review === "auto"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolveBatchSetups honours per-setup labels and review overrides", () => {
  const workspace = makeWorkspace(["coder"]);

  try {
    const setups = resolveBatchSetups(workspace, [
      { agentPath: "agents/coder.md", model: "openai/gpt-4.1-mini", label: "baseline" },
      { agentPath: "agents/coder.md", model: "openai/gpt-4.1-mini", label: "no-judge", review: "off" }
    ], "auto");

    assert.deepEqual(setups.map((setup) => setup.setupKey), ["baseline", "no-judge"]);
    assert.equal(setups[0].review, "auto");
    assert.equal(setups[1].review, "off");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolveBatchSetups collapses identical agent+model entries", () => {
  const workspace = makeWorkspace(["coder"]);

  try {
    const setups = resolveBatchSetups(workspace, [
      { agentPath: "agents/coder.md", model: "openai/gpt-4.1-mini" },
      { agentPath: "./agents/coder.md", model: "openai/gpt-4.1-mini" }
    ], "auto");

    assert.equal(setups.length, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolveBatchSetups rejects duplicate labels so comparison columns stay distinct", () => {
  const workspace = makeWorkspace(["coder", "reviewer"]);

  try {
    assert.throws(
      () => resolveBatchSetups(workspace, [
        { agentPath: "agents/coder.md", model: "a", label: "candidate" },
        { agentPath: "agents/reviewer.md", model: "b", label: "candidate" }
      ], "auto"),
      /Setup labels must be unique/
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolveBatchSetups enforces the setup cap and rejects empty input", () => {
  const workspace = makeWorkspace(["coder"]);

  try {
    const tooMany = Array.from({ length: INPUT_LIMITS.maxSetupsPerBatch + 1 }, (_, index) => ({
      agentPath: "agents/coder.md",
      model: `model-${index}`
    }));

    assert.throws(() => resolveBatchSetups(workspace, tooMany, "auto"), /at most 12 setups/);
    assert.throws(() => resolveBatchSetups(workspace, [], "auto"), /at least one setup/);
    assert.throws(() => resolveBatchSetups(workspace, "nope", "auto"), /setups must be an array/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("setupsFromAgentList keeps the legacy agents × single-model shorthand working", () => {
  const workspace = makeWorkspace(["coder", "reviewer"]);

  try {
    const agents = [
      inspectAgentFile(workspace, "agents/coder.md"),
      inspectAgentFile(workspace, "agents/reviewer.md")
    ];

    const setups = setupsFromAgentList(agents, "openai/gpt-4.1-mini", "off");
    assert.deepEqual(setups.map((setup) => setup.setupKey), [
      "coder · openai/gpt-4.1-mini",
      "reviewer · openai/gpt-4.1-mini"
    ]);
    assert.ok(setups.every((setup) => setup.review === "off"));

    const withoutModel = setupsFromAgentList(agents, undefined, "auto");
    assert.deepEqual(withoutModel.map((setup) => setup.setupKey), [
      "coder · rules / no model",
      "reviewer · rules / no model"
    ]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("assertBatchCapacity counts setups × tasks, not agents × tasks", () => {
  assert.doesNotThrow(() => assertBatchCapacity(6, 8));
  assert.throws(() => assertBatchCapacity(7, 8), /Batch would create 56 runs/);
});
