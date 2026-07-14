import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AgentUsageReport {
  available: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

const UNAVAILABLE: AgentUsageReport = { available: false, inputTokens: 0, outputTokens: 0, costUsd: null };

export function readAgentUsageReport(workspaceDir: string): AgentUsageReport {
  const reportPath = path.join(workspaceDir, "result", "usage.json");
  if (!existsSync(reportPath)) return UNAVAILABLE;

  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
      inputTokens?: unknown;
      outputTokens?: unknown;
      costUsd?: unknown;
    };

    if (typeof parsed.inputTokens !== "number" || typeof parsed.outputTokens !== "number") {
      return UNAVAILABLE;
    }

    return {
      available: true,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      costUsd: typeof parsed.costUsd === "number" ? parsed.costUsd : null
    };
  } catch {
    return UNAVAILABLE;
  }
}
