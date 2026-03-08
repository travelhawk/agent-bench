# agent-bench

Local-first full-stack benchmarking workbench for AI agents.

`agent-bench` now combines a CLI, a Next.js workbench, SQLite persistence, benchmark markdown files, and artifact snapshots so you can load agents, queue eval playlists, and inspect runs without needing a hosted evaluation platform first.

## What Changed Since v0.3.0

- Reframed the Test Lab around a guided local runner flow with explicit blocker states, next-step guidance, and post-run actions.
- Persisted failed batch jobs as first-class run history entries with failure summaries, logs, and rerun support.
- Replaced the old fixed score framing in the UI with evaluator-aware outcome/process/review/efficiency breakdowns plus confidence labels.
- Extended benchmark tasks with structured sections for `Why This Task`, `Inputs`, `Deliverable Format`, `Success Checks`, and `Failure Modes`.
- Upgraded the seeded benchmark tasks so the shipped suites are more specific and benchmark-grade by default.
- Added run-detail evidence panels with objective checks, matched/missing signals, and recommended next actions.
- Added the first real sandbox execution path for fixture-backed benchmark tasks plus markdown agents that declare a `Runner:` command.
- Sandboxed runs now execute the runner from the agent directory, expose the task workspace via environment variables, and verify the result with an explicit task command.
- On macOS, sandboxed runs now use `sandbox-exec` with workspace/artifact write restrictions and network denial unless the task explicitly requires network access.
- On hosts without macOS seatbelt, `auto` mode now chooses Docker only when the daemon is ready and the configured image already exists locally; otherwise it falls back to `process`.
- Hardened Windows execution paths by using `where` for binary lookup, keeping Docker container shells on `/bin/sh`, and standardizing seeded verifier commands on explicit relative test-file globs.
- Browser and computer-use tasks in `interaction-surfaces` now ship real fixture directories and verifier commands instead of metadata-only placeholders.
- The sample workspace now includes runnable browser and computer-use example agents under `./examples/sample-workspace`.
- Runner environments are now scrubbed by default and only receive a small safe host env plus explicit `AGENT_BENCH_*` runtime variables.
- Added a GitHub Actions CI matrix so the branch is validated on `ubuntu-latest`, `macos-latest`, and `windows-latest`.
- Hardened API input handling so JSON routes reject invalid or non-object payloads with explicit client errors.
- Batch execution now tolerates per-run failures and reports partial results instead of aborting the whole queue on the first runtime error.
- Replaced hash-based local fallback scores with deterministic rules-based review tied to actual agent/task fit.
- Replaced pseudo-screenshot artifacts with generated run reports that describe the real evaluation signals.
- Benchmark metadata now covers resolution, interaction surface, evaluator mode, difficulty, and environment constraints.
- Added seeded higher-resolution suites for agentic workflows plus browser/computer-use interaction surfaces.
- Moved the sample workspace out of `./agents` into `./examples/sample-workspace` so a fresh checkout no longer auto-loads example agents as real inputs.
- Added research-backed benchmark notes in `docs/AGENTIC_TEST_RESEARCH.md`.

## What Changed In v0.3.0

- Migrated the UI into a Next.js full-stack app with App Router pages and API routes.
- The Test Lab now runs real server-backed batch flows with persisted logs and report artifacts.
- Provider setup, agent loading, benchmark authoring, history, and artifact access all go through the same application surface.
- The runtime path no longer depends on `dist`-only evaluator scripts, so batch runs work from both the CLI and the Next server.
- Research, architecture, and validation notes live in:
  - `docs/RESEARCH_BRIEF.md`
  - `docs/ARCHITECTURE_SPEC.md`
  - `docs/VALIDATION_REPORT.md`

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start the local workbench:

```bash
pnpm exec agent-bench init
pnpm exec agent-bench ui
```

By default the UI starts on `http://localhost:4173`.

Build the production app and CLI:

```bash
pnpm run build
```

If you want to run the sample browser operator, ensure Google Chrome is installed locally.
If Chrome is installed in a non-standard path, set `CHROME_BIN` to that executable before running E2E tests.

Run the end-to-end UI regression suite locally:

```bash
pnpm run test:e2e
```

Use the CLI directly:

```bash
pnpm exec agent-bench run
pnpm exec agent-bench history
pnpm exec agent-bench compare --left <run-key> --right <run-key>
```

## The Recommended Flow

