import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AgentRecord, AgentSkillReference } from "../types";

const EXCLUDED_FILE_NAMES = new Set(["README.md"]);
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".next", ".agent-bench", "tasks"]);
export const AGENT_BUNDLE_MANIFEST = "agent-bench.bundle.json";

interface ManagedAgentBundleManifest {
  version: 1;
  entryFile: string;
  createdAt: string;
  baseAgentPath?: string | null;
  skills?: AgentSkillReference[];
}

export interface ResolvedAgentExecutionContext {
  absoluteEntryPath: string;
  absoluteBundlePath: string;
  bundleMode: "flat" | "bundle";
  content: string;
  runnerCommand?: string;
  assetFileCount: number;
  skills: AgentSkillReference[];
}

function toAgentKey(relativePath: string): string {
  return relativePath.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function summarizeAgent(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 140);

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  return (firstLine || "Agent definition ready for benchmark runs.").slice(0, 140);
}

function extractRunnerCommand(content: string): string | undefined {
  const match = content.match(/^Runner(?: Command)?:\s*(.+)$/mi);
  return match?.[1]?.trim() || undefined;
}

export function readAgentRunnerCommand(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return extractRunnerCommand(readFileSync(filePath, "utf8"));
}

export function getManagedAgentsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent-bench", "agents");
}

function isSameOrNestedPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath);
}

function readManagedBundleManifest(bundleRoot: string): ManagedAgentBundleManifest | null {
  const manifestPath = path.join(bundleRoot, AGENT_BUNDLE_MANIFEST);
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ManagedAgentBundleManifest;
  } catch {
    return null;
  }
}

export function readAgentBundleManifest(bundleRoot: string): ManagedAgentBundleManifest | null {
  return readManagedBundleManifest(bundleRoot);
}

function sanitizeManifestEntry(bundleRoot: string, entryFile: string | undefined): string | null {
  if (!entryFile?.trim()) return null;
  const absoluteEntryPath = path.resolve(bundleRoot, entryFile);
  if (!isSameOrNestedPath(bundleRoot, absoluteEntryPath)) return null;
  if (!existsSync(absoluteEntryPath) || !statSync(absoluteEntryPath).isFile()) return null;
  if (path.extname(absoluteEntryPath).toLowerCase() !== ".md") return null;
  return absoluteEntryPath;
}

function resolveAgentEntryFromDir(dirPath: string): string {
  const manifest = readManagedBundleManifest(dirPath);
  const manifestEntry = sanitizeManifestEntry(dirPath, manifest?.entryFile);
  if (manifestEntry) return manifestEntry;

  const agentsMd = path.join(dirPath, "AGENTS.md");
  if (existsSync(agentsMd) && statSync(agentsMd).isFile()) {
    return agentsMd;
  }

  const markdownFiles = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md" && !EXCLUDED_FILE_NAMES.has(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (markdownFiles.length === 1) {
    return markdownFiles[0];
  }

  throw new Error(`Agent directory does not contain a resolvable entry markdown file: ${dirPath}`);
}

function isWorkspaceAgentMarkdownFile(workspaceRoot: string, absolutePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, absolutePath);
  const segments = relativePath.split(path.sep);
  const fileName = path.basename(absolutePath);

  if (!relativePath || relativePath.startsWith("..")) return false;
  if (path.extname(fileName).toLowerCase() !== ".md") return false;
  if (EXCLUDED_FILE_NAMES.has(fileName)) return false;
  if (segments.includes("tasks")) return false;
  if (segments[0] !== "agents") return false;
  if (fileName === "AGENTS.md") {
    return segments.length > 2;
  }

  return true;
}

function walkFiles(currentDir: string, results: string[], excludedDirs = EXCLUDED_DIR_NAMES): void {
  const entries = readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) return;
      walkFiles(absolutePath, results, excludedDirs);
      return;
    }

    if (entry.isFile()) {
      results.push(absolutePath);
    }
  });
}

function listBundleFiles(bundleRoot: string, entryPath: string, bundleMode: "flat" | "bundle"): string[] {
  if (bundleMode === "flat") {
    return [];
  }

  const files: string[] = [];
  walkFiles(bundleRoot, files);
  return files.filter((filePath) => filePath !== entryPath);
}

function inferBundledSkillReferences(bundleRoot: string): AgentSkillReference[] {
  const skillsDir = path.join(bundleRoot, ".agents", "skills");
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    return [];
  }

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      source: entry.name,
      skillName: entry.name,
      installSpec: entry.name,
      title: entry.name,
      origin: "bundled" as const
    }))
    .sort((left, right) => left.skillName.localeCompare(right.skillName));
}

function resolveBundledSkills(bundleRoot: string): AgentSkillReference[] {
  const manifestSkills = readManagedBundleManifest(bundleRoot)?.skills;
  if (Array.isArray(manifestSkills) && manifestSkills.length > 0) {
    return manifestSkills.map((skill) => ({
      ...skill,
      origin: skill.origin ?? "skills.sh"
    }));
  }

  return inferBundledSkillReferences(bundleRoot);
}

