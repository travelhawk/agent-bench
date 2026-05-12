import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENT_BUNDLE_MANIFEST, getManagedAgentsRoot, inspectAgentFile, resolveAgentExecutionContext } from "./files";
import { installSkillsIntoBundle, SkillSearchResult } from "./skills";
import { AgentRecord, AgentSkillReference } from "../types";

export interface UploadedAgentBundleFile {
  path: string;
  content: string;
}

export interface CreateManagedAgentBundleInput {
  name?: string;
  baseAgentPath?: string;
  agentMarkdown?: string;
  files?: UploadedAgentBundleFile[];
  skills?: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>;
}

interface CreateManagedAgentBundleDeps {
  installSkills?: typeof installSkillsIntoBundle;
  now?: () => Date;
}

const COPY_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".agent-bench", "test-results"]);

function sanitizeBundleSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveBundleDirectoryName(root: string, requestedName: string): string {
  const base = sanitizeBundleSegment(requestedName) || "managed-agent";
  let attempt = base;
  let suffix = 2;

  while (existsSync(path.join(root, attempt))) {
    attempt = `${base}-${suffix}`;
    suffix += 1;
  }

  return attempt;
}

function shouldCopySourcePath(sourcePath: string): boolean {
  const baseName = path.basename(sourcePath);
  if (COPY_EXCLUDED_DIRS.has(baseName)) return false;
  return true;
}

function normalizeUploadedPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!normalized) {
    throw new Error("Uploaded bundle files require a relative path.");
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new Error(`Invalid uploaded bundle path: ${inputPath}`);
  }
  return normalized;
}

function writeUploadedFiles(bundleRoot: string, files: UploadedAgentBundleFile[]): void {
  files.forEach((file) => {
    const relativePath = normalizeUploadedPath(file.path);
    const absolutePath = path.join(bundleRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.content, "utf8");
  });
}

function listBundledSkills(bundleRoot: string): AgentSkillReference[] {
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

function mergeSkillReferences(existing: AgentSkillReference[], added: AgentSkillReference[]): AgentSkillReference[] {
  const merged = new Map<string, AgentSkillReference>();

  [...existing, ...added].forEach((skill) => {
    const key = `${skill.source}::${skill.skillName}`;
    merged.set(key, skill);
  });

  return [...merged.values()].sort((left, right) => left.installSpec.localeCompare(right.installSpec));
}

export function createManagedAgentBundle(
  workspaceRoot: string,
  input: CreateManagedAgentBundleInput,
  deps: CreateManagedAgentBundleDeps = {}
): AgentRecord {
  const managedRoot = getManagedAgentsRoot(workspaceRoot);
  mkdirSync(managedRoot, { recursive: true });

  const now = deps.now?.() ?? new Date();
  const installSkills = deps.installSkills ?? installSkillsIntoBundle;
  const baseAgentPath = input.baseAgentPath?.trim();
  const bundleDirName = resolveBundleDirectoryName(
    managedRoot,
    input.name?.trim()
      || baseAgentPath
      || `managed-agent-${now.toISOString().slice(0, 10)}`
  );
  const bundleRoot = path.join(managedRoot, bundleDirName);
  mkdirSync(bundleRoot, { recursive: true });

  let entryRelativePath = "AGENTS.md";
  let inheritedSkills: AgentSkillReference[] = [];

  if (baseAgentPath) {
    const baseAgent = inspectAgentFile(workspaceRoot, baseAgentPath);
    const absoluteBaseEntryPath = path.resolve(workspaceRoot, baseAgent.path);
    const baseContext = resolveAgentExecutionContext(absoluteBaseEntryPath);
    entryRelativePath = path.relative(baseContext.absoluteBundlePath, baseContext.absoluteEntryPath);
    inheritedSkills = baseContext.skills;
    cpSync(baseContext.absoluteBundlePath, bundleRoot, {
      recursive: true,
      filter: shouldCopySourcePath
    });
  }

  const agentMarkdown = input.agentMarkdown?.trim();
  if (!baseAgentPath && !agentMarkdown) {
    throw new Error("Provide either a baseAgentPath or agentMarkdown when creating a managed bundle.");
  }
  if (agentMarkdown) {
    const absoluteEntryPath = path.join(bundleRoot, ...entryRelativePath.split(path.sep));
    mkdirSync(path.dirname(absoluteEntryPath), { recursive: true });
    writeFileSync(absoluteEntryPath, agentMarkdown, "utf8");
  }

  const uploadedFiles = Array.isArray(input.files) ? input.files : [];
  if (uploadedFiles.length > 0) {
    writeUploadedFiles(bundleRoot, uploadedFiles);
  }

  const selectedSkills = Array.isArray(input.skills) ? input.skills : [];
  const installedSkills = selectedSkills.length > 0
    ? installSkills(bundleRoot, selectedSkills)
    : [];
  const inferredBundledSkills = listBundledSkills(bundleRoot);
  const manifestSkills = mergeSkillReferences(
    mergeSkillReferences(inheritedSkills, installedSkills),
    inheritedSkills.length === 0 && installedSkills.length === 0 ? inferredBundledSkills : []
  );

  writeFileSync(path.join(bundleRoot, AGENT_BUNDLE_MANIFEST), JSON.stringify({
    version: 1,
    entryFile: entryRelativePath.replace(/\\/g, "/"),
    createdAt: now.toISOString(),
    baseAgentPath: baseAgentPath ?? null,
    skills: manifestSkills
  }, null, 2), "utf8");

  return inspectAgentFile(workspaceRoot, path.relative(workspaceRoot, bundleRoot));
}
