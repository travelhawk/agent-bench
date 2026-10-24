import test from "node:test";
import assert from "node:assert/strict";
import { agentRequiresNetwork, resolveJudgeModelForRun } from "../src/runtime/evaluator";

const ORIGINAL_JUDGE_MODEL = process.env.AGENT_BENCH_JUDGE_MODEL;

test.afterEach(() => {
  if (ORIGINAL_JUDGE_MODEL === undefined) delete process.env.AGENT_BENCH_JUDGE_MODEL;
  else process.env.AGENT_BENCH_JUDGE_MODEL = ORIGINAL_JUDGE_MODEL;
});

test("an explicit judge model always wins", () => {
  const resolved = resolveJudgeModelForRun({
    judgeModel: "openai/gpt-4.1",
    model: "anthropic/claude-opus-5",
    hasRunner: true
  });
  assert.equal(resolved, "openai/gpt-4.1");
});

test("a runner-backed agent keeps its model out of the judge seat", () => {
  process.env.AGENT_BENCH_JUDGE_MODEL = "openai/gpt-4.1-mini";
  const sonnet = resolveJudgeModelForRun({ model: "anthropic/claude-sonnet-5", hasRunner: true });
  const opus = resolveJudgeModelForRun({ model: "anthropic/claude-opus-5", hasRunner: true });

  // Both subjects must be graded by the same judge, or the comparison would
  // vary two things at once.
  assert.equal(sonnet, "openai/gpt-4.1-mini");
  assert.equal(opus, "openai/gpt-4.1-mini");
});

test("a review-only agent still treats model as the judge", () => {
  const resolved = resolveJudgeModelForRun({ model: "anthropic/claude-opus-5", hasRunner: false });
  assert.equal(resolved, "anthropic/claude-opus-5");
});

test("agentRequiresNetwork reads the agent's own declaration", () => {
  assert.equal(agentRequiresNetwork("# a\n\nRunner: node run.mjs\nRequires Network: yes\n"), true);
  assert.equal(agentRequiresNetwork("Requires Network: TRUE"), true);
  assert.equal(agentRequiresNetwork("Requires Network: no"), false);
  assert.equal(agentRequiresNetwork("# a\n\nRunner: node run.mjs\n"), false);
  // Only a line of its own counts, so prose about networking cannot open egress.
  assert.equal(agentRequiresNetwork("The agent explains Requires Network: yes in passing."), false);
});
