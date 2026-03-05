import Database from "better-sqlite3";

export function createDb(dbPath: string): Database.Database {
  return new Database(dbPath);
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      agent_version TEXT NOT NULL,
      suite_name TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      tests_score REAL NOT NULL,
      llm_score REAL NOT NULL,
      perf_score REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      artifacts_path TEXT NOT NULL,
      log_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_agent_name ON runs(agent_name);
  `);
}