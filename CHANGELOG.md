# Changelog

## Unreleased

- Added `agent-bench compare-models --models a,b,c`: one command plans one setup per model, runs the batch against a constant agent and task, prints the ranked table with a winner per metric, and with `--format md|csv|json|html` (plus `--out`) writes the shareable report in the same step. Takes `--agent`, `--benchmark`, `--task`, `--judge-model`, `--no-judge`, and `--db`; refuses fewer than two distinct models
- Added `agent-bench doctor`: checks Node (`node:sqlite` needs 22.5+, stable in 24), that the database opens, the gateway key, benchmark suites, agents (and how many are actually executable), and the sandbox provider. Prints PASS / WARN / FAIL with the fix next to each problem and exits non-zero only on a FAIL, so a missing gateway key is a warning rather than a blocker
- **Separated the model under test from the judge model.** A runner-backed agent spends `--model` on its own work, so handing that same model to the grader would vary two things at once in a model-vs-model comparison. `resolveJudgeModelForRun` now resolves the judge from `--judge-model` / `AGENT_BENCH_JUDGE_MODEL` and only falls back to `model` for review-only agents, which have no model of their own. A batch uses one judge across every setup. Previously the runner was handed the *judge-resolved* model, so with `--model` unset it silently received `openai/gpt-4.1-mini`. `judgeModel` is threaded through `runSingle`, `runBatch`, `POST /api/run/batch`, and the run summary, which now records `model` and `judgeModel` separately
- Added a shipped `model-coder` agent (`examples/sample-workspace/agents/model-coder.md` + `run.mjs`): a model-agnostic single-shot coding runner that reads the task brief and workspace, asks `AGENT_BENCH_PROVIDER_MODEL` for a complete set of file edits, applies them, restores `tests/` so the verifier cannot be gamed, refuses writes that resolve outside the workspace, and self-reports token usage to `result/usage.json`. A model-vs-model comparison no longer requires writing a runner first
- An agent can now declare `Requires Network: yes` in its markdown. A runner that calls a model needs egress even when the task itself does not, so a sandboxed run satisfies both the task's and the agent's declaration instead of forcing every benchmark task to open the network
- `agent-bench init` now seeds a usable workspace instead of only creating the database: it installs the benchmark suites, the executable `model-coder` agent, and a `.env` from `.env.sample` when each is missing, then names the next command. Previously `init` left a workspace with nothing to run, and `doctor` would have told the user to run `init` again
- Added `--judge-model` to `agent-bench run`, and split the Test Lab's single model field into **Model(s) under test** and a separate **Judge model**, both persisted. The batch request carries `judgeModel`
- Fixed `node --test` verifiers reporting no test metrics. `parseNodeTestTapSummary` only matched TAP output (`# pass 2`), but `node --test` prints `ℹ pass 2` under its default reporter, so a sandboxed run's test counts were silently dropped and the outcome fell back to binary pass/fail. Both reporter shapes now parse. The existing runner tests only passed because they ran *inside* `node --test`, which made the nested runner emit TAP
- Fixed a setup labelled by its own model rendering the model twice (`anthropic/claude-opus-5 · anthropic/claude-opus-5`) in the terminal matrix, the Markdown and HTML exports, and the workbench comparison board. Added `setupModelSuffix` next to `setupDisplayName` so all five render sites share one rule
- Extracted the terminal comparison renderer into `src/core/matrix-print.ts`, so `matrix` and `compare-models` print the same table from the same code and the formatting is testable without a database
- Replaced the `better-sqlite3` native module with Node's built-in **`node:sqlite`**. `better-sqlite3` has to be compiled per Node ABI, so every Node upgrade broke the database with `ERR_DLOPEN_FAILED` until `pnpm rebuild better-sqlite3` succeeded — which itself needs a working node-gyp/MSBuild toolchain. `node:sqlite` ships with Node, needs no build step, and reads the same database files, so existing `~/.agent-bench/data.db` histories are untouched. Drops the `better-sqlite3` and `@types/better-sqlite3` dependencies and adds `engines.node >= 22.5.0`; CI now runs Node 24, where `node:sqlite` is stable
- Added comparison **export and sharing**: the Comparison tab can copy or download the current comparison as Markdown, CSV, JSON (`agent-bench.comparison/v1`), or a self-contained HTML report, and can copy a deep link (`?view=compare&benchmark=...`) for people who already run the workbench. A per-row **Share** checkbox narrows the export to a chosen subset of setups. Every export ranks all setups and names a winner per metric (score, quality, tests, speed, leanest tokens, cheapest). The HTML report embeds no scripts and makes no external requests, and all untrusted labels are escaped
- Added `agent-bench export` (`--format --benchmark --task --setups --limit --title --share-url --out`) and `GET /api/comparison/export`, plus `GET /api/comparison` for the raw matrix. Like the comparison itself, both render only from persisted SQLite rows, so sharing costs zero tokens
- A batch can now compare **more than two setups**: `/api/run/batch` accepts `setups: [{ agentPath, model, label, review }]`, so each agent carries its own review model instead of one model being pinned across the whole batch. Labels must be unique, identical agent+model entries collapse, and the previous `agents[] + model` form still works as the single-model shorthand. Capped at 12 setups (and the existing 48 runs) per launch
- The Test Lab's `Review model` field became `Review model(s)` — one model per line — and previews the resulting setups as chips before launch; the plan metric now reads `Setups × Tasks = Runs`
- `agent-bench compare` now takes two or more run keys (`compare <a> <b> <c>`) and reports each as a delta against the first, plus a winner line; `--left/--right` still works. Run History compares up to six runs side by side instead of exactly two
- Runs now persist their `setup_key`: the column existed and the runtime already carried a `setupSnapshot`, but the service never populated it, so every comparison had to re-derive the setup from the agent name and model and custom batch labels were lost. A custom label now shows up everywhere a setup is named: the Comparison leaderboard and heatmap, `agent-bench matrix`, and every export
- Fixed batch runs recording `agentVersion: "v1"` for every agent: the version probe used `/v\\d+/i` (a literal backslash followed by `d`) instead of `/v\d+/i`, so it never matched. The single-run path was already correct
- Failed batch jobs now persist their setup key, workflow path, and model id, so a failure shows up in the right comparison column instead of an unattributed row
- Added a **Comparison** view to the workbench: every agent × model setup side by side with score, quality, test pass counts, average duration, agent tokens, judge tokens, and cost as visual bars, plus a per-task score heatmap and a benchmark filter — all aggregated client-side from persisted runs, so browsing and re-rendering the comparison never spends tokens
- Added an `agent-bench matrix` CLI command that prints the same agent × model comparison (with ASCII score bars and per-task averages) from the local SQLite history
- Runs now persist their `benchmark_key`, `task_key`, `model_id`, `review_mode`, and `judge_total_tokens`; previously the model used for a run was dropped on insert, which made model-vs-model comparison impossible from history
- Added a zero-token review mode: the Test Lab's "Skip LLM judge" toggle, the CLI's `--no-judge` flag, and `AGENT_BENCH_REVIEW=off` all skip the LLM judge entirely (deterministic rules review, `review_mode = off`) even when a gateway key is configured — verifier outcome, tests, diff, duration, and agent-usage metrics are unaffected
- The comparison surfaces how many reviews were served for free (judge cache hits, rules/off reviews) versus fresh gateway calls, so token spend per comparison is visible
- Sandboxed runs that produce an `index.html` now automatically capture a full-page screenshot (`page.png`) and a scroll-through video (`page.webm`) via local Playwright rendering — zero model tokens; best-effort, so a missing browser never fails a run. Opt out with `AGENT_BENCH_VISUALS=false` or keep screenshots only with `AGENT_BENCH_VISUAL_VIDEO=false`
- Added a **Visual comparison** gallery to the Comparison tab: per task, the latest visual run of every agent × model setup side by side (screenshot thumbnail, click-to-play video), so different workflows for the same landing page or web app can be compared visually; the run inspector shows the same media under "Produced page"
- Persisted `screenshot_file`/`video_file` per run and extended the artifact route to serve `image/png` and `video/webm`; the multimodal screenshot judge now reuses the captured screenshot instead of rendering twice

