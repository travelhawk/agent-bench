import assert from "node:assert/strict";
import test from "node:test";
import { executeBatchPlan } from "../src/server/service";

test("executeBatchPlan keeps later jobs running when one job fails", async () => {
  const jobs = [
    { benchmarkKey: "agentic-workflows", taskKey: "research-synthesis-loop", agentPath: "agents/coder.md" },
    { benchmarkKey: "agentic-workflows", taskKey: "release-war-room", agentPath: "agents/coder.md" },
    { benchmarkKey: "agentic-workflows", taskKey: "superagent-handoff-mesh", agentPath: "agents/reviewer.md" }
  ];

  const order: string[] = [];
  const result = await executeBatchPlan(jobs, async (job) => {
    order.push(`${job.agentPath}:${job.taskKey}`);
    if (job.taskKey === "release-war-room") {
      throw new Error("judge gateway timed out");
    }
    return `${job.agentPath}:${job.taskKey}`;
  });

  assert.deepEqual(order, [
    "agents/coder.md:research-synthesis-loop",
    "agents/coder.md:release-war-room",
    "agents/reviewer.md:superagent-handoff-mesh"
  ]);
  assert.deepEqual(result.results, [
    "agents/coder.md:research-synthesis-loop",
    "agents/reviewer.md:superagent-handoff-mesh"
  ]);
  assert.deepEqual(result.failures, [
    {
      agentPath: "agents/coder.md",
      taskKey: "release-war-room",
      message: "judge gateway timed out"
    }
  ]);
});
