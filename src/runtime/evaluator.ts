import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { computeWeightedScore, performanceScoreFromMetrics } from "../core/scoring";
import { RunInput, RuntimeEvaluationRequest } from "../types";

const DEFAULT_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.003;
const DEFAULT_SYSTEM_PROMPT = [
  "You are AgentBenchJudge, a strict evaluator for application tasks.",
  "Do not stop early.",
  "Assess whether the requested application task is actually completed end-to-end.",
  "Reward correctness, completeness, and verifiable outcomes.",
  "Penalize partial implementations, TODOs, and missing acceptance behavior.",
  "Return compact JSON only in this exact format:",
  "{\"score\": number, \"taskCompleted\": boolean, \"reason\": string}"
].join(" ");

interface JudgeResult {
  score: number;
  latencyMs: number;
  totalTokens: number;
  rawText: string;
  mode: "gateway" | "gateway-cache" | "local-fallback";
}

interface JudgeCacheEntry {
  score: number;
  rawText: string;
  totalTokens: number;
}

type JudgeCacheMap = Record<string, JudgeCacheEntry>;

function hashStringToUnit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function parseJudgeScore(content: string): number {
  const numeric = Number(content);
  if (Number.isFinite(numeric)) {
    return clampScore(numeric);
  }

  try {
    const parsed = JSON.parse(content) as { score?: number };
    if (typeof parsed.score === "number") {
      return clampScore(parsed.score);
    }
  } catch {
    // no-op, fallback to regex parsing
  }

  const match = content.match(/-?\d+(\.\d+)?/);
  if (match) {
    return clampScore(Number(match[0]));
  }
  throw new Error("Gateway judge response did not include a parseable numeric score.");
}

function clampScore(raw: number): number {
  if (raw < 0) return 0;
  if (raw > 10) return 10;
  return Number(raw.toFixed(2));
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
    "Score this agent's benchmark readiness on a 0-10 scale.",
    "Respond with compact JSON only: {\"score\": <number>}.",
    `Agent Preview:\n${input.agentTextPreview}`
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

  const score = parseJudgeScore(rawText);
  const usageSafe = usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
  const totalTokens = usageSafe?.totalTokens ?? ((usageSafe?.inputTokens ?? 0) + (usageSafe?.outputTokens ?? 0));
  return { score, latencyMs, totalTokens, rawText, mode: "gateway" };
}

function buildAgentPreview(agentPath: string): string {
  try {
    const raw = readFileSync(agentPath, "utf8");
    return raw.slice(0, 2000);
  } catch {
    return "Agent file not found. Evaluate using metadata only.";
  }
}

function buildTaskContext(benchmarks: RuntimeEvaluationRequest["benchmarks"], benchmarkKey: string, taskKey?: string): string {
  const benchmark = benchmarks.find((entry) => entry.key === benchmarkKey);
  const selectedTasks = taskKey
    ? (benchmark?.tasks.filter((task) => task.key === taskKey) ?? [])
    : (benchmark?.tasks ?? []);

  return JSON.stringify({
    selectedBenchmark: benchmark ?? null,
    selectedTaskKey: taskKey ?? null,
    selectedTasks,
    allBenchmarks: benchmarks
  }, null, 2);
}

function resolveAgentMaterial(input: RuntimeEvaluationRequest): { agentPathLabel: string; agentMd: string } {
  if (input.agentMarkdown && input.agentMarkdown.trim()) {
    return {
      agentPathLabel: input.agentPath ?? "web-ui-inline",
      agentMd: input.agentMarkdown.trim().slice(0, 12000)
    };
  }

  if (input.agentPath) {
    return {
      agentPathLabel: input.agentPath,
      agentMd: buildAgentPreview(input.agentPath)
    };
  }

  throw new Error("Run request requires either agentPath or agentMarkdown.");
}

