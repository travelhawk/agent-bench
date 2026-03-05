async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
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

function card(title, value, icon) {
  return `
    <article class="stat-card">
      <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1b2d57] text-xl">${icon}</div>
      <p class="text-xl text-slate-300">${title}</p>
      <p class="mt-2 text-5xl font-extrabold">${value}</p>
    </article>
  `;
}

function runCard(run) {
  const screenshotUrl = `/artifacts/${run.runKey}/screenshot.svg`;
  return `
    <article class="run-card">
      <div class="flex flex-wrap items-start gap-4">
        <div class="grid h-14 w-14 place-content-center rounded-full bg-emerald-900/60 text-3xl font-bold text-emerald-300">${run.score.toFixed(1)}</div>
        <div>
          <h3 class="text-2xl font-bold">${run.agentName}</h3>
          <p class="text-sm text-slate-400">${run.runKey} • ${new Date(run.createdAt).toLocaleString()}</p>
          <p class="text-xs text-slate-500">tests ${run.testsScore.toFixed(2)} • judge ${run.llmScore.toFixed(2)} • perf ${run.perfScore.toFixed(2)}</p>
        </div>
        <div class="ml-auto text-right text-slate-300">
          <div>${(run.durationMs / 1000).toFixed(1)}s</div>
          <div>$${run.costUsd.toFixed(2)}</div>
        </div>
      </div>
      <a href="${screenshotUrl}" target="_blank" rel="noreferrer">
        <img src="${screenshotUrl}" alt="Run screenshot ${run.runKey}" class="mt-3 h-36 w-full rounded-xl border border-slate-700 object-cover" />
      </a>
      <div class="mt-3 flex items-center gap-4">
        <button type="button" class="text-sm text-blue-300 open-run" data-run-key="${run.runKey}">Open Run</button>
        <button type="button" class="text-sm text-blue-300 view-run-result" data-run-key="${run.runKey}">View Result JSON</button>
      </div>
      <pre id="result-${run.runKey}" class="mt-2 hidden overflow-x-auto rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300"></pre>
    </article>
  `;
}

function historyCard(run) {
  return `
    <article class="run-card">
      <div class="flex items-center gap-4">
        <div class="grid h-14 w-14 place-content-center rounded-full bg-emerald-900/60 text-2xl font-bold text-emerald-300">${run.score.toFixed(1)}</div>
        <div class="flex-1">
          <h3 class="text-xl font-bold">${run.runKey}</h3>
          <p class="text-sm text-slate-400">${run.agentName} • ${run.suiteName} • ${new Date(run.createdAt).toLocaleString()}</p>
        </div>
        <button type="button" class="rounded border border-blue-700 px-3 py-1 text-xs text-blue-300 open-run" data-run-key="${run.runKey}">Open Run</button>
        <button type="button" class="rounded border border-red-700 px-3 py-1 text-xs text-red-300 delete-run" data-run-key="${run.runKey}">Delete</button>
      </div>
    </article>
  `;
}

function benchmarkButton(benchmark) {
  const taskButtons = benchmark.tasks.map((task) => `
    <button type="button" class="mt-2 w-full rounded border border-slate-700 px-3 py-2 text-left text-xs text-slate-200 task-select"
      data-benchmark="${benchmark.key}" data-task="${task.key}">
      ${task.title} (${task.key})
    </button>
  `).join("");
  return `
    <div class="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
      <button type="button" class="quick-btn suite-select" data-benchmark="${benchmark.key}">
        <span>${benchmark.title}</span><span>▶</span>
      </button>
      <p class="mt-2 text-xs text-slate-400">${benchmark.description}</p>
      ${taskButtons}
    </div>
  `;
}

function benchmarkTaskItem(benchmark) {
  return `
    <div class="rounded-lg border border-slate-700 bg-slate-900/30 p-3 space-y-2">
      <div class="text-sm font-semibold text-slate-200">${benchmark.title} <span class="text-slate-500">(${benchmark.key})</span></div>
      <div class="text-xs text-slate-400">${benchmark.description}</div>
      ${benchmark.tasks.map((task) => `
        <div class="rounded border border-slate-700 bg-slate-950/40 p-2">
          <div class="text-xs font-semibold text-slate-300">${task.title} (${task.key})</div>
          <div class="mt-1 text-xs text-slate-400"><strong>Task:</strong> ${task.description}</div>
          <div class="mt-1 text-xs text-slate-400"><strong>Expected:</strong> ${task.expectedOutcome}</div>
        </div>
      `).join("")}
    </div>
  `;
}

async function showRunResult(runKey) {
  const target = document.getElementById(`result-${runKey}`);
  target.classList.remove("hidden");
  target.textContent = "Loading result...";
  try {
    const data = await fetchJson(`/api/run/${runKey}/result`);
    target.textContent = JSON.stringify(data.summary ?? data.run, null, 2);
  } catch (error) {
    target.textContent = `Failed to load result: ${error.message}`;
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
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Total: ${(summary.scores?.total ?? data.run.score).toFixed(2)}</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Tests: ${(summary.scores?.tests ?? data.run.testsScore).toFixed(2)}</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Judge: ${(summary.scores?.judge ?? data.run.llmScore).toFixed(2)}</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Perf: ${(summary.scores?.performance ?? data.run.perfScore).toFixed(2)}</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Duration: ${(data.run.durationMs / 1000).toFixed(2)}s</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">LLM Latency: ${Number(summary.latencyMs ?? data.run.latencyMs)}ms</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Cost: $${Number(summary.costUsd ?? data.run.costUsd).toFixed(4)}</div>`,
      `<div class="rounded border border-slate-700 p-2 text-slate-300">Judge Mode: ${summary.judgeMode ?? "unknown"}</div>`
    ].join("");
    screenshot.src = data.screenshotUrl;
    screenshotLink.href = data.screenshotUrl;
  } catch (error) {
    title.textContent = `Failed to load run details: ${error.message}`;
  }
}