1. Open the Test Lab in the browser.
2. Check the `Next action` panel first; it tells you whether the current run plan is blocked, ready, running, or completed with failures.
3. Enter an optional gateway API key in the provider bar, or rely on `AI_GATEWAY_API_KEY` from your environment.
4. Load one or more agent definitions from `./agents`.
5. Choose either:
   - one challenge
   - the full benchmark cycle for a suite
6. Inspect the task contract before launching: signal quality, inputs, deliverable format, success checks, and failure modes.
7. Launch the batch and inspect the resulting runs, logs, and artifacts.
8. If any jobs fail, open the persisted failed runs and use `Rerun failed only` after fixing the blocker.
9. Switch to Run History or the Benchmark Library when you want to review runs or refine suites/tasks.

## Full-Stack Surface

- `/` renders the Test Lab shell and current workbench state.
- `/api/workbench` returns the current dashboard snapshot.
- `/api/run/batch` executes multi-agent runs for either one task or a full benchmark cycle.
- `/api/run/[runKey]/result` returns the persisted run summary used by the inspector.
- `/api/artifacts/[runKey]/[file]` serves generated run reports and result files.

## Provider Setup

If you want model-based review through Vercel AI Gateway, create a local env file and set your key:

```bash
cp .env.sample .env
```

```bash
export AI_GATEWAY_API_KEY="your_key"
```

You can also paste a key directly into the UI for the current browser session. That session key is not written to SQLite or run artifacts.

Without a key, `agent-bench` still works using deterministic rules-based review driven by the agent spec and benchmark metadata.

Sandboxed runners also receive:

- `AGENT_BENCH_PROVIDER_API_KEY` when you launch a run with a provider key
- `AGENT_BENCH_PROVIDER_MODEL` when you choose a model in the UI or CLI
- `AGENT_BENCH_SANDBOX_PROVIDER` if you want to force `process`, `macos-seatbelt`, or `docker`
- `AGENT_BENCH_SANDBOX_DOCKER_IMAGE` if you want Docker runs to use a specific image instead of the default Node image

## Sandboxed Execution

`agent-bench` now supports real per-run sandbox execution when both sides of the contract exist:

- the agent markdown includes a `Runner:` command
- the benchmark task includes a `## Sandbox` section with a fixture and optional verify command

Agent example:

```md
# Local Sandbox Coder

Runner: node ./runner.js
```

Task example:

```md
# Fix React Bug

Key: fix-react-bug

## Task
Repair a failing React component behavior in an isolated repo.

## Expected Outcome
Return a patch and tests that make the component deterministic and pass all checks.

## Sandbox
Fixture Dir: fixtures/fix-react-bug
Verify Command: node --test tests/*.test.js
Provider: auto
Timeout Ms: 120000
```

Runner contract:

- the runner starts from the agent file directory, not from the task workspace
- the writable task repo is exposed as `AGENT_BENCH_WORKSPACE`
- task and agent material are written into the run artifacts and exposed as `AGENT_BENCH_TASK_FILE` and `AGENT_BENCH_AGENT_FILE`
- run metadata is exposed through `AGENT_BENCH_RUN_KEY`, `AGENT_BENCH_BENCHMARK_KEY`, `AGENT_BENCH_TASK_KEY`, and `AGENT_BENCH_ARTIFACTS_DIR`
- `Provider:` can be `auto`, `process`, `macos-seatbelt`, or `docker`
- in `auto` mode, macOS prefers `sandbox-exec`; other hosts only auto-select Docker when the daemon is ready and the configured image is already present locally
- on Windows hosts without Docker, sandboxed runs fall back to the host `process` provider and keep the same runner/verifier contract
- browser tasks can explicitly choose `Provider: process` when a host browser is required and the stronger sandbox would break launch stability

## What A Run Means Today

Current runs now come in two honest modes:

- Review-only runs:
  - score how well an agent definition appears to fit the selected benchmark task
  - use the configured model for review when `AI_GATEWAY_API_KEY` is present
  - otherwise use the deterministic rules rubric
  - are labeled as low or medium confidence guidance depending on how structured the benchmark contract is
- Sandboxed runs:
  - copy the task fixture into a fresh run workspace
  - execute the agent runner and optional verify command
  - use real runner/verifier outcomes as the objective outcome signal
  - expose objective checks, evidence summaries, and recommended next actions in the run detail payload
  - are labeled high confidence when deterministic checks are present
- Generated artifacts are run reports plus execution files like the copied workspace, task brief, and sandbox profile files. They are not fake browser screenshots.
- Batch failures are now persisted as failed history rows instead of being hidden in a transient batch response only.

This means the workbench now performs real sandboxed execution for tasks that opt into the fixture/runner contract, while the broader benchmark library still contains review-only tasks as well.

