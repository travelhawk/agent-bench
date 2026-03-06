"use client";

import { startTransition, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AgentRecord,
  BatchRunResult,
  BenchmarkEvaluatorMode,
  BenchmarkInteractionMode,
  BenchmarkResolution,
  BenchmarkSuiteRecord,
  BenchmarkTaskRecord,
  RunMode,
  RunRecord,
  RunResultPayload,
  WorkbenchSnapshot
} from "../src/types";

type ViewMode = "lab" | "history" | "benchmarks";

interface BenchmarkFormState {
  type: "suite" | "task";
  benchmarkKey: string;
  key: string;
  title: string;
  description: string;
  expectedOutcome: string;
  resolution: BenchmarkResolution;
  interaction: BenchmarkInteractionMode;
  evaluator: BenchmarkEvaluatorMode;
  difficulty: "low" | "medium" | "high";
  domain: string;
  tags: string;
  requiresIsolation: boolean;
  requiresNetwork: boolean;
}

interface RunSummaryView {
  executionMode?: string;
  reviewMode?: string;
  sandbox?: { provider?: string; networkAccess?: string };
  latencyMs?: number;
  costUsd?: number;
  scores?: { total?: number; tests?: number; judge?: number; performance?: number };
}

const MAX_BATCH_RUNS = 48;
const RESOLUTION_OPTIONS: BenchmarkResolution[] = ["atomic", "workflow", "campaign", "swarm"];
const INTERACTION_OPTIONS: BenchmarkInteractionMode[] = ["artifact", "terminal", "browser", "tool-use", "computer-use", "multi-agent"];
const EVALUATOR_OPTIONS: BenchmarkEvaluatorMode[] = ["state", "artifact", "trace", "judge", "hybrid"];
const DIFFICULTY_OPTIONS = ["low", "medium", "high"] as const;
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC"
});

const STORAGE_KEYS = {
  selectedAgents: "agent-bench:selected-agents",
  benchmarkKey: "agent-bench:benchmark-key",
  taskKey: "agent-bench:task-key",
  runMode: "agent-bench:run-mode",
  model: "agent-bench:model",
  providerApiKey: "agent-bench:provider-api-key"
} as const;

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string): string {
  return `${UTC_DATE_FORMATTER.format(new Date(value))} UTC`;
}

function humanizeToken(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function taskStructureChips(task: BenchmarkTaskRecord): string[] {
  return [
    humanizeToken(task.metadata.resolution),
    humanizeToken(task.metadata.interaction),
    `${humanizeToken(task.metadata.evaluator)} eval`,
    `${humanizeToken(task.metadata.difficulty)} difficulty`,
    ...(task.sandbox ? ["Sandboxed"] : []),
    ...(task.metadata.requiresIsolation ? ["Isolated"] : []),
    ...(task.metadata.requiresNetwork ? ["Networked"] : []),
    ...task.metadata.tags.map((tag) => `#${tag}`)
  ];
}

function suiteChips(benchmark: BenchmarkSuiteRecord): string[] {
  return [
    humanizeToken(benchmark.metadata.resolution),
    humanizeToken(benchmark.metadata.domain),
    ...benchmark.metadata.tags.map((tag) => `#${tag}`)
  ];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data as T;
}

async function mutateJson<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data as T;
}

