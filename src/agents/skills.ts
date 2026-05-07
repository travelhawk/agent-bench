import { spawnSync } from "node:child_process";
import { AgentSkillReference, InstalledSkillRecord } from "../types";

export interface SkillSearchResult {
  source: string;
  skillName: string;
  installSpec: string;
  registryUrl?: string;
  installs?: number;
  title?: string;
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function skillsCliCommand(args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", "--yes", "skills", ...args]
    };
  }

  return {
    command: "npx",
    args: ["--yes", "skills", ...args]
  };
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

function parseCompactNumber(input: string): number | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;

  const suffix = (match[2] ?? "").toUpperCase();
  const multiplier = suffix === "K"
    ? 1_000
    : suffix === "M"
      ? 1_000_000
      : suffix === "B"
        ? 1_000_000_000
        : 1;

  return Math.round(value * multiplier);
}

function normalizeSkillSelection(
  inputSkills: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>
): Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">> {
  const unique = new Map<string, Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>();

  inputSkills.forEach((skill) => {
    const source = skill.source.trim();
    const skillName = skill.skillName.trim();
    if (!source || !skillName) return;
    unique.set(`${source}::${skillName}`, {
      source,
      skillName,
      registryUrl: skill.registryUrl,
      installs: skill.installs,
      title: skill.title
    });
  });

  return [...unique.values()];
}

function groupSkillsBySource(
  inputSkills: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>
): Map<string, Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>> {
  const grouped = new Map<string, Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>>();

  normalizeSkillSelection(inputSkills).forEach((skill) => {
    const group = grouped.get(skill.source) ?? [];
    group.push(skill);
    grouped.set(skill.source, group);
  });

  return grouped;
}

function runSkillsCli(
  cwd: string,
  args: string[],
  timeout: number,
  errorLabel: string
): { stdout: string; stderr: string; combined: string } {
  const command = skillsCliCommand(args);
  const result = spawnSync(command.command, command.args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      DISABLE_TELEMETRY: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = stripAnsi(`${stdout}\n${stderr}`).trim();

  if (result.error) {
    throw new Error(`${errorLabel}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = combined || result.signal || "unknown error";
    throw new Error(`${errorLabel}: ${detail}`);
  }

  return { stdout, stderr, combined };
}

export function parseSkillsSearchOutput(output: string): SkillSearchResult[] {
  const text = stripAnsi(output);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const results: SkillSearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([^/\s]+\/[^\s@]+)@([^\s]+)\s+([\d.]+[KMB]?)\s+installs$/i);
    if (!match) continue;

    const registryUrl = lines.slice(index + 1, index + 3)
      .map((candidate) => candidate.replace(/^└\s*/, "").trim())
      .find((candidate) => candidate.startsWith("https://skills.sh/"));

    results.push({
      source: match[1],
      skillName: match[2],
      installSpec: `${match[1]}@${match[2]}`,
      registryUrl,
      installs: parseCompactNumber(match[3]),
      title: match[2]
    });
  }

  return results;
}

export function parseInstalledSkillsOutput(output: string): InstalledSkillRecord[] {
  const parsed = JSON.parse(output) as Array<{
    name?: string;
    path?: string;
    scope?: string;
    agents?: string[];
  }>;

  if (!Array.isArray(parsed)) {
    throw new Error("skills list returned an unexpected payload.");
  }

  return parsed
    .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0 && typeof entry.path === "string" && entry.path.trim().length > 0)
    .map<InstalledSkillRecord>((entry) => ({
      name: entry.name!.trim(),
      path: entry.path!.trim(),
      scope: entry.scope === "global" ? "global" : "project",
      agents: Array.isArray(entry.agents)
        ? entry.agents.filter((agent): agent is string => typeof agent === "string" && agent.trim().length > 0).map((agent) => agent.trim())
        : []
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function searchSkillsRegistry(query: string, cwd: string): SkillSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { combined } = runSkillsCli(cwd, ["find", trimmed], 120_000, "skills search failed");
  if (/no skills found/i.test(combined)) {
    return [];
  }

  return parseSkillsSearchOutput(combined);
}

export function listInstalledProjectSkills(cwd: string): InstalledSkillRecord[] {
  const { combined } = runSkillsCli(cwd, ["list", "-a", "codex", "--json"], 120_000, "skills list failed");
  return parseInstalledSkillsOutput(combined || "[]");
}

export function installSkillsIntoBundle(
  bundleRoot: string,
  inputSkills: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>
): AgentSkillReference[] {
  const grouped = groupSkillsBySource(inputSkills);

  grouped.forEach((skills, source) => {
    runSkillsCli(bundleRoot, [
      "add",
      source,
      "--agent",
      "codex",
      "--copy",
      "--yes",
      ...skills.flatMap((skill) => ["--skill", skill.skillName])
    ], 300_000, `skills install failed for ${source}`);
  });

  return normalizeSkillSelection(inputSkills).map((skill) => ({
    source: skill.source,
    skillName: skill.skillName,
    installSpec: `${skill.source}@${skill.skillName}`,
    registryUrl: skill.registryUrl,
    installs: skill.installs,
    title: skill.title,
    origin: "skills.sh"
  }));
}

export function installProjectSkills(
  cwd: string,
  inputSkills: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>
): InstalledSkillRecord[] {
  const grouped = groupSkillsBySource(inputSkills);
  if (grouped.size === 0) {
    return listInstalledProjectSkills(cwd);
  }

  grouped.forEach((skills, source) => {
    runSkillsCli(cwd, [
      "add",
      source,
      "--agent",
      "codex",
      "--copy",
      "--yes",
      ...skills.flatMap((skill) => ["--skill", skill.skillName])
    ], 300_000, `skills install failed for ${source}`);
  });

  return listInstalledProjectSkills(cwd);
}

export function removeProjectSkills(cwd: string, names: string[]): InstalledSkillRecord[] {
  const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error("Select at least one installed skill to remove.");
  }

  runSkillsCli(cwd, [
    "remove",
    ...normalized,
    "--agent",
    "codex",
    "--yes"
  ], 300_000, "skills removal failed");

  return listInstalledProjectSkills(cwd);
}

export function updateProjectSkills(cwd: string, names?: string[]): InstalledSkillRecord[] {
  const normalized = [...new Set((names ?? []).map((name) => name.trim()).filter(Boolean))];
  runSkillsCli(cwd, [
    "update",
    ...normalized,
    "--project",
    "--yes"
  ], 300_000, "skills update failed");

  return listInstalledProjectSkills(cwd);
}
