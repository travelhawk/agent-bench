# Validation Report

Date: 2026-03-06

Status: PASS

## Scope

Validation covered the full-stack workbench plus the latest sandbox execution pass: real fixture-backed runner execution, macOS seatbelt isolation, scrubbed runner environments, generated run reports, benchmark metadata, richer seeded suites, JSON route validation, partial-failure batch execution, example-workspace cleanup, updated docs, and regression tests.

## Checks Performed

### Build

- `./node_modules/.bin/tsc -p tsconfig.cli.json --pretty false`
  - Result: pass
  - Environment: current working tree

- `./node_modules/.bin/tsc -p tsconfig.json --pretty false`
  - Result: pass
  - Environment: current working tree

- `pnpm run build`
  - Result: pass
  - Environment: current working tree
  - Notes: verified `next build --webpack` plus CLI build

### Tests

- `pnpm test`
  - Result: pass
  - Tests passed: 20/20

Covered tests:

- agent discovery ignores task docs and helper files
- invalid agent paths are rejected
- invalid JSON and non-object request bodies are rejected
- benchmark markdown metadata round-trips correctly and legacy files still backfill defaults
- seeded suites now cover browser and computer-use interaction surfaces
- batch execution logic continues after a single job failure and reports that failure separately
- runtime evaluation writes report artifacts without relying on a dist-only child-process path
- sandboxed runtime execution succeeds against the seeded `fix-react-bug` fixture using a real runner command
- macOS seatbelt sandbox blocks writes outside the task workspace during runner execution
- LLM judge parsing still works
- LLM judge empty response handling still fails correctly
- weighted scoring stays on the 60/30/10 split
- performance score still penalizes slow and expensive runs

### Runtime Smoke

- `node dist/src/index.js run --agent ./agents/local/coder.md --benchmark core-engineering --task fix-react-bug --db /tmp/agent-bench-sandbox-smoke/runs.db`
  - Result: pass
  - Environment: isolated temp workspace under `/tmp`
  - Verified:
    - a local markdown agent with `Runner: node ./runner.js` is executed from its own agent directory
    - the benchmark fixture is copied into a fresh per-run workspace
    - the runner patches the workspace and the verify command passes inside that workspace
    - the run summary records `executionMode: sandbox`
    - the run summary records `provider: macos-seatbelt`
    - the run summary records `networkAccess: disabled` for the seeded `fix-react-bug` task
    - the per-run artifacts contain `runner.sb`, `verifier.sb`, `task-brief.md`, `agent.md`, `workspace/`, `summary.json`, `session.log`, and `report.svg`

## Notes

- macOS seatbelt isolation is now used automatically when `sandbox-exec` is available. Other platforms currently fall back to process-level workspace isolation.
- Runner environments are intentionally scrubbed; only a safe host env plus explicit `AGENT_BENCH_*` variables are forwarded into the sandbox.
- Artifact serving keeps a compatibility fallback for older runs that still reference `screenshot.svg`, but all new runs now emit `report.svg`.

## Reproduction Commands

```bash
mkdir -p /tmp/agent-bench-sandbox-smoke/agents/local
mkdir -p /tmp/agent-bench-sandbox-smoke/benchmarks
cp -R ./benchmarks/core-engineering /tmp/agent-bench-sandbox-smoke/benchmarks/core-engineering
printf '# Local Sandbox Coder\nRunner: node ./runner.js\n' > /tmp/agent-bench-sandbox-smoke/agents/local/coder.md
printf "const fs = require('node:fs');\nconst path = require('node:path');\nconst target = path.join(process.env.AGENT_BENCH_WORKSPACE, 'Counter.js');\nconst next = fs.readFileSync(target, 'utf8').replace('next = current + 1;\\n  next = current + 1;', 'next = current + 1;\\n  next = next + 1;');\nfs.writeFileSync(target, next);\n" > /tmp/agent-bench-sandbox-smoke/agents/local/runner.js
cd /Users/denniswestermann/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/Coding\ Projekte/Agent_Branche/agent-bench
./node_modules/.bin/tsc -p tsconfig.cli.json --pretty false
./node_modules/.bin/tsc -p tsconfig.json --pretty false
pnpm test
pnpm run build
cd /tmp/agent-bench-sandbox-smoke
node /Users/denniswestermann/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/Coding\ Projekte/Agent_Branche/agent-bench/dist/src/index.js run --agent ./agents/local/coder.md --benchmark core-engineering --task fix-react-bug --db ./runs.db
```
