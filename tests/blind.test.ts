import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assignBlindLetters,
  blindLetter,
  mapBlindRanking,
  parseBlindRanking,
  prepareBlindReview,
  readBlindRankingFile
} from "../src/core/blind";

const runs = [
  { setupKey: "vanilla", runKey: "r1", workspaceDir: "/w1" },
  { setupKey: "vanilla+review", runKey: "r2", workspaceDir: "/w2" },
  { setupKey: "forge", runKey: "r3", workspaceDir: "/w3" }
];

test("blindLetter counts A..Z then AA", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(blindLetter), ["A", "B", "Z", "AA", "AB"]);
});

test("assignBlindLetters shuffles with the given random source and keeps every run once", () => {
  const entries = assignBlindLetters(runs, () => 0);
  assert.deepEqual(entries.map((entry) => entry.letter), ["A", "B", "C"]);
  assert.deepEqual(entries.map((entry) => entry.runKey).sort(), ["r1", "r2", "r3"]);
  // With random() = 0 Fisher-Yates rotates: the order differs from the input.
  assert.notDeepEqual(entries.map((entry) => entry.runKey), ["r1", "r2", "r3"]);
});

test("mapBlindRanking maps letters back to setups; unranked letters get null", () => {
  const entries = assignBlindLetters(runs, () => 0.99);
  const ranking = parseBlindRanking([
    { letter: entries[2].letter.toLowerCase(), rank: 1, notes: "best" },
    { letter: entries[0].letter, rank: "2" },
    { letter: "Z", rank: 3 },
    { rank: 4 }
  ]);
  const verdicts = mapBlindRanking(entries, ranking);
  assert.equal(verdicts.find((v) => v.runKey === entries[2].runKey)?.rank, 1);
  assert.equal(verdicts.find((v) => v.runKey === entries[2].runKey)?.notes, "best");
  assert.equal(verdicts.find((v) => v.runKey === entries[0].runKey)?.rank, 2);
  assert.equal(verdicts.find((v) => v.runKey === entries[1].runKey)?.rank, null);
  assert.equal(verdicts.length, 3);
});

test("parseBlindRanking accepts {ranking: [...]} and rejects other shapes", () => {
  assert.equal(parseBlindRanking({ ranking: [{ letter: "A", rank: 1 }] }).length, 1);
  assert.throws(() => parseBlindRanking({ nope: true }), /array/);
});

test("prepareBlindReview copies workspaces without revealing files and keeps the key outside", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ab-blind-"));
  const make = (name: string) => {
    const dir = path.join(root, "src", name);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    mkdirSync(path.join(dir, "result"), { recursive: true });
    mkdirSync(path.join(dir, "traps"), { recursive: true });
    writeFileSync(path.join(dir, "src", "app.ts"), `// ${name}`);
    writeFileSync(path.join(dir, "result", "usage.json"), "{}");
    writeFileSync(path.join(dir, "CLAUDE.md"), "workflow hint");
    return dir;
  };
  const prepared = prepareBlindReview({
    rootDir: path.join(root, "review"),
    runs: [
      { setupKey: "s1", runKey: "r1", workspaceDir: make("one") },
      { setupKey: "s2", runKey: "r2", workspaceDir: make("two") },
      { setupKey: "gone", runKey: "r3", workspaceDir: path.join(root, "missing") }
    ],
    taskMarkdown: "# Task",
    random: () => 0.5
  });

  assert.equal(prepared.entries.length, 2);
  for (const entry of prepared.entries) {
    const dir = path.join(prepared.blindDir, entry.letter);
    assert.ok(existsSync(path.join(dir, "src", "app.ts")));
    for (const hidden of ["node_modules", ".git", "result", "traps", "CLAUDE.md"]) {
      assert.equal(existsSync(path.join(dir, hidden)), false, `${hidden} must not be copied`);
    }
  }
  assert.ok(path.relative(prepared.blindDir, prepared.keyPath).startsWith(".."), "key lives outside the blind folder");
  const key = JSON.parse(readFileSync(prepared.keyPath, "utf8"));
  assert.deepEqual(key.map((entry: { setupKey: string }) => entry.setupKey).sort(), ["s1", "s2"]);
  assert.equal(readFileSync(prepared.taskFile, "utf8"), "# Task");

  assert.throws(() => readBlindRankingFile(prepared.blindDir), /ranking\.json/);
  writeFileSync(path.join(prepared.blindDir, "ranking.json"), JSON.stringify([{ letter: "A", rank: 1, notes: "ok" }]));
  assert.equal(readBlindRankingFile(prepared.blindDir)[0].letter, "A");
});
