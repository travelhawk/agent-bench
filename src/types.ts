export type RunStatus = "completed" | "failed";

export interface ScoreBreakdown {
  tests: number;
  judge: number;
  performance: number;
  total: number;
}

export interface RunRecord {
  id: number;
  runKey: string;
  agentName: string;
  agentVersion: string;
  suiteName: string;
  status: RunStatus;
  score: number;
  testsScore: number;
  llmScore: number;
  perfScore: number;
  latencyMs: number;
  costUsd: number;
  durationMs: number;
  artifactsPath: string;
  logText: string;
  createdAt: string;
}

export interface RunInput {
  agentName: string;
  agentVersion: string;
  suiteName: string;
  scores: ScoreBreakdown;
  latencyMs: number;
  costUsd: number;
  durationMs: number;
  artifactsPath: string;
  logText: string;
}