"use client";

import { useMemo, useState } from "react";
import type { RunRecord } from "../../src/types";
import { buildComparisonMatrix, ComparisonSetup, NO_MODEL_LABEL, runBenchmarkKey } from "../../src/core/comparison";

function formatTokens(value: number): string {
  if (value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "n/a";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function testsRatioLabel(passed: number, total: number): string {
  return total > 0 ? `${passed}/${total}` : "n/a";
}

function scoreTone(score: number | null): string {
  if (score == null) return "heat-none";
  if (score >= 7.5) return "heat-good";
  if (score >= 5) return "heat-warn";
  return "heat-bad";
}

/** Horizontal in-table bar. `invert` marks lower-is-better metrics (duration, tokens, cost). */
function MetricBar({ value, max, label, best, invert = false }: {
  value: number | null; max: number; label: string; best: boolean; invert?: boolean;
}) {
  const ratio = value == null || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className={`metric-bar-cell ${best ? "metric-best" : ""}`}>
      <span className="metric-bar-value">{label}</span>
      <span className={`metric-bar ${invert ? "metric-bar-invert" : ""}`}><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
    </div>
  );
}

export function ComparisonBoard({ runs }: { runs: RunRecord[] }) {
  const [benchmarkFilter, setBenchmarkFilter] = useState<string>("all");

  const allBenchmarkKeys = useMemo(() => [...new Set(runs.map(runBenchmarkKey))].sort(), [runs]);
  const matrix = useMemo(
    () => buildComparisonMatrix(runs, benchmarkFilter === "all" ? {} : { benchmarkKey: benchmarkFilter }),
    [runs, benchmarkFilter]
  );

  if (runs.length === 0) {
    return <div className="empty-state">No persisted runs yet. Launch a batch in the Test Lab first — the comparison builds itself from run history without spending any tokens.</div>;
  }

  const maxDuration = Math.max(...matrix.setups.map((setup) => setup.avgDurationMs ?? 0), 1);
  const maxAgentTokens = Math.max(...matrix.setups.map((setup) => setup.agentTokens), 1);
  const maxJudgeTokens = Math.max(...matrix.setups.map((setup) => setup.judgeTokens), 1);
  const maxCost = Math.max(...matrix.setups.map((setup) => setup.judgeCostUsd + setup.agentCostUsd), 0.0001);

  const scored = matrix.setups.filter((setup) => setup.avgScore != null);
  const bestScore = scored.length > 0 ? Math.max(...scored.map((setup) => setup.avgScore!)) : null;
  const withQuality = matrix.setups.filter((setup) => setup.avgQuality != null);
  const bestQuality = withQuality.length > 0 ? Math.max(...withQuality.map((setup) => setup.avgQuality!)) : null;
  const bestTestsRatio = Math.max(...matrix.setups.map((setup) => setup.testsTotal > 0 ? setup.testsPassed / setup.testsTotal : -1));
  const fastest = Math.min(...matrix.setups.map((setup) => setup.avgDurationMs ?? Number.POSITIVE_INFINITY));
  const setupsWithUsage = matrix.setups.filter((setup) => setup.agentUsageRuns > 0);
  const leanestTokens = setupsWithUsage.length > 0 ? Math.min(...setupsWithUsage.map((setup) => setup.agentTokens)) : null;
  const cheapest = Math.min(...matrix.setups.map((setup) => setup.judgeCostUsd + setup.agentCostUsd));

  const zeroTokenReviews = matrix.totals.cachedReviews + matrix.totals.rulesReviews + matrix.totals.offReviews;

  function setupTitle(setup: ComparisonSetup): { agent: string; model: string } {
    return { agent: setup.agentName, model: setup.modelLabel };
  }

  return (
    <div className="comparison-board">
      <div className="comparison-controls">
        <label className="field"><span>Benchmark</span>
          <select value={benchmarkFilter} onChange={(event) => setBenchmarkFilter(event.target.value)}>
            <option value="all">All benchmarks</option>
            {allBenchmarkKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <div className="token-strip">
          <div className="token-stat"><span>Runs compared</span><strong>{matrix.totals.runs}</strong></div>
          <div className="token-stat"><span>Judge tokens</span><strong>{formatTokens(matrix.totals.judgeTokens)}</strong></div>
          <div className="token-stat"><span>Agent tokens</span><strong>{matrix.totals.agentTokens > 0 ? formatTokens(matrix.totals.agentTokens) : "n/a"}</strong></div>
          <div className="token-stat"><span>Total cost</span><strong>${(matrix.totals.judgeCostUsd + matrix.totals.agentCostUsd).toFixed(2)}</strong></div>
          <div className="token-stat token-stat-good"><span>Zero-token reviews</span><strong>{zeroTokenReviews}</strong></div>
        </div>
      </div>
      <p className="status-line">This view aggregates persisted runs only — filtering and re-rendering never call a model. {matrix.totals.cachedReviews > 0 ? `${matrix.totals.cachedReviews} review(s) were served from the judge cache, ` : ""}{matrix.totals.rulesReviews + matrix.totals.offReviews > 0 ? `${matrix.totals.rulesReviews + matrix.totals.offReviews} used the deterministic rules rubric — ` : ""}only {matrix.totals.gatewayReviews} run(s) spent fresh judge tokens.</p>

      <div className="table-scroll">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Setup (agent × model)</th>
              <th>Score</th>
              <th>Quality</th>
              <th>Tests</th>
              <th>Avg time</th>
              <th>Agent tokens</th>
              <th>Judge tokens</th>
              <th>Cost</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {matrix.setups.map((setup) => {
              const { agent, model } = setupTitle(setup);
              const testsRatio = setup.testsTotal > 0 ? setup.testsPassed / setup.testsTotal : null;
              const cost = setup.judgeCostUsd + setup.agentCostUsd;
              return (
                <tr key={setup.setupKey}>
                  <td className="setup-cell">
                    <strong>{agent}</strong>
                    <span className={`model-chip ${model === NO_MODEL_LABEL ? "model-chip-muted" : ""}`}>{model}</span>
                  </td>
                  <td><MetricBar value={setup.avgScore} max={10} label={setup.avgScore != null ? setup.avgScore.toFixed(2) : "n/a"} best={bestScore != null && setup.avgScore === bestScore} /></td>
                  <td><MetricBar value={setup.avgQuality} max={10} label={setup.avgQuality != null ? setup.avgQuality.toFixed(2) : "n/a"} best={bestQuality != null && setup.avgQuality === bestQuality} /></td>
                  <td><MetricBar value={testsRatio != null ? testsRatio * 10 : null} max={10} label={testsRatioLabel(setup.testsPassed, setup.testsTotal)} best={testsRatio != null && testsRatio === bestTestsRatio && bestTestsRatio >= 0} /></td>
                  <td><MetricBar invert value={setup.avgDurationMs} max={maxDuration} label={formatDuration(setup.avgDurationMs)} best={setup.avgDurationMs != null && setup.avgDurationMs === fastest} /></td>
                  <td><MetricBar invert value={setup.agentUsageRuns > 0 ? setup.agentTokens : null} max={maxAgentTokens} label={setup.agentUsageRuns > 0 ? formatTokens(setup.agentTokens) : "n/a"} best={leanestTokens != null && setup.agentUsageRuns > 0 && setup.agentTokens === leanestTokens} /></td>
                  <td><MetricBar invert value={setup.judgeTokens} max={maxJudgeTokens} label={formatTokens(setup.judgeTokens)} best={false} /></td>
                  <td><MetricBar invert value={cost} max={maxCost} label={`$${cost.toFixed(2)}`} best={cost === cheapest} /></td>
                  <td className="runs-cell">{setup.completedCount}{setup.failedCount > 0 ? <span className="delta-neg"> +{setup.failedCount}✗</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {matrix.taskKeys.length > 1 && (
        <div className="heatmap-block">
          <div className="section-header"><div><p className="eyebrow">Per task</p><h3>Score heatmap</h3></div></div>
          <div className="table-scroll">
            <table className="matrix-table heatmap-table">
              <thead>
                <tr>
                  <th>Setup</th>
                  {matrix.taskKeys.map((taskKey) => <th key={taskKey} className="heat-head">{taskKey}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.setups.map((setup) => (
                  <tr key={`heat-${setup.setupKey}`}>
                    <td className="setup-cell"><strong>{setup.agentName}</strong><span className="model-chip model-chip-muted">{setup.modelLabel}</span></td>
                    {matrix.taskKeys.map((taskKey) => {
                      const cell = setup.tasks[taskKey];
                      if (!cell) return <td key={taskKey} className="heat-cell heat-none">—</td>;
                      return (
                        <td key={taskKey} className={`heat-cell ${cell.avgScore == null && cell.failedCount > 0 ? "heat-bad" : scoreTone(cell.avgScore)}`}>
                          <strong>{cell.avgScore != null ? cell.avgScore.toFixed(1) : cell.failedCount > 0 ? "✗" : "—"}</strong>
                          <span>{testsRatioLabel(cell.testsPassed, cell.testsTotal)}{cell.runCount > 1 ? ` · ${cell.runCount}r` : ""}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
