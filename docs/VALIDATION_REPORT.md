# Validation Report

Date: 2026-03-06

Status: PASS

## Scope

Validation covered the full-stack workbench plus the latest sandbox expansion pass: real fixture-backed runner execution, Docker-backed sandboxing outside macOS seatbelt, host-browser execution overrides for browser fixtures, scrubbed runner environments, generated run reports, benchmark metadata, richer seeded suites, example runner workspaces, Windows-specific command-path hardening, updated docs, and regression tests.

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
  - Tests passed: 24/24

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
- the seeded computer-use fixture executes end-to-end and verifies its incident plan artifact
- the Docker provider executes a real command inside a container and maps workspace paths back to the host
- Windows-specific command lookup uses `where` and shell resolution remains explicit across host and container execution
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

- `node dist/src/index.js run --agent ./examples/sample-workspace/agents/browser-operator.md --benchmark interaction-surfaces --task browser-support-escalation --db /tmp/agent-bench-browser-smoke/runs.db`
  - Result: pass
  - Environment: current working tree
  - Verified:
    - the browser fixture launches through the example Playwright runner
    - the task uses `Provider: process` so the host browser can launch even on macOS where Chromium under `sandbox-exec` proved unstable
    - the runner writes `result/browser-escalation.json` plus a browser screenshot artifact
    - the verifier passes and the run summary records `provider: process` with `testsScore: 10`

- `node dist/src/index.js run --agent ./examples/sample-workspace/agents/computer-operator.md --benchmark interaction-surfaces --task computer-use-incident-drill --db /tmp/agent-bench-computer-smoke/runs.db`
  - Result: pass
  - Environment: current working tree
  - Verified:
    - the computer-use fixture executes through the sample desktop-style runner
    - the run stays on the stronger macOS seatbelt provider
    - the verifier passes against the generated `result/incident-plan.json`

- `AGENT_BENCH_SANDBOX_PROVIDER=process node dist/src/index.js run --agent /tmp/.../agents/local/coder.md --benchmark core-engineering --task fix-react-bug --db /tmp/.../runs.db`
  - Result: pass
  - Environment: current working tree with isolated temp workspace under `/tmp`
  - Verified:
    - the process-provider path executes the seeded `fix-react-bug` fixture without relying on macOS seatbelt or Docker
    - the runner exits `0`, the verifier exits `0`, and the run summary records `provider: process`
    - the quoted `node --test "tests/*.test.js"` verifier command succeeds without shell-expanded glob assumptions

## Notes

- macOS seatbelt isolation is still the default on this machine for non-browser tasks.
- Outside macOS seatbelt, the runtime now prefers Docker when the daemon is available.
- Windows-compatible execution paths are now hardened locally and the repo includes a GitHub Actions matrix for `windows-latest`, `macos-latest`, and `ubuntu-latest`.
- Browser tasks can override the provider to `process`; the seeded browser fixture does this because Chromium headless crashed under `sandbox-exec` during validation.
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
cd /Users/denniswestermann/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/Coding\ Projekte/Agent_Branche/agent-bench
pnpm exec playwright install chromium
node dist/src/index.js run --agent ./examples/sample-workspace/agents/browser-operator.md --benchmark interaction-surfaces --task browser-support-escalation --db /tmp/agent-bench-browser-smoke/runs.db
node dist/src/index.js run --agent ./examples/sample-workspace/agents/computer-operator.md --benchmark interaction-surfaces --task computer-use-incident-drill --db /tmp/agent-bench-computer-smoke/runs.db
```
