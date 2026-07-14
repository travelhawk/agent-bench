import Database from "better-sqlite3";

export function createDb(dbPath: string): Database.Database {
  return new Database(dbPath);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  if (columnExists(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key TEXT NOT NULL UNIQUE,
      experiment_key TEXT,
      benchmark_key TEXT,
      task_key TEXT,
      setup_key TEXT,
      workflow_path TEXT,
      model_id TEXT,
      trial_index INTEGER,
      agent_name TEXT NOT NULL,
      agent_version TEXT NOT NULL,
      suite_name TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      process_score REAL NOT NULL DEFAULT 0,
      tests_score REAL NOT NULL,
      llm_score REAL NOT NULL,
      perf_score REAL NOT NULL,
      objective_score REAL NOT NULL DEFAULT 0,
      objective_pass INTEGER NOT NULL DEFAULT 0,
      objective_checks_available INTEGER NOT NULL DEFAULT 0,
      objective_checks_passed INTEGER NOT NULL DEFAULT 0,
      deterministic INTEGER NOT NULL DEFAULT 0,
      score_profile TEXT NOT NULL DEFAULT 'hybrid',
      score_confidence TEXT NOT NULL DEFAULT 'low',
      failure_reason TEXT,
      latency_ms INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      artifacts_path TEXT NOT NULL,
      log_text TEXT NOT NULL,
      diff_available INTEGER NOT NULL DEFAULT 0,
      diff_files_changed INTEGER NOT NULL DEFAULT 0,
      diff_insertions INTEGER NOT NULL DEFAULT 0,
      diff_deletions INTEGER NOT NULL DEFAULT 0,
      verifier_tests_available INTEGER NOT NULL DEFAULT 0,
      verifier_tests_total INTEGER NOT NULL DEFAULT 0,
      verifier_tests_passed INTEGER NOT NULL DEFAULT 0,
      quality_score REAL,
      agent_usage_available INTEGER NOT NULL DEFAULT 0,
      agent_input_tokens INTEGER NOT NULL DEFAULT 0,
      agent_output_tokens INTEGER NOT NULL DEFAULT 0,
      agent_cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_key TEXT NOT NULL UNIQUE,
      benchmark_key TEXT NOT NULL,
      run_mode TEXT NOT NULL,
      task_plan_json TEXT NOT NULL,
      repeat_count INTEGER NOT NULL,
      strict_sandbox INTEGER NOT NULL DEFAULT 1,
      resolved_provider TEXT NOT NULL,
      environment_fingerprint TEXT NOT NULL,
      setups_json TEXT NOT NULL,
      queue_size INTEGER NOT NULL,
      completed_runs INTEGER NOT NULL,
      failed_runs INTEGER NOT NULL,
      status TEXT NOT NULL,
      comparison_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at DESC);
  `);

  addColumnIfMissing(db, "runs", "experiment_key", "TEXT");
  addColumnIfMissing(db, "runs", "benchmark_key", "TEXT");
  addColumnIfMissing(db, "runs", "task_key", "TEXT");
  addColumnIfMissing(db, "runs", "setup_key", "TEXT");
  addColumnIfMissing(db, "runs", "workflow_path", "TEXT");
  addColumnIfMissing(db, "runs", "model_id", "TEXT");
  addColumnIfMissing(db, "runs", "trial_index", "INTEGER");
  addColumnIfMissing(db, "runs", "process_score", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "objective_score", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "objective_pass", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "objective_checks_available", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "objective_checks_passed", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "deterministic", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "score_profile", "TEXT NOT NULL DEFAULT 'hybrid'");
  addColumnIfMissing(db, "runs", "score_confidence", "TEXT NOT NULL DEFAULT 'low'");
  addColumnIfMissing(db, "runs", "failure_reason", "TEXT");
  addColumnIfMissing(db, "runs", "diff_available", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "diff_files_changed", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "diff_insertions", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "diff_deletions", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "verifier_tests_available", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "verifier_tests_total", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "verifier_tests_passed", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "quality_score", "REAL");
  addColumnIfMissing(db, "runs", "agent_usage_available", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "agent_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "agent_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "agent_cost_usd", "REAL NOT NULL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_agent_name ON runs(agent_name);
    CREATE INDEX IF NOT EXISTS idx_runs_experiment_key ON runs(experiment_key);
    CREATE INDEX IF NOT EXISTS idx_runs_setup_key ON runs(setup_key);
  `);
}
