import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonMatrix, buildHeadlineWinners } from "../src/core/comparison";
import { renderMatrixLines, renderMatrixWinners } from "../src/core/matrix-print";
import { buildComparisonExport, renderComparisonHtml, renderComparisonMarkdown } from "../src/core/export";
import { RunRecord, TrapResult } from "../src/types";

function traps(passed: number, total: number): TrapResult[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `t${index + 1}`,
    description: `trap ${index + 1}`,
    status: index < passed ? "pass" : "fail"
  })) as TrapResult[];
}

function run(runKey: string, setupKey: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 1, runKey, setupKey, benchmarkKey: "workflow-builds", taskKey: "haushaltsbuch",
    modelId: null, reviewMode: "rules", judgeTotalTokens: 0, agentName: setupKey, agentVersion: "v1",
    suiteName: "workflow-builds/haushaltsbuch", status: "completed", score: 9, qualityScore: 6,
    durationMs: 1000, costUsd: 1, agentCostUsd: 1, agentUsageAvailable: true,
    agentInputTokens: 1000, agentOutputTokens: 100, createdAt: "2026-11-17T09:00:00.000Z",
    verifierTestsAvailable: false, verifierTestsTotal: 0, verifierTestsPassed: 0,
    artifactsPath: "/tmp/none", logText: "", diffAvailable: false,
    ...overrides
  } as RunRecord;
}

/** The haushaltsbuch case: vanilla wins the heuristic, forge wins traps + blind review. */
function haushaltsbuchMatrix() {
  const runs: RunRecord[] = [];
  for (let i = 0; i < 3; i += 1) {
    runs.push(run(`v${i}`, "vanilla", { score: 9.18, trapResults: traps(i === 0 ? 4 : 2, 5), blindRank: [6, 6, 7][i], agentCostUsd: 0.64, costUsd: 0 }));
    runs.push(run(`f${i}`, "forge", { score: 8.99, trapResults: traps(4, 5), blindRank: [2, 2, 2][i], agentCostUsd: 1.31, costUsd: 0 }));
  }
  return buildComparisonMatrix(runs, {});
}

test("traps and blind rank decide the verdict, not the rules heuristic", () => {
  const lines = renderMatrixWinners(haushaltsbuchMatrix());
  assert.match(lines[0], /^Verdict: forge \(most traps passed and best blind rank\)/);
  assert.match(lines[1], /^Most traps passed: forge .*\(12\/15\)/);
  assert.match(lines[2], /^Best blind rank:\s+forge .*\(2\.0\)/);
  const text = lines.join("\n");
  assert.match(text, /Rules score \(heuristic\): vanilla/);
  assert.doesNotMatch(text, /Best score/);
  assert.doesNotMatch(text, /Best quality/, "all qualities are 6.00, so no quality winner");
});

test("verdict says so when traps and blind rank disagree", () => {
  const headline = buildHeadlineWinners([
    { setupKey: "a", traps: { t1: { passed: 3, failed: 0, unknown: 0 } }, blindRank: 3, reviewModes: { rules: 3 }, avgScore: 9, avgQuality: 6 },
    { setupKey: "b", traps: { t1: { passed: 1, failed: 2, unknown: 0 } }, blindRank: 1, reviewModes: { rules: 3 }, avgScore: 8, avgQuality: 6 }
  ]);
  assert.deepEqual(headline.traps?.setupKeys, ["a"]);
  assert.deepEqual(headline.blindRank?.setupKeys, ["b"]);
  assert.match(headline.verdict ?? "", /no clear winner - traps favour a, blind review favours b/);
});

test("trap ties list every tied setup", () => {
  const headline = buildHeadlineWinners([
    { setupKey: "a", traps: { t1: { passed: 2, failed: 1, unknown: 0 } }, blindRank: null, reviewModes: { gateway: 3 }, avgScore: 9, avgQuality: 7 },
    { setupKey: "b", traps: { t1: { passed: 2, failed: 1, unknown: 0 } }, blindRank: null, reviewModes: { gateway: 3 }, avgScore: 8, avgQuality: 6 }
  ]);
  assert.deepEqual(headline.traps?.setupKeys, ["a", "b"]);
  assert.equal(headline.scoreIsHeuristic, false);
  assert.equal(headline.qualityAllEqual, false);
  assert.match(headline.verdict ?? "", /tie on traps between a = b/);
});

test("per-setup row labels cost as a total over N runs with the average", () => {
  const text = renderMatrixLines(haushaltsbuchMatrix()).join("\n");
  assert.match(text, /rules score \(heuristic\)/);
  assert.match(text, /cost \$3\.93 total over 3 runs \(avg \$1\.31\)/);
});

test("json, md and html exports carry traps + blind rank winners first", () => {
  const matrix = haushaltsbuchMatrix();
  const meta = { generatedAt: "2026-11-17T10:00:00.000Z" } as Parameters<typeof buildComparisonExport>[1];
  const payload = buildComparisonExport(matrix, meta);
  assert.equal(payload.winners.traps, "forge");
  assert.equal(payload.winners.trapsPassed, 12);
  assert.equal(payload.winners.trapsTotal, 15);
  assert.equal(payload.winners.blindRank, "forge");
  assert.equal(payload.winners.blindRankValue, 2);
  assert.equal(payload.winners.scoreIsHeuristic, true);
  assert.equal(payload.winners.quality, null);
  assert.match(payload.winners.verdict ?? "", /^forge/);
  const forgeRow = payload.setups.find((row) => row.setupKey === "forge")!;
  assert.equal(forgeRow.avgCostUsd, 1.31);
  assert.equal(forgeRow.scoreIsHeuristic, true);

  const md = renderComparisonMarkdown(matrix, meta);
  const winners = md.slice(md.indexOf("## Winners"));
  assert.match(winners, /\*\*Verdict:\*\* forge/);
  assert.ok(winners.indexOf("Most traps passed") < winners.indexOf("Rules score (heuristic)"));
  assert.doesNotMatch(md, /Best score|Best quality/);
  assert.match(md, /Cost \(total over runs\)/);

  const html = renderComparisonHtml(matrix, meta);
  assert.match(html, /<strong>Verdict:<\/strong> forge/);
  assert.match(html, /<li><strong>Most traps passed:<\/strong> forge \(12\/15\)<\/li><li><strong>Best blind rank:<\/strong> forge \(2\.0\)/);
  assert.match(html, /class="trap-winner">forge ★/);
  assert.doesNotMatch(html, /Best score/);
});