- Added an opt-in `craft` score profile plus an `AGENT_BENCH_SCORE_PROFILE` override that lets a run weight the judge's code-quality score and the workflow/process score into the total (outcome .45 / process .15 / review .15 / quality .15 / efficiency .1). Previously `qualityScore` was stored but never influenced the score, and the process score was only used by the `trace` profile; the default `hybrid` weighting is unchanged so historical runs stay comparable
- Based the efficiency score on the agent-under-test's self-reported cost when it is available, instead of the judge/grader cost, so efficiency reflects the workflow being benchmarked rather than harness overhead (falls back to judge cost when the agent reports no usage)
- Added an opt-in judge panel (`AGENT_BENCH_JUDGE_SAMPLES`>1): several independent judge passes with distinct reviewer lenses, aggregated by median score/qualityScore to reduce single-judge bias/variance; default 1 keeps the previous single-pass behavior and the cache is keyed per judge mode
- Added an opt-in multimodal screenshot judge (`AGENT_BENCH_JUDGE_SCREENSHOT`): renders a visual task's `index.html` with Playwright and attaches it as image evidence so the judge can rate visual quality (guarded/dynamic import; falls back to text-only if unavailable). Optional `AGENT_BENCH_CHROMIUM_PATH` to pin the browser binary
- Generalized graded scoring to custom (non-`node --test`) verifiers: a verify script may print `AGENT_BENCH_CHECKS: <passed>/<total>` and the outcome is graded by that ratio. Rewrote the `security-audit-report` and `landing-page-refresh` verifiers to emit per-check counts, so those tasks now discriminate partially-correct work instead of scoring binary
- Fixed a corrupted `release-notes-cli` fixture: `tests/cli.test.js` carried a stray patch artifact (`*** Add File: ...`) that made the file unparseable, so that task's verifier could never pass for any agent
- Graded the sandbox outcome score by verifier test-pass ratio (partial credit) instead of binary pass/fail, so two partially-passing workflows are ranked by how much actually works; the deterministic objective pass/fail stays strict (all-or-nothing)
- Sharpened the LLM-judge contract to ground `score` in the task's success checks / failure modes and the observed verifier test-pass count, and to rate `qualityScore` from the workspace diff; the parsed test metrics and diff summary are now included in the judge's evidence context
- Added a regression test asserting graded partial-pass outcome (1/3 tests → outcome ≈ 6.3, objectivePass false)
- Added `test-results/` and `playwright-report/` to `.gitignore`

