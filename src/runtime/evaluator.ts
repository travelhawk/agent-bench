import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { computeWeightedScore, performanceScoreFromMetrics } from "../core/scoring";
import { BenchmarkSuiteRecord, BenchmarkTaskRecord, RunInput, RuntimeEvaluationRequest } from "../types";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.003;
const DEFAULT_SYSTEM_PROMPT = [
  "You are AgentBenchReview, a strict evaluator for agent specifications.",
  "Assess whether the provided agent instructions appear capable of completing the requested benchmark task.",
  "Score task fit, workflow clarity, verification steps, and operational safety.",
  "Do not invent execution results, tests, or artifacts that are not present.",
  "Return compact JSON only in this exact format:",
  "{\"score\": number, \"reason\": string}"
].join(" ");

interface JudgeResult {
  score: number;
  latencyMs: number;
  totalTokens: number;
  rawText: string;
  reason: string;
  mode: "gateway" | "gateway-cache" | "rules";
}

interface ParsedJudgeResponse {
  score: number;
  reason: string;
}

interface JudgeCacheEntry {
  score: number;
  rawText: string;
  totalTokens: number;
  reason: string;
}

interface RulesAssessment {
  readinessScore: number;
  reviewScore: number;
  matchedSignals: string[];
  missingSignals: string[];
  reason: string;
}

type JudgeCacheMap = Record<string, JudgeCacheEntry>;

