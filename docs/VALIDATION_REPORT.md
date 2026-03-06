# Validation Report

Date: 2026-03-06

Status: PASS

## Scope

Validation covered the Option C full-stack migration: Next.js app shell, App Router APIs, server-side workbench services, batch execution runtime changes, updated versioning/docs, and regression tests.

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
  - Tests passed: 7/7

Covered tests:

- agent discovery ignores task docs and helper files
- invalid agent paths are rejected
- runtime evaluation writes artifacts without relying on a dist-only child-process path
- LLM judge parsing still works
- LLM judge empty response handling still fails correctly
- weighted scoring stays on the 60/30/10 split
- performance score still penalizes slow and expensive runs

### Runtime Smoke

- `./node_modules/.bin/next start --port 4173`
  - Result: pass
  - Environment: clean validation mirror under `/tmp/agent-bench-option-c`

- Browser smoke on `http://127.0.0.1:4173`
  - Result: pass
  - Verified:
    - workbench home page renders
    - discovered agents are visible
    - clicking `Run selected agents` completes a 4-run benchmark cycle
    - recent run cards, inspector details, and screenshot artifacts render

## Notes

- In the original iCloud-backed working directory on this machine, `next build` can hang idle inside the filesystem layer. The same code path completes in a clean `/tmp` mirror, so this is treated as an environment-specific workspace issue rather than an application failure.
- Native dependencies were rebuilt successfully with `pnpm rebuild better-sqlite3 sharp` before the final smoke checks.

## Reproduction Commands

```bash
rm -rf /tmp/agent-bench-option-c
mkdir -p /tmp/agent-bench-option-c
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' ./ /tmp/agent-bench-option-c/
cd /tmp/agent-bench-option-c
pnpm install
./node_modules/.bin/tsc -p tsconfig.cli.json --pretty false
./node_modules/.bin/tsc -p tsconfig.json --pretty false
pnpm run build
pnpm test
./node_modules/.bin/next start --port 4173
```
