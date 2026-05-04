import test from "node:test";
import assert from "node:assert/strict";
import { judgeWithVercelAiSdk, resolveGatewayApiKey, resolveJudgeModel } from "../src/runtime/evaluator";

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