- Added lines-of-code diff metrics per run (files changed, insertions, deletions) via a host-side git baseline commit and post-run diff, exposed in the CLI, summary artifacts, and workbench UI
- Added structured test pass/fail counts for `node --test`-based verify commands, parsed from TAP summary lines, with an explicit "unavailable" state for tasks using custom verify scripts
- Added an independent judge-scored code-quality metric (`qualityScore`), separate from the existing task-fit review score, backed by real diff evidence in the judge prompt and a low-confidence rules-based fallback when no gateway key is configured
- Added an opt-in agent-under-test token usage/cost self-report contract (`result/usage.json`) so runners can report their own LLM token usage and cost, tracked separately from judge cost
- Removed the dead legacy Express-era static UI assets (`src/ui/public`, `src/ui/styles`) and the now-unused Tailwind config/dependency, since the Next.js app is the only live UI surface
- Replaced the default seeded suites with a faster benchmark set built around `repo-maintenance`, `product-builds`, and `creative-frontend`
- Added executable fixtures for `security-audit-report`, `release-notes-cli`, `simple-feedback-web-app`, and `landing-page-refresh`
- Restored benchmark metadata fields for reliability, time budget, cost budget, and default trials
- Added strict sandbox-provider enforcement support and clarified that `process` mode is a fresh workspace, not a dedicated sandbox
- Fixed GitHub Actions pnpm setup to defer to `package.json#packageManager`, avoiding cross-platform CI failures from mismatched pinned versions
- Added managed AGENTS.md bundles with optional uploaded `.agents` files plus `skills.sh` discovery and installation for bundle-based agent comparisons
- Integrated project-scoped `skills.sh` management in the workbench, including search, install, update, and removal flows plus shared `./.agents` context for flat-agent review and sandbox runs
- Fixed Windows `skills.sh` execution inside the Node server by routing `npx` calls through `cmd.exe` instead of direct `npx.cmd` spawning
- Fixed legacy SQLite schema startup by migrating new experiment/run columns before creating indexes that depend on them
- Restored environment-based provider configuration via `AI_GATEWAY_API_KEY` and `AGENT_BENCH_JUDGE_MODEL` fallbacks
- Added a guided local runner flow in the Next.js workbench with explicit readiness states, blocker callouts, and next-step guidance
- Added rerun-failed-only support plus persisted failed run history rows with generated failure summaries and logs
- Replaced the old score presentation with evaluator-aware outcome/process/review/efficiency profiles and per-run confidence labels
- Added objective check summaries, evidence highlights, and recommended next actions to run detail payloads and artifacts
- Extended benchmark tasks with structured sections for why the task matters, fixed inputs, deliverable format, success checks, and failure modes
- Upgraded the seeded benchmark tasks so the shipped suites are more specific and benchmark-grade by default
- Hardened Docker sandbox defaults on low-core hosts by clamping the CPU limit to a safe local value
- Added regression coverage for persisted failed runs, richer benchmark task round-trips, and Windows-safe sandboxed fixture patching
- Hardened Windows execution by switching command discovery to `where`, keeping Docker shell execution POSIX inside Linux containers, and removing shell-dependent test invocation paths
- Hardened sandbox auto-selection so Linux and Windows hosts only auto-pick Docker when the daemon is ready and the configured image already exists locally
- Added a GitHub Actions CI matrix for `ubuntu-latest`, `macos-latest`, and `windows-latest`
- Added a Docker sandbox provider so non-macOS hosts can use a stronger containerized execution path when Docker is available
- Added executable `browser-support-escalation` and `computer-use-incident-drill` fixtures with verifier commands under `interaction-surfaces`
- Added sample runnable agents and runner scripts for browser and computer-use tasks under `examples/sample-workspace`
- Added per-task sandbox provider overrides so browser fixtures can opt into host-process execution when a real browser is required
- Added the repo-local `playwright` dev dependency for browser fixture runners
- Added real fixture-backed sandbox execution for tasks with `## Sandbox` metadata and agents that declare a `Runner:` command
- Added a new macOS sandbox provider based on `sandbox-exec` with write restrictions to the task workspace and run artifacts
- Scrubbed runner environments by default and exposed explicit runtime vars like `AGENT_BENCH_WORKSPACE`, `AGENT_BENCH_PROVIDER_API_KEY`, and `AGENT_BENCH_PROVIDER_MODEL`
- Added regression coverage for relative runner commands and seatbelt-blocked escape attempts outside the task workspace
- Replaced hash-based fallback scoring with deterministic rules-based review tied to real agent/task signals
- Replaced pseudo-screenshot artifacts with generated run reports and added legacy fallback for older run artifacts
- Moved repository example agents out of `./agents` into `./examples/sample-workspace` so fresh checkouts no longer auto-load sample agents
- Added benchmark metadata for resolution, interaction surface, evaluator mode, difficulty, tags, and environment constraints
- Added a second seeded suite for higher-resolution agentic workflow and superagent-style tests
- Added a third seeded suite for browser, computer-use, and tool-routing benchmark surfaces
- Hardened batch execution with input bounds, agent-path validation, deduplication, and a maximum batch size
- Hardened JSON API parsing and made batch execution resilient to partial per-run failures
- Added parser and validation tests for metadata round-trips and batch hardening behavior
- Added a research brief documenting current benchmark patterns across OpenAI Evals, LangSmith, Braintrust, SWE-bench, WebArena, OSWorld, GAIA, tau-bench, and TheAgentCompany

