import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Blind review: every workspace is copied to an anonymous letter folder, a
 * reviewer ranks the letters, and only afterwards are letters mapped back to
 * setups. The key lives outside the folder the reviewer sees.
 */

/**
 * Names that must not reach the reviewer: VCS data, dependencies, harness
 * reports, the hidden checks, build output, editor and agent state, agent
 * instruction files, and secrets.
 *
 * The agent-state entries are the ones that decide whether the review is blind
 * at all. A workflow that leaves `.oneshot/` behind, next to a build from a
 * workflow that leaves nothing, splits the folders into two groups before the
 * reviewer has read a line of code. New agent tooling appears faster than this
 * list grows, which is why every unrecognised dotted directory is dropped too,
 * at any depth.
 */
const BLIND_EXCLUDE_NAMES = new Set([
  // Version control and dependencies.
  ".git", ".svn", ".hg", "node_modules",
  // Harness output and the hidden checks.
  "result", "traps", "trap-results.json", "test-results", "playwright-report",
  // Build output and caches.
  "dist", "coverage",
  // Agent instruction files and dotted rule files. Agent state folders are
  // covered by the dotted-directory rule below.
  "claude.md", "agents.md", "agent.md", "gemini.md", "qwen.md", "copilot-instructions.md",
  "conventions.md", ".cursorrules", ".windsurfrules", ".clinerules", ".roomodes", ".claude.json",
  // Secrets and OS noise.
  ".env", ".ds_store", "thumbs.db"
]);

/** Families of generated files, e.g. `.aider.chat.history.md` or `.env.local`. */
const BLIND_EXCLUDE_PREFIXES = [".aider", ".env."];

/** Dotted directories that are part of the build, not of the agent that ran it. */
const BLIND_KEEP_DOT_DIRS = new Set([".github", ".vscode-test", ".storybook", ".husky", ".yarn"]);

/**
 * Compared lowercase throughout: Windows paths are case-insensitive, so a
 * case-sensitive list lets `Claude.md` through while stripping `CLAUDE.md`, and
 * the reviewer sees a file in one folder and not in another.
 */
export function isBlindExcluded(name: string, isDirectory: boolean): boolean {
  const lower = name.toLowerCase();
  if (BLIND_EXCLUDE_NAMES.has(lower)) return true;
  if (BLIND_EXCLUDE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  // Agent and editor state lives in dotted directories. Denying by default means
  // a workflow this list has never heard of cannot sign its own build.
  return isDirectory && lower.startsWith(".") && !BLIND_KEEP_DOT_DIRS.has(lower);
}

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

/**
 * Copies a workspace, dropping everything `isBlindExcluded` rejects, at any
 * depth.
 *
 * Symlinks are skipped rather than copied. A link is both a leak and a hazard:
 * its target path can name the run it came from, and following one can walk
 * back out into the real workspace next to `traps/`. `readdirSync` with file
 * types also avoids a `stat` per entry, so a dangling link cannot throw and
 * cost the whole batch its review.
 */
export function copyWorkspaceBlind(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (isBlindExcluded(entry.name, entry.isDirectory())) continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyWorkspaceBlind(from, to);
    } else if (entry.isFile()) {
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
