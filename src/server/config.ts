import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Stamped into shared comparison exports so a report says which build produced it. */
export const TOOL_VERSION = "0.4.0";

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

/** Where the shipped starter agents live. */
export function resolvePackagedExamplesDir(): string | null {
  return resolvePackagedDir(path.join("examples", "sample-workspace"));
}

/** The benchmark suites shipped with the package, used to seed a fresh workspace. */
export function resolvePackagedBenchmarksDir(): string | null {
  return resolvePackagedDir("benchmarks");
}

/** The env template shipped with the package, so `init` can seed a workspace that has none. */
export function resolvePackagedEnvSample(): string | null {
  return resolvePackagedDir(".env.sample");
}

/**
 * Anchors on the package root rather than searching for the directory by name.
 * `dist/src/benchmarks` is a compiled module directory, so a search by name
 * finds that code before the benchmark data and seeds a workspace with `.js`
 * files instead of suites.
 */
function resolvePackagedDir(relative: string): string | null {
  const root = findPackageRoot();
  if (!root) return null;
  const candidate = path.join(root, relative);
  return existsSync(candidate) ? candidate : null;
}

/**
 * The compiled entrypoint sits a few directories below the package root, and
 * the depth differs between the TypeScript sources and `dist/`, so walk up to
 * the nearest package.json instead of hard-coding a hop count.
 */
function findPackageRoot(): string | null {
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