## 0.3.0 - 2026-03-06

- Migrated the workbench into a Next.js full-stack app with App Router pages and API routes
- Replaced the old static UI shell with a server-backed Test Lab, Run History, and Benchmark Library experience
- Added full-stack workbench services for snapshot loading, batch execution, run details, artifact streaming, and benchmark authoring
- Removed the runtime dependency on a dist-only evaluator subprocess path so batch runs now work inside the Next server
- Standardized the repo on `pnpm`, removed `package-lock.json`, and updated validation/docs for the full-stack release

## 0.2.1 - 2026-03-05

- Stopped tracking the repository sample `agents/` workspace so local agent definitions remain gitignored by default
- Kept the workbench, research, architecture, and validation updates from `0.2.0` as the functional baseline

## 0.2.0 - 2026-03-05

- Reframed the UI into a workbench-style Test Lab with provider setup, agent queueing, benchmark playlists, and batch launch planning
- Added agent discovery and manual inspection APIs for markdown definitions under `./agents`
- Added multi-agent batch execution with `single-task` and `benchmark-cycle` modes
- Added research and architecture docs for the next-stage product direction
- Added tests for agent discovery and updated `.gitignore` so local `agents/` work stays out of commits by default

## 0.1.0 - 2026-03-05

- Implemented CLI commands: `init`, `run`, `history`, `compare`, `ui`
- Added SQLite schema, benchmark seeding, run persistence, and dashboard summaries
- Implemented weighted scoring (60/30/10) and regression alerting
- Added artifact/log snapshot generation under `.agent-bench/artifacts`
- Built dashboard UI (sidebar, stats cards, recent runs, quick start, live logs panel)
- Added minimal scoring tests and validation workflow documentation
