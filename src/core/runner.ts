import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeWeightedScore, performanceScoreFromMetrics } from "./scoring";
import { RunInput } from "../types";

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function simulateRun(agentPath: string, suiteName: string, artifactsRoot: string): RunInput {
  const now = new Date();
  const runKey = `run-${now.getTime().toString().slice(-4)}`;
  const agentName = path.basename(agentPath, path.extname(agentPath));
  const agentVersion = /v\d+/i.test(agentName) ? agentName.match(/v\d+/i)![0] : "v1";

  const testsScore = Number(rand(5.6, 9.6).toFixed(2));
  const judgeScore = Number(rand(5.2, 9.4).toFixed(2));
  const latencyMs = Math.round(rand(18000, 70000));
  const costUsd = Number(rand(0.05, 0.45).toFixed(2));
  const durationMs = Math.round(latencyMs * rand(0.85, 1.15));
  const perfScore = performanceScoreFromMetrics(latencyMs, costUsd);
  const scores = computeWeightedScore(testsScore, judgeScore, perfScore);

  const artifactsPath = path.join(artifactsRoot, runKey);
  mkdirSync(artifactsPath, { recursive: true });
  const logText = [
    "$ agent-bench init --local",
    `Initializing SQLITE database at ${path.join(artifactsRoot, "..", "data.db")}...`,
    "✓ Database ready.",
    `Scanning agent definition at ${agentPath}...`,
    "Found: coder-v1.md, researcher.md",
    "--- Session Started ---",
    "Waiting for process command...",
    `Run ${runKey} completed with score ${scores.total}`
  ].join("\n");

  writeFileSync(path.join(artifactsPath, "summary.json"), JSON.stringify({
    runKey,
    suiteName,
    scores,
    latencyMs,
    costUsd,
    durationMs,
    createdAt: now.toISOString()
  }, null, 2));

  writeFileSync(path.join(artifactsPath, "session.log"), logText);

  return {
    agentName,
    agentVersion,
    suiteName,
    scores,
    latencyMs,
    costUsd,
    durationMs,
    artifactsPath,
    logText
  };
}

export function newRunKey(): string {
  return `run-${randomUUID().slice(0, 8)}`;
}