function clampScore(raw: number): number {
  if (raw < 0) return 0;
  if (raw > 10) return 10;
  return Number(raw.toFixed(2));
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(input: string): string {
  return input.toLowerCase();
}

function hasAny(text: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function normalizeKeyword(tag: string): string[] {
  const normalized = tag.toLowerCase().trim();
  if (!normalized) return [];
  const withSpaces = normalized.replace(/-/g, " ");
  return normalized === withSpaces ? [normalized] : [normalized, withSpaces];
}

function parseJudgeResponse(content: string): ParsedJudgeResponse {
  try {
    const parsed = JSON.parse(content) as { score?: number; reason?: string };
    if (typeof parsed.score === "number") {
      return {
        score: clampScore(parsed.score),
        reason: typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "Gateway review returned a numeric score without an explicit reason."
      };
    }
  } catch {
    // Continue to regex parsing below.
  }

  const match = content.match(/-?\d+(\.\d+)?/);
  if (match) {
    return {
      score: clampScore(Number(match[0])),
      reason: content.trim().slice(0, 280) || "Gateway review returned a numeric score without an explicit reason."
    };
  }

  throw new Error("Gateway judge response did not include a parseable numeric score.");
}

export async function judgeWithVercelAiSdk(input: {
  apiKey: string;
  model: string;
  benchmarkKey: string;
  taskKey?: string;
  agentPath: string;
  agentName: string;
  agentVersion: string;
  agentTextPreview: string;
  generateTextFn?: typeof generateText;
}): Promise<JudgeResult> {
  const prompt = [
    `Benchmark: ${input.benchmarkKey}`,
    `Task: ${input.taskKey ?? "all"}`,
    `Agent Name: ${input.agentName}`,
    `Agent Version: ${input.agentVersion}`,
    `Agent File: ${input.agentPath}`,
    "Review whether this agent specification appears capable of completing the requested work.",
    "Respond with compact JSON only: {\"score\": <number>, \"reason\": \"...\"}.",
    `Evaluation Context:\n${input.agentTextPreview}`
  ].join("\n\n");

  const started = Date.now();
  const callGenerateText = input.generateTextFn ?? generateText;
  const { text, usage } = await callGenerateText({
    model: input.model,
    prompt,
    system: process.env.LLM_JUDGE_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
    temperature: 0,
    providerOptions: {
      gateway: {
        apiKey: input.apiKey
      }
    }
  });
  const latencyMs = Date.now() - started;

  const rawText = text?.trim() ?? "";
  if (!rawText) {
    throw new Error("AI SDK judge returned an empty response.");
  }

  const parsed = parseJudgeResponse(rawText);
  const usageSafe = usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
  const totalTokens = usageSafe?.totalTokens ?? ((usageSafe?.inputTokens ?? 0) + (usageSafe?.outputTokens ?? 0));
  return {
    score: parsed.score,
    reason: parsed.reason,
    latencyMs,
    totalTokens,
    rawText,
    mode: "gateway"
  };
}

function readAgentPreview(agentPath: string): string {
  return readFileSync(agentPath, "utf8").trim().slice(0, 12000);
}

function buildTaskContext(benchmarks: RuntimeEvaluationRequest["benchmarks"], benchmarkKey: string, taskKey?: string): string {
  const benchmark = benchmarks.find((entry) => entry.key === benchmarkKey);
  const selectedTasks = taskKey
    ? (benchmark?.tasks.filter((task) => task.key === taskKey) ?? [])
    : (benchmark?.tasks ?? []);

  return JSON.stringify({
    selectedBenchmark: benchmark ?? null,
    selectedTaskKey: taskKey ?? null,
    selectedTasks
  }, null, 2);
}

function resolveAgentMaterial(input: RuntimeEvaluationRequest): { agentPathLabel: string; agentMd: string } {
  if (input.agentMarkdown && input.agentMarkdown.trim()) {
    return {
      agentPathLabel: input.agentPath ?? "inline-agent",
      agentMd: input.agentMarkdown.trim().slice(0, 12000)
    };
  }

  if (!input.agentPath) {
    throw new Error("Run request requires either agentPath or agentMarkdown.");
  }

  return {
    agentPathLabel: input.agentPath,
    agentMd: readAgentPreview(input.agentPath)
  };
}

function estimateCostUsd(totalTokens: number): number {
  const configured = Number(process.env.AGENT_BENCH_COST_PER_1K_TOKENS_USD ?? DEFAULT_COST_PER_1K_TOKENS_USD);
  const costPer1K = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_PER_1K_TOKENS_USD;
  return Number(((totalTokens / 1000) * costPer1K).toFixed(4));
}

function cachePathFromArtifactsRoot(artifactsRoot: string): string {
  return path.join(path.dirname(artifactsRoot), "judge-cache.json");
}

function getJudgeCacheEnabled(): boolean {
  const raw = (process.env.LLM_JUDGE_RESPONSE_CACHE ?? process.env.AGENT_BENCH_DETERMINISTIC ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function makeJudgeFingerprint(input: { benchmarkKey: string; taskKey?: string; model: string; taskContext: string; agentMd: string }): string {
  return createHash("sha256")
    .update(input.benchmarkKey)
    .update("\n")
    .update(input.taskKey ?? "all")
    .update("\n")
    .update(input.model)
    .update("\n")
    .update(input.taskContext)
    .update("\n")
    .update(input.agentMd)
    .digest("hex");
}

function loadJudgeCache(cachePath: string): JudgeCacheMap {
  if (!existsSync(cachePath)) return {};
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as JudgeCacheMap;
  } catch {
    return {};
  }
}

function saveJudgeCache(cachePath: string, cache: JudgeCacheMap): void {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function buildRulesAssessment(benchmark: BenchmarkSuiteRecord, task: BenchmarkTaskRecord | undefined, agentMd: string): RulesAssessment {
  const agentText = normalizeText(agentMd);
  const resolution = task?.metadata.resolution ?? benchmark.metadata.resolution;
  const interaction = task?.metadata.interaction;
  const requiresNetwork = task?.metadata.requiresNetwork ?? false;
  const requiresIsolation = task?.metadata.requiresIsolation ?? false;
  const difficulty = task?.metadata.difficulty ?? "medium";
  const taskTags = [
    ...benchmark.metadata.tags,
    ...(task?.metadata.tags ?? [])
  ];

  const hasRole = hasAny(agentText, ["role:", "behavior:", "instruction", "responsibil"]);
  const hasPlanning = hasAny(agentText, ["plan", "research", "synthes", "analy", "step", "decompose", "approach"]);
  const hasVerification = hasAny(agentText, ["test", "verify", "validation", "check", "acceptance", "pass/fail", "assert"]);
  const hasSafety = hasAny(agentText, ["rollback", "failure", "risk", "guardrail", "constraint", "safety", "secure"]);
  const hasDeliverable = hasAny(agentText, ["deliver", "return", "output", "report", "summary", "artifact", "patch"]);
  const hasToolUse = hasAny(agentText, ["tool", "api", "function", "search", "fetch", "call"]);
  const hasTerminal = hasAny(agentText, ["terminal", "shell", "command", "bash", "zsh", "repo", "git", "patch", "build", "test"]);
  const hasBrowser = hasAny(agentText, ["browser", "page", "click", "form", "dom", "navigate", "tab", "selector"]);
  const hasComputer = hasAny(agentText, ["computer", "desktop", "window", "screen", "mouse", "keyboard", "application"]);
  const hasDelegation = hasAny(agentText, ["delegate", "handoff", "reviewer", "specialist", "merge", "coordination", "orchestrat"]);
  const hasNetwork = hasAny(agentText, ["network", "web", "browse", "http", "api", "search", "online"]);
  const hasIsolation = hasAny(agentText, ["isolate", "sandbox", "workspace", "repo", "local", "artifact", "test env"]);
  const hasStructuredMarkdown = /(^|\n)#+\s+/.test(agentMd) || /(^|\n)-\s+/.test(agentMd);
  const hasDetailedSpec = agentMd.trim().length >= 180;
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  let readinessScore = 3.4;
  let reviewScore = 3.1;

  function bonus(condition: boolean, readinessDelta: number, reviewDelta: number, matchedLabel: string): void {
    if (!condition) return;
    readinessScore += readinessDelta;
    reviewScore += reviewDelta;
    matchedSignals.push(matchedLabel);
  }

  function requirement(
    condition: boolean,
    readinessDelta: number,
    reviewDelta: number,
    matchedLabel: string,
    missingLabel: string
  ): void {
    if (condition) {
      readinessScore += readinessDelta;
      reviewScore += reviewDelta;
      matchedSignals.push(matchedLabel);
      return;
    }

    readinessScore -= readinessDelta * 0.6;
    reviewScore -= reviewDelta * 0.5;
    missingSignals.push(missingLabel);
  }

  bonus(hasRole, 0.4, 0.7, "clear role or behavior contract");
  bonus(hasStructuredMarkdown, 0.2, 0.5, "structured instructions");
  bonus(hasDetailedSpec, 0.3, 0.4, "enough instruction detail for stable execution");
  requirement(hasVerification, 0.8, 1.0, "explicit verification or acceptance checks", "verification or acceptance checks are missing");
  bonus(hasSafety, 0.2, 0.8, "failure handling or rollback guidance");
  requirement(hasDeliverable, 0.6, 0.5, "clear output expectations", "deliverable or output expectations are not explicit");

  if (resolution === "workflow") {
    requirement(hasPlanning, 1.0, 0.5, "workflow planning signals", "workflow planning guidance is missing");
  } else if (resolution === "campaign") {
    requirement(hasPlanning && hasSafety, 1.4, 0.7, "long-horizon planning and recovery signals", "campaign-level planning or recovery guidance is missing");
  } else if (resolution === "swarm") {
    requirement(hasPlanning && hasDelegation, 1.8, 0.9, "multi-agent orchestration guidance", "swarm orchestration or handoff guidance is missing");
  } else {
    bonus(hasVerification, 0.4, 0.3, "atomic task acceptance focus");
  }

  if (interaction === "artifact") {
    requirement(hasDeliverable || hasVerification, 1.0, 0.3, "artifact-oriented completion signals", "artifact completion criteria are not described");
  }
  if (interaction === "terminal") {
    requirement(hasTerminal, 1.5, 0.4, "terminal and repo operations capability", "terminal or repo operations are not described");
  }
  if (interaction === "browser") {
    requirement(hasBrowser, 1.8, 0.5, "browser workflow capability", "browser interaction capability is missing");
  }
  if (interaction === "computer-use") {
    requirement(hasComputer, 1.8, 0.5, "computer-use capability", "computer-use capability is missing");
  }
  if (interaction === "tool-use") {
    requirement(hasToolUse || hasBrowser || hasTerminal, 1.4, 0.4, "tool invocation capability", "tool invocation capability is missing");
  }
  if (interaction === "multi-agent") {
    requirement(hasDelegation, 2.0, 0.7, "delegation and handoff capability", "delegation or handoff guidance is missing");
  }

  if (requiresNetwork) {
    requirement(hasNetwork, 0.8, 0.2, "network or web access intent", "task requires network use but the agent spec does not mention web or API work");
  }
  if (requiresIsolation) {
    requirement(hasIsolation || hasTerminal, 0.8, 0.2, "workspace or isolation awareness", "task expects isolated workspace handling but the agent spec does not mention it");
  }

  const matchedKeywords = taskTags.filter((tag) => normalizeKeyword(tag).some((keyword) => agentText.includes(keyword)));
  if (matchedKeywords.length > 0) {
    readinessScore += Math.min(1.2, matchedKeywords.length * 0.3);
    reviewScore += Math.min(0.8, matchedKeywords.length * 0.2);
    matchedSignals.push(`task keywords present: ${matchedKeywords.slice(0, 4).join(", ")}`);
  } else if (taskTags.length > 0) {
    readinessScore -= 0.7;
    reviewScore -= 0.4;
    missingSignals.push("task-specific keywords are not reflected in the agent spec");
  }

  if (difficulty === "high" && !hasDetailedSpec) {
    readinessScore -= 0.8;
    reviewScore -= 0.6;
    missingSignals.push("high-difficulty task but the agent instructions are still very thin");
  }

  const matchedSummary = matchedSignals.slice(0, 3).join("; ");
  const missingSummary = missingSignals.slice(0, 2).join("; ");
  const reason = [
    matchedSummary ? `Matched: ${matchedSummary}.` : "",
    missingSummary ? `Gaps: ${missingSummary}.` : ""
  ].filter(Boolean).join(" ");

  return {
    readinessScore: clampScore(readinessScore),
    reviewScore: clampScore(reviewScore),
    matchedSignals: matchedSignals.slice(0, 6),
    missingSignals: missingSignals.slice(0, 6),
    reason: reason || "Rules review found a basic but weak agent specification with limited task-specific evidence."
  };
}

function buildRunReportSvg(input: {
  runKey: string;
  benchmarkKey: string;
  taskKey?: string;
  agentName: string;
  total: number;
  readiness: number;
  review: number;
  performance: number;
  reviewMode: string;
  matchedSignals: string[];
  missingSignals: string[];
}): string {
  const matchedLines = input.matchedSignals.length > 0 ? input.matchedSignals : ["No strong matched signals recorded."];
  const missingLines = input.missingSignals.length > 0 ? input.missingSignals : ["No major gaps detected in the rules review."];
  const renderLines = (lines: string[], x: number, startY: number, color: string) => lines
    .slice(0, 4)
    .map((line, index) => `<text x="${x}" y="${startY + index * 34}" fill="${color}" font-size="24" font-family="Manrope, Arial">${escapeXml(`• ${line}`)}</text>`)
    .join("");

  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">",
    "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0f172a\"/><stop offset=\"100%\" stop-color=\"#1e293b\"/></linearGradient></defs>",
    "<rect width=\"1280\" height=\"720\" fill=\"url(#bg)\"/>",
    "<text x=\"64\" y=\"84\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">agent-bench run report</text>",
    `<text x=\"64\" y=\"130\" fill=\"#e2e8f0\" font-size=\"22\" font-family=\"Manrope, Arial\">Run: ${escapeXml(input.runKey)}</text>`,
    `<text x=\"64\" y=\"162\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Benchmark: ${escapeXml(input.benchmarkKey)}</text>`,
    `<text x=\"64\" y=\"192\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Task: ${escapeXml(input.taskKey ?? "all")}</text>`,
    `<text x=\"64\" y=\"222\" fill=\"#cbd5e1\" font-size=\"20\" font-family=\"Manrope, Arial\">Agent: ${escapeXml(input.agentName)}</text>`,
    `<text x=\"64\" y=\"252\" fill=\"#94a3b8\" font-size=\"18\" font-family=\"Manrope, Arial\">Review mode: ${escapeXml(input.reviewMode)}</text>`,
    "<rect x=\"64\" y=\"288\" width=\"1152\" height=\"126\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    `<text x=\"100\" y=\"360\" fill=\"#34d399\" font-size=\"56\" font-family=\"Manrope, Arial\">Total ${input.total.toFixed(2)}</text>`,
    `<text x=\"100\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Readiness ${input.readiness.toFixed(2)}</text>`,
    `<text x=\"460\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Review ${input.review.toFixed(2)}</text>`,
    `<text x=\"760\" y=\"402\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">Performance ${input.performance.toFixed(2)}</text>`,
    "<rect x=\"64\" y=\"446\" width=\"544\" height=\"224\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    "<rect x=\"672\" y=\"446\" width=\"544\" height=\"224\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    "<text x=\"96\" y=\"490\" fill=\"#34d399\" font-size=\"26\" font-family=\"Manrope, Arial\">Matched Signals</text>",
    renderLines(matchedLines, 96, 536, "#e2e8f0"),
    "<text x=\"704\" y=\"490\" fill=\"#fca5a5\" font-size=\"26\" font-family=\"Manrope, Arial\">Open Gaps</text>",
    renderLines(missingLines, 704, 536, "#e2e8f0"),
    "</svg>"
  ].join("");
}

export async function evaluate(input: RuntimeEvaluationRequest): Promise<RunInput> {
  const now = new Date();
  const started = Date.now();
  const selectedBenchmark = input.benchmarks.find((benchmark) => benchmark.key === input.benchmarkKey);
  if (!selectedBenchmark) {
    throw new Error(`Unknown benchmark: ${input.benchmarkKey}`);
  }
  const selectedTask = input.taskKey
    ? selectedBenchmark.tasks.find((task) => task.key === input.taskKey)
    : undefined;
  if (input.taskKey && !selectedTask) {
    throw new Error(`Unknown task '${input.taskKey}' in benchmark '${input.benchmarkKey}'`);
  }

  const material = resolveAgentMaterial(input);
  const headingName = material.agentMd.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallbackName = path.basename(material.agentPathLabel, path.extname(material.agentPathLabel)) || "agent";
  const agentName = headingName || fallbackName;
  const agentVersion = /v\d+/i.test(agentName) ? agentName.match(/v\d+/i)![0] : "v1";
  const taskContext = buildTaskContext(input.benchmarks, input.benchmarkKey, input.taskKey);
  const assessment = buildRulesAssessment(selectedBenchmark, selectedTask, material.agentMd);
  const readinessScore = assessment.readinessScore;

  const model = input.model ?? process.env.AGENT_BENCH_JUDGE_MODEL ?? DEFAULT_MODEL;
  const apiKey = input.gatewayApiKey?.trim() || process.env.AI_GATEWAY_API_KEY;
  const cacheEnabled = getJudgeCacheEnabled();
  const judgePromptContent = `Task Context:\n${taskContext}\n\nRules Assessment:\n${JSON.stringify(assessment, null, 2)}\n\nAgent Markdown:\n${material.agentMd}`;
  const fingerprint = makeJudgeFingerprint({
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    model,
    taskContext,
    agentMd: material.agentMd
  });
  const cachePath = cachePathFromArtifactsRoot(input.artifactsRoot);
  const judgeCache = loadJudgeCache(cachePath);

  let judge: JudgeResult;
  if (apiKey) {
    if (cacheEnabled && judgeCache[fingerprint]) {
      const cached = judgeCache[fingerprint];
      judge = {
        score: cached.score,
        rawText: cached.rawText,
        totalTokens: cached.totalTokens,
        reason: cached.reason,
        latencyMs: 1,
        mode: "gateway-cache"
      };
    } else {
      judge = await judgeWithVercelAiSdk({
        apiKey,
        model,
        benchmarkKey: input.benchmarkKey,
        taskKey: input.taskKey,
        agentPath: material.agentPathLabel,
        agentName,
        agentVersion,
        agentTextPreview: judgePromptContent
      });
      if (cacheEnabled) {
        judgeCache[fingerprint] = {
          score: judge.score,
          rawText: judge.rawText,
          totalTokens: judge.totalTokens,
          reason: judge.reason
        };
        saveJudgeCache(cachePath, judgeCache);
      }
    }
  } else {
    judge = {
      score: assessment.reviewScore,
      latencyMs: 1,
      totalTokens: 0,
      rawText: JSON.stringify({ score: assessment.reviewScore, reason: assessment.reason }),
      reason: assessment.reason,
      mode: "rules"
    };
  }

  const costUsd = estimateCostUsd(judge.totalTokens);
  const latencyMs = judge.latencyMs;
  const durationMs = Date.now() - started;
  const perfScore = performanceScoreFromMetrics(latencyMs, costUsd);
  const scores = computeWeightedScore(readinessScore, judge.score, perfScore);

  const artifactsPath = path.join(input.artifactsRoot, input.runKey);
  mkdirSync(artifactsPath, { recursive: true });
  const logText = [
    `Run key: ${input.runKey}`,
    `Benchmark: ${input.benchmarkKey}`,
    `Task: ${input.taskKey ?? "all"}`,
    `Agent: ${material.agentPathLabel}`,
    `Review mode: ${judge.mode}`,
    `Model: ${model}`,
    `Readiness score: ${readinessScore}`,
    `Review score: ${judge.score}`,
    `Performance score: ${perfScore}`,
    `Latency: ${latencyMs}ms`,
    `Cost: $${costUsd.toFixed(4)}`,
    `Matched signals: ${assessment.matchedSignals.join("; ") || "none"}`,
    `Open gaps: ${assessment.missingSignals.join("; ") || "none"}`,
    `Review reason: ${judge.reason}`,
    `Review response: ${judge.rawText}`
  ].join("\n");

  writeFileSync(path.join(artifactsPath, "summary.json"), JSON.stringify({
    runKey: input.runKey,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey ?? null,
    suiteMetadata: selectedBenchmark.metadata,
    taskMetadata: selectedTask?.metadata ?? null,
    model,
    reviewMode: judge.mode,
    scoreLabels: {
      tests: "task-fit",
      judge: "review",
      performance: "performance"
    },
    scores,
    assessment,
    latencyMs,
    costUsd,
    durationMs,
    createdAt: now.toISOString(),
    reportFile: "report.svg"
  }, null, 2));
  writeFileSync(path.join(artifactsPath, "session.log"), logText);
  writeFileSync(path.join(artifactsPath, "report.svg"), buildRunReportSvg({
    runKey: input.runKey,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    agentName,
    total: scores.total,
    readiness: scores.tests,
    review: scores.judge,
    performance: scores.performance,
    reviewMode: judge.mode,
    matchedSignals: assessment.matchedSignals,
    missingSignals: assessment.missingSignals
  }));

  return {
    runKey: input.runKey,
    agentName,
    agentVersion,
    suiteName: input.taskKey ? `${input.benchmarkKey}/${input.taskKey}` : input.benchmarkKey,
    scores,
    latencyMs,
    costUsd,
    durationMs,
    artifactsPath,
    logText
  };
}
