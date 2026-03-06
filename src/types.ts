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
  agentRunnerCommand?: string;
  benchmarkKey: string;
  taskKey?: string;
  artifactsRoot: string;
  benchmarksDir?: string;
  benchmarks: BenchmarkSuiteRecord[];
  model?: string;
  gatewayApiKey?: string;
}

export interface AgentRecord {
  key: string;
  name: string;
  path: string;
  summary: string;
  executionMode: "review-only" | "sandbox";
  runnerCommand?: string;
  source: "discovered" | "manual";
  status: "ready";
}

export type BenchmarkResolution = "atomic" | "workflow" | "campaign" | "swarm";
export type BenchmarkInteractionMode = "artifact" | "terminal" | "browser" | "tool-use" | "computer-use" | "multi-agent";
export type BenchmarkEvaluatorMode = "state" | "artifact" | "trace" | "judge" | "hybrid";
export type BenchmarkDifficulty = "low" | "medium" | "high";
export type BenchmarkSandboxProvider = "auto" | "process" | "macos-seatbelt" | "docker";

export interface BenchmarkSuiteMetadata {
  resolution: BenchmarkResolution;
  domain: string;
  tags: string[];
}

export interface BenchmarkTaskMetadata {
  resolution: BenchmarkResolution;
  interaction: BenchmarkInteractionMode;
  evaluator: BenchmarkEvaluatorMode;
  difficulty: BenchmarkDifficulty;
  tags: string[];
  requiresIsolation: boolean;
  requiresNetwork: boolean;
}

export interface BenchmarkTaskSandbox {
  fixtureDir?: string;
  verifyCommand?: string;
  provider?: BenchmarkSandboxProvider;
  timeoutMs: number;
}

export interface BenchmarkTaskRecord {
  key: string;
  title: string;
  description: string;
  expectedOutcome: string;
  metadata: BenchmarkTaskMetadata;
  sandbox: BenchmarkTaskSandbox | null;
}

export interface BenchmarkSuiteRecord {
  key: string;
  title: string;
  description: string;
  metadata: BenchmarkSuiteMetadata;
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

export interface BatchRunFailure {
  agentPath: string;
  taskKey: string;
  message: string;
}

export interface BatchRunResult {
  runMode: RunMode;
  benchmarkKey: string;
  taskPlan: string[];
  queueSize: number;
  completedRuns: number;
  failedRuns: number;
  runs: RunEvaluationResult[];
  failures: BatchRunFailure[];
}

export interface RunResultPayload {
  run: RunRecord;
  summary: Record<string, unknown> | null;
  reportUrl: string;
}
