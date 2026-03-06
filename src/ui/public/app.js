const STORAGE_KEYS = {
  selectedAgents: "agent-bench:selected-agents",
  benchmarkKey: "agent-bench:benchmark-key",
  taskKey: "agent-bench:task-key",
  runMode: "agent-bench:run-mode",
  model: "agent-bench:model",
  providerApiKey: "agent-bench:provider-api-key"
};

const state = {
  summary: null,
  runs: [],
  benchmarks: [],
  agents: [],
  manualAgents: [],
  batchResults: [],
  latestLogText: "",
  selectedAgentPaths: new Set(loadArray(STORAGE_KEYS.selectedAgents)),
  config: {
    benchmarkKey: localStorage.getItem(STORAGE_KEYS.benchmarkKey) || "",
    taskKey: localStorage.getItem(STORAGE_KEYS.taskKey) || "",
    runMode: localStorage.getItem(STORAGE_KEYS.runMode) || "benchmark-cycle",
    model: localStorage.getItem(STORAGE_KEYS.model) || "",
    providerApiKey: sessionStorage.getItem(STORAGE_KEYS.providerApiKey) || ""
  }
};

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeData(value) {
  return encodeURIComponent(String(value));
}

function persistConfig() {
  localStorage.setItem(STORAGE_KEYS.benchmarkKey, state.config.benchmarkKey);
  localStorage.setItem(STORAGE_KEYS.taskKey, state.config.taskKey);
  localStorage.setItem(STORAGE_KEYS.runMode, state.config.runMode);
  localStorage.setItem(STORAGE_KEYS.model, state.config.model);
  sessionStorage.setItem(STORAGE_KEYS.providerApiKey, state.config.providerApiKey);
}

function persistSelectedAgents() {
  localStorage.setItem(STORAGE_KEYS.selectedAgents, JSON.stringify([...state.selectedAgentPaths]));
}