## Benchmarks

Benchmarks live in markdown files:

```text
benchmarks/
  <benchmark-key>/
    benchmark.md
    tasks/
      <task-key>.md
```

`benchmark.md`

```md
# <Benchmark Title>

Key: <benchmark-key>

## Description
<what this suite covers>

## Metadata
Resolution: workflow
Domain: software-engineering
Tags: coding, regression
```

`tasks/<task-key>.md`

```md
# <Task Title>

Key: <task-key>

## Task
<natural-language task>

## Expected Outcome
<what counts as complete>

## Why This Task
<why this task is worth running>

## Inputs
<fixed inputs, fixtures, constraints, or source material>

## Deliverable Format
<required output structure>

## Success Checks
- <deterministic or reviewable success criteria>

## Failure Modes
- <likely failure case to watch for>

## Sandbox
Fixture Dir: fixtures/<task-name>
Verify Command: node --test tests/*.test.js
Provider: auto
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Tags: react, tests
Requires Isolation: yes
Requires Network: no
```

Metadata meanings:

- `Resolution`: `atomic`, `workflow`, `campaign`, or `swarm`
- `Interaction`: `artifact`, `terminal`, `browser`, `tool-use`, `computer-use`, or `multi-agent`
- `Evaluator`: `state`, `artifact`, `trace`, `judge`, or `hybrid`
- `Difficulty`: `low`, `medium`, or `high`
- `Sandbox`: optional fixture-backed runtime contract for real execution
- Structured task sections are optional for backward compatibility, but strongly recommended because the workbench now uses them for guidance and confidence labeling

The repo now ships three benchmark shapes by default:

- `core-engineering` for fast deterministic regressions
- `agentic-workflows` for higher-resolution workflow, campaign, and superagent-style tests
- `interaction-surfaces` for browser, computer-use, and mixed tool-routing scenarios

The `interaction-surfaces` suite now includes executable fixtures for:

- `browser-support-escalation`
- `computer-use-incident-drill`

## Agent Definitions

The workbench scans `./agents` for markdown agent definitions and ignores task folders plus helper files like `AGENTS.md` and `README.md`.

Important:

- `./agents` is gitignored for local work.
- Keep real agent definitions local unless you explicitly want them versioned elsewhere.
- The repository examples now live under `./examples/sample-workspace` so they do not appear as loaded runtime agents.
- Agents without `Runner:` stay in review-only mode; agents with `Runner:` become sandbox-capable when paired with a sandboxed task.
- Example runnable sandbox agents live under `./examples/sample-workspace/agents`.

## Defaults

- DB path: `$HOME/.agent-bench/data.db`
- Artifact path: `$HOME/.agent-bench/artifacts/`
- Review model: `openai/gpt-4.1-mini`
- Benchmarks folder: `./benchmarks`
- Workbench port: `4173`

## Current Limits

- Full isolation now has two stronger providers: `sandbox-exec` on macOS and Docker on hosts where the daemon is available.
- Browser tasks currently default to `Provider: process` when they need a real host browser; that is intentional until a browser-capable container/runtime path is added.
- The runtime contract is command-based. `agent-bench` does not yet provide a universal in-process tool protocol for arbitrary agent frameworks.
- Multi-agent suites are still structurally modeled, but they only become truly executable when they are backed by concrete fixtures and verification commands.
- The UI now supports multi-agent batch execution and partial-failure reporting, but trace-level grading, experiment comparison views, and artifact diffs are still future work.
- The strongest next step is upgrading benchmark tasks into richer dataset-backed eval cases.
- Batch execution is intentionally capped at `48` runs per launch to keep the local workbench responsive and predictable.

## Troubleshooting

- If the Next.js app fails to start after dependency changes, run `pnpm install` again so native packages like `better-sqlite3` are rebuilt.
- If you want production verification instead of dev mode, run `pnpm run build` and then `./node_modules/.bin/next start --port 4173`.
- Keep local agent definitions under `./agents`; the repo ignores that folder for day-to-day work.
- If a runner needs to consume the configured model or provider key, read `AGENT_BENCH_PROVIDER_MODEL` and `AGENT_BENCH_PROVIDER_API_KEY` from the runner process.
- If you need to debug a failing sandbox on macOS, inspect the per-run `runner.sb` and `verifier.sb` files in the artifacts directory.
- If you want to exercise the browser sample runner, install Chromium once with `pnpm exec playwright install chromium`.
- See `docs/AGENTIC_TEST_RESEARCH.md` for the current research-backed test taxonomy and why the benchmark metadata is structured this way.
