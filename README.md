# agent-bench

Local-first benchmarking workbench for AI agents.

`agent-bench` combines a CLI, a lightweight web UI, SQLite persistence, benchmark markdown files, and artifact snapshots so you can iterate on agent definitions without needing a hosted evaluation platform first.

## What Changed In v0.2.0

- The UI is now workbench-first instead of dashboard-first.
- You can configure provider access directly in the browser session.
- Agent definitions are discovered from `./agents` and can be queued visually.
- The UI can run one challenge or an entire benchmark cycle across multiple agents.
- Research and product architecture notes now live in:
  - `docs/RESEARCH_BRIEF.md`
  - `docs/ARCHITECTURE_SPEC.md`

## Quick Start

Install from this repo:

```bash
npm install -g .
```

Run the CLI:

```bash
agent-bench run
agent-bench history
agent-bench compare --left <run-key> --right <run-key>
```

Start the workbench UI:

```bash
agent-bench ui
```

By default the UI starts on `http://localhost:4173`.

## The Recommended Flow

1. Open the Test Lab in the browser.
2. Enter an optional gateway API key in the provider bar, or rely on `AI_GATEWAY_API_KEY` from your environment.
3. Load one or more agent definitions from `./agents`.
4. Choose either:
   - one challenge
   - the full benchmark cycle for a suite
5. Launch the batch and inspect the resulting runs, logs, and artifacts.

## Provider Setup

If you want live LLM judging through Vercel AI Gateway, create a local env file and set your key:

```bash
cp .env.sample .env
```

```bash
export AI_GATEWAY_API_KEY="your_key"
```

You can also paste a key directly into the UI for the current browser session. That session key is not written to SQLite or run artifacts.

Without a key, `agent-bench` still works using deterministic local fallback judging.

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
```

`tasks/<task-key>.md`

```md
# <Task Title>

Key: <task-key>

## Task
<natural-language task>

## Expected Outcome
<what counts as complete>
```

## Agent Definitions

The workbench scans `./agents` for markdown agent definitions and ignores task folders plus helper files like `AGENTS.md` and `README.md`.

Important:

- `./agents` is gitignored for local work.
- Keep real agent definitions local unless you explicitly want them versioned elsewhere.

## Defaults

- DB path: `$HOME/.agent-bench/data.db`
- Artifact path: `$HOME/.agent-bench/artifacts/`
- Judge model: `openai/gpt-4.1-mini`
- Benchmarks folder: `./benchmarks`

## Current Limits

- The scoring/runtime pipeline is still an MVP and can fall back to deterministic local judging.
- The UI now supports multi-agent batch execution, but trace-level grading and artifact diffs are still future work.
- The strongest next step is upgrading benchmark tasks into richer dataset-backed eval cases.