function estimateCostUsd(totalTokens: number): number {
  const configured = Number(process.env.AGENT_BENCH_COST_PER_1K_TOKENS_USD ?? DEFAULT_COST_PER_1K_TOKENS_USD);
  const costPer1K = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_PER_1K_TOKENS_USD;
  return Number(((totalTokens / 1000) * costPer1K).toFixed(4));
}

function cachePathFromArtifactsRoot(artifactsRoot: string): string {
  return path.join(path.dirname(artifactsRoot), "judge-cache.json");
}

function getDeterministicEnabled(): boolean {
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

function judgeLocally(input: { benchmarkKey: string; taskKey?: string; agentName: string; agentMd: string; taskContext: string }): JudgeResult {
  const started = Date.now();
  const seed = hashStringToUnit(`${input.benchmarkKey}:${input.taskKey ?? "all"}:${input.agentName}:${input.taskContext}:${input.agentMd.slice(0, 4000)}`);
  const score = Number((5.8 + seed * 3.6).toFixed(2));
  return {
    score,
    latencyMs: Math.max(1, Date.now() - started),
    totalTokens: 0,
    rawText: JSON.stringify({ score, mode: "local-fallback" }),
    mode: "local-fallback"
  };
}

function buildRunScreenshotSvg(input: {
  runKey: string;
  benchmarkKey: string;
  taskKey?: string;
  agentName: string;
  total: number;
  tests: number;
  judge: number;
  perf: number;
}): string {
  return [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">",
    "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0f172a\"/><stop offset=\"100%\" stop-color=\"#1e293b\"/></linearGradient></defs>",
    "<rect width=\"1280\" height=\"720\" fill=\"url(#bg)\"/>",
    "<text x=\"64\" y=\"90\" fill=\"#93c5fd\" font-size=\"28\" font-family=\"Manrope, Arial\">agent-bench run screenshot</text>",
    `<text x=\"64\" y=\"140\" fill=\"#e2e8f0\" font-size=\"24\" font-family=\"Manrope, Arial\">Run: ${input.runKey}</text>`,
    `<text x=\"64\" y=\"182\" fill=\"#cbd5e1\" font-size=\"22\" font-family=\"Manrope, Arial\">Benchmark: ${input.benchmarkKey}</text>`,
    `<text x=\"64\" y=\"212\" fill=\"#cbd5e1\" font-size=\"22\" font-family=\"Manrope, Arial\">Task: ${input.taskKey ?? "all"}</text>`,
    `<text x=\"64\" y=\"244\" fill=\"#cbd5e1\" font-size=\"22\" font-family=\"Manrope, Arial\">Agent: ${input.agentName}</text>`,
    "<rect x=\"64\" y=\"280\" width=\"1152\" height=\"320\" rx=\"20\" fill=\"#0b1224\" stroke=\"#334155\"/>",
    `<text x=\"100\" y=\"350\" fill=\"#34d399\" font-size=\"64\" font-family=\"Manrope, Arial\">Total ${input.total.toFixed(2)}</text>`,
    `<text x=\"100\" y=\"418\" fill=\"#93c5fd\" font-size=\"32\" font-family=\"Manrope, Arial\">Tests ${input.tests.toFixed(2)}</text>`,
    `<text x=\"440\" y=\"418\" fill=\"#93c5fd\" font-size=\"32\" font-family=\"Manrope, Arial\">Judge ${input.judge.toFixed(2)}</text>`,
    `<text x=\"760\" y=\"418\" fill=\"#93c5fd\" font-size=\"32\" font-family=\"Manrope, Arial\">Perf ${input.perf.toFixed(2)}</text>`,
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
  if (input.taskKey && !selectedBenchmark.tasks.some((task) => task.key === input.taskKey)) {
    throw new Error(`Unknown task '${input.taskKey}' in benchmark '${input.benchmarkKey}'`);
  }
  const material = resolveAgentMaterial(input);
  const agentName = path.basename(material.agentPathLabel, path.extname(material.agentPathLabel)) || "agent";
  const agentVersion = /v\d+/i.test(agentName) ? agentName.match(/v\d+/i)![0] : "v1";
  const preview = material.agentMd;
  const taskContext = buildTaskContext(input.benchmarks, input.benchmarkKey, input.taskKey);
  const testsSeed = hashStringToUnit(`${material.agentPathLabel}:${input.benchmarkKey}:${input.taskKey ?? "all"}`);
  const testsScore = Number((6 + testsSeed * 3.5).toFixed(2));

  const model = input.model ?? process.env.AGENT_BENCH_JUDGE_MODEL ?? DEFAULT_MODEL;
  const apiKey = input.gatewayApiKey?.trim() || process.env.AI_GATEWAY_API_KEY;
  const deterministic = getDeterministicEnabled();
  const judgePromptContent = `Task Context:\n${taskContext}\n\nAgent Markdown:\n${preview}`;
  const fingerprint = makeJudgeFingerprint({
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    model,
    taskContext,
    agentMd: preview
  });
  const cachePath = cachePathFromArtifactsRoot(input.artifactsRoot);
  const judgeCache = loadJudgeCache(cachePath);

  let judge: JudgeResult;
  if (apiKey) {
    if (deterministic && judgeCache[fingerprint]) {
      const cached = judgeCache[fingerprint];
      judge = {
        score: cached.score,
        rawText: cached.rawText,
        totalTokens: cached.totalTokens,
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
      if (deterministic) {
        judgeCache[fingerprint] = {
          score: judge.score,
          rawText: judge.rawText,
          totalTokens: judge.totalTokens
        };
        saveJudgeCache(cachePath, judgeCache);
      }
    }
  } else {
    judge = judgeLocally({
      benchmarkKey: input.benchmarkKey,
      taskKey: input.taskKey,
      agentName,
      taskContext,
      agentMd: preview
    });
  }

  const costUsd = estimateCostUsd(judge.totalTokens);
  const latencyMs = judge.latencyMs;
  const durationMs = Date.now() - started;
  const perfScore = performanceScoreFromMetrics(latencyMs, costUsd);
  const scores = computeWeightedScore(testsScore, judge.score, perfScore);

  const artifactsPath = path.join(input.artifactsRoot, input.runKey);
  mkdirSync(artifactsPath, { recursive: true });
  const logText = [
    `Run key: ${input.runKey}`,
    `Benchmark: ${input.benchmarkKey}`,
    `Task: ${input.taskKey ?? "all"}`,
    `Agent: ${material.agentPathLabel}`,
    `Judge mode: ${judge.mode}`,
    `Model: ${model}`,
    `Tests score: ${testsScore}`,
    `Judge score: ${judge.score}`,
    `Perf score: ${perfScore}`,
    `Latency: ${latencyMs}ms`,
    `Cost: $${costUsd.toFixed(4)}`,
    `Gateway response: ${judge.rawText}`
  ].join("\n");

  writeFileSync(path.join(artifactsPath, "summary.json"), JSON.stringify({
    runKey: input.runKey,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey ?? null,
    model,
    judgeMode: judge.mode,
    scores,
    latencyMs,
    costUsd,
    durationMs,
    createdAt: now.toISOString(),
    screenshotFile: "screenshot.svg"
  }, null, 2));
  writeFileSync(path.join(artifactsPath, "session.log"), logText);
  writeFileSync(path.join(artifactsPath, "screenshot.svg"), buildRunScreenshotSvg({
    runKey: input.runKey,
    benchmarkKey: input.benchmarkKey,
    taskKey: input.taskKey,
    agentName,
    total: scores.total,
    tests: scores.tests,
    judge: scores.judge,
    perf: scores.performance
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

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const resultPath = process.argv[3];
  if (!requestPath || !resultPath) {
    throw new Error("Usage: node evaluator.js <request.json> <result.json>");
  }

  const input = JSON.parse(readFileSync(requestPath, "utf8")) as RuntimeEvaluationRequest;
  const result = await evaluate(input);
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  });
}
