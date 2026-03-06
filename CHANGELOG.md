# Changelog

## Unreleased

- Fixed CLI test execution to use Node test discovery (`node --test dist/tests`) and updated fixture verify commands to avoid shell-specific globs
- Added a Playwright E2E suite for core workbench UI flows and wired it into GitHub CI on Ubuntu so pull requests must pass it
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
