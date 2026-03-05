import Database from "better-sqlite3";
import { RunInput, RunRecord } from "../types";
import { newRunKey } from "../core/runner";

export interface DashboardSummary {
  totalRuns: number;
  avgScore: number;
  totalCost: number;
  activeBenchmarks: number;
}

const DEFAULT_BENCHMARKS = [
  {
    key: "fix-react-bug",
    title: "Fix React Bug",
    description: "Repair a failing React component behavior in an isolated repo."
  },
  {
    key: "logic-puzzle",
    title: "Logic Puzzle",
    description: "Solve a deterministic reasoning benchmark with traceable steps."
  },
  {
    key: "design-rest-api",
    title: "Design REST API",
    description: "Produce routes and contracts for a small API specification task."
  },
  {
    key: "sql-refactor",
    title: "SQL Refactor",
    description: "Improve correctness and performance of an existing SQL query."
  }
];

export function seedBenchmarks(db: Database.Database): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO benchmarks (key, title, description)
    VALUES (@key, @title, @description)
  `);

  const transaction = db.transaction((rows: typeof DEFAULT_BENCHMARKS) => {
    rows.forEach((row) => stmt.run(row));
  });

  transaction(DEFAULT_BENCHMARKS);
}

export function insertRun(db: Database.Database, input: RunInput): RunRecord {
  const runKey = newRunKey();
  db.prepare(`
    INSERT INTO runs (
      run_key, agent_name, agent_version, suite_name, status,
      score, tests_score, llm_score, perf_score,
      latency_ms, cost_usd, duration_ms, artifacts_path, log_text
    ) VALUES (
      @run_key, @agent_name, @agent_version, @suite_name, 'completed',
      @score, @tests_score, @llm_score, @perf_score,
      @latency_ms, @cost_usd, @duration_ms, @artifacts_path, @log_text
    )
  `).run({
    run_key: runKey,
    agent_name: input.agentName,
    agent_version: input.agentVersion,
    suite_name: input.suiteName,
    score: input.scores.total,
    tests_score: input.scores.tests,
    llm_score: input.scores.judge,
    perf_score: input.scores.performance,
    latency_ms: input.latencyMs,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    artifacts_path: input.artifactsPath,
    log_text: input.logText
  });

  const row = db.prepare(`
    SELECT * FROM runs WHERE run_key = ?
  `).get(runKey) as Record<string, unknown>;

  return mapRun(row);
}

export function listRuns(db: Database.Database, limit = 20): RunRecord[] {
  const rows = db.prepare(`
    SELECT * FROM runs
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  return rows.map(mapRun);
}

export function getBestScore(db: Database.Database): number | null {
  const row = db.prepare(`SELECT MAX(score) as best FROM runs`).get() as { best: number | null };
  return row.best;
}

export function getDashboardSummary(db: Database.Database): DashboardSummary {
  const totalRuns = (db.prepare(`SELECT COUNT(*) as c FROM runs`).get() as { c: number }).c;
  const avgScore = (db.prepare(`SELECT COALESCE(AVG(score), 0) as s FROM runs`).get() as { s: number }).s;
  const totalCost = (db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as c FROM runs`).get() as { c: number }).c;
  const activeBenchmarks = (db.prepare(`SELECT COUNT(*) as c FROM benchmarks`).get() as { c: number }).c;

  return {
    totalRuns,
    avgScore: Number(avgScore.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    activeBenchmarks
  };
}

export function listBenchmarks(db: Database.Database): Array<{ key: string; title: string; description: string }> {
  return db.prepare(`SELECT key, title, description FROM benchmarks ORDER BY id ASC`).all() as Array<{
    key: string;
    title: string;
    description: string;
  }>;
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: Number(row.id),
    runKey: String(row.run_key),
    agentName: String(row.agent_name),
    agentVersion: String(row.agent_version),
    suiteName: String(row.suite_name),
    status: String(row.status) as RunRecord["status"],
    score: Number(row.score),
    testsScore: Number(row.tests_score),
    llmScore: Number(row.llm_score),
    perfScore: Number(row.perf_score),
    latencyMs: Number(row.latency_ms),
    costUsd: Number(row.cost_usd),
    durationMs: Number(row.duration_ms),
    artifactsPath: String(row.artifacts_path),
    logText: String(row.log_text),
    createdAt: String(row.created_at)
  };
}