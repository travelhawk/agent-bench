import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb, initializeSchema } from "../src/db/schema";
import { insertRun, saveBlindReviewUsage, setBlindReview, sumBlindReviewUsageForRuns } from "../src/db/store";
import { exportComparison, importBlindReviewDir } from "../src/server/service";
import { RunInput } from "../src/types";

function runInput(runKey: string, agentName: string): RunInput {
  return {
    runKey,
    benchmarkKey: "workflow-builds",
    taskKey: "haushaltsbuch",
    modelId: null,
    agentName,
    agentVersion: "v1",
    suiteName: "workflow-builds/haushaltsbuch",
    status: "completed",
    scores: { outcome: 8, process: 0, review: 8, efficiency: 6, tests: 8, judge: 8, performance: 6, total: 7.8 },
    scoreProfile: "hybrid",
    scoreConfidence: "medium",
    latencyMs: 1000,
    costUsd: 0,
    durationMs: 60000,
    artifactsPath: "/tmp/none",
    logText: "",
    verifierTestsAvailable: false,
    verifierTestsTotal: 0,
    verifierTestsPassed: 0,
    qualityScore: null,
    agentUsageAvailable: true,
    agentInputTokens: 1000,
    agentOutputTokens: 100,
    agentCostUsd: 0.5,
    reviewMode: "rules",
    judgeTotalTokens: 0
  } as RunInput;
}

test("blind reviewer usage is stored with the review and summed once per review", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-blind-usage-"));
  const db = createDb(path.join(workspace, "runs.db"));
  try {
    initializeSchema(db);
    for (const key of ["a", "b", "c"]) insertRun(db, runInput(key, key === "c" ? "other" : "vanilla"));
    saveBlindReviewUsage(db, {
      reviewKey: "blind-1",
      taskKey: "haushaltsbuch",
      usage: { inputTokens: 744000, outputTokens: 11800, costUsd: 0.38, durationMs: 378000 },
      runKeys: ["a", "b"]
    });
    assert.deepEqual(sumBlindReviewUsageForRuns(db, ["a", "b", "c"]), { inputTokens: 744000, outputTokens: 11800, costUsd: 0.38, durationMs: 378000 });
    assert.equal(sumBlindReviewUsageForRuns(db, ["c"]), null);
    // Re-saving the same review replaces it instead of double counting.
    saveBlindReviewUsage(db, { reviewKey: "blind-1", taskKey: "haushaltsbuch", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.1, durationMs: 1 }, runKeys: ["a"] });
    assert.equal(sumBlindReviewUsageForRuns(db, ["a", "b"])?.costUsd, 0.1);
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("export reads blind reviewer cost from the DB (md, json, html) and old folders can be imported", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-blind-export-"));
  const dbPath = path.join(workspace, "runs.db");
  const db = createDb(dbPath);
  try {
    initializeSchema(db);
    insertRun(db, runInput("r1", "vanilla"));
    insertRun(db, runInput("r2", "forge"));
    setBlindReview(db, "r1", 2, "ok");
    setBlindReview(db, "r2", 1, "best");
  } finally {
    db.close();
  }
  try {
    const before = await exportComparison({ format: "md", benchmarkKey: "workflow-builds" }, dbPath);
    assert.doesNotMatch(before.body, /Blind reviewer: \d/);

    const dir = path.join(workspace, "blind-2026-11-17T07-04-45-961Z-haushaltsbuch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "blind-key.json"), JSON.stringify([{ letter: "A", setupKey: "vanilla", runKey: "r1" }, { letter: "B", setupKey: "forge", runKey: "r2" }]));
    writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ inputTokens: 743975, outputTokens: 11842, costUsd: 0.38, durationMs: 377803 }));
    const imported = await importBlindReviewDir(dir, dbPath);
    assert.deepEqual(imported.runKeys, ["r1", "r2"]);

    for (const format of ["md", "html"] as const) {
      const result = await exportComparison({ format, benchmarkKey: "workflow-builds" }, dbPath);
      assert.match(result.body, /744\.0k in \/ 11\.8k out, \$0\.38/, `${format} shows the reviewer`);
    }
    const json = JSON.parse((await exportComparison({ format: "json", benchmarkKey: "workflow-builds" }, dbPath)).body);
    assert.equal(json.batchTotals.blindReviewer.costUsd, 0.38);
    assert.ok(json.batchTotals.totalCostUsd >= 1.38 - 1e-9, "reviewer cost is part of the batch total");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
