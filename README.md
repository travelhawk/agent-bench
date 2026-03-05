# agent-bench

A modular benchmarking framework for AI agents that reduces regression uncertainty by testing agent configurations against reproducible task suites and producing objective scores.

## Vision

`agent-bench` aims to become the quality standard for agent development: local, repeatable validation before production deployment.

Core idea: treat prompt and agent changes like software changes, with measurable quality gates instead of intuition.

## Product Scope (v0 baseline)

- CLI-first benchmarking workflow for power users
- Support for agent definitions (prompts, tools, model settings)
- Benchmark runner for sequential/parallel suite execution
- Isolated execution environment (sandboxed runs)
- Persistent local run history (SQLite)
- Weighted scoring:
  - Automated tests: 60%
  - LLM judge: 30%
  - Performance metrics: 10%
- Regression alerts when new runs score below best baseline
- Artifact-first output (snapshots + logs)
- Web UI for analysis:
  - Dashboard
  - Run explorer
  - Diff viewer

## Architecture Principles

- Strict decoupling between agent definitions and benchmark definitions
- Artifact-first design: every run produces a reproducible black-box trace
- Minimal stack:
  - TypeScript / Node.js
  - SQLite
  - Commander.js (CLI)
  - Tailwind CSS (UI)

## Setup

1. Clone the repository.
2. Install dependencies (once `package.json` is available):
   - `npm install`
3. Prepare local config/env:
   - LLM provider key (for judge integration)
   - Database path (SQLite)
   - Sandbox runtime settings

## Usage

Planned command flow:

- Run benchmark suite:
  - `agent-bench run --agent ./agents/agent-v1.md --suite ./benchmarks/core`
- Compare versions:
  - `agent-bench compare --left ./agents/agent-v1.md --right ./agents/agent-v2.md`
- Start analysis UI:
  - `agent-bench ui`

## Configuration

Expected config areas:

- `agent`: prompt/tool/model references
- `runner`: concurrency, timeout, retries
- `judge`: model, rubric, temperature
- `scoring`: weight distribution and thresholds
- `storage`: SQLite path and retention policy
- `sandbox`: resource limits and isolation mode

## Example Workflow

1. Define or update an agent (`agent-v2.md`).
2. Execute suite with `agent-bench run`.
3. Review score + latency + cost.
4. Open UI and inspect logs/snapshots.
5. Compare with previous best run.
6. Ship only if no regression is detected.

## Troubleshooting

- Missing API key:
  - Ensure your LLM provider key is set in environment/config.
- Empty or inconsistent scores:
  - Verify benchmark suite includes both deterministic tests and evaluation prompts.
- Slow runs:
  - Lower concurrency or tighten suite size for local iteration.
- Large artifact storage growth:
  - Configure retention and prune historical runs.
- UI does not show latest run:
  - Check SQLite path alignment between CLI and UI config.

## Project Status

Planning/bootstrapping stage. This repository currently contains PRD material and baseline documentation.

See [docs/PRD.md](docs/PRD.md) for full product requirements.