function RunCard({
  run,
  badge,
  onOpen,
  onJson,
  onDelete
}: {
  run: RunRecord;
  badge?: ReactNode;
  onOpen: () => void;
  onJson: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="run-card">
      <div className="run-card-top">
        <div className="score-pill">{run.score.toFixed(1)}</div>
        <div className="run-copy">
          <h3>{run.agentName}</h3>
          <p>{run.suiteName}</p>
          <p>{run.runKey} • {formatDate(run.createdAt)}</p>
        </div>
        <div className="run-metrics">
          <span>{(run.durationMs / 1000).toFixed(1)}s</span>
          <span>{formatMoney(run.costUsd)}</span>
          {badge}
        </div>
      </div>
      <div className="metric-strip">
        <span>Readiness {run.testsScore.toFixed(2)}</span>
        <span>Review {run.llmScore.toFixed(2)}</span>
        <span>Performance {run.perfScore.toFixed(2)}</span>
      </div>
      <img
        src={`/api/artifacts/${run.runKey}/report.svg`}
        alt={`Run report ${run.runKey}`}
        className="run-image"
      />
      <div className="action-row">
        <button type="button" className="text-link button-reset" onClick={onOpen}>Open</button>
        <button type="button" className="text-link button-reset" onClick={onJson}>Result JSON</button>
        <button type="button" className="text-link button-reset" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

function readRunSummary(summary: RunResultPayload["summary"]): RunSummaryView | null {
  return (summary ?? null) as RunSummaryView | null;
}

export function WorkbenchClient({ initialSnapshot }: { initialSnapshot: WorkbenchSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setView] = useState<ViewMode>("lab");
  const [selectedAgentPaths, setSelectedAgentPaths] = useState<string[]>(initialSnapshot.agents[0] ? [initialSnapshot.agents[0].path] : []);
  const [benchmarkKey, setBenchmarkKey] = useState(initialSnapshot.benchmarks[0]?.key ?? "");
  const [taskKey, setTaskKey] = useState(initialSnapshot.benchmarks[0]?.tasks[0]?.key ?? "");
  const [runMode, setRunMode] = useState<RunMode>("benchmark-cycle");
  const [model, setModel] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [manualAgentPath, setManualAgentPath] = useState("");
  const [manualAgentStatus, setManualAgentStatus] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [benchmarkStatus, setBenchmarkStatus] = useState("");
  const [resultJson, setResultJson] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<RunResultPayload | null>(null);
  const [benchmarkForm, setBenchmarkForm] = useState<BenchmarkFormState>({
    type: "suite",
    benchmarkKey: "",
    key: "",
    title: "",
    description: "",
    expectedOutcome: "",
    resolution: "workflow",
    interaction: "tool-use",
    evaluator: "hybrid",
    difficulty: "medium",
    domain: "general",
    tags: "",
    requiresIsolation: true,
    requiresNetwork: false
  });

  useEffect(() => {
    const savedAgents = localStorage.getItem(STORAGE_KEYS.selectedAgents);
    const savedBenchmark = localStorage.getItem(STORAGE_KEYS.benchmarkKey);
    const savedTask = localStorage.getItem(STORAGE_KEYS.taskKey);
    const savedRunMode = localStorage.getItem(STORAGE_KEYS.runMode);
    const savedModel = localStorage.getItem(STORAGE_KEYS.model);
    const savedApiKey = sessionStorage.getItem(STORAGE_KEYS.providerApiKey);

    if (savedAgents) {
      try {
        const parsed = JSON.parse(savedAgents) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedAgentPaths(parsed);
        }
      } catch {
        // Ignore invalid local state.
      }
    }
    if (savedBenchmark) setBenchmarkKey(savedBenchmark);
    if (savedTask) setTaskKey(savedTask);
    if (savedRunMode === "single-task" || savedRunMode === "benchmark-cycle") setRunMode(savedRunMode);
    if (savedModel) setModel(savedModel);
    if (savedApiKey) setProviderApiKey(savedApiKey);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedAgents, JSON.stringify(selectedAgentPaths));
    localStorage.setItem(STORAGE_KEYS.benchmarkKey, benchmarkKey);
    localStorage.setItem(STORAGE_KEYS.taskKey, taskKey);
    localStorage.setItem(STORAGE_KEYS.runMode, runMode);
    localStorage.setItem(STORAGE_KEYS.model, model);
    sessionStorage.setItem(STORAGE_KEYS.providerApiKey, providerApiKey);
  }, [benchmarkKey, model, providerApiKey, runMode, selectedAgentPaths, taskKey]);

  const selectedBenchmark = snapshot.benchmarks.find((entry) => entry.key === benchmarkKey) ?? snapshot.benchmarks[0] ?? null;
  const plannedTasks = selectedBenchmark
    ? runMode === "single-task"
      ? selectedBenchmark.tasks.filter((task) => task.key === taskKey)
      : selectedBenchmark.tasks
    : [];
  const selectedAgents = snapshot.agents.filter((agent) => selectedAgentPaths.includes(agent.path));
  const totalRuns = selectedAgents.length * plannedTasks.length;
  const batchOverflow = totalRuns > MAX_BATCH_RUNS;
  const recentRuns = snapshot.runs.slice(0, 8);
  const historyRuns = snapshot.runs;
  const detailSummary = detail ? readRunSummary(detail.summary) : null;

  useEffect(() => {
    if (!selectedBenchmark) return;
    if (benchmarkKey !== selectedBenchmark.key) {
      setBenchmarkKey(selectedBenchmark.key);
      return;
    }

    const activeTask = selectedBenchmark.tasks.find((entry) => entry.key === taskKey);
    if (!activeTask && selectedBenchmark.tasks[0]) {
      setTaskKey(selectedBenchmark.tasks[0].key);
    }
  }, [benchmarkKey, selectedBenchmark, taskKey]);

  async function refreshSnapshot() {
    const nextSnapshot = await getJson<WorkbenchSnapshot>("/api/workbench");
    startTransition(() => {
      setSnapshot(nextSnapshot);
    });
  }

  async function openRun(runKey: string) {
    const nextDetail = await getJson<RunResultPayload>(`/api/run/${runKey}/result`);
    startTransition(() => {
      setDetail(nextDetail);
    });
  }

  async function showRunJson(runKey: string) {
    const nextDetail = await getJson<RunResultPayload>(`/api/run/${runKey}/result`);
    setResultJson((current) => ({
      ...current,
      [runKey]: JSON.stringify(nextDetail.summary ?? nextDetail.run, null, 2)
    }));
  }

  async function deleteRunAction(runKey: string) {
    if (!window.confirm(`Delete run ${runKey}?`)) return;
    await mutateJson(`/api/run/${runKey}`, "DELETE");
    if (detail?.run.runKey === runKey) {
      setDetail(null);
    }
    await refreshSnapshot();
  }

  async function inspectManualAgent() {
    if (!manualAgentPath.trim()) {
      setManualAgentStatus("Enter a path inside ./agents first.");
      return;
    }

    setManualAgentStatus("Inspecting agent path...");

    try {
      const response = await mutateJson<{ agent: AgentRecord }>("/api/agents/inspect", "POST", {
        agentPath: manualAgentPath.trim()
      });

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          agents: [...current.agents.filter((agent) => agent.path !== response.agent.path), response.agent]
        }));
      });
      setSelectedAgentPaths((current) => Array.from(new Set([...current, response.agent.path])));
      setManualAgentPath("");
      setManualAgentStatus(`Loaded ${response.agent.name}.`);
    } catch (error: unknown) {
      setManualAgentStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runBatchAction() {
    if (selectedAgents.length === 0) {
      setRunStatus("Select at least one agent before starting.");
      return;
    }
    if (plannedTasks.length === 0) {
      setRunStatus("Pick a benchmark challenge before starting.");
      return;
    }

    setRunStatus(`Launching ${totalRuns} run(s)...`);

    try {
      const response = await mutateJson<BatchRunResult>("/api/run/batch", "POST", {
        agents: selectedAgents.map((agent) => agent.path),
        benchmarkKey,
        taskKey: runMode === "single-task" ? taskKey : undefined,
        runMode,
        model: model || undefined,
        providerApiKey: providerApiKey || undefined
      });

      const firstFailure = response.failures[0]?.message;
      if (response.failedRuns > 0) {
        setRunStatus(`Completed ${response.completedRuns}/${response.queueSize} run(s). ${response.failedRuns} failed.${firstFailure ? ` First failure: ${firstFailure}` : ""}`);
      } else {
        setRunStatus(`Completed ${response.queueSize} run(s).`);
      }
      await refreshSnapshot();
      if (response.runs[0]) {
        await openRun(response.runs[0].run.runKey);
      }
    } catch (error: unknown) {
      setRunStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function createBenchmarkAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBenchmarkStatus("Creating benchmark...");

    try {
      await mutateJson("/api/benchmarks", "POST", benchmarkForm);
      setBenchmarkForm({
        type: "suite",
        benchmarkKey: "",
        key: "",
        title: "",
        description: "",
        expectedOutcome: "",
        resolution: "workflow",
        interaction: "tool-use",
        evaluator: "hybrid",
        difficulty: "medium",
        domain: "general",
        tags: "",
        requiresIsolation: true,
        requiresNetwork: false
      });
      setBenchmarkStatus("Benchmark created.");
      await refreshSnapshot();
    } catch (error: unknown) {
      setBenchmarkStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">AB</div>
          <div>
            <div className="eyebrow">Local-first eval workbench</div>
            <div className="brand-title">agent-bench</div>
          </div>
        </div>

        <nav className="nav-stack">
          <button type="button" className={`nav-item ${view === "lab" ? "active" : ""}`} onClick={() => setView("lab")}>Test Lab</button>
          <button type="button" className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>Run History</button>
          <button type="button" className={`nav-item ${view === "benchmarks" ? "active" : ""}`} onClick={() => setView("benchmarks")}>Benchmark Library</button>
        </nav>

        <div className="sidebar-callout">
          <div className="eyebrow">Current shape</div>
          <p>Server-rendered entrypoint, route handlers, and local DB-backed workbench flows in one app.</p>
        </div>

        <div className="sidebar-callout sidebar-callout-muted">
          <div className="eyebrow">North star</div>
          <p>Dataset-backed evals, trace inspection, and team-ready comparisons without losing the local-first feel.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Full-stack workbench</p>
            <h1>Agent Test Lab</h1>
            <p>
              Configure a provider, queue agents, run a benchmark cycle, and inspect runs through server-backed
              APIs with persisted reports, logs, and benchmark metadata.
            </p>
          </div>

          <div className="hero-stats">
            <article className="stat-card stat-card-blue">
              <span className="stat-label">Total runs</span>
              <strong className="stat-value">{snapshot.summary.totalRuns}</strong>
            </article>
            <article className="stat-card stat-card-green">
              <span className="stat-label">Average score</span>
              <strong className="stat-value">{snapshot.summary.avgScore.toFixed(1)}</strong>
            </article>
            <article className="stat-card stat-card-amber">
              <span className="stat-label">Total cost</span>
              <strong className="stat-value">{formatMoney(snapshot.summary.totalCost)}</strong>
            </article>
            <article className="stat-card stat-card-rose">
              <span className="stat-label">Available agents</span>
              <strong className="stat-value">{snapshot.summary.availableAgents}</strong>
            </article>
          </div>
        </header>

        {view === "lab" && (
          <section className="view-stack">
            <section className="config-strip panel">
              <div className="section-intro">
                <div>
                  <p className="eyebrow">Provider configuration</p>
                  <h2>Use the Next.js app as the control room.</h2>
                </div>
                <p className="section-note">
                  Session keys stay in the browser session. Leave the field empty to use <code>AI_GATEWAY_API_KEY</code>.
                </p>
              </div>

              <div className="config-grid">
                <label className="field">
                  <span>Gateway API key</span>
                  <input value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} placeholder="Optional for model-based review" />
                </label>
                <label className="field">
                  <span>Review model</span>
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4.1-mini" />
                </label>
                <label className="field">
                  <span>Benchmark suite</span>
                  <select value={benchmarkKey} onChange={(event) => setBenchmarkKey(event.target.value)}>
                    {snapshot.benchmarks.map((benchmark) => (
                      <option key={benchmark.key} value={benchmark.key}>{benchmark.title}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Run mode</span>
                  <select value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)}>
                    <option value="benchmark-cycle">Benchmark cycle</option>
                    <option value="single-task">Single challenge</option>
                  </select>
                </label>
                <label className="field field-span-2">
                  <span>Challenge</span>
                  <select value={taskKey} onChange={(event) => setTaskKey(event.target.value)} disabled={runMode !== "single-task"}>
                    {selectedBenchmark?.tasks.map((task) => (
                      <option key={task.key} value={task.key}>{task.title}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="lab-grid">
              <article className="panel">
                <div className="panel-head">
                  <div className="step-badge">1</div>
                  <div>
                    <h2>Load Agents</h2>
                    <p>Discovered directly from the workspace and managed through server-backed inspect flows.</p>
                  </div>
                </div>

                <div className="summary-band">
                  <strong>{selectedAgents.length}</strong>
                  <span>selected from {snapshot.agents.length} discovered definitions</span>
                </div>

                <div className="agent-list">
                  {snapshot.agents.length > 0 ? snapshot.agents.map((agent) => {
                    const active = selectedAgentPaths.includes(agent.path);
                    return (
                      <button
                        key={agent.path}
                        type="button"
                        className={`agent-card ${active ? "selected" : ""}`}
                        onClick={() => setSelectedAgentPaths((current) => current.includes(agent.path)
                          ? current.filter((entry) => entry !== agent.path)
                          : [...current, agent.path])}
                      >
                        <div className="agent-card-head">
                          <div>
                            <div className="agent-title">{agent.name}</div>
                            <div className="agent-summary">{agent.summary}</div>
                          </div>
                          <span className={`status-chip ${active ? "status-chip-active" : ""}`}>{active ? "Loaded" : "Ready"}</span>
                        </div>
                        <div className="agent-meta">
                          <span>{agent.path}</span>
                          <span>{agent.executionMode === "sandbox" ? "Sandbox ready" : "Review only"}</span>
                          <span>{agent.source === "manual" ? "Added manually" : "Discovered"}</span>
                        </div>
                      </button>
                    );
                  }) : <div className="empty-state">No agent markdown files found under <code>./agents</code> yet.</div>}
                </div>

                <div className="inline-form">
                  <input value={manualAgentPath} onChange={(event) => setManualAgentPath(event.target.value)} placeholder="Add another agent path inside ./agents" />
                  <button type="button" className="secondary-action" onClick={inspectManualAgent}>Inspect path</button>
                </div>
                <p className="status-line">{manualAgentStatus}</p>
              </article>

              <article className="panel">
                <div className="panel-head">
                  <div className="step-badge">2</div>
                  <div>
                    <h2>Build the Playlist</h2>
                    <p>The server owns suites/tasks, the client composes the current run plan.</p>
                  </div>
                </div>

                <div className="summary-band">
                  <strong>{selectedBenchmark?.title ?? "No benchmark"}</strong>
                  <span>{selectedBenchmark?.description ?? "Select a benchmark suite."}</span>
                  {selectedBenchmark && (
                    <div className="chip-row">
                      {suiteChips(selectedBenchmark).map((chip) => <span className="mini-chip" key={chip}>{chip}</span>)}
                    </div>
                  )}
                </div>

                <div className="suite-pills">
                  {snapshot.benchmarks.map((benchmark) => (
                    <button
                      key={benchmark.key}
                      type="button"
                      className={`suite-pill ${benchmark.key === benchmarkKey ? "active" : ""}`}
                      onClick={() => setBenchmarkKey(benchmark.key)}
                    >
                      <span>{benchmark.title}</span>
                      <span>{benchmark.tasks.length} tasks • {humanizeToken(benchmark.metadata.resolution)}</span>
                    </button>
                  ))}
                </div>

                <div className="playlist-list">
                  {plannedTasks.map((task) => (
                    <button
                      key={task.key}
                      type="button"
                      className={`playlist-card ${runMode === "single-task" && task.key === taskKey ? "active" : runMode === "benchmark-cycle" ? "active" : ""}`}
                      onClick={() => {
                        setRunMode("single-task");
                        setTaskKey(task.key);
                      }}
                    >
                      <div className="agent-card-head">
                        <strong>{task.title}</strong>
                        <span className={`status-chip ${runMode === "benchmark-cycle" || task.key === taskKey ? "status-chip-active" : ""}`}>
                          {runMode === "benchmark-cycle" || task.key === taskKey ? "Queued" : "Idle"}
                        </span>
                      </div>
                      <p>{task.description}</p>
                      <div className="chip-row">
                        {taskStructureChips(task).map((chip) => <span className="mini-chip" key={`${task.key}-${chip}`}>{chip}</span>)}
                      </div>
                      <div className="playlist-outcome">{task.expectedOutcome}</div>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel panel-highlight">
                <div className="panel-head">
                  <div className="step-badge">3</div>
                  <div>
                    <h2>Launch Batch</h2>
                    <p>Every run now goes through route handlers and server-backed DB operations.</p>
                  </div>
                </div>

                <div className="run-plan">
                  <div className="plan-metric">
                    <strong>{selectedAgents.length}</strong>
                    <span>Agents loaded</span>
                  </div>
                  <div className="plan-metric">
                    <strong>{plannedTasks.length}</strong>
                    <span>Challenges queued</span>
                  </div>
                  <div className="plan-metric">
                    <strong>{totalRuns}</strong>
                    <span>Runs to execute</span>
                  </div>
                  <div className="plan-stack">
                    <div>{selectedAgents.map((agent) => <span className="mini-chip" key={agent.path}>{agent.name}</span>)}</div>
                    <div>{plannedTasks.map((task) => <span className="mini-chip" key={task.key}>{task.title}</span>)}</div>
                  </div>
                </div>

                <button type="button" className="primary-action" disabled={totalRuns === 0 || batchOverflow} onClick={runBatchAction}>
                  Run selected agents
                </button>
                <p className="status-line">{batchOverflow ? `Batch exceeds the ${MAX_BATCH_RUNS}-run limit. Narrow the selection.` : runStatus}</p>
              </article>
            </section>

            <section className="dashboard-grid">
              <article className="panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Recent output</p>
                    <h2>Latest runs</h2>
                  </div>
                  <button type="button" className="text-link button-reset" onClick={() => setView("history")}>View full history</button>
                </div>

                <div className="run-list">
                  {recentRuns.length > 0 ? recentRuns.map((run) => (
                    <div key={run.runKey}>
                      <RunCard
                        run={run}
                        onOpen={() => openRun(run.runKey)}
                        onJson={() => showRunJson(run.runKey)}
                        onDelete={() => deleteRunAction(run.runKey)}
                      />
                      {resultJson[run.runKey] && <pre className="result-box">{resultJson[run.runKey]}</pre>}
                    </div>
                  )) : <div className="empty-state">No runs yet. Launch the first batch from the Test Lab.</div>}
                </div>
              </article>

              <div className="rail-stack">
                <article className="panel">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Activity</p>
                      <h2>Latest log</h2>
                    </div>
                  </div>
                  <pre className="log-panel">{snapshot.latestLogText}</pre>
                </article>

                <article className="panel">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Inspector</p>
                      <h2>Run details</h2>
                    </div>
                  </div>

                  {detail ? (
                    <div className="run-detail-content">
                      <div className="detail-title">{detail.run.runKey} • {detail.run.agentName} • {detail.run.suiteName}</div>
                      <div className="detail-grid">
                        <div className="detail-cell">Total <strong>{(detailSummary?.scores?.total ?? detail.run.score).toFixed(2)}</strong></div>
                        <div className="detail-cell">Readiness <strong>{(detailSummary?.scores?.tests ?? detail.run.testsScore).toFixed(2)}</strong></div>
                        <div className="detail-cell">Review <strong>{(detailSummary?.scores?.judge ?? detail.run.llmScore).toFixed(2)}</strong></div>
                        <div className="detail-cell">Performance <strong>{(detailSummary?.scores?.performance ?? detail.run.perfScore).toFixed(2)}</strong></div>
                        <div className="detail-cell">Duration <strong>{(detail.run.durationMs / 1000).toFixed(2)}s</strong></div>
                        <div className="detail-cell">Latency <strong>{Number(detailSummary?.latencyMs ?? detail.run.latencyMs)}ms</strong></div>
                        <div className="detail-cell">Cost <strong>{Number(detailSummary?.costUsd ?? detail.run.costUsd).toFixed(4)}</strong></div>
                        <div className="detail-cell">Execution <strong>{detailSummary?.executionMode ?? "review-only"}</strong></div>
                        <div className="detail-cell">Sandbox <strong>{detailSummary?.sandbox?.provider ?? "n/a"}</strong></div>
                        <div className="detail-cell">Network <strong>{detailSummary?.sandbox?.networkAccess ?? "n/a"}</strong></div>
                        <div className="detail-cell">Review mode <strong>{detailSummary?.reviewMode ?? "unknown"}</strong></div>
                      </div>
                      <a href={detail.reportUrl} target="_blank" rel="noreferrer">
                        <img src={detail.reportUrl} alt={`Run report ${detail.run.runKey}`} className="detail-image" />
                      </a>
                    </div>
                  ) : <div className="empty-state">Open any run card to inspect its score breakdown and generated run report.</div>}
                </article>
              </div>
            </section>
          </section>
        )}

        {view === "history" && (
          <section className="view-stack">
            <article className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Audit trail</p>
                  <h2>Run History</h2>
                </div>
              </div>

              <div className="run-list">
                {historyRuns.length > 0 ? historyRuns.map((run) => (
                  <div key={run.runKey}>
                    <RunCard
                      run={run}
                      onOpen={() => openRun(run.runKey)}
                      onJson={() => showRunJson(run.runKey)}
                      onDelete={() => deleteRunAction(run.runKey)}
                    />
                    {resultJson[run.runKey] && <pre className="result-box">{resultJson[run.runKey]}</pre>}
                  </div>
                )) : <div className="empty-state">Run history will appear here after the first execution.</div>}
              </div>
            </article>
          </section>
        )}

        {view === "benchmarks" && (
          <section className="view-stack">
            <article className="panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Benchmark authoring</p>
                  <h2>Benchmark Library</h2>
                </div>
              </div>

              <form className="benchmark-form" onSubmit={createBenchmarkAction}>
                <label className="field">
                  <span>Create</span>
                  <select
                    value={benchmarkForm.type}
                    onChange={(event) => setBenchmarkForm((current) => ({ ...current, type: event.target.value as "suite" | "task" }))}
                  >
                    <option value="suite">Benchmark suite</option>
                    <option value="task">Task in existing suite</option>
                  </select>
                </label>

                <label className="field">
                  <span>Parent benchmark</span>
                  <input
                    value={benchmarkForm.benchmarkKey}
                    onChange={(event) => setBenchmarkForm((current) => ({ ...current, benchmarkKey: event.target.value }))}
                    placeholder="Required for tasks"
                  />
                </label>

                <label className="field">
                  <span>Key</span>
                  <input value={benchmarkForm.key} onChange={(event) => setBenchmarkForm((current) => ({ ...current, key: event.target.value }))} placeholder="auth-migration" />
                </label>

                <label className="field">
                  <span>Title</span>
                  <input value={benchmarkForm.title} onChange={(event) => setBenchmarkForm((current) => ({ ...current, title: event.target.value }))} placeholder="Authentication Migration" />
                </label>

                <label className="field field-span-2">
                  <span>Description</span>
                  <textarea value={benchmarkForm.description} onChange={(event) => setBenchmarkForm((current) => ({ ...current, description: event.target.value }))} placeholder="What should the agent do?" />
                </label>

                <label className="field field-span-2">
                  <span>Expected outcome</span>
                  <textarea value={benchmarkForm.expectedOutcome} onChange={(event) => setBenchmarkForm((current) => ({ ...current, expectedOutcome: event.target.value }))} placeholder="What proves that the task is complete?" />
                </label>

                <label className="field">
                  <span>Resolution</span>
                  <select value={benchmarkForm.resolution} onChange={(event) => setBenchmarkForm((current) => ({ ...current, resolution: event.target.value as BenchmarkResolution }))}>
                    {RESOLUTION_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Domain</span>
                  <input value={benchmarkForm.domain} onChange={(event) => setBenchmarkForm((current) => ({ ...current, domain: event.target.value }))} placeholder="software-engineering" />
                </label>

                <label className="field field-span-2">
                  <span>Tags</span>
                  <input value={benchmarkForm.tags} onChange={(event) => setBenchmarkForm((current) => ({ ...current, tags: event.target.value }))} placeholder="coding, regression, tool-use" />
                </label>

                {benchmarkForm.type === "task" && (
                  <>
                    <label className="field">
                      <span>Interaction</span>
                      <select value={benchmarkForm.interaction} onChange={(event) => setBenchmarkForm((current) => ({ ...current, interaction: event.target.value as BenchmarkInteractionMode }))}>
                        {INTERACTION_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
                      </select>
                    </label>

                    <label className="field">
                      <span>Evaluator</span>
                      <select value={benchmarkForm.evaluator} onChange={(event) => setBenchmarkForm((current) => ({ ...current, evaluator: event.target.value as BenchmarkEvaluatorMode }))}>
                        {EVALUATOR_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
                      </select>
                    </label>

                    <label className="field">
                      <span>Difficulty</span>
                      <select value={benchmarkForm.difficulty} onChange={(event) => setBenchmarkForm((current) => ({ ...current, difficulty: event.target.value as "low" | "medium" | "high" }))}>
                        {DIFFICULTY_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}
                      </select>
                    </label>

                    <label className="field field-checkbox">
                      <span>Requires isolation</span>
                      <input
                        type="checkbox"
                        checked={benchmarkForm.requiresIsolation}
                        onChange={(event) => setBenchmarkForm((current) => ({ ...current, requiresIsolation: event.target.checked }))}
                      />
                    </label>

                    <label className="field field-checkbox">
                      <span>Requires network</span>
                      <input
                        type="checkbox"
                        checked={benchmarkForm.requiresNetwork}
                        onChange={(event) => setBenchmarkForm((current) => ({ ...current, requiresNetwork: event.target.checked }))}
                      />
                    </label>
                  </>
                )}

                <button type="submit" className="primary-action">Add benchmark</button>
                <p className="status-line">{benchmarkStatus}</p>
              </form>

              <div className="benchmark-library">
                {snapshot.benchmarks.map((benchmark) => (
                  <article className="library-card" key={benchmark.key}>
                    <div className="library-header">
                      <div>
                        <h3>{benchmark.title}</h3>
                        <p>{benchmark.key}</p>
                      </div>
                      <span className="status-chip">{benchmark.tasks.length} tasks</span>
                    </div>
                    <p className="library-copy">{benchmark.description}</p>
                    <div className="chip-row">
                      {suiteChips(benchmark).map((chip) => <span className="mini-chip" key={`${benchmark.key}-${chip}`}>{chip}</span>)}
                    </div>
                    <div className="library-stack">
                      {benchmark.tasks.map((task) => (
                        <div className="library-task" key={task.key}>
                          <strong>{task.title} ({task.key})</strong>
                          <p>{task.description}</p>
                          <div className="chip-row">
                            {taskStructureChips(task).map((chip) => <span className="mini-chip" key={`${task.key}-${chip}`}>{chip}</span>)}
                          </div>
                          <span>{task.expectedOutcome}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
