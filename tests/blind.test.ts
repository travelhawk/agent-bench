import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assignBlindLetters,
  blindLetter,
  copyWorkspaceBlind,
  isBlindExcluded,
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


/**
 * The blind folder is the whole guarantee. A workflow that leaves its own state
 * folder behind, next to one that leaves nothing, splits the builds into two
 * groups before the reviewer reads a line of code.
 */
test("agent and editor state never reaches the reviewer", () => {
  const source = mkdtempSync(path.join(os.tmpdir(), "blind-src-"));
  const target = path.join(mkdtempSync(path.join(os.tmpdir(), "blind-dst-")), "A");

  const leaks = [
    ".agent/session.md",
    ".oneshot/plan.md",
    ".claude/settings.json",
    ".cursor/rules.md",
    ".specstory/history.md",
    ".vscode/settings.json",
    ".forge/state.json",
    ".codex/log.txt",
    "traps/trap.spec.ts",
    "result/score.json"
  ];
  for (const relative of leaks) {
    mkdirSync(path.join(source, path.dirname(relative)), { recursive: true });
    writeFileSync(path.join(source, relative), "x");
  }
  for (const name of [".env", ".env.local", ".aider.chat.history.md", "CLAUDE.md", "Claude.md", "AGENTS.md", ".cursorrules"]) {
    writeFileSync(path.join(source, name), "x");
  }

  // What a reviewer is supposed to see.
  mkdirSync(path.join(source, "src"), { recursive: true });
  writeFileSync(path.join(source, "src", "app.ts"), "export const app = 1;");
  writeFileSync(path.join(source, "package.json"), "{}");
  mkdirSync(path.join(source, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(source, ".github", "workflows", "ci.yml"), "on: push");

  copyWorkspaceBlind(source, target);

  for (const relative of [...leaks, ".env", ".env.local", ".aider.chat.history.md", "CLAUDE.md", "Claude.md", "AGENTS.md", ".cursorrules"]) {
    assert.equal(existsSync(path.join(target, relative)), false, `${relative} leaked into the blind folder`);
  }
  assert.equal(existsSync(path.join(target, "src", "app.ts")), true);
  assert.equal(existsSync(path.join(target, "package.json")), true);
  assert.equal(existsSync(path.join(target, ".github", "workflows", "ci.yml")), true);
});

test("an unknown dotted directory is excluded, so new agent tooling cannot sign a build", () => {
  assert.equal(isBlindExcluded(".some-future-agent", true), true);
  assert.equal(isBlindExcluded(".github", true), false);
  // A dotted file is judged by name, not by the directory rule.
  assert.equal(isBlindExcluded(".gitignore", false), false);
  assert.equal(isBlindExcluded(".env.production", false), true);
});

test("the exclude list is case-insensitive, because Windows paths are", () => {
  for (const name of ["CLAUDE.md", "Claude.md", "claude.md", "AGENTS.md", "Agents.md"]) {
    assert.equal(isBlindExcluded(name, false), true, `${name} should be excluded`);
  }
  assert.equal(isBlindExcluded("Node_Modules", true), true);
});

test("a nested workspace keeps being stripped at depth", () => {
  const source = mkdtempSync(path.join(os.tmpdir(), "blind-deep-src-"));
  const target = path.join(mkdtempSync(path.join(os.tmpdir(), "blind-deep-dst-")), "A");
  mkdirSync(path.join(source, "packages", "web", ".agent"), { recursive: true });
  writeFileSync(path.join(source, "packages", "web", ".agent", "notes.md"), "x");
  mkdirSync(path.join(source, "packages", "web", "src"), { recursive: true });
  writeFileSync(path.join(source, "packages", "web", "src", "index.ts"), "export {};");

  copyWorkspaceBlind(source, target);

  assert.equal(existsSync(path.join(target, "packages", "web", ".agent")), false);
  assert.equal(existsSync(path.join(target, "packages", "web", "src", "index.ts")), true);
});