export function resolveAgentExecutionContext(agentPath: string): ResolvedAgentExecutionContext {
  const absoluteInputPath = path.resolve(agentPath);
  if (!existsSync(absoluteInputPath)) {
    throw new Error(`Agent file not found: ${agentPath}`);
  }

  const stats = statSync(absoluteInputPath);
  const absoluteEntryPath = stats.isDirectory()
    ? resolveAgentEntryFromDir(absoluteInputPath)
    : absoluteInputPath;

  const absoluteBundlePath = path.dirname(absoluteEntryPath);
  const bundleMode = (
    path.basename(absoluteEntryPath) === "AGENTS.md"
    || existsSync(path.join(absoluteBundlePath, ".agents"))
    || existsSync(path.join(absoluteBundlePath, AGENT_BUNDLE_MANIFEST))
  ) ? "bundle" : "flat";
  const content = readFileSync(absoluteEntryPath, "utf8");
  const runnerCommand = extractRunnerCommand(content);
  const bundleFiles = listBundleFiles(absoluteBundlePath, absoluteEntryPath, bundleMode);
  const skills = resolveBundledSkills(absoluteBundlePath);

  return {
    absoluteEntryPath,
    absoluteBundlePath,
    bundleMode,
    content,
    runnerCommand,
    assetFileCount: bundleFiles.length,
    skills
  };
}

function buildAgentRecord(workspaceRoot: string, absoluteEntryPath: string, source: AgentRecord["source"]): AgentRecord {
  const relativePath = toWorkspaceRelative(workspaceRoot, absoluteEntryPath);
  const executionContext = resolveAgentExecutionContext(absoluteEntryPath);
  const fallbackName = path.basename(relativePath, path.extname(relativePath));
  const bundleRelativePath = executionContext.bundleMode === "bundle"
    ? toWorkspaceRelative(workspaceRoot, executionContext.absoluteBundlePath)
    : undefined;

  return {
    key: toAgentKey(relativePath),
    name: executionContext.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackName,
    path: relativePath,
    summary: summarizeAgent(executionContext.content),
    system: {
      entryFile: relativePath,
      bundleMode: executionContext.bundleMode,
      bundlePath: bundleRelativePath && bundleRelativePath !== relativePath ? bundleRelativePath : undefined,
      skillCount: executionContext.skills.length,
      assetFileCount: executionContext.assetFileCount,
      skills: executionContext.skills
    },
    executionMode: executionContext.runnerCommand ? "sandbox" : "review-only",
    runnerCommand: executionContext.runnerCommand,
    source,
    status: "ready"
  };
}

function walkWorkspaceAgentFiles(workspaceRoot: string, currentDir: string, results: string[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) return;
      walkWorkspaceAgentFiles(workspaceRoot, absolutePath, results);
      return;
    }

    if (entry.isFile() && isWorkspaceAgentMarkdownFile(workspaceRoot, absolutePath)) {
      results.push(absolutePath);
    }
  });
}

function listManagedAgentBundleEntries(workspaceRoot: string): string[] {
  const managedRoot = getManagedAgentsRoot(workspaceRoot);
  if (!existsSync(managedRoot)) return [];

  return readdirSync(managedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(managedRoot, entry.name))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((bundleRoot) => {
      try {
        return [resolveAgentEntryFromDir(bundleRoot)];
      } catch {
        return [];
      }
    });
}

export function listAgentFiles(workspaceRoot: string): AgentRecord[] {
  const workspaceAgentsDir = path.join(workspaceRoot, "agents");
  const filePaths: Array<{ filePath: string; source: AgentRecord["source"] }> = [];

  if (existsSync(workspaceAgentsDir)) {
    const workspaceFilePaths: string[] = [];
    walkWorkspaceAgentFiles(workspaceRoot, workspaceAgentsDir, workspaceFilePaths);
    workspaceFilePaths.forEach((filePath) => filePaths.push({ filePath, source: "discovered" }));
  }

  listManagedAgentBundleEntries(workspaceRoot).forEach((filePath) => {
    filePaths.push({ filePath, source: "managed" });
  });

  return filePaths
    .map(({ filePath, source }) => buildAgentRecord(workspaceRoot, filePath, source))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function assertAllowedAgentPath(workspaceRoot: string, absolutePath: string): AgentRecord["source"] {
  const workspaceAgentsDir = path.join(workspaceRoot, "agents");
  const managedAgentsDir = getManagedAgentsRoot(workspaceRoot);

  if (existsSync(workspaceAgentsDir) && isSameOrNestedPath(workspaceAgentsDir, absolutePath)) {
    return "manual";
  }
  if (existsSync(managedAgentsDir) && isSameOrNestedPath(managedAgentsDir, absolutePath)) {
    return "managed";
  }

  throw new Error("Agent path must point to a markdown definition inside ./agents or ./.agent-bench/agents.");
}

export function inspectAgentFile(workspaceRoot: string, inputPath: string): AgentRecord {
  const absoluteInputPath = path.resolve(workspaceRoot, inputPath);

  if (!existsSync(absoluteInputPath)) {
    throw new Error(`Agent file not found: ${inputPath}`);
  }

  const source = assertAllowedAgentPath(workspaceRoot, absoluteInputPath);
  const stats = statSync(absoluteInputPath);
  const absoluteEntryPath = stats.isDirectory()
    ? resolveAgentEntryFromDir(absoluteInputPath)
    : absoluteInputPath;

  if (!statSync(absoluteEntryPath).isFile()) {
    throw new Error(`Agent path must point to a file or bundle directory: ${inputPath}`);
  }

  if (path.extname(absoluteEntryPath).toLowerCase() !== ".md") {
    throw new Error("Agent definition entry must be a markdown file.");
  }

  if (source === "manual" && !isWorkspaceAgentMarkdownFile(workspaceRoot, absoluteEntryPath)) {
    throw new Error("Agent file must be a markdown definition inside ./agents or a nested agent bundle directory.");
  }

  return buildAgentRecord(workspaceRoot, absoluteEntryPath, source);
}
