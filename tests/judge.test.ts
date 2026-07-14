import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { judgeWithVercelAiSdk, resolveGatewayApiKey, resolveJudgeModel, runJudgeReview } from "../src/runtime/evaluator";

test("judgeWithVercelAiSdk calls generateText and parses score", async () => {
  let capturedArgs: Record<string, unknown> | undefined;
  const mockGenerateText = (async (args: Record<string, unknown>) => {
    capturedArgs = args;
    return {
      text: "{\"score\": 8.4, \"taskCompleted\": true, \"reason\": \"Done\"}",
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        totalTokens: 140
      }
    };
  }) as unknown as typeof import("ai").generateText;

  const result = await judgeWithVercelAiSdk({
    apiKey: "test-key",
    model: "openai/gpt-4.1-mini",
    benchmarkKey: "creative-frontend",
    taskKey: "landing-page-refresh",
    agentPath: "/tmp/agent.md",
    agentName: "agent",
    agentVersion: "v1",
    agentTextPreview: "agent markdown",
    generateTextFn: mockGenerateText
  });

  assert.ok(capturedArgs, "generateText should be called");
  assert.equal(capturedArgs.model, "openai/gpt-4.1-mini");
  assert.equal(typeof capturedArgs.system, "string");
  assert.equal(result.score, 8.4);
  assert.equal(result.totalTokens, 140);
  assert.equal(result.mode, "gateway");
});

test("judgeWithVercelAiSdk fails on empty model text", async () => {
  const mockGenerateText = (async () => ({ text: "" })) as unknown as typeof import("ai").generateText;

  await assert.rejects(
    () => judgeWithVercelAiSdk({
      apiKey: "test-key",
      model: "openai/gpt-4.1-mini",
      benchmarkKey: "creative-frontend",
      taskKey: "landing-page-refresh",
      agentPath: "/tmp/agent.md",
      agentName: "agent",
      agentVersion: "v1",
      agentTextPreview: "agent markdown",
      generateTextFn: mockGenerateText
    }),
    /empty response/i
  );
});

test("judgeWithVercelAiSdk parses qualityScore when the model includes it", async () => {
  const mockGenerateText = (async () => ({
    text: "{\"score\": 7.1, \"qualityScore\": 8.9, \"reason\": \"Solid diff\"}",
    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
  })) as unknown as typeof import("ai").generateText;

  const result = await judgeWithVercelAiSdk({
    apiKey: "test-key",
    model: "openai/gpt-4.1-mini",
    benchmarkKey: "creative-frontend",
    taskKey: "landing-page-refresh",
    agentPath: "/tmp/agent.md",
    agentName: "agent",
    agentVersion: "v1",
    agentTextPreview: "agent markdown",
    generateTextFn: mockGenerateText
  });

  assert.equal(result.score, 7.1);
  assert.equal(result.qualityScore, 8.9);
});

test("runJudgeReview aggregates a judge panel by median score", async () => {
  const previous = process.env.AGENT_BENCH_JUDGE_SAMPLES;
  process.env.AGENT_BENCH_JUDGE_SAMPLES = "3";

  try {
    const scores = [6, 9, 7];
    let call = 0;
    const mockGenerateText = (async () => ({
      text: JSON.stringify({ score: scores[call++], qualityScore: 5, reason: "sample reason" }),
      usage: { totalTokens: 10 }
    })) as unknown as typeof import("ai").generateText;

    const result = await runJudgeReview({
      apiKey: "test-key",
      model: "openai/gpt-4.1-mini",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      agentPath: "/tmp/agent.md",
      agentName: "agent",
      agentVersion: "v1",
      agentTextPreview: "ctx",
      generateTextFn: mockGenerateText
    });

    assert.equal(call, 3, "should sample three times");
    assert.equal(result.score, 7, "median of [6,9,7] is 7");
    assert.equal(result.qualityScore, 5);
    assert.equal(result.totalTokens, 30);
    assert.match(result.reason, /panel of 3/i);
  } finally {
    if (previous === undefined) delete process.env.AGENT_BENCH_JUDGE_SAMPLES;
    else process.env.AGENT_BENCH_JUDGE_SAMPLES = previous;
  }
});

test("judgeWithVercelAiSdk sends a multimodal message when a screenshot is provided", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-judge-img-"));
  const imagePath = path.join(workspace, "page.png");
  writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    let capturedArgs: Record<string, unknown> | undefined;
    const mockGenerateText = (async (args: Record<string, unknown>) => {
      capturedArgs = args;
      return { text: JSON.stringify({ score: 8, qualityScore: 7, reason: "looks good" }), usage: { totalTokens: 12 } };
    }) as unknown as typeof import("ai").generateText;

    const result = await judgeWithVercelAiSdk({
      apiKey: "test-key",
      model: "openai/gpt-4.1-mini",
      benchmarkKey: "creative-frontend",
      taskKey: "landing-page-refresh",
      agentPath: "/tmp/agent.md",
      agentName: "agent",
      agentVersion: "v1",
      agentTextPreview: "ctx",
      imagePngPath: imagePath,
      generateTextFn: mockGenerateText
    });

    assert.ok(capturedArgs, "generateText should be called");
    assert.equal(capturedArgs.prompt, undefined, "image path should switch to messages, not prompt");
    assert.ok(Array.isArray(capturedArgs.messages), "should send a messages array");
    assert.equal(result.score, 8);
    assert.equal(result.qualityScore, 7);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("resolveGatewayApiKey falls back to AI_GATEWAY_API_KEY", () => {
  const previousKey = process.env.AI_GATEWAY_API_KEY;

  try {
    process.env.AI_GATEWAY_API_KEY = " env-key ";

    assert.equal(resolveGatewayApiKey(undefined), "env-key");
    assert.equal(resolveGatewayApiKey(" session-key "), "session-key");
  } finally {
    if (previousKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = previousKey;
    }
  }
});

test("resolveJudgeModel falls back to AGENT_BENCH_JUDGE_MODEL", () => {
  const previousModel = process.env.AGENT_BENCH_JUDGE_MODEL;

  try {
    process.env.AGENT_BENCH_JUDGE_MODEL = " openai/custom-model ";

    assert.equal(resolveJudgeModel(undefined), "openai/custom-model");
    assert.equal(resolveJudgeModel(" openai/request-model "), "openai/request-model");
  } finally {
    if (previousModel === undefined) {
      delete process.env.AGENT_BENCH_JUDGE_MODEL;
    } else {
      process.env.AGENT_BENCH_JUDGE_MODEL = previousModel;
    }
  }
});
