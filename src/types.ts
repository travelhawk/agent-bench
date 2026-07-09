export type RunStatus = "completed" | "failed";
export type ScoreConfidence = "high" | "medium" | "low";
export type ScoreProfileKey = "hybrid" | "artifact" | "trace" | "judge" | "state";
export type SandboxSelection = "process" | "macos-seatbelt" | "docker" | "mixed";
export type BenchmarkReliability = "low" | "medium" | "high";

export interface ScoreBreakdown {
  outcome: number;
  process: number;
  review: number;
  efficiency: number;
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
  outcomeScore: number;
  processScore: number;
  reviewScore: number;
  efficiencyScore: number;
  testsScore: number;
  llmScore: number;
  perfScore: number;
  scoreProfile: ScoreProfileKey;
  scoreConfidence: ScoreConfidence;
  failureReason: string | null;
  latencyMs: number;
  costUsd: number;
  durationMs: number;
  artifactsPath: string;
  logText: string;
  createdAt: string;
  diffAvailable: boolean;
  diffFilesChanged: number;
  diffInsertions: number;
  diffDeletions: number;
  verifierTestsAvailable: boolean;
  verifierTestsTotal: number;
  verifierTestsPassed: number;
  qualityScore: number | null;
  agentUsageAvailable: boolean;
  agentInputTokens: number;
  agentOutputTokens: number;
  agentCostUsd: number;
}

export interface RunInput {
  runKey: string;
  experimentKey?: string | null;
  benchmarkKey?: string;
  taskKey?: string | null;
  setupKey?: string | null;
  workflowPath?: string | null;
  modelId?: string | null;
  trialIndex?: number | null;
  agentName: string;
  agentVersion: string;
  suiteName: string;
  status: RunStatus;
  scores: ScoreBreakdown;
  objectiveScore?: number;
  objectivePass?: boolean;
  objectiveChecksAvailable?: number;
  objectiveChecksPassed?: number;
  deterministic?: boolean;
  scoreProfile: ScoreProfileKey;
  scoreConfidence: ScoreConfidence;
  failureReason?: string | null;
  latencyMs: number;
  costUsd: number;
  durationMs: number;
  artifactsPath: string;
  logText: string;
  diffAvailable?: boolean;
  diffFilesChanged?: number;
  diffInsertions?: number;
  diffDeletions?: number;
  verifierTestsAvailable?: boolean;
  verifierTestsTotal?: number;
  verifierTestsPassed?: number;
  qualityScore?: number | null;
  agentUsageAvailable?: boolean;
  agentInputTokens?: number;
  agentOutputTokens?: number;
  agentCostUsd?: number;
}

export interface RuntimeEvaluationRequest {
  runKey: string;
  experimentKey?: string | null;
  workspaceRoot?: string;
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
  strictSandbox?: boolean;
  resolvedSandboxProvider?: SandboxSelection;
  trialIndex?: number | null;
  environmentFingerprint?: string | null;
  setupSnapshot?: {
    key?: string | null;
    workflowPath?: string | null;
    modelId?: string | null;
  } | null;
}

export interface AgentSkillReference {
  source: string;
  skillName: string;
  installSpec: string;
  registryUrl?: string;
  installs?: number;
  title?: string;
  origin: "bundled" | "skills.sh";
}

export interface InstalledSkillRecord {
  name: string;
  path: string;
  scope: "project" | "global";
  agents: string[];
}

export interface AgentSystemSummary {
  entryFile: string;
  bundleMode: "flat" | "bundle";
  bundlePath?: string;
  sharedAgentsPath?: string;
  skillCount: number;
  assetFileCount: number;
  skills: AgentSkillReference[];
}

export interface AgentRecord {
  key: string;
  name: string;
  path: string;
  summary: string;
  system: AgentSystemSummary;
  executionMode: "review-only" | "sandbox";
  runnerCommand?: string;
  source: "discovered" | "manual" | "managed";
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
  reliability: BenchmarkReliability;
  tags: string[];
  requiresIsolation: boolean;
  requiresNetwork: boolean;
  timeBudgetMs: number;
  costBudgetUsd: number;
  defaultTrials: number;
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
  whyThisTask: string;
  inputs: string;
  deliverableFormat: string;
  successChecks: string[];
  failureModes: string[];
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
  projectSkills: InstalledSkillRecord[];
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
  run?: RunEvaluationResult;
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
