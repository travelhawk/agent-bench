# agent-bench

`agent-bench` is a local benchmarking tool for AI agents with a CLI-first workflow and a dashboard UI.

Current implementation delivers a working vertical slice:
- SQLite-backed run persistence
- Weighted scoring (tests 60%, LLM-judge 30%, performance 10%)
- Regression alerts
- Artifact/log snapshots per run
- Dashboard UI inspired by the provided mockup

## Stack

- TypeScript / Node.js
- Commander.js (CLI)
- SQLite (`better-sqlite3`)
- Express (UI server/API)
- Tailwind CSS (compiled static UI styles)

## Setup

1. Install dependencies:
```bash
npm install
```
2. Build project:
```bash
npm run build
```
3. Initialize local storage:
```bash
node dist/src/index.js init --local
```

## Usage

### Run a benchmark
```bash
node dist/src/index.js run --agent ./agents/coder-v1.md --suite fix-react-bug
```

### Show run history
```bash
node dist/src/index.js history --limit 10
```

### Compare two runs
```bash
node dist/src/index.js compare --left run-abc123 --right run-def456
```

### Start the dashboard
```bash
node dist/src/index.js ui --port 4173
```
Open: `http://localhost:4173`

## Configuration

Defaults:
- DB path: `.agent-bench/data.db`
- Artifact path: `.agent-bench/artifacts/`

Override DB path per command:
```bash
node dist/src/index.js run --agent ./agents/coder-v1.md --db ./tmp/bench.db
```

## Example Workflow

1. `init` local database.
2. Execute one or more `run` commands for agent variants.
3. Inspect `history` and `compare` output.
4. Open `ui` and review score/cost trends plus latest logs.
5. Use regression alerts as a quality gate before shipping agent changes.

## Troubleshooting

- `no such table: runs`
  - Re-run `init`; commands now auto-initialize schema, but manual DB edits may require reset.

- UI has no data
  - Run at least one benchmark first with `run --agent ...`.

- Build warning: Browserslist outdated
  - Optional maintenance command: `npx update-browserslist-db@latest`

- Missing Tailwind binary
  - Ensure `npm install` finished successfully.

## Project Artifacts

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Research + architecture records: [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md)