function attachRunInteractions() {
  document.querySelectorAll(".open-run").forEach((button) => {
    button.addEventListener("click", () => {
      const runKey = button.dataset.runKey || "";
      if (runKey) openRunDetails(runKey);
    });
  });
  document.querySelectorAll(".view-run-result").forEach((button) => {
    button.addEventListener("click", () => {
      showRunResult(button.dataset.runKey || "");
    });
  });
  document.querySelectorAll(".delete-run").forEach((button) => {
    button.addEventListener("click", async () => {
      const runKey = button.dataset.runKey || "";
      if (!runKey) return;
      const confirmed = window.confirm(`Delete run ${runKey}?`);
      if (!confirmed) return;
      try {
        await deleteJson(`/api/run/${runKey}`);
        await loadDashboard();
      } catch (error) {
        alert(`Delete failed: ${error.message}`);
      }
    });
  });
}

function attachBenchmarkInteractions() {
  document.querySelectorAll(".suite-select").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("benchmark-input").value = button.dataset.benchmark || "";
      document.getElementById("task-input").value = "";
      document.getElementById("run-form").requestSubmit();
    });
  });
  document.querySelectorAll(".task-select").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("benchmark-input").value = button.dataset.benchmark || "";
      document.getElementById("task-input").value = button.dataset.task || "";
      document.getElementById("run-form").requestSubmit();
    });
  });
}

function renderBenchmarks(benchmarks) {
  document.getElementById("benchmarks-list").innerHTML = benchmarks.map(benchmarkButton).join("");
  document.getElementById("tasks-list").innerHTML = benchmarks.map(benchmarkTaskItem).join("");
  attachBenchmarkInteractions();
}

function renderRuns(runs) {
  document.getElementById("runs-list").innerHTML = runs.length
    ? runs.map(runCard).join("")
    : '<div class="run-card"><p class="text-slate-400">No runs available yet. Start one from CLI or the Quick Start buttons.</p></div>';
  attachRunInteractions();
}

function renderHistory(runs) {
  document.getElementById("history-list").innerHTML = runs.length
    ? runs.map(historyCard).join("")
    : '<div class="run-card"><p class="text-slate-400">No run history available.</p></div>';
  attachRunInteractions();
}

function renderStats(summary) {
  document.getElementById("stats-grid").innerHTML = [
    card("Total Runs", summary.totalRuns, "↻"),
    card("Avg. Score", summary.avgScore.toFixed(1), "📊"),
    card("Total Cost", `$${summary.totalCost.toFixed(2)}`, "⚡"),
    card("Active Benchmarks", summary.activeBenchmarks, "🗄")
  ].join("");
}

async function loadDashboard() {
  const [summary, runs, benchmarks, logText] = await Promise.all([
    fetchJson("/api/summary"),
    fetchJson("/api/runs?limit=100"),
    fetchJson("/api/benchmarks"),
    fetch("/api/logs/latest").then((r) => r.text())
  ]);

  renderStats(summary);
  renderRuns(runs.slice(0, 10));
  renderHistory(runs);
  renderBenchmarks(benchmarks);
  document.getElementById("log-panel").textContent = logText;
}

async function submitRun(event) {
  event.preventDefault();
  const runButton = document.getElementById("run-button");
  const runStatus = document.getElementById("run-status");
  const benchmarkKey = document.getElementById("benchmark-input").value.trim() || "core-engineering";
  const taskKey = document.getElementById("task-input").value.trim();
  const agentPath = document.getElementById("agent-path-input").value.trim();
  const agentMarkdown = document.getElementById("agent-md-input").value.trim();
  const model = document.getElementById("model-input").value.trim();

  runButton.disabled = true;
  runStatus.textContent = "Running evaluation...";

  try {
    const payload = {
      benchmarkKey,
      taskKey: taskKey || undefined,
      agentPath: agentPath || undefined,
      agentMarkdown: agentMarkdown || undefined,
      model: model || undefined
    };
    const result = await postJson("/api/run", payload);
    runStatus.textContent = `Run ${result.run.runKey} completed with score ${result.run.score}.`;
    await loadDashboard();
  } catch (error) {
    runStatus.textContent = `Run failed: ${error.message}`;
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

document.getElementById("run-form").addEventListener("submit", submitRun);
document.getElementById("benchmark-form").addEventListener("submit", submitBenchmark);
document.getElementById("view-all-history").addEventListener("click", (event) => {
  event.preventDefault();
  setActiveView("history");
});

function setActiveView(view) {
  const dashboard = document.getElementById("dashboard-view");
  const history = document.getElementById("history-view");
  const benchmarks = document.getElementById("benchmarks-view");

  dashboard.classList.add("hidden");
  history.classList.add("hidden");
  benchmarks.classList.add("hidden");

  if (view === "history") history.classList.remove("hidden");
  else if (view === "benchmarks") benchmarks.classList.remove("hidden");
  else dashboard.classList.remove("hidden");

  document.querySelectorAll("[data-view]").forEach((nav) => {
    nav.classList.toggle("active", nav.dataset.view === view);
  });
}

document.querySelectorAll("[data-view]").forEach((nav) => {
  nav.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView(nav.dataset.view || "dashboard");
  });
});

loadDashboard().catch((error) => {
  document.getElementById("log-panel").textContent = `Failed to load dashboard: ${error.message}`;
});
