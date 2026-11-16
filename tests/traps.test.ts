import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";
import { buildComparisonMatrix } from "../src/core/comparison";
import { renderComparison } from "../src/core/export";
import { renderTrapMatrixLines } from "../src/core/matrix-print";
import { readSetupsFile } from "../src/core/setups-file";
import { agentEnvPassthrough } from "../src/runtime/evaluator";
import { mapTrapResults, parseTrapsSection, readTrapTestCases } from "../src/runtime/traps";
import { RunRecord } from "../src/types";

test("parseTrapsSection reads '- id: description' lines and skips noise and duplicates", () => {
  const traps = parseTrapsSection([
    "- double-delete: a double click removes two rows",
    "* Two-Tabs: tabs overwrite each other",
    "not a trap line",
    "- double-delete: duplicate"
  ].join("\n"));
  assert.deepEqual(traps, [
    { id: "double-delete", description: "a double click removes two rows" },
    { id: "two-tabs", description: "tabs overwrite each other" }
  ]);
});

test("task markdown with ## Traps and trap sandbox fields round-trips through the parser", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ab-traps-"));
  mkdirSync(path.join(dir, "suite", "tasks"), { recursive: true });
  writeFileSync(path.join(dir, "suite", "benchmark.md"), "# Suite\n\nKey: suite\n\n## Description\nx\n");
  writeFileSync(path.join(dir, "suite", "tasks", "t.md"), [
    "# T", "", "Key: t", "", "## Task", "Do it", "", "## Expected Outcome", "Done", "",
    "## Traps", "- a-1: first", "- b-2: second", "",
    "## Sandbox", "Fixture Dir: fixtures/t", "Verify Command: npm test", "Traps Dir: traps/t",
    "Trap Command: npx vitest run traps/", "Timeout Ms: 1000", ""
  ].join("\n"));
  const task = listBenchmarkSuitesFromFiles(dir).find((suite) => suite.key === "suite")!.tasks[0];
  assert.deepEqual(task.traps?.map((trap) => trap.id), ["a-1", "b-2"]);
  assert.equal(task.sandbox?.trapsDir, "traps/t");
  assert.equal(task.sandbox?.trapCommand, "npx vitest run traps/");
});

test("readTrapTestCases understands vitest and playwright JSON reports", () => {
  const vitest = readTrapTestCases({
    testResults: [{ assertionResults: [
      { fullName: "traps double-delete removes one", status: "passed" },
      { fullName: "traps two-tabs keep both", status: "failed" }
    ] }]
  });
  assert.deepEqual(vitest, [
    { name: "traps double-delete removes one", passed: true },
    { name: "traps two-tabs keep both", passed: false }
  ]);

  const playwright = readTrapTestCases({
    suites: [{ title: "x.trap.ts", specs: [], suites: [{ title: "group", specs: [
      { title: "double-delete: one row", ok: true, tests: [{ status: "expected" }] },
      { title: "two-tabs: both kept", ok: false, tests: [{ status: "unexpected" }] }
    ] }] }]
  });
  assert.deepEqual(playwright.map((entry) => entry.passed), [true, false]);
  assert.match(playwright[0].name, /double-delete/);
  assert.deepEqual(readTrapTestCases(null), []);
});

test("mapTrapResults: pass only when every matching test passed, unknown when none matched", () => {
  const traps = [
    { id: "double-delete", description: "d" },
    { id: "two-tabs", description: "t" },
    { id: "never-run", description: "n" }
  ];
  const results = mapTrapResults(traps, [
    { name: "Double-Delete: first", passed: true },
    { name: "double-delete: after reload", passed: true },
    { name: "two-tabs: a", passed: true },
    { name: "two-tabs: b", passed: false }
  ]);
  assert.deepEqual(results.map((result) => [result.id, result.status]), [
    ["double-delete", "pass"],
    ["two-tabs", "fail"],
    ["never-run", "unknown"]
  ]);
});

