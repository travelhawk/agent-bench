# agent-bench

CLI benchmark tool for AI agents.
Uses Vercel AI SDK 5 for model calls.

## Super Quick Start

Install globally from this repo:
```bash
npm install -g .
```

Run immediately:
```bash
agent-bench run
agent-bench ui
```

No manual SQLite work is needed. The CLI auto-creates and auto-migrates the local DB.

## Optional Gateway Setup

If you want live LLM judging through Vercel AI Gateway, create a `.env` from sample and set your key:
```bash
cp .env.sample .env
```

```bash
# PowerShell
$env:AI_GATEWAY_API_KEY="your_key"
```

Without a key, `agent-bench run` still works using local fallback judging so you can start immediately.

## Main Commands

```bash
agent-bench run
agent-bench ui
```

Useful options:
```bash
agent-bench run --agent ./agents/coder-v1.md --benchmark core-engineering --task fix-react-bug --model openai/gpt-4.1-mini
agent-bench ui --port 4173
```

Deterministic behavior:
- `LLM_JUDGE_RESPONSE_CACHE=true` (default) keeps repeated identical runs stable.
- With AI Gateway key set, first run calls the LM and then reuses cached judge output for identical inputs.
- Without AI Gateway key, local deterministic fallback judge is used.
- Optional custom judge system prompt via `LLM_JUDGE_SYSTEM_PROMPT`.

## Defaults

- DB path: `$HOME/.agent-bench/data.db`
- Artifact path: `$HOME/.agent-bench/artifacts/`
- Judge model: `openai/gpt-4.1-mini`
- Benchmarks folder: `./benchmarks`

Concepts:
- Benchmark: a suite that groups related tasks.
- Task: one specific natural-language challenge with expected outcome inside a benchmark.

Benchmark suite structure:

```md
benchmarks/
  <benchmark-key>/
    benchmark.md
    tasks/
      <task-key>.md
```

`benchmark.md`:

```md
# <Benchmark Title>

Key: <benchmark-key>

## Description
<what this benchmark suite covers>
```

Task file format (`tasks/<task-key>.md`):

```md
# <Task Title>

Key: <task-key>

## Task
<natural-language task description for this task>

## Expected Outcome
<clear expected result>
```
