"use client";

import { useEffect, useState } from "react";
import type { RunResultPayload } from "../../src/types";
import { confidenceClass, readRunSummary, runStatusClass } from "./shared";

function ScoreBar({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  return (
    <div className="score-bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track"><div className={`bar-fill ${tone ?? ""}`} style={{ width: `${pct}%` }} /></div>
      <span className="bar-num">{value.toFixed(2)}</span>
    </div>
  );
}

export function RunInspector({ detail, onClose }: { detail: RunResultPayload; onClose: () => void }) {
  const [showJson, setShowJson] = useState(false);
  const run = detail.run;
  const summary = readRunSummary(detail.summary);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [onClose]);

  const quality = summary?.qualityScore ?? run.qualityScore;
  const scores: Array<{ label: string; value: number; tone?: string }> = [
    { label: "Total", value: summary?.scores?.total ?? run.score, tone: "" },
    { label: "Outcome", value: summary?.scores?.outcome ?? run.outcomeScore, tone: "bar-fill-good" },
    { label: "Process", value: summary?.scores?.process ?? run.processScore, tone: "bar-fill-info" },
    { label: "Review", value: summary?.scores?.review ?? run.reviewScore },
    { label: "Efficiency", value: summary?.scores?.efficiency ?? run.efficiencyScore, tone: "bar-fill-info" }
  ];

  const testsPct = run.verifierTestsTotal > 0 ? (run.verifierTestsPassed / run.verifierTestsTotal) * 100 : 0;
  const agentTotalTokens = run.agentInputTokens + run.agentOutputTokens;

  return (
    <div className="drawer-overlay" role="dialog" aria-modal="true" aria-label={`Run ${run.runKey}`} onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Run inspector</p>
            <h2>{run.agentName}</h2>
            <div className="chip-row">
              <span className={`status-chip ${runStatusClass(run.status)}`}>{run.status}</span>
              <span className={`status-chip ${confidenceClass(run.scoreConfidence)}`}>{run.scoreConfidence} confidence</span>
              <span className="status-chip">{summary?.scoreProfile ?? run.scoreProfile}</span>
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close inspector">✕</button>
        </div>

        <div className="drawer-body">
          <div className="detail-stack"><strong>{run.suiteName}</strong><span>{run.runKey}</span></div>

          <div className="drawer-section">
            <h3>Score breakdown</h3>
            {scores.map((score) => <ScoreBar key={score.label} label={score.label} value={score.value} tone={score.tone} />)}
          </div>

          <div className="drawer-section">
            <h3>Execution metrics</h3>
            <div className="metric-grid">
              <div className="metric-block">
                <div className="metric-head"><strong>Lines changed</strong>{!run.diffAvailable && <span className="metric-na">n/a</span>}</div>
                {run.diffAvailable ? (
                  <>
                    <div className="diff-figures"><span className="diff-add">+{run.diffInsertions}</span><span className="diff-del">−{run.diffDeletions}</span></div>
                    <span className="metric-sub">{run.diffFilesChanged} file{run.diffFilesChanged === 1 ? "" : "s"} changed</span>
                  </>
                ) : <span className="metric-sub">No git diff captured for this run.</span>}
              </div>

              <div className="metric-block">
                <div className="metric-head"><strong>Tests</strong>{!run.verifierTestsAvailable && <span className="metric-na">n/a</span>}</div>
                {run.verifierTestsAvailable ? (
                  <>
                    <div className="metric-big">{run.verifierTestsPassed}/{run.verifierTestsTotal}</div>
                    <div className="bar-track"><div className="bar-fill bar-fill-good" style={{ width: `${testsPct}%` }} /></div>
                  </>
                ) : <span className="metric-sub">Verifier is not a node --test runner.</span>}
              </div>

              <div className="metric-block">
                <div className="metric-head"><strong>Code quality</strong>{quality == null && <span className="metric-na">n/a</span>}</div>
                {quality != null ? (
                  <>
                    <div className="metric-big">{quality.toFixed(1)}<span className="metric-sub"> / 10</span></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, quality * 10))}%` }} /></div>
                  </>
                ) : <span className="metric-sub">No judge quality score.</span>}
              </div>

              <div className="metric-block">
                <div className="metric-head"><strong>Agent usage</strong>{!run.agentUsageAvailable && <span className="metric-na">n/a</span>}</div>
                {run.agentUsageAvailable ? (
                  <>
                    <div className="metric-big">{agentTotalTokens.toLocaleString()}</div>
                    <span className="metric-sub">{run.agentInputTokens.toLocaleString()} in / {run.agentOutputTokens.toLocaleString()} out · ${run.agentCostUsd.toFixed(4)}</span>
                  </>
                ) : <span className="metric-sub">Runner did not self-report usage.</span>}
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h3>Run detail</h3>
            <div className="metric-grid">
              <div className="detail-stack"><strong>Execution</strong><span>{summary?.executionMode ?? "review-only"}</span></div>
              <div className="detail-stack"><strong>Sandbox</strong><span>{summary?.sandbox?.provider ?? "n/a"}{summary?.sandbox?.networkAccess ? ` · net ${summary.sandbox.networkAccess}` : ""}</span></div>
              <div className="detail-stack"><strong>Review mode</strong><span>{summary?.reviewMode ?? "unknown"}</span></div>
              <div className="detail-stack"><strong>Latency / cost</strong><span>{Number(summary?.latencyMs ?? run.latencyMs)}ms · ${Number(summary?.costUsd ?? run.costUsd).toFixed(4)}</span></div>
            </div>
          </div>

          {summary?.objectiveChecks && (
            <div className="detail-stack">
              <strong>Objective checks</strong>
              <span>{summary.objectiveChecks.passed ?? 0}/{summary.objectiveChecks.available ?? 0}{summary.objectiveChecks.deterministic ? " deterministic" : " advisory"}</span>
              {summary.objectiveChecks.items?.length ? <span>{summary.objectiveChecks.items.join(" / ")}</span> : null}
            </div>
          )}
          {summary?.taskContract?.deliverableFormat && <div className="detail-stack"><strong>Deliverable format</strong><span>{summary.taskContract.deliverableFormat}</span></div>}
          {summary?.evidence?.matchedSignals?.length ? <div className="detail-stack"><strong>Matched evidence</strong><span>{summary.evidence.matchedSignals.join(" / ")}</span></div> : null}
          {summary?.evidence?.missingSignals?.length ? <div className="detail-stack"><strong>Open gaps</strong><span>{summary.evidence.missingSignals.join(" / ")}</span></div> : null}
          {summary?.recommendedNextActions?.length ? (
            <div className="detail-stack">
              <strong>Recommended next actions</strong>
              <ul className="plain-list">{summary.recommendedNextActions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}

          <div className="drawer-section">
            <h3>Report</h3>
            <a href={detail.reportUrl} target="_blank" rel="noreferrer"><img src={detail.reportUrl} alt={`Run report ${run.runKey}`} className="detail-image" /></a>
          </div>

          <div className="drawer-section">
            <button type="button" className="text-link button-reset" onClick={() => setShowJson((current) => !current)}>{showJson ? "Hide raw JSON" : "Show raw JSON"}</button>
            {showJson && <pre className="result-box">{JSON.stringify(detail.summary ?? detail.run, null, 2)}</pre>}
          </div>
        </div>
      </aside>
    </div>
  );
}