function run(overrides: Partial<RunRecord> & { runKey: string; setupKey: string }): RunRecord {
  return {
    id: 1, benchmarkKey: "b", taskKey: "t", modelId: null, reviewMode: "off", judgeTotalTokens: 0,
    agentName: "claude-code", agentVersion: "v1", suiteName: "b/t", status: "completed", score: 5,
    outcomeScore: 5, processScore: 5, reviewScore: 5, efficiencyScore: 5, testsScore: 5, llmScore: 5, perfScore: 5,
    scoreProfile: "hybrid", scoreConfidence: "high", failureReason: null, latencyMs: 1, costUsd: 0, durationMs: 1,
    artifactsPath: "/tmp", logText: "", createdAt: "2026-01-01T00:00:00Z", diffAvailable: false, diffFilesChanged: 0,
    diffInsertions: 0, diffDeletions: 0, verifierTestsAvailable: false, verifierTestsTotal: 0, verifierTestsPassed: 0,
    qualityScore: null, screenshotFile: null, videoFile: null, agentUsageAvailable: false, agentInputTokens: 0,
    agentOutputTokens: 0, agentCostUsd: 0,
    ...overrides
  };
}

test("comparison builds a trap matrix (rows traps, columns setups) and carries blind ranks into exports", () => {
  const matrix = buildComparisonMatrix([
    run({ runKey: "r1", setupKey: "vanilla", blindRank: 2, blindNotes: "loses data", trapResults: [
      { id: "double-delete", description: "d", status: "fail" },
      { id: "two-tabs", description: "t", status: "pass" }
    ] }),
    run({ runKey: "r2", setupKey: "vanilla+review", blindRank: 1, blindNotes: "solid", trapResults: [
      { id: "double-delete", description: "d", status: "pass" },
      { id: "two-tabs", description: "t", status: "pass" }
    ] })
  ]);
  assert.deepEqual(matrix.trapIds, ["double-delete", "two-tabs"]);
  const vanilla = matrix.setups.find((setup) => setup.setupKey === "vanilla")!;
  assert.deepEqual(vanilla.traps["double-delete"], { passed: 0, failed: 1, unknown: 0 });
  assert.equal(vanilla.blindRank, 2);

  const lines = renderTrapMatrixLines(matrix).join("\n");
  assert.match(lines, /double-delete\s+(FAIL\s+pass|pass\s+FAIL)/);

  const md = renderComparison(matrix, { generatedAt: "2026-01-01T00:00:00Z" }, "md");
  assert.match(md, /## Traps \(hidden checks\)/);
  assert.match(md, /\| 1 \| vanilla\+review \| solid \|/);
  const json = JSON.parse(renderComparison(matrix, { generatedAt: "2026-01-01T00:00:00Z" }, "json"));
  assert.deepEqual(json.trapIds, ["double-delete", "two-tabs"]);
  assert.equal(json.setups.find((row: { setupKey: string }) => row.setupKey === "vanilla").blindRank, 2);
  const html = renderComparison(matrix, { generatedAt: "2026-01-01T00:00:00Z" }, "html");
  assert.match(html, /<h2>Traps<\/h2>/);
  assert.match(html, /Blind ranking/);
});

test("readSetupsFile selects variants by label and rejects unknown labels", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ab-setups-"));
  const file = path.join(dir, "setups.json");
  writeFileSync(file, JSON.stringify([
    { label: "vanilla", agent: "agents/claude-code.md" },
    { label: "vanilla+review", agent: "agents/claude-code.md", followupPrompt: "review" }
  ]));
  const picked = readSetupsFile(file, "vanilla+review");
  assert.equal(picked.length, 1);
  assert.equal(picked[0].followupPrompt, "review");
  assert.equal(readSetupsFile(file).length, 2);
  assert.throws(() => readSetupsFile(file, "nope"), /Unknown setup label/);
  assert.ok(readFileSync(file, "utf8").length > 0);
});

test("agentEnvPassthrough only accepts plain env var names", () => {
  assert.deepEqual(
    agentEnvPassthrough("# a\nEnv Passthrough: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, bad-name, $(x)\n"),
    ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]
  );
  assert.deepEqual(agentEnvPassthrough("# none"), []);
});
