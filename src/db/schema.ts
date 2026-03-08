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

    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_agent_name ON runs(agent_name);
  `);

  addColumnIfMissing(db, "runs", "process_score", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "score_profile", "TEXT NOT NULL DEFAULT 'hybrid'");
  addColumnIfMissing(db, "runs", "score_confidence", "TEXT NOT NULL DEFAULT 'low'");
  addColumnIfMissing(db, "runs", "failure_reason", "TEXT");
}
