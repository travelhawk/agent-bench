"use client";

import { startTransition, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type {
  AgentRecord, AgentSkillReference, BatchRunFailure, BatchRunResult, BenchmarkEvaluatorMode, BenchmarkInteractionMode,
  BenchmarkResolution, BenchmarkSuiteRecord, BenchmarkTaskRecord, InstalledSkillRecord, RunMode, RunRecord, RunResultPayload, WorkbenchSnapshot
} from "../src/types";

type ViewMode = "lab" | "history" | "benchmarks";
type WorkflowState = "blocked" | "ready" | "running" | "completed-with-failures" | "completed-clean";
type AsyncTone = "neutral" | "success" | "error";
type Confidence = "high" | "medium" | "low";

interface BenchmarkFormState {
  type: "suite" | "task"; benchmarkKey: string; key: string; title: string; description: string; expectedOutcome: string;
  whyThisTask: string; inputs: string; deliverableFormat: string; successChecks: string; failureModes: string;
  resolution: BenchmarkResolution; interaction: BenchmarkInteractionMode; evaluator: BenchmarkEvaluatorMode;
  difficulty: "low" | "medium" | "high"; domain: string; tags: string; requiresIsolation: boolean; requiresNetwork: boolean;
}

interface RunSummaryView {
  status?: "completed" | "failed"; executionMode?: string; reviewMode?: string; scoreProfile?: string; scoreConfidence?: Confidence;
  latencyMs?: number; costUsd?: number; failureReason?: string;
  agentSystem?: { entryFile?: string; bundleMode?: "flat" | "bundle"; bundlePath?: string | null; sharedAgentsPath?: string | null; skillCount?: number; assetFileCount?: number; skills?: AgentSkillReference[] };
  sandbox?: { provider?: string; networkAccess?: string; runner?: { exitCode?: number; cwd?: string }; verifier?: { exitCode?: number; command?: string } };
  objectiveChecks?: { available?: number; passed?: number; deterministic?: boolean; items?: string[] };
  scores?: { total?: number; outcome?: number; process?: number; review?: number; efficiency?: number; tests?: number; judge?: number; performance?: number };
  evidence?: { matchedSignals?: string[]; missingSignals?: string[]; artifacts?: string[] };
  recommendedNextActions?: string[];
  taskContract?: { whyThisTask?: string; inputs?: string; deliverableFormat?: string; successChecks?: string[]; failureModes?: string[] };
}

interface StatusMessage { tone: AsyncTone; message: string; }
interface RetryJob { benchmarkKey: string; taskKey: string; agentPath: string; }
interface SkillSearchResultView {
  source: string;
  skillName: string;
  installSpec: string;
  registryUrl: string;
  installs?: number;
  title: string;
}
interface BundleUploadFile { path: string; content: string; }
interface ProjectSkillsResponse { skills: InstalledSkillRecord[]; }

const MAX_BATCH_RUNS = 48;
const RESOLUTION_OPTIONS: BenchmarkResolution[] = ["atomic", "workflow", "campaign", "swarm"];
const INTERACTION_OPTIONS: BenchmarkInteractionMode[] = ["artifact", "terminal", "browser", "tool-use", "computer-use", "multi-agent"];
const EVALUATOR_OPTIONS: BenchmarkEvaluatorMode[] = ["state", "artifact", "trace", "judge", "hybrid"];
const DIFFICULTY_OPTIONS = ["low", "medium", "high"] as const;
const STORAGE_KEYS = { selectedAgents: "agent-bench:selected-agents", benchmarkKey: "agent-bench:benchmark-key", taskKey: "agent-bench:task-key", runMode: "agent-bench:run-mode", model: "agent-bench:model", providerApiKey: "agent-bench:provider-api-key" } as const;

const emptyForm = (): BenchmarkFormState => ({
  type: "suite", benchmarkKey: "", key: "", title: "", description: "", expectedOutcome: "", whyThisTask: "", inputs: "",
  deliverableFormat: "", successChecks: "", failureModes: "", resolution: "workflow", interaction: "tool-use", evaluator: "hybrid",
  difficulty: "medium", domain: "general", tags: "", requiresIsolation: true, requiresNetwork: false
});

const formatMoney = (value: number) => `$${value.toFixed(2)}`;
const formatInstalls = (value?: number) => typeof value === "number" ? `${value.toLocaleString()} installs` : "skills.sh";
const humanizeToken = (value: string) => value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const splitListInput = (value: string) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
const readRunSummary = (summary: RunResultPayload["summary"]) => (summary ?? null) as RunSummaryView | null;

async function readBundleUploadFiles(fileList: FileList): Promise<BundleUploadFile[]> {
  const files = Array.from(fileList);
  return Promise.all(files.map(async (file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      path: relativePath,
      content: await file.text()
    };
  }));
}

function taskSignalQuality(task: BenchmarkTaskRecord): Confidence {
  if (task.sandbox?.verifyCommand) return "high";
  if (task.whyThisTask || task.inputs || task.deliverableFormat || task.successChecks.length > 0 || task.failureModes.length > 0) return "medium";
  return "low";
}

function chipsForTask(task: BenchmarkTaskRecord): string[] {
  return [
    humanizeToken(task.metadata.resolution), humanizeToken(task.metadata.interaction), `${humanizeToken(task.metadata.evaluator)} eval`,
    `${humanizeToken(task.metadata.difficulty)} difficulty`, task.sandbox ? `Sandboxed ${humanizeToken(task.sandbox.provider ?? "auto")}` : "Review only",
    `${humanizeToken(taskSignalQuality(task))} signal`, ...(task.metadata.requiresIsolation ? ["Isolated"] : []),
    ...(task.metadata.requiresNetwork ? ["Networked"] : []), ...task.metadata.tags.map((tag) => `#${tag}`)
  ];
}

function chipsForSuite(benchmark: BenchmarkSuiteRecord): string[] {
  return [humanizeToken(benchmark.metadata.resolution), humanizeToken(benchmark.metadata.domain), ...benchmark.metadata.tags.map((tag) => `#${tag}`)];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url); const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${url}`);
  return data as T;
}

async function mutateJson<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${url}`);
  return data as T;
}

function toneClass(tone: AsyncTone): string { return `status-line status-line-${tone}`; }
function confidenceClass(confidence: Confidence): string { return confidence === "high" ? "status-chip-good" : confidence === "medium" ? "status-chip-warn" : "status-chip-muted"; }
function runStatusClass(status: RunRecord["status"]): string { return status === "failed" ? "status-chip-bad" : "status-chip-good"; }

