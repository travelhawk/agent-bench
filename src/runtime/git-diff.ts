import { spawnSync } from "node:child_process";

export interface WorkspaceDiffStats {
  available: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
}

const GIT_IDENTITY_ARGS = ["-c", "user.email=agent-bench@local", "-c", "user.name=agent-bench"];
const PATCH_CHAR_LIMIT = 6000;

function commandExists(command: string): boolean {
  const lookup = process.platform === "win32"
    ? { bin: "where", args: [command] }
    : { bin: "which", args: [command] };
  const result = spawnSync(lookup.bin, lookup.args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0;
}

export function initWorkspaceGitBaseline(workspaceDir: string): boolean {
  if (!commandExists("git")) return false;

  const init = spawnSync("git", ["init", "-q"], { cwd: workspaceDir, stdio: "ignore" });
  if (init.status !== 0) return false;

  spawnSync("git", [...GIT_IDENTITY_ARGS, "add", "-A"], { cwd: workspaceDir, stdio: "ignore" });
  const commit = spawnSync(
    "git",
    [...GIT_IDENTITY_ARGS, "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "agent-bench baseline"],
    { cwd: workspaceDir, stdio: "ignore" }
  );
  return commit.status === 0;
}

function parseNumstat(numstatOutput: string): { filesChanged: number; insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  let filesChanged = 0;

  numstatOutput.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [added, removed] = trimmed.split("\t");
    filesChanged += 1;
    insertions += added === "-" ? 0 : Number(added) || 0;
    deletions += removed === "-" ? 0 : Number(removed) || 0;
  });

  return { filesChanged, insertions, deletions };
}

export function computeWorkspaceGitDiffStats(workspaceDir: string): WorkspaceDiffStats {
  const unavailable: WorkspaceDiffStats = { available: false, filesChanged: 0, insertions: 0, deletions: 0, patch: "" };
  if (!commandExists("git")) return unavailable;

  spawnSync("git", ["add", "-A"], { cwd: workspaceDir, stdio: "ignore" });

  const numstat = spawnSync("git", ["diff", "--numstat", "--cached", "HEAD"], {
    cwd: workspaceDir,
    encoding: "utf8"
  });
  if (numstat.status !== 0) return unavailable;

  const patchResult = spawnSync("git", ["diff", "--cached", "HEAD"], { cwd: workspaceDir, encoding: "utf8" });
  const { filesChanged, insertions, deletions } = parseNumstat(numstat.stdout ?? "");

  return {
    available: true,
    filesChanged,
    insertions,
    deletions,
    patch: (patchResult.stdout ?? "").slice(0, PATCH_CHAR_LIMIT)
  };
}