function dedupeAgents(agents) {
  const map = new Map();
  agents.forEach((agent) => {
    map.set(agent.path, agent);
  });
  return [...map.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function mergeAgents(discovered) {
  state.agents = dedupeAgents([...discovered, ...state.manualAgents]);
  const knownPaths = new Set(state.agents.map((agent) => agent.path));
  state.selectedAgentPaths.forEach((path) => {
    if (!knownPaths.has(path)) {
      state.selectedAgentPaths.delete(path);
    }
  });
  if (state.selectedAgentPaths.size === 0 && state.agents[0]) {
    state.selectedAgentPaths.add(state.agents[0].path);
  }
  persistSelectedAgents();
}

function getSelectedBenchmark() {
  return state.benchmarks.find((benchmark) => benchmark.key === state.config.benchmarkKey) || state.benchmarks[0] || null;
}

function getTaskOptions() {
  return getSelectedBenchmark()?.tasks || [];
}

function ensureBenchmarkSelection() {
  if (!state.benchmarks.length) return;

  const selectedBenchmark = getSelectedBenchmark();
  if (!selectedBenchmark) return;

  if (state.config.benchmarkKey !== selectedBenchmark.key) {
    state.config.benchmarkKey = selectedBenchmark.key;
  }

  const tasks = selectedBenchmark.tasks;
  const taskExists = tasks.some((task) => task.key === state.config.taskKey);
  if (!taskExists) {
    state.config.taskKey = tasks[0]?.key || "";
  }

  persistConfig();
}

function getPlannedTasks() {
  const benchmark = getSelectedBenchmark();
  if (!benchmark) return [];

  if (state.config.runMode === "single-task") {
    return benchmark.tasks.filter((task) => task.key === state.config.taskKey);
  }

  return benchmark.tasks;
}

function getSelectedAgents() {
  return state.agents.filter((agent) => state.selectedAgentPaths.has(agent.path));
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data;
}

async function deleteJson(url) {
  const res = await fetch(url, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }
  return data;
}

function statCard(label, value, tone) {
  return `
    <article class="stat-card stat-card-${tone}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}</strong>
    </article>
  `;
}

function agentCard(agent) {
  const selected = state.selectedAgentPaths.has(agent.path);
  return `
    <button type="button" class="agent-card ${selected ? "selected" : ""}" data-agent-path="${encodeData(agent.path)}">
      <div class="agent-card-head">
        <div>
          <div class="agent-title">${escapeHtml(agent.name)}</div>
          <div class="agent-summary">${escapeHtml(agent.summary)}</div>
        </div>
        <span class="status-chip ${selected ? "status-chip-active" : ""}">${selected ? "Loaded" : "Ready"}</span>
      </div>
      <div class="agent-meta">
        <span>${escapeHtml(agent.path)}</span>
        <span>${agent.source === "manual" ? "Added manually" : "Discovered"}</span>
      </div>
    </button>
  `;
}

function suitePill(benchmark) {
  const active = benchmark.key === state.config.benchmarkKey;
  return `
    <button type="button" class="suite-pill ${active ? "active" : ""}" data-benchmark-key="${escapeHtml(benchmark.key)}">
      <span>${escapeHtml(benchmark.title)}</span>
      <span>${benchmark.tasks.length} tasks</span>
    </button>
  `;
}

function playlistCard(task) {
  const selected = state.config.runMode === "single-task"
    ? task.key === state.config.taskKey
    : true;

  return `
    <button type="button" class="playlist-card ${selected ? "active" : ""}" data-task-key="${escapeHtml(task.key)}">
      <div class="playlist-card-head">
        <strong>${escapeHtml(task.title)}</strong>
        <span class="status-chip ${selected ? "status-chip-active" : ""}">${selected ? "Queued" : "Idle"}</span>
      </div>
      <p>${escapeHtml(task.description)}</p>
      <div class="playlist-outcome">${escapeHtml(task.expectedOutcome)}</div>
    </button>
  `;
}

function runCard(run, extraBadge) {
  const screenshotUrl = `/artifacts/${run.runKey}/screenshot.svg`;
  return `
    <article class="run-card">
      <div class="run-card-top">
        <div class="score-pill">${run.score.toFixed(1)}</div>
        <div class="run-copy">
          <h3>${escapeHtml(run.agentName)}</h3>
          <p>${escapeHtml(run.suiteName)}</p>
          <p>${escapeHtml(run.runKey)} • ${escapeHtml(formatDate(run.createdAt))}</p>
        </div>
        <div class="run-metrics">
          <span>${(run.durationMs / 1000).toFixed(1)}s</span>
          <span>${formatMoney(run.costUsd)}</span>
          ${extraBadge || ""}
        </div>
      </div>
      <div class="metric-strip">
        <span>Tests ${run.testsScore.toFixed(2)}</span>
        <span>Judge ${run.llmScore.toFixed(2)}</span>
        <span>Perf ${run.perfScore.toFixed(2)}</span>
      </div>
      <a href="${screenshotUrl}" target="_blank" rel="noreferrer">
        <img src="${screenshotUrl}" alt="Run screenshot ${escapeHtml(run.runKey)}" class="run-image" />
      </a>
      <div class="action-row">
        <button type="button" class="text-link open-run" data-run-key="${escapeHtml(run.runKey)}">Open</button>
        <button type="button" class="text-link view-run-result" data-run-key="${escapeHtml(run.runKey)}">Result JSON</button>
        <button type="button" class="text-link delete-run" data-run-key="${escapeHtml(run.runKey)}">Delete</button>
      </div>
      <pre data-result-run-key="${escapeHtml(run.runKey)}" class="result-box hidden"></pre>
    </article>
  `;
}

function batchResultCard(result) {
  const badge = result.regressed
    ? '<span class="status-chip status-chip-warn">Regression</span>'
    : '<span class="status-chip status-chip-good">Checked</span>';
  return runCard(result.run, badge);
}

function benchmarkTaskItem(benchmark) {
  return `
    <article class="library-card">
      <div class="library-header">
        <div>
          <h3>${escapeHtml(benchmark.title)}</h3>
          <p>${escapeHtml(benchmark.key)}</p>
        </div>
        <span class="status-chip">${benchmark.tasks.length} tasks</span>
      </div>
      <p class="library-copy">${escapeHtml(benchmark.description)}</p>
      <div class="library-stack">
        ${benchmark.tasks.map((task) => `
          <div class="library-task">
            <strong>${escapeHtml(task.title)} (${escapeHtml(task.key)})</strong>
            <p>${escapeHtml(task.description)}</p>
            <span>${escapeHtml(task.expectedOutcome)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderStats() {
  const summary = state.summary || {
    totalRuns: 0,
    avgScore: 0,
    totalCost: 0,
    activeBenchmarks: 0,
    availableAgents: 0
  };

  document.getElementById("stats-grid").innerHTML = [
    statCard("Total runs", String(summary.totalRuns), "blue"),
    statCard("Average score", Number(summary.avgScore || 0).toFixed(1), "green"),
    statCard("Total cost", formatMoney(summary.totalCost), "amber"),
    statCard("Available agents", String(summary.availableAgents || 0), "rose")
  ].join("");
}

function renderControls() {
  const benchmarkInput = document.getElementById("benchmark-input");
  const taskInput = document.getElementById("task-input");
  const runModeInput = document.getElementById("run-mode-input");
  const modelInput = document.getElementById("model-input");
  const apiKeyInput = document.getElementById("provider-api-key-input");

  benchmarkInput.innerHTML = state.benchmarks.map((benchmark) => `
    <option value="${escapeHtml(benchmark.key)}">${escapeHtml(benchmark.title)}</option>
  `).join("");

  const tasks = getTaskOptions();
  taskInput.innerHTML = tasks.map((task) => `
    <option value="${escapeHtml(task.key)}">${escapeHtml(task.title)}</option>
  `).join("");

  benchmarkInput.value = state.config.benchmarkKey;
  taskInput.value = state.config.taskKey;
  runModeInput.value = state.config.runMode;
  taskInput.disabled = state.config.runMode !== "single-task";
  modelInput.value = state.config.model;
  apiKeyInput.value = state.config.providerApiKey;
}

function renderAgents() {
  const selectedAgents = getSelectedAgents();
  document.getElementById("selected-agents-summary").innerHTML = `
    <strong>${selectedAgents.length}</strong> agent${selectedAgents.length === 1 ? "" : "s"} selected
    <span>from ${state.agents.length} discovered definitions</span>
  `;

  document.getElementById("agents-list").innerHTML = state.agents.length
    ? state.agents.map(agentCard).join("")
    : '<div class="empty-state">No agent markdown files found under <code>./agents</code> yet.</div>';
}

function renderPlaylist() {
  const benchmark = getSelectedBenchmark();
  const plannedTasks = getPlannedTasks();

  document.getElementById("suite-pills").innerHTML = state.benchmarks.map(suitePill).join("");
  document.getElementById("playlist-summary").innerHTML = benchmark
    ? `<strong>${escapeHtml(benchmark.title)}</strong><span>${escapeHtml(benchmark.description)}</span>`
    : "No benchmark loaded.";

  document.getElementById("playlist-list").innerHTML = plannedTasks.length
    ? plannedTasks.map(playlistCard).join("")
    : '<div class="empty-state">Select a benchmark challenge to build a playlist.</div>';
}

function renderRunPlan() {
  const selectedAgents = getSelectedAgents();
  const plannedTasks = getPlannedTasks();
  const totalRuns = selectedAgents.length * plannedTasks.length;
  const runButton = document.getElementById("run-button");

  document.getElementById("run-plan").innerHTML = `
    <div class="plan-metric">
      <strong>${selectedAgents.length}</strong>
      <span>Agents loaded</span>
    </div>
    <div class="plan-metric">
      <strong>${plannedTasks.length}</strong>
      <span>Challenges queued</span>
    </div>
    <div class="plan-metric">
      <strong>${totalRuns}</strong>
      <span>Runs to execute</span>
    </div>
    <div class="plan-stack">
      <div>${selectedAgents.map((agent) => `<span class="mini-chip">${escapeHtml(agent.name)}</span>`).join("") || "<span class=\"mini-chip\">Select an agent</span>"}</div>
      <div>${plannedTasks.map((task) => `<span class="mini-chip">${escapeHtml(task.title)}</span>`).join("") || "<span class=\"mini-chip\">Select a task</span>"}</div>
    </div>
  `;

  runButton.disabled = totalRuns === 0 || (state.config.runMode === "single-task" && !state.config.taskKey);
}

function renderRuns() {
  document.getElementById("runs-list").innerHTML = state.runs.length
    ? state.runs.slice(0, 8).map((run) => runCard(run, "")).join("")
    : '<div class="empty-state">No runs yet. Load an agent and launch the first batch.</div>';
}

function renderHistory() {
  document.getElementById("history-list").innerHTML = state.runs.length
    ? state.runs.map((run) => runCard(run, "")).join("")
    : '<div class="empty-state">Run history will appear here after the first execution.</div>';
}

function renderBatchResults() {
  document.getElementById("batch-results").innerHTML = state.batchResults.length
    ? state.batchResults.map(batchResultCard).join("")
    : '<div class="empty-state">Batch results show up here immediately after a launch.</div>';
}

function renderBenchmarkLibrary() {
  document.getElementById("tasks-list").innerHTML = state.benchmarks.length
    ? state.benchmarks.map(benchmarkTaskItem).join("")
    : '<div class="empty-state">No benchmarks are available yet.</div>';
}

function renderLogPanel() {
  document.getElementById("log-panel").textContent = state.latestLogText || "No runs yet.";
}

function renderAll() {
  renderStats();
  renderControls();
  renderAgents();
  renderPlaylist();
  renderRunPlan();
  renderRuns();
  renderHistory();
  renderBatchResults();
  renderBenchmarkLibrary();
  renderLogPanel();
}

async function showRunResult(runKey) {
  const targets = [...document.querySelectorAll(`[data-result-run-key="${CSS.escape(runKey)}"]`)];
  if (!targets.length) return;

  targets.forEach((target) => {
    target.classList.remove("hidden");
    target.textContent = "Loading result...";
  });

  try {
    const data = await fetchJson(`/api/run/${runKey}/result`);
    const payload = JSON.stringify(data.summary || data.run, null, 2);
    targets.forEach((target) => {
      target.textContent = payload;
    });
  } catch (error) {
    targets.forEach((target) => {
      target.textContent = `Failed to load result: ${error.message}`;
    });
  }
}

async function openRunDetails(runKey) {
  const empty = document.getElementById("run-detail-empty");
  const content = document.getElementById("run-detail-content");
  const title = document.getElementById("run-detail-title");
  const matrix = document.getElementById("run-detail-matrix");
  const screenshot = document.getElementById("run-detail-screenshot");
  const screenshotLink = document.getElementById("run-detail-screenshot-link");

  empty.classList.add("hidden");
  content.classList.remove("hidden");
  title.textContent = "Loading run details...";
  matrix.innerHTML = "";

  try {
    const data = await fetchJson(`/api/run/${runKey}/result`);
    const summary = data.summary || {};
    title.textContent = `${data.run.runKey} • ${data.run.agentName} • ${data.run.suiteName}`;
    matrix.innerHTML = [
      `Total <strong>${(summary.scores?.total ?? data.run.score).toFixed(2)}</strong>`,
      `Tests <strong>${(summary.scores?.tests ?? data.run.testsScore).toFixed(2)}</strong>`,
      `Judge <strong>${(summary.scores?.judge ?? data.run.llmScore).toFixed(2)}</strong>`,
      `Performance <strong>${(summary.scores?.performance ?? data.run.perfScore).toFixed(2)}</strong>`,
      `Duration <strong>${(data.run.durationMs / 1000).toFixed(2)}s</strong>`,
      `Latency <strong>${Number(summary.latencyMs ?? data.run.latencyMs)}ms</strong>`,
      `Cost <strong>${Number(summary.costUsd ?? data.run.costUsd).toFixed(4)}</strong>`,
      `Judge mode <strong>${escapeHtml(summary.judgeMode || "unknown")}</strong>`
    ].map((entry) => `<div class="detail-cell">${entry}</div>`).join("");
    screenshot.src = data.screenshotUrl;
    screenshotLink.href = data.screenshotUrl;
  } catch (error) {
    title.textContent = `Failed to load run details: ${error.message}`;
  }
}

async function loadDashboard() {
  const [summary, runs, benchmarks, agentsResponse, logText] = await Promise.all([
    fetchJson("/api/summary"),
    fetchJson("/api/runs?limit=100"),
    fetchJson("/api/benchmarks"),
    fetchJson("/api/agents"),
    fetch("/api/logs/latest").then((res) => res.text())
  ]);

  state.summary = summary;
  state.runs = runs;
  state.benchmarks = benchmarks;
  state.latestLogText = logText;
  mergeAgents(Array.isArray(agentsResponse.agents) ? agentsResponse.agents : []);
  ensureBenchmarkSelection();
  renderAll();
}

async function submitManualAgent(event) {
  event.preventDefault();
  const input = document.getElementById("manual-agent-path-input");
  const status = document.getElementById("manual-agent-status");
  const rawPath = input.value.trim();

  if (!rawPath) {
    status.textContent = "Enter a path inside ./agents first.";
    return;
  }

  status.textContent = "Inspecting agent path...";

  try {
    const data = await postJson("/api/agents/inspect", { agentPath: rawPath });
    state.manualAgents = dedupeAgents([...state.manualAgents, data.agent]);
    mergeAgents(state.agents);
    state.selectedAgentPaths.add(data.agent.path);
    persistSelectedAgents();
    input.value = "";
    status.textContent = `Loaded ${data.agent.name}.`;
    renderAll();
  } catch (error) {
    status.textContent = `Inspect failed: ${error.message}`;
  }
}

async function submitRunBatch() {
  const selectedAgents = getSelectedAgents();
  const plannedTasks = getPlannedTasks();
  const runStatus = document.getElementById("run-status");
  const runButton = document.getElementById("run-button");

  if (selectedAgents.length === 0) {
    runStatus.textContent = "Select at least one agent before starting.";
    return;
  }
  if (plannedTasks.length === 0) {
    runStatus.textContent = "Pick a benchmark challenge before starting.";
    return;
  }

  runButton.disabled = true;
  runStatus.textContent = `Launching ${selectedAgents.length * plannedTasks.length} run(s)...`;

  try {
    const payload = {
      agents: selectedAgents.map((agent) => agent.path),
      benchmarkKey: state.config.benchmarkKey,
      taskKey: state.config.runMode === "single-task" ? state.config.taskKey : undefined,
      runMode: state.config.runMode,
      model: state.config.model || undefined,
      providerApiKey: state.config.providerApiKey || undefined
    };
    const result = await postJson("/api/run/batch", payload);
    state.batchResults = result.runs || [];
    runStatus.textContent = result.failedRuns > 0
      ? `Completed ${result.completedRuns}/${result.queueSize} run(s). ${result.failedRuns} failed.`
      : `Completed ${result.queueSize} run(s) across ${selectedAgents.length} agent(s).`;
    await loadDashboard();
    renderBatchResults();
  } catch (error) {
    runStatus.textContent = `Batch failed: ${error.message}`;
  } finally {
    runButton.disabled = false;
  }
}

async function submitBenchmark(event) {
  event.preventDefault();
  const button = document.getElementById("benchmark-create-button");
  const status = document.getElementById("benchmark-status");
  const key = document.getElementById("benchmark-key-input").value.trim();
  const title = document.getElementById("benchmark-title-input").value.trim();
  const description = document.getElementById("benchmark-description-input").value.trim();
  const expectedOutcome = document.getElementById("benchmark-outcome-input").value.trim();
  const type = document.getElementById("benchmark-type-input").value;
  const benchmarkKey = document.getElementById("benchmark-parent-input").value.trim();

  button.disabled = true;
  status.textContent = "Creating benchmark...";

  try {
    await postJson("/api/benchmarks", { type, benchmarkKey, key, title, description, expectedOutcome });
    status.textContent = "Benchmark created.";
    document.getElementById("benchmark-form").reset();
    await loadDashboard();
  } catch (error) {
    status.textContent = `Create failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function setActiveView(view) {
  ["lab", "history", "benchmarks"].forEach((key) => {
    const section = document.getElementById(`${key}-view`);
    const nav = document.querySelector(`[data-view="${key}"]`);
    const active = key === view;
    section.classList.toggle("hidden", !active);
    nav.classList.toggle("active", active);
  });
}

function handleGlobalClick(event) {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.matches("[data-agent-path]")) {
    const agentPath = decodeURIComponent(target.dataset.agentPath || "");
    if (!agentPath) return;
    if (state.selectedAgentPaths.has(agentPath)) state.selectedAgentPaths.delete(agentPath);
    else state.selectedAgentPaths.add(agentPath);
    persistSelectedAgents();
    renderAgents();
    renderRunPlan();
    return;
  }

  if (target.matches("[data-benchmark-key]")) {
    state.config.benchmarkKey = target.dataset.benchmarkKey || state.config.benchmarkKey;
    ensureBenchmarkSelection();
    persistConfig();
    renderAll();
    return;
  }

  if (target.matches("[data-task-key]")) {
    state.config.runMode = "single-task";
    state.config.taskKey = target.dataset.taskKey || state.config.taskKey;
    persistConfig();
    renderAll();
    return;
  }

  if (target.classList.contains("open-run")) {
    openRunDetails(target.dataset.runKey || "");
    return;
  }

  if (target.classList.contains("view-run-result")) {
    showRunResult(target.dataset.runKey || "");
    return;
  }

  if (target.classList.contains("delete-run")) {
    const runKey = target.dataset.runKey || "";
    if (!runKey) return;
    if (!window.confirm(`Delete run ${runKey}?`)) return;

    deleteJson(`/api/run/${runKey}`)
      .then(() => loadDashboard())
      .catch((error) => {
        window.alert(`Delete failed: ${error.message}`);
      });
    return;
  }

  if (target.matches("[data-view]")) {
    event.preventDefault();
    setActiveView(target.dataset.view || "lab");
    return;
  }

  if (target.id === "view-all-history") {
    event.preventDefault();
    setActiveView("history");
  }
}

function bindControls() {
  document.getElementById("provider-api-key-input").addEventListener("input", (event) => {
    state.config.providerApiKey = event.target.value.trim();
    persistConfig();
  });

  document.getElementById("model-input").addEventListener("input", (event) => {
    state.config.model = event.target.value.trim();
    persistConfig();
  });

  document.getElementById("benchmark-input").addEventListener("change", (event) => {
    state.config.benchmarkKey = event.target.value;
    ensureBenchmarkSelection();
    persistConfig();
    renderAll();
  });

  document.getElementById("run-mode-input").addEventListener("change", (event) => {
    state.config.runMode = event.target.value;
    ensureBenchmarkSelection();
    persistConfig();
    renderAll();
  });

  document.getElementById("task-input").addEventListener("change", (event) => {
    state.config.taskKey = event.target.value;
    persistConfig();
    renderAll();
  });

  document.getElementById("manual-agent-form").addEventListener("submit", submitManualAgent);
  document.getElementById("benchmark-form").addEventListener("submit", submitBenchmark);
  document.getElementById("run-button").addEventListener("click", submitRunBatch);
  document.body.addEventListener("click", handleGlobalClick);
}

bindControls();
loadDashboard().catch((error) => {
  document.getElementById("log-panel").textContent = `Failed to load dashboard: ${error.message}`;
});
