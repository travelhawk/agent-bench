import { spawnSync } from "node:child_process";
import { AgentSkillReference } from "../types";

export interface SkillSearchResult {
  source: string;
  skillName: string;
  installSpec: string;
  registryUrl?: string;
  installs?: number;
  title?: string;
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function skillsCliBin(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
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

    const registryUrl = lines[index + 1]?.replace(/^└\s*/, "").trim();
    if (!registryUrl?.startsWith("https://skills.sh/")) continue;

    const source = match[1];
    const skillName = match[2];
    results.push({
      source,
      skillName,
      installSpec: `${source}@${skillName}`,
      registryUrl,
      installs: parseCompactNumber(match[3]),
      title: skillName
    });
  }

  return results;
}

export function searchSkillsRegistry(query: string, cwd: string): SkillSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const result = spawnSync(skillsCliBin(), ["skills", "find", trimmed], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      DISABLE_TELEMETRY: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;

  if (result.status !== 0) {
    throw new Error(`skills search failed: ${stripAnsi(combined).trim() || "unknown error"}`);
  }

  if (/no skills found/i.test(combined)) {
    return [];
  }

  return parseSkillsSearchOutput(combined);
}

export function installSkillsIntoBundle(
  bundleRoot: string,
  inputSkills: Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>
): AgentSkillReference[] {
  const grouped = new Map<string, Array<Pick<SkillSearchResult, "source" | "skillName" | "registryUrl" | "installs" | "title">>>();

  inputSkills.forEach((skill) => {
    const source = skill.source.trim();
    const skillName = skill.skillName.trim();
    if (!source || !skillName) return;

    const group = grouped.get(source) ?? [];
    if (!group.some((entry) => entry.skillName === skillName)) {
      group.push(skill);
    }
    grouped.set(source, group);
  });

  grouped.forEach((skills, source) => {
    const args = [
      "skills",
      "add",
      source,
      "--agent",
      "codex",
      "--copy",
      "--yes",
      ...skills.flatMap((skill) => ["--skill", skill.skillName])
    ];
    const result = spawnSync(skillsCliBin(), args, {
      cwd: bundleRoot,
      encoding: "utf8",
      timeout: 300_000,
      env: {
        ...process.env,
        DISABLE_TELEMETRY: "1",
        NO_COLOR: "1",
        FORCE_COLOR: "0"
      }
    });
    if (result.status !== 0) {
      const details = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
      throw new Error(`skills install failed for ${source}: ${details || "unknown error"}`);
    }
  });

  return inputSkills.map((skill) => ({
    source: skill.source.trim(),
    skillName: skill.skillName.trim(),
    installSpec: `${skill.source.trim()}@${skill.skillName.trim()}`,
    registryUrl: skill.registryUrl,
    installs: skill.installs,
    title: skill.title,
    origin: "skills.sh"
  }));
}
