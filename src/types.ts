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
  gatewayApiKey?: string;
}

export interface AgentRecord {
  key: string;
  name: string;
  path: string;
  summary: string;
  source: "discovered" | "manual";
  status: "ready";
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

export type RunMode = "single-task" | "benchmark-cycle";

export interface WorkbenchSummary {
  totalRuns: number;
  avgScore: number;
  totalCost: number;
  activeBenchmarks: number;
  availableAgents: number;
}

export interface WorkbenchSnapshot {
  summary: WorkbenchSummary;
  runs: RunRecord[];
  benchmarks: BenchmarkSuiteRecord[];
  agents: AgentRecord[];
  latestLogText: string;
}

export interface RunEvaluationResult {
  run: RunRecord;
  bestBefore: number | null;
  regressed: boolean;
}

export interface RunResultPayload {
  run: RunRecord;
  summary: Record<string, unknown> | null;
  screenshotUrl: string;
}
