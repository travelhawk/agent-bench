async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
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
  return `
    <article class="run-card">
      <div class="flex items-center gap-4">
        <div class="grid h-14 w-14 place-content-center rounded-full bg-emerald-900/60 text-3xl font-bold text-emerald-300">${run.score.toFixed(1)}</div>
        <div>
          <h3 class="text-2xl font-bold">${run.agentName}</h3>
          <p class="text-sm text-slate-400">${run.runKey} • ${new Date(run.createdAt).toLocaleTimeString()}</p>
        </div>
      </div>
      <div class="text-right text-slate-300">
        <div>${(run.durationMs / 1000).toFixed(1)}s</div>
        <div>$${run.costUsd.toFixed(2)}</div>
      </div>
    </article>
  `;
}

function benchmarkButton(benchmark) {
  return `<button class="quick-btn"><span>${benchmark.title}</span><span>›</span></button>`;
}

async function loadDashboard() {
  const [summary, runs, benchmarks, logText] = await Promise.all([
    fetchJson("/api/summary"),
    fetchJson("/api/runs?limit=6"),
    fetchJson("/api/benchmarks"),
    fetch("/api/logs/latest").then((r) => r.text())
  ]);

  document.getElementById("stats-grid").innerHTML = [
    card("Total Runs", summary.totalRuns, "↻"),
    card("Avg. Score", summary.avgScore.toFixed(1), "📊"),
    card("Total Cost", `$${summary.totalCost.toFixed(2)}`, "⚡"),
    card("Active Benchmarks", summary.activeBenchmarks, "🗄")
  ].join("");

  document.getElementById("runs-list").innerHTML = runs.length
    ? runs.map(runCard).join("")
    : '<div class="run-card"><p class="text-slate-400">No runs available. Use `agent-bench run --agent ...` first.</p></div>';

  document.getElementById("benchmarks-list").innerHTML = benchmarks.map(benchmarkButton).join("");
  document.getElementById("log-panel").textContent = logText;
}

loadDashboard().catch((error) => {
  document.getElementById("log-panel").textContent = `Failed to load dashboard: ${error.message}`;
});