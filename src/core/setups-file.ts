import { readFileSync } from "node:fs";
import { BatchSetupInput } from "../types";

/**
 * Setups file: `[{ "label": "vanilla", "agent": "agents/claude-code.md",
 * "model"?: "...", "followupPrompt"?: "...", "review"?: "off" }]`. One agent
 * can appear under several labels, so workflow variants need no new files.
 */
export function readSetupsFile(filePath: string, only?: string): BatchSetupInput[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { setups?: unknown })?.setups;
  if (!Array.isArray(list)) throw new Error(`${filePath} must hold an array of setups.`);
  const setups = list.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    const agentPath = typeof item.agent === "string" ? item.agent : typeof item.agentPath === "string" ? item.agentPath : "";
    const label = typeof item.label === "string" ? item.label : "";
    if (!agentPath || !label) throw new Error(`Setup #${index + 1} in ${filePath} needs "label" and "agent".`);
    return {
      agentPath,
      label,
      model: typeof item.model === "string" ? item.model : null,
      followupPrompt: typeof item.followupPrompt === "string" ? item.followupPrompt : null,
      buildPrompt: typeof item.buildPrompt === "string" ? item.buildPrompt : null,
      env: item.env && typeof item.env === "object" && !Array.isArray(item.env) ? item.env as Record<string, string> : undefined,
      review: item.review === "off" ? "off" as const : item.review === "auto" ? "auto" as const : null
    };
  });
  if (!only) return setups;
  const wanted = only.split(",").map((entry) => entry.trim()).filter(Boolean);
  const missing = wanted.filter((label) => !setups.some((setup) => setup.label === label));
  if (missing.length > 0) {
    throw new Error(`Unknown setup label(s): ${missing.join(", ")}. Available: ${setups.map((setup) => setup.label).join(", ")}.`);
  }
  return wanted.map((label) => setups.find((setup) => setup.label === label)!);
}
