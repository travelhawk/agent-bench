# agent-bench

Local-first full-stack benchmarking workbench for AI agents.

`agent-bench` now combines a CLI, a Next.js workbench, SQLite persistence, benchmark markdown files, and artifact snapshots so you can load agents, queue eval playlists, and inspect runs without needing a hosted evaluation platform first.

## What Changed Since v0.3.0

- Added the first real sandbox execution path for fixture-backed benchmark tasks plus markdown agents that declare a `Runner:` command.
- Sandboxed runs now execute the runner from the agent directory, expose the task workspace via environment variables, and verify the result with an explicit task command.
- On macOS, sandboxed runs now use `sandbox-exec` with workspace/artifact write restrictions and network denial unless the task explicitly requires network access.
- Runner environments are now scrubbed by default and only receive a small safe host env plus explicit `AGENT_BENCH_*` runtime variables.
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

Use the CLI directly:

```bash
pnpm exec agent-bench run
pnpm exec agent-bench history
pnpm exec agent-bench compare --left <run-key> --right <run-key>
```

## The Recommended Flow

1. Open the Test Lab in the browser.
2. Enter an optional gateway API key in the provider bar, or rely on `AI_GATEWAY_API_KEY` from your environment.
3. Load one or more agent definitions from `./agents`.
4. Choose either:
   - one challenge
   - the full benchmark cycle for a suite
5. Launch the batch and inspect the resulting runs, logs, and artifacts.
6. Switch to Run History or the Benchmark Library when you want to review runs or author new suites/tasks.

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
Timeout Ms: 120000
```

Runner contract:

- the runner starts from the agent file directory, not from the task workspace
- the writable task repo is exposed as `AGENT_BENCH_WORKSPACE`
- task and agent material are written into the run artifacts and exposed as `AGENT_BENCH_TASK_FILE` and `AGENT_BENCH_AGENT_FILE`
- run metadata is exposed through `AGENT_BENCH_RUN_KEY`, `AGENT_BENCH_BENCHMARK_KEY`, `AGENT_BENCH_TASK_KEY`, and `AGENT_BENCH_ARTIFACTS_DIR`
- on macOS, the runner and verifier are wrapped in `sandbox-exec`; writes are limited to the task workspace plus run artifacts, and network is disabled unless the task metadata says it is required

## What A Run Means Today

Current runs now come in two honest modes:

- Review-only runs:
  - score how well an agent definition appears to fit the selected benchmark task
  - use the configured model for review when `AI_GATEWAY_API_KEY` is present
  - otherwise use the deterministic rules rubric
- Sandboxed runs:
  - copy the task fixture into a fresh run workspace
  - execute the agent runner and optional verify command
  - use real runner and verifier outcomes as the readiness/test score
  - still combine that execution evidence with review scoring for the final weighted score
- Generated artifacts are run reports plus execution files like the copied workspace, task brief, and sandbox profile files. They are not fake browser screenshots.

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

## Sandbox
Fixture Dir: fixtures/<task-name>
Verify Command: node --test tests/*.test.js
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

The repo now ships three benchmark shapes by default:

- `core-engineering` for fast deterministic regressions
- `agentic-workflows` for higher-resolution workflow, campaign, and superagent-style tests
- `interaction-surfaces` for browser, computer-use, and mixed tool-routing scenarios

## Agent Definitions

The workbench scans `./agents` for markdown agent definitions and ignores task folders plus helper files like `AGENTS.md` and `README.md`.

Important:

- `./agents` is gitignored for local work.
- Keep real agent definitions local unless you explicitly want them versioned elsewhere.
- The repository examples now live under `./examples/sample-workspace` so they do not appear as loaded runtime agents.
- Agents without `Runner:` stay in review-only mode; agents with `Runner:` become sandbox-capable when paired with a sandboxed task.

## Defaults

- DB path: `$HOME/.agent-bench/data.db`
- Artifact path: `$HOME/.agent-bench/artifacts/`
- Review model: `openai/gpt-4.1-mini`
- Benchmarks folder: `./benchmarks`
- Workbench port: `4173`

## Current Limits

- Full isolation is currently strongest on macOS, where `sandbox-exec` is available. Other platforms currently fall back to workspace-isolated process execution until more providers are added.
- The runtime contract is command-based. `agent-bench` does not yet provide a universal in-process tool protocol for arbitrary agent frameworks.
- Browser, computer-use, and multi-agent suites are structurally modeled, but they only become truly executable when they are backed by concrete fixtures and verification commands.
- The UI now supports multi-agent batch execution and partial-failure reporting, but trace-level grading, experiment comparison views, and artifact diffs are still future work.
- The strongest next step is upgrading benchmark tasks into richer dataset-backed eval cases.
- Batch execution is intentionally capped at `48` runs per launch to keep the local workbench responsive and predictable.

## Troubleshooting

- If the Next.js app fails to start after dependency changes, run `pnpm install` again so native packages like `better-sqlite3` are rebuilt.
- If you want production verification instead of dev mode, run `pnpm run build` and then `./node_modules/.bin/next start --port 4173`.
- Keep local agent definitions under `./agents`; the repo ignores that folder for day-to-day work.
- If a runner needs to consume the configured model or provider key, read `AGENT_BENCH_PROVIDER_MODEL` and `AGENT_BENCH_PROVIDER_API_KEY` from the runner process.
- If you need to debug a failing sandbox on macOS, inspect the per-run `runner.sb` and `verifier.sb` files in the artifacts directory.
- See `docs/AGENTIC_TEST_RESEARCH.md` for the current research-backed test taxonomy and why the benchmark metadata is structured this way.
