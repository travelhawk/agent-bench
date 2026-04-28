import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb, initializeSchema } from "../src/db/schema";

test("initializeSchema migrates legacy run tables before creating new run indexes", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-schema-"));
  const db = createDb(path.join(workspace, "runs.db"));

  try {
    db.exec(`
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_key TEXT NOT NULL UNIQUE,
        agent_name TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        suite_name TEXT NOT NULL,
        status TEXT NOT NULL,
        score REAL NOT NULL,
        process_score REAL NOT NULL DEFAULT 0,
        tests_score REAL NOT NULL,
        llm_score REAL NOT NULL,
        perf_score REAL NOT NULL,
        score_profile TEXT NOT NULL DEFAULT 'hybrid',
        score_confidence TEXT NOT NULL DEFAULT 'low',
        failure_reason TEXT,
        latency_ms INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        artifacts_path TEXT NOT NULL,
        log_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    assert.doesNotThrow(() => initializeSchema(db));

    const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    const indexes = db.prepare("PRAGMA index_list(runs)").all() as Array<{ name: string }>;

    assert.ok(columns.some((column) => column.name === "experiment_key"));
    assert.ok(columns.some((column) => column.name === "setup_key"));
    assert.ok(indexes.some((index) => index.name === "idx_runs_experiment_key"));
    assert.ok(indexes.some((index) => index.name === "idx_runs_setup_key"));
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
