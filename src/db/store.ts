import Database from "better-sqlite3";
import { RunInput, RunRecord } from "../types";

export interface DashboardSummary {
  totalRuns: number;
  avgScore: number;
  totalCost: number;
}

export function insertRun(db: Database.Database, input: RunInput): RunRecord {
  db.prepare(`
    INSERT INTO runs (
      run_key, agent_name, agent_version, suite_name, status,
      score, process_score, tests_score, llm_score, perf_score,
      score_profile, score_confidence, failure_reason,
      latency_ms, cost_usd, duration_ms, artifacts_path, log_text
    ) VALUES (
      @run_key, @agent_name, @agent_version, @suite_name, @status,
      @score, @process_score, @tests_score, @llm_score, @perf_score,
      @score_profile, @score_confidence, @failure_reason,
      @latency_ms, @cost_usd, @duration_ms, @artifacts_path, @log_text
    )
  `).run({
    run_key: input.runKey,
    agent_name: input.agentName,
    agent_version: input.agentVersion,
    suite_name: input.suiteName,
    status: input.status,
    score: input.scores.total,
    process_score: input.scores.process,
    tests_score: input.scores.outcome,
    llm_score: input.scores.review,
    perf_score: input.scores.efficiency,
    score_profile: input.scoreProfile,
    score_confidence: input.scoreConfidence,
    failure_reason: input.failureReason ?? null,
    latency_ms: input.latencyMs,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    artifacts_path: input.artifactsPath,
    log_text: input.logText
  });

  const row = db.prepare(`
    SELECT * FROM runs WHERE run_key = ?
  `).get(input.runKey) as Record<string, unknown>;

  return mapRun(row);
}

export function getRunByKey(db: Database.Database, runKey: string): RunRecord | null {
  const row = db.prepare(`
    SELECT * FROM runs WHERE run_key = ?
  `).get(runKey) as Record<string, unknown> | undefined;

  return row ? mapRun(row) : null;
}

export function deleteRunByKey(db: Database.Database, runKey: string): boolean {
  const result = db.prepare(`
    DELETE FROM runs WHERE run_key = ?
  `).run(runKey);
  return result.changes > 0;
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

  return {
    totalRuns,
    avgScore: Number(avgScore.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2))
  };
}

function mapRun(row: Record<string, unknown>): RunRecord {
  const outcomeScore = Number(row.tests_score);
  const processScore = Number(row.process_score ?? 0);
  const reviewScore = Number(row.llm_score);
  const efficiencyScore = Number(row.perf_score);

  return {
    id: Number(row.id),
    runKey: String(row.run_key),
    agentName: String(row.agent_name),
    agentVersion: String(row.agent_version),
    suiteName: String(row.suite_name),
    status: String(row.status) as RunRecord["status"],
    score: Number(row.score),
    outcomeScore,
    processScore,
    reviewScore,
    efficiencyScore,
    testsScore: outcomeScore,
    llmScore: reviewScore,
    perfScore: efficiencyScore,
    scoreProfile: String(row.score_profile ?? "hybrid") as RunRecord["scoreProfile"],
    scoreConfidence: String(row.score_confidence ?? "low") as RunRecord["scoreConfidence"],
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    latencyMs: Number(row.latency_ms),
    costUsd: Number(row.cost_usd),
    durationMs: Number(row.duration_ms),
    artifactsPath: String(row.artifacts_path),
    logText: String(row.log_text),
    createdAt: String(row.created_at)
  };
}
