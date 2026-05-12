# Architecture Spec

Date: 2026-05-04

## Chosen Direction

Keep the existing local runner architecture, but make the seeded benchmark library narrower, faster, and more executable.

## Architecture Spec

### Principles

- Default suites should optimize for comparability, not breadth.
- Every coding task in the default seed set should have an executable verifier.
- Review-only tasks should be rare and clearly labeled.
- A fresh workspace is mandatory for sandboxed tasks.
- Dedicated isolation should be treated as a provider capability, not assumed from the presence of a fresh workspace alone.

### Benchmark Taxonomy

- `repo-maintenance`
  - objective repo tasks on existing code
  - fastest signal for prompt changes
- `product-builds`
  - small greenfield implementation tasks
  - still executable and bounded
- `creative-frontend`
  - one visually inspectable task with enough structure for automation plus human review

### Task Metadata

Each task now carries:

- `resolution`
- `interaction`
- `evaluator`
- `difficulty`
- `reliability`
- `tags`
- `requiresIsolation`
- `requiresNetwork`
- `timeBudgetMs`
- `costBudgetUsd`
- `defaultTrials`

These extra fields are necessary for speed-focused comparison. A benchmark that has no budget and no declared reliability is hard to use as a regression gate.

### File Tree

```text
benchmarks/
  creative-frontend/
    benchmark.md
    fixtures/
      landing-page-refresh/
    tasks/
      landing-page-refresh.md
  product-builds/
    benchmark.md
    fixtures/
      release-notes-cli/
      simple-feedback-web-app/
    tasks/
      release-notes-cli.md
      simple-feedback-web-app.md
  repo-maintenance/
    benchmark.md
    fixtures/
      fix-react-bug/
      security-audit-report/
    tasks/
      fix-react-bug.md
      security-audit-report.md
```

### Data Flow

User
-> selects one task or a full suite
-> runner copies fixture into a fresh workspace
-> agent runner receives the writable task workspace plus a read-only agent bundle that can include `.agents` skills and workflow files
-> verifier produces the main pass/fail signal
-> optional LLM judge adds secondary review context
-> results persist to SQLite plus run artifacts

### Agent Bundles

- Workspace agents still load from `./agents`.
- Managed bundles live under `./.agent-bench/agents` so uploaded files and discovered skills stay local and untracked.
- A bundle can start from an existing agent file or nested `AGENTS.md` directory, then add:
  - uploaded `.agents` files
  - uploaded workflow/helper files
  - `skills.sh` skills installed through the official `skills` CLI
- Sandbox runs expose bundle paths through explicit env vars and copy bundle evidence into artifacts so the comparison covers the whole agent system.

### Sandbox Policy

- `process`: fresh workspace only, not a strong sandbox boundary
- `docker`: fresh workspace plus real dedicated isolation
- `macos-seatbelt`: fresh workspace plus real dedicated isolation on supported macOS hosts
- `strictProvider`: fail closed when a dedicated provider was requested but unavailable

### Key Decision

Do not make the default benchmark set “impressive” by adding many surfaces. Make it useful first:

- one visual task
- one simple app
- one CLI tool
- two repo tasks

That is enough to measure whether agent prompt changes improved real outcomes without making every run slow or expensive.
