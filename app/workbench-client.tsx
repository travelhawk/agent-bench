"use client";

import { startTransition, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type {
  AgentRecord, BatchRunFailure, BatchRunResult, BenchmarkEvaluatorMode, BenchmarkInteractionMode,
  BenchmarkResolution, BenchmarkSuiteRecord, BenchmarkTaskRecord, InstalledSkillRecord, RunMode, RunRecord, RunResultPayload, WorkbenchSnapshot
} from "../src/types";
import { RunCard } from "./_components/run-card";
import { RunInspector } from "./_components/run-inspector";
import {
  AsyncTone, Confidence, formatInstalls, humanizeToken, splitListInput, toneClass
} from "./_components/shared";

type ViewMode = "lab" | "history" | "benchmarks";
type WorkflowState = "blocked" | "ready" | "running" | "completed-with-failures" | "completed-clean";
type ThemeMode = "light" | "dark" | "system";

interface BenchmarkFormState {
  type: "suite" | "task"; benchmarkKey: string; key: string; title: string; description: string; expectedOutcome: string;
  whyThisTask: string; inputs: string; deliverableFormat: string; successChecks: string; failureModes: string;
  resolution: BenchmarkResolution; interaction: BenchmarkInteractionMode; evaluator: BenchmarkEvaluatorMode;
  difficulty: "low" | "medium" | "high"; domain: string; tags: string; requiresIsolation: boolean; requiresNetwork: boolean;
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
const THEME_KEY = "agent-bench:theme";
const STORAGE_KEYS = { selectedAgents: "agent-bench:selected-agents", benchmarkKey: "agent-bench:benchmark-key", taskKey: "agent-bench:task-key", runMode: "agent-bench:run-mode", model: "agent-bench:model", providerApiKey: "agent-bench:provider-api-key" } as const;

const emptyForm = (): BenchmarkFormState => ({
  type: "suite", benchmarkKey: "", key: "", title: "", description: "", expectedOutcome: "", whyThisTask: "", inputs: "",
  deliverableFormat: "", successChecks: "", failureModes: "", resolution: "workflow", interaction: "tool-use", evaluator: "hybrid",
  difficulty: "medium", domain: "general", tags: "", requiresIsolation: true, requiresNetwork: false
});

async function readBundleUploadFiles(fileList: FileList): Promise<BundleUploadFile[]> {
  const files = Array.from(fileList);
  return Promise.all(files.map(async (file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return { path: relativePath, content: await file.text() };
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

const VIEW_SUBTITLE: Record<ViewMode, string> = {
  lab: "Load agents, choose tasks, run a bounded benchmark, and inspect the evidence.",
  history: "Every run with its score, diff, tests, quality, and cost — open one to inspect, or compare two.",
  benchmarks: "Author new suites and tasks, and browse the seeded benchmark library."
};

function compareRows(left: RunRecord, right: RunRecord): Array<{ label: string; left: string; right: string; delta: number | null }> {
  const quand = left.qualityScore != null && right.qualityScore != null;
  return [
    { label: "Score", left: left.score.toFixed(2), right: right.score.toFixed(2), delta: right.score - left.score },
    { label: "Quality", left: left.qualityScore != null ? left.qualityScore.toFixed(2) : "n/a", right: right.qualityScore != null ? right.qualityScore.toFixed(2) : "n/a", delta: quand ? right.qualityScore! - left.qualityScore! : null },
    { label: "Diff files", left: left.diffAvailable ? String(left.diffFilesChanged) : "n/a", right: right.diffAvailable ? String(right.diffFilesChanged) : "n/a", delta: null },
    { label: "Tests", left: left.verifierTestsAvailable ? `${left.verifierTestsPassed}/${left.verifierTestsTotal}` : "n/a", right: right.verifierTestsAvailable ? `${right.verifierTestsPassed}/${right.verifierTestsTotal}` : "n/a", delta: null },
    { label: "Cost", left: `$${left.costUsd.toFixed(2)}`, right: `$${right.costUsd.toFixed(2)}`, delta: null },
    { label: "Duration", left: `${(left.durationMs / 1000).toFixed(1)}s`, right: `${(right.durationMs / 1000).toFixed(1)}s`, delta: null }
  ];
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
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [compareMode, setCompareMode] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);

  useEffect(() => {
    const savedAgents = localStorage.getItem(STORAGE_KEYS.selectedAgents), savedBenchmark = localStorage.getItem(STORAGE_KEYS.benchmarkKey),
      savedTask = localStorage.getItem(STORAGE_KEYS.taskKey), savedRunMode = localStorage.getItem(STORAGE_KEYS.runMode),
      savedModel = localStorage.getItem(STORAGE_KEYS.model), savedApiKey = sessionStorage.getItem(STORAGE_KEYS.providerApiKey);
    if (savedAgents) try { const parsed = JSON.parse(savedAgents) as string[]; if (Array.isArray(parsed) && parsed.length > 0) setSelectedAgentPaths(parsed); } catch {}
    if (savedBenchmark) setBenchmarkKey(savedBenchmark); if (savedTask) setTaskKey(savedTask);
    if (savedRunMode === "single-task" || savedRunMode === "benchmark-cycle") setRunMode(savedRunMode);
    if (savedModel) setModel(savedModel); if (savedApiKey) setProviderApiKey(savedApiKey);
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") setThemeMode(savedTheme);
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
  const bestRun = snapshot.runs.filter((run) => run.status === "completed").sort((left, right) => right.score - left.score)[0];
  const compareLeft = snapshot.runs.find((run) => run.runKey === compareKeys[0]) ?? null;
  const compareRight = snapshot.runs.find((run) => run.runKey === compareKeys[1]) ?? null;

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
  async function deleteRunAction(runKey: string) { if (!window.confirm(`Delete run ${runKey}?`)) return; setActiveRunAction(`delete:${runKey}`); try { await mutateJson(`/api/run/${runKey}`, "DELETE"); if (detail?.run.runKey === runKey) setDetail(null); setCompareKeys((current) => current.filter((key) => key !== runKey)); await refreshSnapshot(); } finally { setActiveRunAction(null); } }

  function toggleTheme() {
    const root = document.documentElement;
    const systemDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective = root.getAttribute("data-theme") ?? (systemDark ? "dark" : "light");
    const next = effective === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    setThemeMode(next);
  }

  function toggleCompareKey(runKey: string) {
    setCompareKeys((current) => current.includes(runKey)
      ? current.filter((key) => key !== runKey)
      : current.length >= 2 ? [current[1], runKey] : [...current, runKey]);
  }

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
    if (!skillQuery.trim()) { setSkillState({ tone: "error", message: "Enter a skills.sh search query first." }); return; }
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
    if (selectedSkills.length === 0) { setProjectSkillState({ tone: "error", message: "Select at least one search result to install into the project." }); return; }
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
    if (names.length === 0) { setProjectSkillState({ tone: "error", message: "Select at least one installed skill to remove." }); return; }
    if (!window.confirm(`Remove ${names.join(", ")} from this project's .agents skills?`)) return;
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
    if (!files || files.length === 0) { setBundleUploadFiles([]); return; }
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
    if (!baseAgentPath) { setBundleState({ tone: "error", message: "Choose or inspect a base agent before creating a managed bundle." }); return; }
    setIsCreatingBundle(true);
    setBundleState({ tone: "neutral", message: "Creating managed agent bundle..." });
    try {
      const response = await mutateJson<{ agent: AgentRecord }>("/api/agents/bundles", "POST", {
        name: bundleName || undefined, baseAgentPath, files: bundleUploadFiles, skills: selectedSkills
      });
      startTransition(() => setSnapshot((current) => ({
        ...current, agents: [...current.agents.filter((agent) => agent.path !== response.agent.path), response.agent]
      })));
      setSelectedAgentPaths((current) => Array.from(new Set([...current, response.agent.path])));
      setBundleBaseAgentPath(response.agent.path);
      setBundleName(""); setBundleUploadFiles([]); setSelectedSkills([]);
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

  function selectBenchmarkSuite(nextBenchmarkKey: string) { setBenchmarkKey(nextBenchmarkKey); setExpandedTaskKeys([]); }
  function toggleTaskDetails(nextTaskKey: string) {
    setExpandedTaskKeys((current) => current.includes(nextTaskKey) ? current.filter((entry) => entry !== nextTaskKey) : [...current, nextTaskKey]);
  }

  const nextActionCopy = workflowState === "blocked" ? blockers[0] ?? "Resolve the blocker before launching." : workflowState === "running" ? "Batch is running. The latest result opens when it finishes." : workflowState === "completed-with-failures" ? "Inspect failed runs, fix the blocker, then rerun failed only." : workflowState === "completed-clean" ? "Open the best run and confirm the evidence." : "Plan is valid. Start when the agents and tasks look right.";
  const latestFailedRun = failedHistoryRuns[0];
  const themeValue = themeMode === "system" ? "Auto" : themeMode === "dark" ? "Dark" : "Light";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">AB</div><div><div className="eyebrow">Eval workbench</div><div className="brand-title">agent-bench</div></div></div>
        <nav className="nav-stack">
          <button type="button" className={`nav-item ${view === "lab" ? "active" : ""}`} onClick={() => setView("lab")}>Test Lab</button>
          <button type="button" className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>Run History</button>
          <button type="button" className={`nav-item ${view === "benchmarks" ? "active" : ""}`} onClick={() => setView("benchmarks")}>Benchmark Library</button>
        </nav>
        <div className="sidebar-spacer" />
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle color theme"><span>Theme</span><span className="toggle-value">{themeValue}</span></button>
        <div className="sidebar-callout"><div className="eyebrow">Current workflow</div><p>Agents → suite → tasks → run.</p></div>
        <div className="sidebar-callout sidebar-callout-muted"><div className="eyebrow">Signal policy</div><p>Verifier-backed runs carry the strongest signal.</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-copy"><p className="eyebrow">Guided local runner</p><h1>Agent Test Lab</h1><p>{VIEW_SUBTITLE[view]}</p></div>
          <div className="stat-inline">
            <article className="stat-pill stat-pill-accent"><span className="stat-label">Total runs</span><strong className="stat-value">{snapshot.summary.totalRuns}</strong></article>
            <article className="stat-pill stat-pill-good"><span className="stat-label">Avg score</span><strong className="stat-value">{snapshot.summary.avgScore.toFixed(1)}</strong></article>
            <article className={`stat-pill ${failedHistoryRuns.length > 0 ? "stat-pill-bad" : ""}`}><span className="stat-label">Failed</span><strong className="stat-value">{failedHistoryRuns.length}</strong></article>
            <article className="stat-pill"><span className="stat-label">Agents</span><strong className="stat-value">{snapshot.summary.availableAgents}</strong></article>
          </div>
        </header>

        {view === "lab" && (
          <section className="view-stack">
            <div className="lab-layout">
              <div className="lab-main">
                <article className="panel">
                  <div className="panel-head"><div className="step-badge">1</div><div><h2>Load Agents</h2><p>Pick one or more agents for this run.</p></div></div>
                  <div className="summary-band"><strong>{selectedAgents.length}</strong><span>selected from {snapshot.agents.length} discovered definition(s)</span></div>
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
                    }) : <div className="empty-state">No agent markdown files found under <code>./agents</code> yet. Add one below.</div>}
                  </div>
                  <div className="inline-form"><input value={manualAgentPath} onChange={(event) => setManualAgentPath(event.target.value)} placeholder="Add an agent path or bundle dir inside ./agents" disabled={isInspectingAgent} /><button type="button" className="secondary-action" onClick={inspectManualAgent} disabled={isInspectingAgent}>Inspect path</button></div>
                  {manualAgentState.message && <p className={toneClass(manualAgentState.tone)}>{manualAgentState.message}</p>}

                  <details className="disclosure">
                    <summary>Manage agents &amp; skills<span className="disclosure-hint">bundles · skills.sh · project skills</span></summary>
                    <div className="disclosure-body">
                      <div className="callout callout-muted"><strong>Bundle skills &amp; workflows</strong><span>Search skills.sh, install them into the project `.agents` layer, or snapshot them into a managed bundle with uploaded workflow files.</span></div>
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
                      <div className="callout callout-muted"><strong>Project skills</strong><span>Installed project skills live under `./.agents` and are shared with flat agents during review and sandbox runs.</span></div>
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
                            <button type="button" className="text-link button-reset btn-danger" onClick={() => removeProjectSkillsAction([skill.name])} disabled={isManagingProjectSkills}>Remove</button>
                          </div>
                        </article>
                      ))}</div> : <div className="empty-state">No project skills installed yet. Search skills.sh, then install selected results into `./.agents`.</div>}
                    </div>
                  </details>
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

                <details className="disclosure">
                  <summary>Provider &amp; review model<span className="disclosure-hint">{providerApiKey ? "session key set" : "optional"}</span></summary>
                  <div className="disclosure-body">
                    <div className="config-grid">
                      <label className="field"><span>Gateway API key</span><input value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} placeholder="Optional for model-based review" /></label>
                      <label className="field"><span>Review model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="openai/gpt-4.1-mini" /></label>
                    </div>
                    <p className="status-line">Add a Gateway key for model review. Leave empty to use the env key or the deterministic rules fallback.</p>
                  </div>
                </details>
              </div>

              <aside className="launch-rail">
                <article className="panel panel-highlight">
                  <div className="panel-head"><div className="step-badge">3</div><div><h2>Launch Batch</h2><p>Review the plan, then run.</p></div></div>
                  <div className="chip-row"><span className={`status-chip workflow-chip workflow-chip-${workflowState}`}>{workflowState.replace(/-/g, " ")}</span></div>
                  <p className="status-line">{nextActionCopy}</p>
                  <div className="run-plan">
                    <div className="plan-metric"><strong>{selectedAgents.length}</strong><span>Agents</span></div>
                    <span className="plan-equals">×</span>
                    <div className="plan-metric"><strong>{plannedTasks.length}</strong><span>Tasks</span></div>
                    <span className="plan-equals">=</span>
                    <div className="plan-metric"><strong>{totalRuns}</strong><span>Runs</span></div>
                  </div>
                  <div className="config-grid">
                    <label className="field"><span>Run mode</span><select value={runMode} onChange={(event) => setRunMode(event.target.value as RunMode)}><option value="benchmark-cycle">Benchmark cycle</option><option value="single-task">Single challenge</option></select></label>
                    <label className="field"><span>Challenge</span><select value={selectedTask?.key ?? ""} onChange={(event) => setTaskKey(event.target.value)} disabled={runMode !== "single-task"}>{selectedBenchmark?.tasks.map((task) => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label>
                  </div>
                  <div className="action-cluster">
                    <button type="button" className="primary-action" disabled={workflowState === "blocked" || isRunningBatch} onClick={() => runBatchAction()}>Run selected agents</button>
                    <button type="button" className="secondary-action" disabled={isRunningBatch || lastBatchFailureJobs.length === 0} onClick={() => runBatchAction(lastBatchFailureJobs)}>Rerun failed only</button>
                    <button type="button" className="secondary-action" disabled={!bestRun || isRunningBatch} onClick={() => bestRun && openRun(bestRun.runKey)}>Inspect best run</button>
                    <button type="button" className="secondary-action" disabled={!latestFailedRun || isRunningBatch} onClick={() => latestFailedRun && openRun(latestFailedRun.runKey)}>Inspect failed run</button>
                  </div>
                  {blockers.length > 0 && <div className="callout callout-error"><strong>Blocked</strong><ul className="plain-list">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
                  {batchOverflow && <p className="status-line status-line-error">Batch exceeds the {MAX_BATCH_RUNS}-run limit. Narrow the selection.</p>}
                  {runState.message && <div className={`callout callout-${runState.tone === "error" ? "error" : runState.tone === "success" ? "success" : "neutral"}`}><span>{runState.message}</span></div>}
                  {lastBatchResult?.failedRuns ? <div className="callout callout-error"><strong>Latest batch failures</strong><ul className="plain-list">{lastBatchResult.failures.slice(0, 3).map((failure: BatchRunFailure) => <li key={`${failure.agentPath}-${failure.taskKey}`}>{failure.taskKey}: {failure.message}</li>)}</ul></div> : null}
                </article>
              </aside>
            </div>

            <section className="results-grid">
              <article className="panel">
                <div className="section-header"><div><p className="eyebrow">Recent output</p><h2>Latest runs</h2></div><button type="button" className="text-link button-reset" onClick={() => setView("history")}>Full history →</button></div>
                <div className="run-list">{recentRuns.length > 0 ? recentRuns.map((run) => <RunCard key={run.runKey} run={run} busy={activeRunAction?.endsWith(run.runKey) ?? false} onOpen={() => openRun(run.runKey)} onDelete={() => deleteRunAction(run.runKey)} />) : <div className="empty-state">No runs yet. Launch the first batch from the launch panel.</div>}</div>
              </article>
              <article className="panel">
                <div className="section-header"><div><p className="eyebrow">Activity</p><h2>Latest log</h2></div></div>
                <pre className="log-panel">{snapshot.latestLogText || "No run log yet."}</pre>
              </article>
            </section>
          </section>
        )}

        {view === "history" && (
          <section className="view-stack">
            <article className="panel">
              <div className="section-header"><div><p className="eyebrow">Audit trail</p><h2>Run History</h2></div><button type="button" className="secondary-action" disabled={historyRuns.length < 2} onClick={() => { setCompareMode((current) => !current); setCompareKeys([]); }}>{compareMode ? "Exit compare" : "Compare runs"}</button></div>
              {compareMode && <div className="callout callout-neutral"><span>{compareKeys.length < 2 ? `Select ${2 - compareKeys.length} more run(s) to compare.` : "Comparing the two selected runs."}</span></div>}
              {compareMode && compareLeft && compareRight && (
                <div className="panel" style={{ marginTop: "0.9rem" }}>
                  <div className="compare-grid">
                    <span className="compare-row-label">Metric</span>
                    <span className="compare-head">{compareLeft.agentName}</span>
                    <span className="compare-head">{compareRight.agentName}</span>
                    {compareRows(compareLeft, compareRight).map((row) => (
                      <div key={row.label} style={{ display: "contents" }}>
                        <span className="compare-row-label">{row.label}</span>
                        <span className="compare-cell">{row.left}</span>
                        <span className={`compare-cell ${row.delta != null && row.delta > 0 ? "delta-pos" : row.delta != null && row.delta < 0 ? "delta-neg" : ""}`}>{row.right}{row.delta != null && row.delta !== 0 ? ` (${row.delta > 0 ? "+" : ""}${row.delta.toFixed(2)})` : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="run-list" style={{ marginTop: "1rem" }}>{historyRuns.length > 0 ? historyRuns.map((run) => <RunCard key={run.runKey} run={run} busy={activeRunAction?.endsWith(run.runKey) ?? false} onOpen={() => openRun(run.runKey)} onDelete={() => deleteRunAction(run.runKey)} compareMode={compareMode} comparePicked={compareKeys.includes(run.runKey)} onToggleCompare={() => toggleCompareKey(run.runKey)} />) : <div className="empty-state">Run history will appear here after the first execution.</div>}</div>
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

      {view === "lab" && (
        <div className="mobile-action-bar">
          <div className="mobile-runs"><strong>{totalRuns}</strong><span>runs queued</span></div>
          <button type="button" className="primary-action" disabled={workflowState === "blocked" || isRunningBatch} onClick={() => runBatchAction()}>Run</button>
        </div>
      )}

      {detail && <RunInspector detail={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}
