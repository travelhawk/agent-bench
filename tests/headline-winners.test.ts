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

/** The haushaltsbuch case: vanilla had the higher stored rules score, forge wins traps + blind review. */
function haushaltsbuchMatrix() {
  const runs: RunRecord[] = [];
  for (let i = 0; i < 3; i += 1) {
    runs.push(run(`v${i}`, "vanilla", { score: 9.18, trapResults: traps(i === 0 ? 4 : 2, 5), blindRank: [6, 6, 7][i], agentCostUsd: 0.64, costUsd: 0 }));
    runs.push(run(`f${i}`, "forge", { score: 8.99, trapResults: traps(4, 5), blindRank: [2, 2, 2][i], agentCostUsd: 1.31, costUsd: 0 }));
  }
  return buildComparisonMatrix(runs, {});
}

test("traps and blind rank decide the verdict; rules runs have no score or quality", () => {
  const lines = renderMatrixWinners(haushaltsbuchMatrix());
  assert.match(lines[0], /^Verdict: forge \(most traps passed and best blind rank\)/);
  assert.match(lines[1], /^Most traps passed: forge .*\(12\/15\)/);
  assert.match(lines[2], /^Best blind rank:\s+forge .*\(2\.0\)/);
  const text = lines.join("\n");
  assert.doesNotMatch(text, /Rules score|Best judge score|Best score/);
  assert.doesNotMatch(text, /Best quality/, "no judge ran, so no quality winner");
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
  assert.equal(headline.qualityAllEqual, false);
  assert.match(headline.verdict ?? "", /tie on traps between a = b/);
});

test("per-setup row labels cost as a total over N runs with the average", () => {
  const text = renderMatrixLines(haushaltsbuchMatrix()).join("\n");
  assert.doesNotMatch(text, /rules score/);
  assert.match(text, /judge score n\/a \| quality n\/a/);
  assert.doesNotMatch(text, /quality 6\.00/);
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
  assert.equal(payload.winners.score, null);
  assert.equal(payload.winners.quality, null);
  assert.match(payload.winners.verdict ?? "", /^forge/);
  const forgeRow = payload.setups.find((row) => row.setupKey === "forge")!;
  assert.equal(forgeRow.avgCostUsd, 1.31);
  assert.equal(forgeRow.avgScore, null);
  assert.equal(forgeRow.avgQuality, null);

  const md = renderComparisonMarkdown(matrix, meta);
  const winners = md.slice(md.indexOf("## Winners"));
  assert.match(winners, /\*\*Verdict:\*\* forge/);
  assert.ok(winners.indexOf("Most traps passed") >= 0);
  assert.doesNotMatch(md, /Rules score|Best judge score|Best score|Best quality/);
  assert.doesNotMatch(md, /6\.00/);
  assert.match(md, /Cost \(total over runs\)/);

  const html = renderComparisonHtml(matrix, meta);
  assert.match(html, /<strong>Verdict:<\/strong> forge/);
  assert.match(html, /<li><strong>Most traps passed:<\/strong> forge \(12\/15\)<\/li><li><strong>Best blind rank:<\/strong> forge \(2\.0\)/);
  assert.match(html, /class="trap-winner">forge ★/);
  assert.doesNotMatch(html, /Best score|Best judge score|Rules score/);
});

test("guard: identical agent file, different traps - never a quality tie, worse traps never win a score/quality winner", () => {
  // Same agent markdown, so the old rules heuristic gave both the same review
  // score and quality 6.00; only the hidden traps differ.
  const runs: RunRecord[] = [];
  for (let i = 0; i < 3; i += 1) {
    runs.push(run(`good${i}`, "good", { score: 8.9, qualityScore: 6, trapResults: traps(5, 5) }));
    runs.push(run(`bad${i}`, "bad", { score: 9.2, qualityScore: 6, trapResults: traps(1, 5) }));
  }
  const matrix = buildComparisonMatrix(runs, {});
  for (const setup of matrix.setups) {
    assert.equal(setup.avgQuality, null, `${setup.setupKey} must not carry a rules quality`);
    assert.equal(setup.avgScore, null, `${setup.setupKey} must not carry a rules score`);
  }
  assert.equal(matrix.setups[0].setupKey, "good", "traps order the leaderboard when no judge ran");

  const meta = { generatedAt: "2026-11-17T10:00:00.000Z" } as Parameters<typeof buildComparisonExport>[1];
  const payload = buildComparisonExport(matrix, meta);
  assert.notEqual(payload.winners.score, "bad");
  assert.notEqual(payload.winners.quality, "bad");
  assert.equal(payload.winners.traps, "good");
  assert.match(payload.winners.verdict ?? "", /^good/);

  const text = renderMatrixWinners(matrix).join("\n");
  assert.doesNotMatch(text, /score.*bad|quality.*bad/i);

  // With a real judge the numbers count again.
  const judged = buildComparisonMatrix(runs.map((entry) => ({ ...entry, reviewMode: "gateway" as const })), {});
  assert.equal(judged.setups.find((setup) => setup.setupKey === "good")!.avgQuality, 6);
});

test("trap tie broken by the unique blind winner names it as verdict", () => {
  const headline = buildHeadlineWinners([
    { setupKey: "a", traps: { t1: { passed: 2, failed: 1, unknown: 0 } }, blindRank: 2, reviewModes: { rules: 3 }, avgScore: 9, avgQuality: 6 },
    { setupKey: "b", traps: { t1: { passed: 2, failed: 1, unknown: 0 } }, blindRank: 1, reviewModes: { rules: 3 }, avgScore: 8, avgQuality: 6 },
    { setupKey: "c", traps: { t1: { passed: 0, failed: 3, unknown: 0 } }, blindRank: 3, reviewModes: { rules: 3 }, avgScore: 8, avgQuality: 6 }
  ]);
  assert.match(headline.verdict ?? "", /^b \(tied on traps with a, best blind rank\)/);
});

test("a setup with no passed trap is never the trap winner; errors count as not passed", () => {
  const headline = buildHeadlineWinners([
    { setupKey: "a", traps: { t1: { passed: 0, failed: 3, unknown: 0 } }, blindRank: null, reviewModes: { rules: 3 }, avgScore: 9, avgQuality: 6 },
    { setupKey: "b", traps: { t1: { passed: 0, failed: 0, unknown: 0, error: 3 } }, blindRank: null, reviewModes: { rules: 3 }, avgScore: 8, avgQuality: 6 }
  ]);
  assert.equal(headline.traps, null);
  assert.equal(headline.verdict, null);
});

test("blind-review notes escape pipes in the Markdown table", () => {
  const matrix = buildComparisonMatrix([
    run("a1", "a", { blindRank: 1, blindNotes: "fast | clean" }),
    run("b1", "b", { blindRank: 2, blindNotes: "slow" })
  ], {});
  const markdown = renderComparisonMarkdown(matrix, { generatedAt: "2026-11-17T10:00:00.000Z" } as Parameters<typeof buildComparisonExport>[1]);
  assert.ok(markdown.includes("fast \\| clean"), markdown);
});
