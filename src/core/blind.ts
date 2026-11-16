import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Blind review: every workspace is copied to an anonymous letter folder, a
 * reviewer ranks the letters, and only afterwards are letters mapped back to
 * setups. The key lives outside the folder the reviewer sees.
 */

/**
 * Files that would reveal which workflow built the app (or are just noise):
 * VCS data, dependencies, harness reports, agent logs and hidden-check files.
 */
export const BLIND_EXCLUDE = new Set([
  ".git", "node_modules", "result", "traps", "trap-results.json", "test-results", "playwright-report",
  ".claude", ".agents", ".forge", ".codex", "dist", "coverage", ".vite", "CLAUDE.md", "AGENTS.md"
]);

export interface BlindEntry {
  letter: string;
  setupKey: string;
  runKey: string;
  workspaceDir: string;
}

export interface BlindRankingEntry {
  letter: string;
  rank: number;
  notes?: string;
}

export interface BlindVerdict {
  setupKey: string;
  runKey: string;
  letter: string;
  rank: number | null;
  notes: string | null;
}

export function blindLetter(index: number): string {
  let label = "";
  let value = index;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

/** Fisher-Yates over the runs, then letters A, B, C... in shuffled order. */
export function assignBlindLetters(
  runs: Array<{ setupKey: string; runKey: string; workspaceDir: string }>,
  random: () => number = Math.random
): BlindEntry[] {
  const shuffled = [...runs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.map((run, index) => ({ ...run, letter: blindLetter(index) }));
}

/** Accepts `[{letter, rank, notes}]` or `{ranking: [...]}`. */
export function parseBlindRanking(raw: unknown): BlindRankingEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { ranking?: unknown }).ranking)
      ? (raw as { ranking: unknown[] }).ranking
      : null;
  if (!list) throw new Error("ranking.json must be an array of {letter, rank, notes}.");
  return list.flatMap((entry) => {
    const item = entry as { letter?: unknown; rank?: unknown; notes?: unknown };
    const letter = typeof item?.letter === "string" ? item.letter.trim().toUpperCase() : "";
    const rank = Number(item?.rank);
    if (!letter || !Number.isFinite(rank)) return [];
    return [{ letter, rank, notes: typeof item.notes === "string" ? item.notes : undefined }];
  });
}

/** Maps letters back to setups; letters the reviewer skipped get rank null. */
export function mapBlindRanking(entries: BlindEntry[], ranking: BlindRankingEntry[]): BlindVerdict[] {
  const byLetter = new Map(ranking.map((entry) => [entry.letter, entry]));
  return entries.map((entry) => {
    const verdict = byLetter.get(entry.letter);
    return {
      setupKey: entry.setupKey,
      runKey: entry.runKey,
      letter: entry.letter,
      rank: verdict ? verdict.rank : null,
      notes: verdict?.notes ?? null
    };
  });
}

/** Copies a workspace without the files in BLIND_EXCLUDE (at any depth). */
export function copyWorkspaceBlind(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(sourceDir)) {
    if (BLIND_EXCLUDE.has(name)) continue;
    const from = path.join(sourceDir, name);
    const to = path.join(targetDir, name);
    if (statSync(from).isDirectory()) {
      copyWorkspaceBlind(from, to);
    } else {
      cpSync(from, to);
    }
  }
}

export interface PreparedBlindReview {
  rootDir: string;
  blindDir: string;
  keyPath: string;
  taskFile: string;
  entries: BlindEntry[];
}

/**
 * Lays out `<root>/blind/<letter>/` plus `<root>/blind/TASK.md` and writes the
 * letter key to `<root>/blind-key.json`, outside the reviewer's folder.
 */
export function prepareBlindReview(input: {
  rootDir: string;
  runs: Array<{ setupKey: string; runKey: string; workspaceDir: string }>;
  taskMarkdown: string;
  random?: () => number;
}): PreparedBlindReview {
  const blindDir = path.join(input.rootDir, "blind");
  mkdirSync(blindDir, { recursive: true });
  const entries = assignBlindLetters(input.runs.filter((run) => existsSync(run.workspaceDir)), input.random);
  for (const entry of entries) {
    copyWorkspaceBlind(entry.workspaceDir, path.join(blindDir, entry.letter));
  }
  const taskFile = path.join(blindDir, "TASK.md");
  writeFileSync(taskFile, input.taskMarkdown, "utf8");
  const keyPath = path.join(input.rootDir, "blind-key.json");
  writeFileSync(keyPath, JSON.stringify(entries.map(({ letter, setupKey, runKey }) => ({ letter, setupKey, runKey })), null, 2));
  return { rootDir: input.rootDir, blindDir, keyPath, taskFile, entries };
}

export function readBlindRankingFile(blindDir: string): BlindRankingEntry[] {
  const rankingPath = path.join(blindDir, "ranking.json");
  if (!existsSync(rankingPath)) {
    throw new Error(`Blind reviewer did not write ${rankingPath}.`);
  }
  return parseBlindRanking(JSON.parse(readFileSync(rankingPath, "utf8")));
}
