# Architecture Spec

Date: 2026-03-05

Chosen option: keep the current local Node/Express stack, but shift the product from a dashboard-first shell to a workbench-first evaluation flow.

## Options Considered

### Option A: Keep the current dashboard and only add more charts

- Low engineering cost
- Low product leverage
- Does not solve first-run friction or multi-agent workflow gaps

### Option B: Workbench-first on the current stack

- Keep the current backend and artifact model
- Reframe the UI around provider setup, agent loading, playlist building, and batch launch
- Add minimal APIs for agent discovery and batch execution

Chosen because it creates a materially better product without requiring a framework rewrite.

### Option C: Full Next.js rewrite

- Better long-term app primitives
- Much higher migration cost
- Does not inherently solve the product-flow problem

Deferred until the product needs auth, sharing, richer state management, or hosted collaboration.

## Product Architecture

### Core UX layers

1. Test Lab
   Provider config, agent queue, benchmark playlist, batch launch.

2. Experiment History
   Durable runs, deletion, reopening, comparison-ready records.

3. Inspector Rail
   Latest log, run details, score breakdown, artifact preview.

4. Benchmark Authoring
   Suite/task creation backed by markdown files.

## Diagram

User
-> Test Lab UI
-> Provider config + selected agents + selected benchmark mode
-> Batch Run API
-> Runtime evaluator
-> SQLite runs table + artifact folder
-> History + Inspector + Logs

## Backend Additions

### Agent discovery

New module:
- `src/agents/files.ts`

Responsibilities:
- scan `./agents`
- ignore `AGENTS.md`, `README.md`, and task folders
- expose discovered agent definitions for the UI
- inspect manually entered agent paths

### Batch execution

New API:
- `POST /api/run/batch`

Behavior:
- accepts multiple agent paths
- accepts `single-task` or `benchmark-cycle`
- expands a benchmark cycle into one run per task
- persists every generated run independently

### Provider handoff

Runtime request extended with:
- `gatewayApiKey?: string`

Behavior:
- UI can provide an API key for the current browser session
- runtime uses the provided key without storing it in the DB or artifacts
- environment variable fallback still works

## Frontend Architecture

### Views

- `lab-view`
- `history-view`
- `benchmarks-view`

### Frontend state

Browser-managed state in `app.js`:
- available benchmarks
- available agents
- selected agent paths
- run mode
- selected benchmark and task
- model override
- session-scoped provider API key
- latest batch results

### Persistence

- `localStorage`: selected agents, benchmark, task, run mode, model
- `sessionStorage`: provider API key

This keeps secrets out of disk-backed app data while still reducing friction inside the current browser session.

## APIs

### Existing APIs retained

- `GET /api/summary`
- `GET /api/runs?limit=n`
- `GET /api/benchmarks`
- `POST /api/benchmarks`
- `GET /api/run/:runKey/result`
- `GET /api/logs/latest`
- `POST /api/run`
- `DELETE /api/run/:runKey`

### New APIs

- `GET /api/agents`
  Returns discovered agent records.

- `POST /api/agents/inspect`
  Validates and returns one manually entered agent definition.

- `POST /api/run/batch`
  Executes one agent-task matrix and returns the created runs.

## Error Handling

- reject empty agent selections for batch runs
- reject `single-task` mode without a task
- reject unknown benchmark/task combinations
- reject invalid manual agent paths
- keep fallback judging behavior when no provider key is present

## Security Notes

- Provider keys passed from the UI are not persisted to SQLite or artifact files.
- UI copy explicitly tells the user that browser-entered keys remain in the current session only.
- Workspace agent discovery is restricted to markdown files in the local `agents` folder.

## What This Architecture Enables Next

### Near-term

- side-by-side run comparison view
- benchmark playlists with ordering or subsets
- agent readiness checks beyond file existence
- richer progress reporting during batch execution

### Medium-term

- dataset-backed benchmarks
- manual review and annotation queues
- real trace ingestion and grading
- artifact/file diffs between runs

### Long-term

- optional hosted mode
- team collaboration and sharing
- CI quality gates with stored baselines

## Minimal Implementation Slice Chosen

Implement now:

- provider config strip in the UI
- agent discovery and manual inspection
- multi-agent selection with ready/loaded states
- benchmark cycle execution across all tasks in a suite
- refreshed workbench-style UI

Defer:

- true trace grading
- real-time batch progress streaming
- side-by-side diff explorer
- multi-user or hosted collaboration
