"use client";

import type { CSSProperties, ReactNode } from "react";
import type { RunRecord } from "../../src/types";
import { confidenceClass, formatMoney, runStatusClass } from "./shared";

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric-tile">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

export function RunCard({
  run, busy, onOpen, onDelete, compareMode = false, comparePicked = false, onToggleCompare
}: {
  run: RunRecord;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  compareMode?: boolean;
  comparePicked?: boolean;
  onToggleCompare?: () => void;
}) {
  const scoreTurns = Math.max(0, Math.min(10, run.score)) / 10;
  const diffValue = run.diffAvailable
    ? <><span className="delta-pos">+{run.diffInsertions}</span> <span className="delta-neg">−{run.diffDeletions}</span></>
    : "n/a";

  return (
    <article className={`run-card ${run.status === "failed" ? "run-card-failed" : ""} ${comparePicked ? "selected-compare" : ""}`}>
      <div className="run-card-top">
        <div className="score-badge" style={{ "--score": scoreTurns * 10 } as CSSProperties}><span>{run.score.toFixed(1)}</span></div>
        <div className="run-copy"><h3>{run.agentName}</h3><p>{run.suiteName}</p></div>
        <div className="run-chips">
          <span className={`status-chip ${runStatusClass(run.status)}`}>{run.status}</span>
          <span className={`status-chip ${confidenceClass(run.scoreConfidence)}`}>{run.scoreConfidence}</span>
        </div>
      </div>
      <div className="run-metrics-row">
        <MetricTile label="Quality" value={run.qualityScore != null ? run.qualityScore.toFixed(1) : "n/a"} />
        <MetricTile label="Diff" value={diffValue} />
        <MetricTile label="Tests" value={run.verifierTestsAvailable ? `${run.verifierTestsPassed}/${run.verifierTestsTotal}` : "n/a"} />
        <MetricTile label="Duration" value={run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : "n/a"} />
        <MetricTile label="Cost" value={formatMoney(run.costUsd)} />
      </div>
      {run.failureReason && <div className="callout callout-error"><span>{run.failureReason}</span></div>}
      <div className="run-card-actions">
        {compareMode && onToggleCompare ? (
          <button type="button" className="text-link button-reset" onClick={onToggleCompare}>{comparePicked ? "Deselect" : "Select to compare"}</button>
        ) : null}
        <button type="button" className="text-link button-reset" onClick={onOpen} disabled={busy}>Open</button>
        <button type="button" className="text-link button-reset btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </article>
  );
}