function RunCard({ run, busyAction, onOpen, onJson, onDelete }: { run: RunRecord; busyAction: string | null; onOpen: () => void; onJson: () => void; onDelete: () => void; }) {
  const busy = busyAction?.endsWith(run.runKey) ?? false;
  return (
    <article className={`run-card ${run.status === "failed" ? "run-card-failed" : ""}`}>
      <div className="run-card-top">
        <div className="score-pill">{run.score.toFixed(1)}</div>
        <div className="run-copy"><h3>{run.agentName}</h3><p>{run.suiteName}</p></div>
        <div className="run-metrics">
          <span>{run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : "n/a"}</span><span>{formatMoney(run.costUsd)}</span>
          <span className={`status-chip ${runStatusClass(run.status)}`}>{run.status}</span>
          <span className={`status-chip ${confidenceClass(run.scoreConfidence)}`}>{run.scoreConfidence} confidence</span>
        </div>
      </div>
      <div className="metric-strip">
        <span>Outcome {run.outcomeScore.toFixed(2)}</span><span>Process {run.processScore.toFixed(2)}</span>
        <span>Review {run.reviewScore.toFixed(2)}</span><span>Efficiency {run.efficiencyScore.toFixed(2)}</span>
      </div>
      {run.failureReason && <div className="callout callout-error">{run.failureReason}</div>}
      <div className="action-row">
        <button type="button" className="text-link button-reset" onClick={onOpen} disabled={busy}>Open</button>
        <button type="button" className="text-link button-reset" onClick={onJson} disabled={busy}>Result JSON</button>
        <button type="button" className="text-link button-reset" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </article>
  );
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
  const [manualAgentState, setManualAgentState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [bundleBaseAgentPath, setBundleBaseAgentPath] = useState(initialSnapshot.agents[0]?.path ?? "");
  const [bundleName, setBundleName] = useState("");
  const [bundleUploadFiles, setBundleUploadFiles] = useState<BundleUploadFile[]>([]);
  const [bundleState, setBundleState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [skillQuery, setSkillQuery] = useState("");
  const [skillResults, setSkillResults] = useState<SkillSearchResultView[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<SkillSearchResultView[]>([]);
  const [skillState, setSkillState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [projectSkillState, setProjectSkillState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [runState, setRunState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [benchmarkState, setBenchmarkState] = useState<StatusMessage>({ tone: "neutral", message: "" });
  const [resultJson, setResultJson] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<RunResultPayload | null>(null);
  const [benchmarkForm, setBenchmarkForm] = useState<BenchmarkFormState>(emptyForm());
  const [isInspectingAgent, setIsInspectingAgent] = useState(false);
  const [isSearchingSkills, setIsSearchingSkills] = useState(false);
  const [isManagingProjectSkills, setIsManagingProjectSkills] = useState(false);
  const [isCreatingBundle, setIsCreatingBundle] = useState(false);
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [isCreatingBenchmark, setIsCreatingBenchmark] = useState(false);
  const [activeRunAction, setActiveRunAction] = useState<string | null>(null);
  const [lastBatchResult, setLastBatchResult] = useState<BatchRunResult | null>(null);
  const [lastBatchFailureJobs, setLastBatchFailureJobs] = useState<RetryJob[]>([]);
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<string[]>([]);

  useEffect(() => {
    const savedAgents = localStorage.getItem(STORAGE_KEYS.selectedAgents), savedBenchmark = localStorage.getItem(STORAGE_KEYS.benchmarkKey),
      savedTask = localStorage.getItem(STORAGE_KEYS.taskKey), savedRunMode = localStorage.getItem(STORAGE_KEYS.runMode),
      savedModel = localStorage.getItem(STORAGE_KEYS.model), savedApiKey = sessionStorage.getItem(STORAGE_KEYS.providerApiKey);
    if (savedAgents) try { const parsed = JSON.parse(savedAgents) as string[]; if (Array.isArray(parsed) && parsed.length > 0) setSelectedAgentPaths(parsed); } catch {}
    if (savedBenchmark) setBenchmarkKey(savedBenchmark); if (savedTask) setTaskKey(savedTask);
    if (savedRunMode === "single-task" || savedRunMode === "benchmark-cycle") setRunMode(savedRunMode);
    if (savedModel) setModel(savedModel); if (savedApiKey) setProviderApiKey(savedApiKey);
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
  const selectedTask = selectedBenchmark?.tasks.find((entry) => entry.key === taskKey) ?? selectedBenchmark?.tasks[0] ?? null;
  const plannedTasks = selectedBenchmark ? (runMode === "single-task" ? selectedBenchmark.tasks.filter((task) => task.key === (selectedTask?.key ?? taskKey)) : selectedBenchmark.tasks) : [];
  const selectedAgents = snapshot.agents.filter((agent) => selectedAgentPaths.includes(agent.path));
  const totalRuns = selectedAgents.length * plannedTasks.length;
  const batchOverflow = totalRuns > MAX_BATCH_RUNS;
  const recentRuns = snapshot.runs.slice(0, 8), historyRuns = snapshot.runs, failedHistoryRuns = snapshot.runs.filter((run) => run.status === "failed");
  const detailSummary = detail ? readRunSummary(detail.summary) : null;
  const bestRun = snapshot.runs.filter((run) => run.status === "completed").sort((left, right) => right.score - left.score)[0];

  useEffect(() => {
    if (!selectedBenchmark) return;
    if (benchmarkKey !== selectedBenchmark.key) { setBenchmarkKey(selectedBenchmark.key); return; }
    const activeTask = selectedBenchmark.tasks.find((entry) => entry.key === taskKey);
    if (!activeTask && selectedBenchmark.tasks[0]) setTaskKey(selectedBenchmark.tasks[0].key);
  }, [benchmarkKey, selectedBenchmark, taskKey]);

  const blockers: string[] = [];
  if (snapshot.agents.length === 0) blockers.push("No agent definitions are available under ./agents yet.");
  if (!selectedBenchmark) blockers.push("No benchmark suite is available.");
  if (selectedAgents.length === 0) blockers.push("Select at least one agent.");
  if (runMode === "single-task" && !selectedTask) blockers.push("Select one challenge for single-task mode.");
  if (plannedTasks.length === 0) blockers.push("The current benchmark selection does not queue any tasks.");
  if (batchOverflow) blockers.push(`The current selection creates ${totalRuns} runs, above the ${MAX_BATCH_RUNS}-run cap.`);
  const workflowState: WorkflowState = isRunningBatch ? "running" : blockers.length > 0 ? "blocked" : lastBatchResult?.failedRuns ? "completed-with-failures" : lastBatchResult ? "completed-clean" : "ready";

  async function refreshSnapshot() { const nextSnapshot = await getJson<WorkbenchSnapshot>("/api/workbench"); startTransition(() => setSnapshot(nextSnapshot)); }
  function replaceProjectSkills(skills: InstalledSkillRecord[]) {
    startTransition(() => setSnapshot((current) => ({ ...current, projectSkills: skills })));
  }
  async function openRun(runKey: string) { setActiveRunAction(`open:${runKey}`); try { const nextDetail = await getJson<RunResultPayload>(`/api/run/${runKey}/result`); startTransition(() => setDetail(nextDetail)); } finally { setActiveRunAction(null); } }
  async function showRunJson(runKey: string) { setActiveRunAction(`json:${runKey}`); try { const nextDetail = await getJson<RunResultPayload>(`/api/run/${runKey}/result`); setResultJson((current) => ({ ...current, [runKey]: JSON.stringify(nextDetail.summary ?? nextDetail.run, null, 2) })); } finally { setActiveRunAction(null); } }
  async function deleteRunAction(runKey: string) { if (!window.confirm(`Delete run ${runKey}?`)) return; setActiveRunAction(`delete:${runKey}`); try { await mutateJson(`/api/run/${runKey}`, "DELETE"); if (detail?.run.runKey === runKey) setDetail(null); await refreshSnapshot(); } finally { setActiveRunAction(null); } }
  async function inspectManualAgent() {
    if (!manualAgentPath.trim()) { setManualAgentState({ tone: "error", message: "Enter a path inside ./agents first." }); return; }
    setIsInspectingAgent(true); setManualAgentState({ tone: "neutral", message: "Inspecting agent path..." });
    try {
      const response = await mutateJson<{ agent: AgentRecord }>("/api/agents/inspect", "POST", { agentPath: manualAgentPath.trim() });
      startTransition(() => setSnapshot((current) => ({ ...current, agents: [...current.agents.filter((agent) => agent.path !== response.agent.path), response.agent] })));
      setSelectedAgentPaths((current) => Array.from(new Set([...current, response.agent.path]))); setManualAgentPath("");
      setBundleBaseAgentPath(response.agent.path);
      setManualAgentState({ tone: "success", message: `Loaded ${response.agent.name}.` });
    } catch (error: unknown) { setManualAgentState({ tone: "error", message: error instanceof Error ? error.message : String(error) }); } finally { setIsInspectingAgent(false); }
  }

  async function searchSkillsAction() {
    if (!skillQuery.trim()) {
      setSkillState({ tone: "error", message: "Enter a skills.sh search query first." });
      return;
    }

    setIsSearchingSkills(true);
    setSkillState({ tone: "neutral", message: `Searching skills.sh for "${skillQuery.trim()}"...` });
    try {
      const response = await mutateJson<{ results: SkillSearchResultView[] }>("/api/skills/search", "POST", { query: skillQuery.trim() });
      setSkillResults(response.results);
      setSkillState({
        tone: response.results.length > 0 ? "success" : "neutral",
        message: response.results.length > 0 ? `Found ${response.results.length} candidate skill(s).` : "No skills found for that query."
      });
    } catch (error: unknown) {
      setSkillState({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsSearchingSkills(false);
    }
  }

  async function installSelectedSkillsAction() {
    if (selectedSkills.length === 0) {
      setProjectSkillState({ tone: "error", message: "Select at least one search result to install into the project." });
      return;
    }

    setIsManagingProjectSkills(true);
    setProjectSkillState({ tone: "neutral", message: `Installing ${selectedSkills.length} skill(s) into ./.agents...` });
    try {
      const response = await mutateJson<ProjectSkillsResponse>("/api/skills", "POST", { skills: selectedSkills });
      replaceProjectSkills(response.skills);
      setProjectSkillState({ tone: "success", message: `Installed ${selectedSkills.length} skill(s) into the project.` });
    } catch (error: unknown) {
      setProjectSkillState({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsManagingProjectSkills(false);
    }
  }

  async function updateProjectSkillsAction(names?: string[]) {
    setIsManagingProjectSkills(true);
    setProjectSkillState({ tone: "neutral", message: names?.length ? `Updating ${names.length} installed skill(s)...` : "Updating installed project skills..." });
    try {
      const response = await mutateJson<ProjectSkillsResponse>("/api/skills", "PATCH", { names });
      replaceProjectSkills(response.skills);
      setProjectSkillState({ tone: "success", message: names?.length ? `Updated ${names.length} installed skill(s).` : "Updated installed project skills." });
    } catch (error: unknown) {
      setProjectSkillState({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsManagingProjectSkills(false);
    }
  }

  async function removeProjectSkillsAction(names: string[]) {
    if (names.length === 0) {
      setProjectSkillState({ tone: "error", message: "Select at least one installed skill to remove." });
      return;
    }
    if (!window.confirm(`Remove ${names.join(", ")} from this project's .agents skills?`)) {
      return;
    }

    setIsManagingProjectSkills(true);
    setProjectSkillState({ tone: "neutral", message: `Removing ${names.length} installed skill(s)...` });
    try {
      const response = await mutateJson<ProjectSkillsResponse>("/api/skills", "DELETE", { names });
      replaceProjectSkills(response.skills);
      setProjectSkillState({ tone: "success", message: `Removed ${names.length} installed skill(s).` });
    } catch (error: unknown) {
      setProjectSkillState({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsManagingProjectSkills(false);
    }
  }

  async function handleBundleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setBundleUploadFiles([]);
      return;
    }

    const uploaded = await readBundleUploadFiles(files);
    setBundleUploadFiles(uploaded);
    setBundleState({ tone: "success", message: `Loaded ${uploaded.length} uploaded bundle file(s).` });
  }

  function toggleSelectedSkill(skill: SkillSearchResultView) {
    setSelectedSkills((current) => current.some((entry) => entry.installSpec === skill.installSpec)
      ? current.filter((entry) => entry.installSpec !== skill.installSpec)
      : [...current, skill]);
  }

  async function createManagedBundleAction() {
    const baseAgentPath = bundleBaseAgentPath || selectedAgents[0]?.path || manualAgentPath.trim();
    if (!baseAgentPath) {
      setBundleState({ tone: "error", message: "Choose or inspect a base agent before creating a managed bundle." });
      return;
    }

    setIsCreatingBundle(true);
    setBundleState({ tone: "neutral", message: "Creating managed agent bundle..." });
    try {
      const response = await mutateJson<{ agent: AgentRecord }>("/api/agents/bundles", "POST", {
        name: bundleName || undefined,
        baseAgentPath,
        files: bundleUploadFiles,
        skills: selectedSkills
      });
      startTransition(() => setSnapshot((current) => ({
        ...current,
        agents: [...current.agents.filter((agent) => agent.path !== response.agent.path), response.agent]
      })));
      setSelectedAgentPaths((current) => Array.from(new Set([...current, response.agent.path])));
      setBundleBaseAgentPath(response.agent.path);
      setBundleName("");
      setBundleUploadFiles([]);
      setSelectedSkills([]);
      setBundleState({ tone: "success", message: `Created managed bundle ${response.agent.name}.` });
    } catch (error: unknown) {
      setBundleState({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsCreatingBundle(false);
    }
  }

  async function runBatchAction(retryJobs?: RetryJob[]) {
    if (!retryJobs && selectedAgents.length === 0) { setRunState({ tone: "error", message: "Select at least one agent before starting." }); return; }
    if (!retryJobs && plannedTasks.length === 0) { setRunState({ tone: "error", message: "Pick a benchmark challenge before starting." }); return; }
    setIsRunningBatch(true); setRunState({ tone: "neutral", message: retryJobs ? `Rerunning ${retryJobs.length} failed job(s)...` : `Launching ${totalRuns} run(s)...` });
    try {
      const response = await mutateJson<BatchRunResult>("/api/run/batch", "POST", {
        agents: retryJobs ? [] : selectedAgents.map((agent) => agent.path), benchmarkKey, taskKey: retryJobs ? undefined : runMode === "single-task" ? selectedTask?.key : undefined,
        runMode, model: model || undefined, providerApiKey: providerApiKey || undefined, jobs: retryJobs
      });
      setLastBatchResult(response);
      setLastBatchFailureJobs(response.failures.map((failure) => ({ benchmarkKey: response.benchmarkKey, taskKey: failure.taskKey, agentPath: failure.agentPath })));
      setRunState(response.failedRuns > 0 ? { tone: "error", message: `Completed ${response.completedRuns}/${response.queueSize} run(s). ${response.failedRuns} failed.` } : { tone: "success", message: `Completed ${response.queueSize} run(s) cleanly.` });
      await refreshSnapshot();
      const firstRun = response.runs[0]?.run.runKey ?? response.failures[0]?.run?.run.runKey;
      if (firstRun) await openRun(firstRun);
    } catch (error: unknown) { setRunState({ tone: "error", message: error instanceof Error ? error.message : String(error) }); } finally { setIsRunningBatch(false); }
  }

  async function createBenchmarkAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsCreatingBenchmark(true); setBenchmarkState({ tone: "neutral", message: "Creating benchmark..." });
    try {
      await mutateJson("/api/benchmarks", "POST", { ...benchmarkForm, successChecks: splitListInput(benchmarkForm.successChecks), failureModes: splitListInput(benchmarkForm.failureModes) });
      setBenchmarkForm(emptyForm()); setBenchmarkState({ tone: "success", message: "Benchmark created." }); await refreshSnapshot();
    } catch (error: unknown) { setBenchmarkState({ tone: "error", message: error instanceof Error ? error.message : String(error) }); } finally { setIsCreatingBenchmark(false); }
  }

  function selectBenchmarkSuite(nextBenchmarkKey: string) {
    setBenchmarkKey(nextBenchmarkKey);
    setExpandedTaskKeys([]);
  }

  function toggleTaskDetails(nextTaskKey: string) {
    setExpandedTaskKeys((current) => current.includes(nextTaskKey)
      ? current.filter((entry) => entry !== nextTaskKey)
      : [...current, nextTaskKey]);
  }

  const nextActionTitle = workflowState === "blocked" ? "Unblock the run plan" : workflowState === "running" ? "Batch in progress" : workflowState === "completed-with-failures" ? "Review failed jobs" : workflowState === "completed-clean" ? "Inspect the result" : "Ready to launch";
  const nextActionCopy = workflowState === "blocked" ? blockers[0] ?? "Resolve the blocker before launching." : workflowState === "running" ? "Batch is running. The latest result opens when it finishes." : workflowState === "completed-with-failures" ? "Inspect failed runs, fix the blocker, then rerun failed only." : workflowState === "completed-clean" ? "Open the best run and confirm the evidence." : "Plan is valid. Start when the agents and tasks look right.";
  const latestFailedRun = failedHistoryRuns[0];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">AB</div><div><div className="eyebrow">Local-first eval workbench</div><div className="brand-title">agent-bench</div></div></div>
        <nav className="nav-stack">
          <button type="button" className={`nav-item ${view === "lab" ? "active" : ""}`} onClick={() => setView("lab")}>Test Lab</button>
          <button type="button" className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>Run History</button>
          <button type="button" className={`nav-item ${view === "benchmarks" ? "active" : ""}`} onClick={() => setView("benchmarks")}>Benchmark Library</button>
        </nav>
        <div className="sidebar-callout"><div className="eyebrow">Current workflow</div><p>Agents -&gt; suite -&gt; tasks -&gt; run.</p></div>
        <div className="sidebar-callout sidebar-callout-muted"><div className="eyebrow">Signal policy</div><p>Verifier-backed runs carry the strongest signal.</p></div>
      </aside>
      <section className="workspace">
        <header className="hero">
          <div className="hero-copy"><p className="eyebrow">Guided local runner</p><h1>Agent Test Lab</h1><p>Load agents, choose tasks, run a bounded benchmark, inspect results.</p></div>
          <div className="hero-stats">
            <article className="stat-card stat-card-blue"><span className="stat-label">Total runs</span><strong className="stat-value">{snapshot.summary.totalRuns}</strong></article>
            <article className="stat-card stat-card-green"><span className="stat-label">Average score</span><strong className="stat-value">{snapshot.summary.avgScore.toFixed(1)}</strong></article>
            <article className="stat-card stat-card-amber"><span className="stat-label">Failed runs</span><strong className="stat-value">{failedHistoryRuns.length}</strong></article>
            <article className="stat-card stat-card-rose"><span className="stat-label">Available agents</span><strong className="stat-value">{snapshot.summary.availableAgents}</strong></article>
          </div>
        </header>
        {view === "lab" && (
          <section className="view-stack">
            <section className="panel guidance-panel">
              <div className="section-header"><div><p className="eyebrow">Next action</p><h2>{nextActionTitle}</h2></div><span className={`status-chip workflow-chip workflow-chip-${workflowState}`}>{workflowState}</span></div>
              <p className="library-copy">{nextActionCopy}</p>
              <div className="guidance-grid">
                <div className="callout"><strong>Queued scope</strong><span>{selectedAgents.length} agent(s) x {plannedTasks.length} task(s) = {totalRuns} run(s)</span></div>
                <div className="callout"><strong>Selected task signal</strong><span>{selectedTask ? `${selectedTask.title} / ${taskSignalQuality(selectedTask)} confidence` : "No task selected"}</span></div>
                <div className="callout"><strong>Provider guidance</strong><span>{providerApiKey ? "Session key is active for this browser session." : "No session key set. Rules review fallback will still run."}</span></div>
              </div>
              {blockers.length > 0 && <div className="callout callout-error"><strong>Blocked</strong><ul className="plain-list">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
              {runState.message && <div className={`callout callout-${runState.tone}`}>{runState.message}</div>}
            </section>

            <section className="config-strip panel">
              <div className="section-intro"><div><p className="eyebrow">Provider configuration</p><h2>Review is optional.</h2></div><p className="section-note">Add a Gateway key for model review. Leave empty for env key or rules.</p></div>
              <div className="config-grid">
                <label className="field"><span>Gateway API key</span><input value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} placeholder="Optional for model-based review" /></label>
                <label className="field"><span>Review model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4.1-mini" /></label>
                <label className="field"><span>Benchmark suite</span><select value={benchmarkKey} onChange={(event) => setBenchmarkKey(event.target.value)}>{snapshot.benchmarks.map((benchmark) => <option key={benchmark.key} value={benchmark.key}>{benchmark.title}</option>)}</select></label>
                <label className="field"><span>Run mode</span><select value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)}><option value="benchmark-cycle">Benchmark cycle</option><option value="single-task">Single challenge</option></select></label>
                <label className="field field-span-2"><span>Challenge</span><select value={selectedTask?.key ?? ""} onChange={(event) => setTaskKey(event.target.value)} disabled={runMode !== "single-task"}>{selectedBenchmark?.tasks.map((task) => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label>
              </div>
            </section>

            <section className="lab-grid">
              <article className="panel">
                <div className="panel-head"><div className="step-badge">1</div><div><h2>Load Agents</h2><p>Pick one or more agents for this run.</p></div></div>
                <div className="summary-band"><strong>{selectedAgents.length}</strong><span>selected from {snapshot.agents.length} discovered definitions</span></div>
                <div className="agent-list">
                  {snapshot.agents.length > 0 ? snapshot.agents.map((agent) => {
                    const active = selectedAgentPaths.includes(agent.path);
                    return (
                      <button key={agent.path} type="button" className={`agent-card ${active ? "selected" : ""}`} onClick={() => setSelectedAgentPaths((current) => current.includes(agent.path) ? current.filter((entry) => entry !== agent.path) : [...current, agent.path])}>
                        <div className="agent-card-head"><div><div className="agent-title">{agent.name}</div><div className="agent-summary">{agent.summary}</div></div><span className={`status-chip ${active ? "status-chip-active" : ""}`}>{active ? "Selected" : "Ready"}</span></div>
                        <div className="agent-meta">
                          <span>{agent.path}</span>
                          <span>{agent.executionMode === "sandbox" ? "Sandbox-capable" : "Review-only"}</span>
                          <span>{agent.system.bundleMode === "bundle" ? `${agent.system.skillCount} skills / ${agent.system.assetFileCount} assets` : agent.system.skillCount > 0 || agent.system.assetFileCount > 0 ? `${agent.system.skillCount} shared skills / ${agent.system.assetFileCount} assets` : "Single-file agent"}</span>
                          {agent.system.sharedAgentsPath ? <span>Shared .agents layer</span> : null}
                          <span>{agent.source === "manual" ? "Added manually" : agent.source === "managed" ? "Managed bundle" : "Discovered"}</span>
                        </div>
                      </button>
                    );
                  }) : <div className="empty-state">No agent markdown files found under <code>./agents</code> yet.</div>}
                </div>
                <div className="inline-form"><input value={manualAgentPath} onChange={(event) => setManualAgentPath(event.target.value)} placeholder="Add another agent path or bundle directory inside ./agents" disabled={isInspectingAgent} /><button type="button" className="secondary-action" onClick={inspectManualAgent} disabled={isInspectingAgent}>Inspect path</button></div>
                {manualAgentState.message && <p className={toneClass(manualAgentState.tone)}>{manualAgentState.message}</p>}
                <div className="callout callout-muted">
                  <strong>Bundle skills and workflows</strong>
                  <span>Search skills on skills.sh, install them into the project `.agents` layer, or snapshot them into a managed bundle together with uploaded workflows.</span>
                </div>
                <div className="config-grid">
                  <label className="field"><span>Base agent</span><select value={bundleBaseAgentPath} onChange={(event) => setBundleBaseAgentPath(event.target.value)}><option value="">Select agent</option>{snapshot.agents.map((agent) => <option key={`bundle-${agent.path}`} value={agent.path}>{agent.name} ({agent.path})</option>)}</select></label>
                  <label className="field"><span>Managed bundle name</span><input value={bundleName} onChange={(event) => setBundleName(event.target.value)} placeholder="optional bundle name" /></label>
                  <label className="field field-span-2"><span>Upload `.agents` or workflow files</span><input type="file" multiple onChange={handleBundleUploadChange} {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)} /></label>
                </div>
                {bundleUploadFiles.length > 0 ? <div className="chip-row">{bundleUploadFiles.slice(0, 6).map((file) => <span className="mini-chip" key={file.path}>{file.path}</span>)}{bundleUploadFiles.length > 6 ? <span className="mini-chip">+{bundleUploadFiles.length - 6} more</span> : null}</div> : null}
                <div className="inline-form"><input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills.sh for reusable skills" disabled={isSearchingSkills} /><button type="button" className="secondary-action" onClick={searchSkillsAction} disabled={isSearchingSkills}>{isSearchingSkills ? "Searching..." : "Search skills"}</button></div>
                {skillState.message && <p className={toneClass(skillState.tone)}>{skillState.message}</p>}
                {skillResults.length > 0 ? <div className="agent-list">{skillResults.map((skill) => {
                  const selected = selectedSkills.some((entry) => entry.installSpec === skill.installSpec);
                  return (
                    <button key={skill.installSpec} type="button" className={`agent-card ${selected ? "selected" : ""}`} onClick={() => toggleSelectedSkill(skill)}>
                      <div className="agent-card-head"><div><div className="agent-title">{skill.title}</div><div className="agent-summary">{skill.installSpec}</div></div><span className={`status-chip ${selected ? "status-chip-active" : ""}`}>{selected ? "Attached" : "Attach"}</span></div>
                      <div className="agent-meta"><span>{formatInstalls(skill.installs)}</span><span>{skill.registryUrl}</span></div>
                    </button>
                  );
                })}</div> : null}
                {selectedSkills.length > 0 ? <div className="chip-row">{selectedSkills.map((skill) => <span className="mini-chip" key={`selected-${skill.installSpec}`}>{skill.installSpec}</span>)}</div> : null}
                <div className="action-row">
                  <button type="button" className="secondary-action" onClick={installSelectedSkillsAction} disabled={isManagingProjectSkills || selectedSkills.length === 0}>{isManagingProjectSkills ? "Installing..." : "Install into project"}</button>
                  <button type="button" className="secondary-action" onClick={createManagedBundleAction} disabled={isCreatingBundle}>{isCreatingBundle ? "Creating..." : "Create managed bundle"}</button>
                </div>
                {bundleState.message && <p className={toneClass(bundleState.tone)}>{bundleState.message}</p>}
                <div className="callout callout-muted">
                  <strong>Project skills</strong>
                  <span>Installed project skills live under `./.agents` and are included as a shared system layer when flat agents from `./agents` are reviewed or sandboxed.</span>
                </div>
                <div className="action-row">
                  <button type="button" className="secondary-action" onClick={() => updateProjectSkillsAction()} disabled={isManagingProjectSkills || snapshot.projectSkills.length === 0}>{isManagingProjectSkills ? "Working..." : "Update all project skills"}</button>
                  <button type="button" className="secondary-action" onClick={() => refreshSnapshot()} disabled={isManagingProjectSkills}>Refresh skills</button>
                </div>
                {projectSkillState.message && <p className={toneClass(projectSkillState.tone)}>{projectSkillState.message}</p>}
                {snapshot.projectSkills.length > 0 ? <div className="agent-list">{snapshot.projectSkills.map((skill) => (
                  <article key={`project-skill-${skill.name}`} className="agent-card">
                    <div className="agent-card-head"><div><div className="agent-title">{skill.name}</div><div className="agent-summary">{skill.path}</div></div><span className="status-chip status-chip-active">{skill.scope}</span></div>
                    <div className="agent-meta"><span>Agents: {skill.agents.join(", ") || "none"}</span></div>
                    <div className="action-row">
                      <button type="button" className="text-link button-reset" onClick={() => updateProjectSkillsAction([skill.name])} disabled={isManagingProjectSkills}>Update</button>
                      <button type="button" className="text-link button-reset" onClick={() => removeProjectSkillsAction([skill.name])} disabled={isManagingProjectSkills}>Remove</button>
                    </div>
                  </article>
                ))}</div> : <div className="empty-state">No project skills installed yet. Search skills.sh, then install selected results into `./.agents`.</div>}
              </article>

              <article className="panel">
                <div className="panel-head"><div className="step-badge">2</div><div><h2>Choose Suite + Tasks</h2><p>Pick a benchmark suite. Its tasks appear below.</p></div></div>
                <div className="summary-band suite-summary"><strong>{selectedBenchmark?.title ?? "No benchmark"}</strong><span>{selectedBenchmark ? `${selectedBenchmark.tasks.length} tasks available` : "Select a suite."}</span>{selectedBenchmark && <div className="chip-row">{chipsForSuite(selectedBenchmark).map((chip) => <span className="mini-chip" key={chip}>{chip}</span>)}</div>}</div>
                <div className="playlist-step-label"><span>1</span><strong>Choose suite</strong></div>
                <div className="suite-pills">{snapshot.benchmarks.map((benchmark) => <button key={benchmark.key} type="button" className={`suite-pill ${benchmark.key === benchmarkKey ? "active" : ""}`} onClick={() => selectBenchmarkSuite(benchmark.key)}><span>{benchmark.title}</span><span>{benchmark.tasks.length} tasks / {humanizeToken(benchmark.metadata.resolution)}</span></button>)}</div>
                <div className="playlist-step-label"><span>2</span><strong>Tasks in {selectedBenchmark?.title ?? "suite"}</strong></div>
                <div className="playlist-list">
                  {(selectedBenchmark?.tasks ?? []).map((task) => {
                    const active = task.key === selectedTask?.key;
                    const queued = runMode === "benchmark-cycle" || active;
                    const expanded = expandedTaskKeys.includes(task.key);
                    return (
                      <article key={task.key} className={`playlist-card ${active ? "active" : ""}`}>
                        <button type="button" className="playlist-select button-reset" onClick={() => setTaskKey(task.key)}>
                          <div className="agent-card-head"><strong>{task.title}</strong><span className={`status-chip ${queued ? "status-chip-active" : ""}`}>{queued ? "Queued" : "Preview"}</span></div>
                          <p>{task.description}</p>
                        </button>
                        <div className="playlist-card-footer">
                          <span>{runMode === "benchmark-cycle" ? "Included in cycle" : active ? "Selected challenge" : "Click title to select"}</span>
                          <button type="button" className="text-link button-reset details-toggle" onClick={() => toggleTaskDetails(task.key)}>{expanded ? "Hide details" : "Show details"}</button>
                        </div>
                        {expanded && (
                          <div className="playlist-details">
                            <div className="chip-row">{chipsForTask(task).map((chip) => <span className="mini-chip" key={`${task.key}-${chip}`}>{chip}</span>)}</div>
                            {task.whyThisTask && <div className="playlist-section"><strong>Why it matters</strong><span>{task.whyThisTask}</span></div>}
                            {task.deliverableFormat && <div className="playlist-section"><strong>Deliverable</strong><span>{task.deliverableFormat}</span></div>}
                            {task.successChecks.length > 0 && <div className="playlist-section"><strong>Success checks</strong><span>{task.successChecks.slice(0, 3).join(" / ")}</span></div>}
                            {task.failureModes.length > 0 && <div className="playlist-section"><strong>Failure modes</strong><span>{task.failureModes.slice(0, 2).join(" / ")}</span></div>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </article>

              <article className="panel panel-highlight">
                <div className="panel-head"><div className="step-badge">3</div><div><h2>Launch Batch</h2><p>Check the count, then run. Use failed-only reruns after fixes.</p></div></div>
                <div className="run-plan">
                  <div className="plan-metric"><strong>{selectedAgents.length}</strong><span>Agents selected</span></div>
                  <div className="plan-metric"><strong>{plannedTasks.length}</strong><span>Tasks queued</span></div>
                  <div className="plan-metric"><strong>{totalRuns}</strong><span>Runs to execute</span></div>
                  <div className="plan-stack"><div>{selectedAgents.map((agent) => <span className="mini-chip" key={agent.path}>{agent.name}</span>)}</div><div>{plannedTasks.map((task) => <span className="mini-chip" key={task.key}>{task.title}</span>)}</div></div>
                </div>
                <div className="action-cluster">
                  <button type="button" className="primary-action" disabled={workflowState === "blocked" || isRunningBatch} onClick={() => runBatchAction()}>Run selected agents</button>
                  <button type="button" className="secondary-action" disabled={isRunningBatch || lastBatchFailureJobs.length === 0} onClick={() => runBatchAction(lastBatchFailureJobs)}>Rerun failed only</button>
                  <button type="button" className="secondary-action" disabled={!bestRun || isRunningBatch} onClick={() => bestRun && openRun(bestRun.runKey)}>Inspect best run</button>
                  <button type="button" className="secondary-action" disabled={!latestFailedRun || isRunningBatch} onClick={() => latestFailedRun && openRun(latestFailedRun.runKey)}>Inspect failed run</button>
                  <button type="button" className="secondary-action" onClick={() => setView("benchmarks")} disabled={!selectedTask}>Refine selected task</button>
                </div>
                {batchOverflow && <p className="status-line status-line-error">Batch exceeds the {MAX_BATCH_RUNS}-run limit. Narrow the selection.</p>}
                {lastBatchResult?.failedRuns ? <div className="callout callout-error"><strong>Latest batch failures</strong><ul className="plain-list">{lastBatchResult.failures.slice(0, 3).map((failure: BatchRunFailure) => <li key={`${failure.agentPath}-${failure.taskKey}`}>{failure.taskKey}: {failure.message}</li>)}</ul></div> : null}
              </article>
            </section>

            <section className="dashboard-grid">
              <article className="panel">
                <div className="section-header"><div><p className="eyebrow">Recent output</p><h2>Latest runs</h2></div><button type="button" className="text-link button-reset" onClick={() => setView("history")}>View full history</button></div>
                <div className="run-list">{recentRuns.length > 0 ? recentRuns.map((run) => <div key={run.runKey}><RunCard run={run} busyAction={activeRunAction} onOpen={() => openRun(run.runKey)} onJson={() => showRunJson(run.runKey)} onDelete={() => deleteRunAction(run.runKey)} />{resultJson[run.runKey] && <pre className="result-box">{resultJson[run.runKey]}</pre>}</div>) : <div className="empty-state">No runs yet. Launch the first batch from the Test Lab.</div>}</div>
              </article>
              <div className="rail-stack">
                <article className="panel"><div className="section-header"><div><p className="eyebrow">Activity</p><h2>Latest log</h2></div></div><pre className="log-panel">{snapshot.latestLogText}</pre></article>
                <article className="panel"><div className="section-header"><div><p className="eyebrow">Inspector</p><h2>Run details</h2></div></div>
                  {detail ? (
                    <div className="run-detail-content">
                      <div className="detail-title">{detail.run.runKey} / {detail.run.agentName} / {detail.run.suiteName}</div>
                      <div className="chip-row"><span className={`status-chip ${runStatusClass(detail.run.status)}`}>{detail.run.status}</span><span className={`status-chip ${confidenceClass(detail.run.scoreConfidence)}`}>{detail.run.scoreConfidence} confidence</span><span className="status-chip">{detailSummary?.scoreProfile ?? detail.run.scoreProfile}</span></div>
                      {detail.run.failureReason && <div className="callout callout-error">{detail.run.failureReason}</div>}
                      <div className="detail-grid">
                        <div className="detail-cell">Total <strong>{(detailSummary?.scores?.total ?? detail.run.score).toFixed(2)}</strong></div><div className="detail-cell">Outcome <strong>{(detailSummary?.scores?.outcome ?? detail.run.outcomeScore).toFixed(2)}</strong></div>
                        <div className="detail-cell">Process <strong>{(detailSummary?.scores?.process ?? detail.run.processScore).toFixed(2)}</strong></div><div className="detail-cell">Review <strong>{(detailSummary?.scores?.review ?? detail.run.reviewScore).toFixed(2)}</strong></div>
                        <div className="detail-cell">Efficiency <strong>{(detailSummary?.scores?.efficiency ?? detail.run.efficiencyScore).toFixed(2)}</strong></div><div className="detail-cell">Duration <strong>{(detail.run.durationMs / 1000).toFixed(2)}s</strong></div>
                        <div className="detail-cell">Latency <strong>{Number(detailSummary?.latencyMs ?? detail.run.latencyMs)}ms</strong></div><div className="detail-cell">Cost <strong>{Number(detailSummary?.costUsd ?? detail.run.costUsd).toFixed(4)}</strong></div>
                        <div className="detail-cell">Execution <strong>{detailSummary?.executionMode ?? "review-only"}</strong></div><div className="detail-cell">Sandbox <strong>{detailSummary?.sandbox?.provider ?? "n/a"}</strong></div>
                        <div className="detail-cell">Network <strong>{detailSummary?.sandbox?.networkAccess ?? "n/a"}</strong></div><div className="detail-cell">Review mode <strong>{detailSummary?.reviewMode ?? "unknown"}</strong></div>
                      </div>
                      {detailSummary?.agentSystem ? <div className="detail-stack"><strong>Agent system</strong><span>{detailSummary.agentSystem.bundleMode === "bundle" ? `Bundle with ${detailSummary.agentSystem.skillCount ?? 0} skills and ${detailSummary.agentSystem.assetFileCount ?? 0} asset files` : detailSummary.agentSystem.sharedAgentsPath ? `Flat agent plus shared .agents with ${detailSummary.agentSystem.skillCount ?? 0} skills and ${detailSummary.agentSystem.assetFileCount ?? 0} asset files` : "Single-file agent definition"}</span>{detailSummary.agentSystem.skills?.length ? <span>{detailSummary.agentSystem.skills.map((skill) => skill.installSpec).join(" / ")}</span> : null}</div> : null}
                      {detailSummary?.objectiveChecks && <div className="detail-stack"><strong>Objective checks</strong><span>{detailSummary.objectiveChecks.passed ?? 0}/{detailSummary.objectiveChecks.available ?? 0}{detailSummary.objectiveChecks.deterministic ? " deterministic" : " advisory"}</span>{detailSummary.objectiveChecks.items?.length ? <span>{detailSummary.objectiveChecks.items.join(" / ")}</span> : null}</div>}
                      {detailSummary?.taskContract?.deliverableFormat && <div className="detail-stack"><strong>Deliverable format</strong><span>{detailSummary.taskContract.deliverableFormat}</span></div>}
                      {detailSummary?.evidence?.matchedSignals?.length ? <div className="detail-stack"><strong>Matched evidence</strong><span>{detailSummary.evidence.matchedSignals.join(" / ")}</span></div> : null}
                      {detailSummary?.evidence?.missingSignals?.length ? <div className="detail-stack"><strong>Open gaps</strong><span>{detailSummary.evidence.missingSignals.join(" / ")}</span></div> : null}
                      {detailSummary?.recommendedNextActions?.length ? <div className="detail-stack"><strong>Recommended next actions</strong><ul className="plain-list">{detailSummary.recommendedNextActions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
                      <a href={detail.reportUrl} target="_blank" rel="noreferrer"><img src={detail.reportUrl} alt={`Run report ${detail.run.runKey}`} className="detail-image" /></a>
                    </div>
                  ) : <div className="empty-state">Open any run card to inspect its score breakdown, evidence, and recommended next actions.</div>}
                </article>
              </div>
            </section>
          </section>
        )}
        {view === "history" && (
          <section className="view-stack">
            <article className="panel">
              <div className="section-header"><div><p className="eyebrow">Audit trail</p><h2>Run History</h2></div></div>
              <div className="run-list">{historyRuns.length > 0 ? historyRuns.map((run) => <div key={run.runKey}><RunCard run={run} busyAction={activeRunAction} onOpen={() => openRun(run.runKey)} onJson={() => showRunJson(run.runKey)} onDelete={() => deleteRunAction(run.runKey)} />{resultJson[run.runKey] && <pre className="result-box">{resultJson[run.runKey]}</pre>}</div>) : <div className="empty-state">Run history will appear here after the first execution.</div>}</div>
            </article>
          </section>
        )}
        {view === "benchmarks" && (
          <section className="view-stack">
            <article className="panel">
              <div className="section-header"><div><p className="eyebrow">Benchmark authoring</p><h2>Benchmark Library</h2></div></div>
              <div className="callout"><strong>Authoring guidance</strong><span>Write tasks with explicit inputs, deliverable shape, success checks, and failure modes so review-only tasks stay honest and upgradeable.</span></div>
              <form className="benchmark-form" onSubmit={createBenchmarkAction}>
                <label className="field"><span>Create</span><select value={benchmarkForm.type} onChange={(event) => setBenchmarkForm((current) => ({ ...current, type: event.target.value as "suite" | "task" }))}><option value="suite">Benchmark suite</option><option value="task">Task in existing suite</option></select></label>
                <label className="field"><span>Parent benchmark</span><input value={benchmarkForm.benchmarkKey} onChange={(event) => setBenchmarkForm((current) => ({ ...current, benchmarkKey: event.target.value }))} placeholder="Required for tasks" /></label>
                <label className="field"><span>Key</span><input value={benchmarkForm.key} onChange={(event) => setBenchmarkForm((current) => ({ ...current, key: event.target.value }))} placeholder="auth-migration" /></label>
                <label className="field"><span>Title</span><input value={benchmarkForm.title} onChange={(event) => setBenchmarkForm((current) => ({ ...current, title: event.target.value }))} placeholder="Authentication Migration" /></label>
                <label className="field field-span-2"><span>Description</span><textarea value={benchmarkForm.description} onChange={(event) => setBenchmarkForm((current) => ({ ...current, description: event.target.value }))} placeholder="What should the agent do?" /></label>
                <label className="field field-span-2"><span>Expected outcome</span><textarea value={benchmarkForm.expectedOutcome} onChange={(event) => setBenchmarkForm((current) => ({ ...current, expectedOutcome: event.target.value }))} placeholder="What proves that the task is complete?" /></label>
                {benchmarkForm.type === "task" && (
                  <>
                    <label className="field field-span-2"><span>Why this task</span><textarea value={benchmarkForm.whyThisTask} onChange={(event) => setBenchmarkForm((current) => ({ ...current, whyThisTask: event.target.value }))} placeholder="Why this task is useful as a benchmark." /></label>
                    <label className="field field-span-2"><span>Inputs</span><textarea value={benchmarkForm.inputs} onChange={(event) => setBenchmarkForm((current) => ({ ...current, inputs: event.target.value }))} placeholder="Fixed inputs, fixtures, constraints, or source material." /></label>
                    <label className="field field-span-2"><span>Deliverable format</span><textarea value={benchmarkForm.deliverableFormat} onChange={(event) => setBenchmarkForm((current) => ({ ...current, deliverableFormat: event.target.value }))} placeholder="Required output structure or artifact format." /></label>
                    <label className="field field-span-2"><span>Success checks</span><textarea value={benchmarkForm.successChecks} onChange={(event) => setBenchmarkForm((current) => ({ ...current, successChecks: event.target.value }))} placeholder="One line per success check." /></label>
                    <label className="field field-span-2"><span>Failure modes</span><textarea value={benchmarkForm.failureModes} onChange={(event) => setBenchmarkForm((current) => ({ ...current, failureModes: event.target.value }))} placeholder="One line per likely failure mode." /></label>
                  </>
                )}
                <label className="field"><span>Resolution</span><select value={benchmarkForm.resolution} onChange={(event) => setBenchmarkForm((current) => ({ ...current, resolution: event.target.value as BenchmarkResolution }))}>{RESOLUTION_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}</select></label>
                <label className="field"><span>Domain</span><input value={benchmarkForm.domain} onChange={(event) => setBenchmarkForm((current) => ({ ...current, domain: event.target.value }))} placeholder="software-engineering" /></label>
                <label className="field field-span-2"><span>Tags</span><input value={benchmarkForm.tags} onChange={(event) => setBenchmarkForm((current) => ({ ...current, tags: event.target.value }))} placeholder="coding, regression, tool-use" /></label>
                {benchmarkForm.type === "task" && (
                  <>
                    <label className="field"><span>Interaction</span><select value={benchmarkForm.interaction} onChange={(event) => setBenchmarkForm((current) => ({ ...current, interaction: event.target.value as BenchmarkInteractionMode }))}>{INTERACTION_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}</select></label>
                    <label className="field"><span>Evaluator</span><select value={benchmarkForm.evaluator} onChange={(event) => setBenchmarkForm((current) => ({ ...current, evaluator: event.target.value as BenchmarkEvaluatorMode }))}>{EVALUATOR_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}</select></label>
                    <label className="field"><span>Difficulty</span><select value={benchmarkForm.difficulty} onChange={(event) => setBenchmarkForm((current) => ({ ...current, difficulty: event.target.value as "low" | "medium" | "high" }))}>{DIFFICULTY_OPTIONS.map((option) => <option key={option} value={option}>{humanizeToken(option)}</option>)}</select></label>
                    <label className="field field-checkbox"><span>Requires isolation</span><input type="checkbox" checked={benchmarkForm.requiresIsolation} onChange={(event) => setBenchmarkForm((current) => ({ ...current, requiresIsolation: event.target.checked }))} /></label>
                    <label className="field field-checkbox"><span>Requires network</span><input type="checkbox" checked={benchmarkForm.requiresNetwork} onChange={(event) => setBenchmarkForm((current) => ({ ...current, requiresNetwork: event.target.checked }))} /></label>
                  </>
                )}
                <button type="submit" className="primary-action" disabled={isCreatingBenchmark}>Add benchmark</button>
                {benchmarkState.message && <p className={toneClass(benchmarkState.tone)}>{benchmarkState.message}</p>}
              </form>
              <div className="benchmark-library">{snapshot.benchmarks.map((benchmark) => <article className="library-card" key={benchmark.key}><div className="library-header"><div><h3>{benchmark.title}</h3><p>{benchmark.key}</p></div><span className="status-chip">{benchmark.tasks.length} tasks</span></div><p className="library-copy">{benchmark.description}</p><div className="chip-row">{chipsForSuite(benchmark).map((chip) => <span className="mini-chip" key={`${benchmark.key}-${chip}`}>{chip}</span>)}</div><div className="library-stack">{benchmark.tasks.map((task) => <div className="library-task" key={task.key}><strong>{task.title} ({task.key})</strong><p>{task.description}</p><div className="chip-row">{chipsForTask(task).map((chip) => <span className="mini-chip" key={`${task.key}-${chip}`}>{chip}</span>)}</div><span>{task.expectedOutcome}</span>{task.deliverableFormat && <span>Deliverable: {task.deliverableFormat}</span>}{task.successChecks.length > 0 && <span>Checks: {task.successChecks.slice(0, 3).join(" / ")}</span>}</div>)}</div></article>)}</div>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
