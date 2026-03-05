import test from "node:test";
import assert from "node:assert/strict";
import { judgeWithVercelAiSdk } from "../src/runtime/evaluator";

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
    benchmarkKey: "core-engineering",
    taskKey: "logic-puzzle",
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
      benchmarkKey: "core-engineering",
      taskKey: "logic-puzzle",
      agentPath: "/tmp/agent.md",
      agentName: "agent",
      agentVersion: "v1",
      agentTextPreview: "agent markdown",
      generateTextFn: mockGenerateText
    }),
    /empty response/i
  );
});
