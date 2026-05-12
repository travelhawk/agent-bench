import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function getWorkspaceRoot(): string {
  return process.cwd();
}

export function resolveDbPath(cwd: string, input?: string): string {
  if (input) return path.resolve(cwd, input);

  const envPath = process.env.AGENT_BENCH_DB_PATH?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(cwd, envPath);
  }

  return path.join(os.homedir(), ".agent-bench", "data.db");
}

export function ensureProjectDirs(dbPath: string): { root: string; artifacts: string } {
  const root = path.dirname(dbPath);
  const artifacts = path.join(root, "artifacts");
  mkdirSync(root, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  return { root, artifacts };
}

export function getArtifactsRoot(dbPath: string): string {
  return path.join(path.dirname(dbPath), "artifacts");
}

export function resolveBenchmarksDir(workspaceRoot = getWorkspaceRoot()): string {
  return path.join(workspaceRoot, "benchmarks");
}
