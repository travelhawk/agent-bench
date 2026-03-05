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
  runKey: string;
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

export interface RuntimeEvaluationRequest {
  runKey: string;
  agentPath?: string;
  agentMarkdown?: string;
  benchmarkKey: string;
  taskKey?: string;
  artifactsRoot: string;
  benchmarks: BenchmarkSuiteRecord[];
  model?: string;
}

export interface BenchmarkTaskRecord {
  key: string;
  title: string;
  description: string;
  expectedOutcome: string;
}

export interface BenchmarkSuiteRecord {
  key: string;
  title: string;
  description: string;
  tasks: BenchmarkTaskRecord[];
}
