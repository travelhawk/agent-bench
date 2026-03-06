# Validation Report

Date: 2026-03-06

Status: PASS

## Scope

Validation covered the full-stack workbench plus the latest reliability pass: rules-based runtime review, generated run reports, benchmark metadata, richer seeded suites, JSON route validation, partial-failure batch execution, example-workspace cleanup, updated docs, and regression tests.

## Checks Performed

### Build

- `./node_modules/.bin/tsc -p tsconfig.cli.json --pretty false`
  - Result: pass
  - Environment: clean validation mirror under `/tmp/agent-bench-option-c`

- `./node_modules/.bin/tsc -p tsconfig.json --pretty false`
  - Result: pass
  - Environment: clean validation mirror under `/tmp/agent-bench-option-c`

- `pnpm run build`
  - Result: pass
  - Environment: clean validation mirror under `/tmp/agent-bench-option-c`
  - Notes: verified `next build --webpack` plus CLI build

### Tests

- `pnpm test`
  - Result: pass
  - Tests passed: 17/17

Covered tests:

- agent discovery ignores task docs and helper files
- invalid agent paths are rejected
- invalid JSON and non-object request bodies are rejected
- benchmark markdown metadata round-trips correctly and legacy files still backfill defaults
- seeded suites now cover browser and computer-use interaction surfaces
- batch execution logic continues after a single job failure and reports that failure separately
- runtime evaluation writes report artifacts without relying on a dist-only child-process path
- LLM judge parsing still works
- LLM judge empty response handling still fails correctly
- weighted scoring stays on the 60/30/10 split
- performance score still penalizes slow and expensive runs

### Runtime Smoke

- `AGENT_BENCH_DB_PATH=/tmp/agent-bench-option-c/validation-fresh-2.db ./node_modules/.bin/next start --port 4177`
  - Result: pass
  - Environment: clean validation mirror under `/tmp/agent-bench-option-c`

- Browser smoke on `http://127.0.0.1:4177`
  - Result: pass
  - Verified:
    - workbench home page renders
    - no browser console errors or hydration mismatch appeared on load
    - a fresh DB starts with zero runs and one real local agent under `./agents`
    - repository examples are not auto-loaded from the runtime agent path
    - clicking `Run selected agents` completes a 3-run benchmark cycle for that local agent
    - recent run cards, inspector details, and generated report artifacts render correctly
    - the latest log reflects `rules` review mode instead of fake fallback scoring

## Notes

- In the original iCloud-backed working directory on this machine, `next build` can hang idle inside the filesystem layer. The same code path completes in a clean `/tmp` mirror, so this is treated as an environment-specific workspace issue rather than an application failure.
- Native dependencies were rebuilt successfully with `pnpm rebuild better-sqlite3 sharp` before the final smoke checks.
- Artifact serving keeps a compatibility fallback for older runs that still reference `screenshot.svg`, but all new runs now emit `report.svg`.

## Reproduction Commands

```bash
rm -rf /tmp/agent-bench-option-c
mkdir -p /tmp/agent-bench-option-c
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' ./ /tmp/agent-bench-option-c/
cd /tmp/agent-bench-option-c
pnpm install
mkdir -p agents/local
printf '# local-coder\n\nRole: implementation and verification agent.\n\nBehavior:\n- Plan the task before editing files.\n- Use terminal and repo tools when the benchmark requires code changes.\n- Verify outcomes with tests, checks, or artifact inspection before reporting completion.\n- Call out risks, rollback steps, and missing evidence when confidence is low.\n' > agents/local/coder.md
./node_modules/.bin/tsc -p tsconfig.cli.json --pretty false
./node_modules/.bin/tsc -p tsconfig.json --pretty false
pnpm test
pnpm run build
AGENT_BENCH_DB_PATH=/tmp/agent-bench-option-c/validation-fresh-2.db ./node_modules/.bin/next start --port 4177
```
