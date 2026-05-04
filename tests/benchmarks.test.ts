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
    assert.equal(suite.tasks[0].metadata.reliability, "medium");
    assert.equal(suite.tasks[0].metadata.timeBudgetMs, 90000);
    assert.equal(suite.tasks[0].metadata.defaultTrials, 1);
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
      whyThisTask: "Checks orchestrated delegation.",
      inputs: "Use the supplied project brief.",
      deliverableFormat: "Return sections for result and handoffs.",
      successChecks: ["Each role is bounded.", "Conflicts are resolved."],
      failureModes: ["No clear handoffs.", "Conflicts left unresolved."],
      metadata: {
        resolution: "swarm",
        interaction: "multi-agent",
        evaluator: "trace",
        difficulty: "high",
        reliability: "medium",
        tags: ["delegation", "orchestration"],
        requiresIsolation: true,
        requiresNetwork: false,
        timeBudgetMs: 120000,
        costBudgetUsd: 2,
        defaultTrials: 2
      },
      sandbox: {
        fixtureDir: "fixtures/superagent-handoff",
        verifyCommand: "node verify.js",
        provider: "docker",
        timeoutMs: 60000
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
    assert.equal(suite.tasks[0].metadata.reliability, "medium");
    assert.equal(suite.tasks[0].metadata.timeBudgetMs, 120000);
    assert.equal(suite.tasks[0].metadata.defaultTrials, 2);
    assert.equal(suite.tasks[0].whyThisTask, "Checks orchestrated delegation.");
    assert.equal(suite.tasks[0].inputs, "Use the supplied project brief.");
    assert.equal(suite.tasks[0].deliverableFormat, "Return sections for result and handoffs.");
    assert.deepEqual(suite.tasks[0].successChecks, ["Each role is bounded.", "Conflicts are resolved."]);
    assert.deepEqual(suite.tasks[0].failureModes, ["No clear handoffs.", "Conflicts left unresolved."]);
    assert.equal(suite.tasks[0].sandbox?.fixtureDir, "fixtures/superagent-handoff");
    assert.equal(suite.tasks[0].sandbox?.verifyCommand, "node verify.js");
    assert.equal(suite.tasks[0].sandbox?.provider, "docker");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("default seeded benchmarks prefer fast product and repo tasks", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-benchmarks-"));

  try {
    const benchmarksDir = path.join(workspace, "benchmarks");
    const suites = listBenchmarkSuitesFromFiles(benchmarksDir);
    const creativeSuite = suites.find((entry) => entry.key === "creative-frontend");
    const productSuite = suites.find((entry) => entry.key === "product-builds");
    const repoSuite = suites.find((entry) => entry.key === "repo-maintenance");

    assert.ok(creativeSuite);
    assert.ok(productSuite);
    assert.ok(repoSuite);
    assert.equal(creativeSuite.metadata.domain, "frontend-design");
    assert.equal(productSuite.metadata.domain, "product-engineering");
    assert.equal(repoSuite.metadata.domain, "software-engineering");
    assert.equal(
      suites
        .find((entry) => entry.key === "creative-frontend")
        ?.tasks.find((task) => task.key === "landing-page-refresh")
        ?.sandbox?.verifyCommand,
      "node verify.js"
    );
    assert.equal(
      suites
        .find((entry) => entry.key === "product-builds")
        ?.tasks.find((task) => task.key === "simple-feedback-web-app")
        ?.sandbox?.verifyCommand,
      "node --test tests/*.test.js"
    );
    assert.equal(
      suites
        .find((entry) => entry.key === "repo-maintenance")
        ?.tasks.find((task) => task.key === "fix-react-bug")
        ?.sandbox?.verifyCommand,
      "node --test tests/*.test.js"
    );
    assert.equal(
      suites
        .find((entry) => entry.key === "repo-maintenance")
        ?.tasks.find((task) => task.key === "security-audit-report")
        ?.sandbox?.fixtureDir,
      "fixtures/security-audit-report"
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
