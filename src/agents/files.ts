import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AgentRecord } from "../types";

const EXCLUDED_FILE_NAMES = new Set(["AGENTS.md", "README.md"]);
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".agent-bench", "tasks"]);

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

function isAgentMarkdownFile(workspaceRoot: string, absolutePath: string): boolean {
  const relativePath = path.relative(workspaceRoot, absolutePath);
  const segments = relativePath.split(path.sep);
  const fileName = path.basename(absolutePath);

  if (!relativePath || relativePath.startsWith("..")) return false;
  if (path.extname(fileName).toLowerCase() !== ".md") return false;
  if (EXCLUDED_FILE_NAMES.has(fileName)) return false;
  if (segments.includes("tasks")) return false;

  return segments[0] === "agents";
}

function buildAgentRecord(workspaceRoot: string, absolutePath: string, source: AgentRecord["source"]): AgentRecord {
  const relativePath = path.relative(workspaceRoot, absolutePath);
  const content = readFileSync(absolutePath, "utf8");
  const fallbackName = path.basename(relativePath, path.extname(relativePath));
  const runnerCommand = extractRunnerCommand(content);

  return {
    key: toAgentKey(relativePath),
    name: content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackName,
    path: relativePath,
    summary: summarizeAgent(content),
    executionMode: runnerCommand ? "sandbox" : "review-only",
    runnerCommand,
    source,
    status: "ready"
  };
}

function walkAgentFiles(workspaceRoot: string, currentDir: string, results: string[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) return;
      walkAgentFiles(workspaceRoot, absolutePath, results);
      return;
    }

    if (entry.isFile() && isAgentMarkdownFile(workspaceRoot, absolutePath)) {
      results.push(absolutePath);
    }
  });
}

export function listAgentFiles(workspaceRoot: string): AgentRecord[] {
  const agentsDir = path.join(workspaceRoot, "agents");
  if (!existsSync(agentsDir)) return [];

  const filePaths: string[] = [];
  walkAgentFiles(workspaceRoot, agentsDir, filePaths);

  return filePaths
    .map((filePath) => buildAgentRecord(workspaceRoot, filePath, "discovered"))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function inspectAgentFile(workspaceRoot: string, inputPath: string): AgentRecord {
  const absolutePath = path.resolve(workspaceRoot, inputPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Agent file not found: ${inputPath}`);
  }
  if (!statSync(absolutePath).isFile()) {
    throw new Error(`Agent path must point to a file: ${inputPath}`);
  }
  if (!isAgentMarkdownFile(workspaceRoot, absolutePath)) {
    throw new Error("Agent file must be a markdown definition inside the workspace agents folder.");
  }

  return buildAgentRecord(workspaceRoot, absolutePath, "manual");
}
