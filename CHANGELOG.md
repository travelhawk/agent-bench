# Changelog

## Unreleased

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
