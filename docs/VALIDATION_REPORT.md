# Validation Report

Date: 2026-03-08

Status: PASS

## Scope

Validation covered the guided local runner release: failed-run persistence, rerun-failed-only batch support, evaluator-aware scoring and confidence labels, richer benchmark task parsing, updated seeded tasks, the rewritten Next.js workbench flow, and sandbox stability on this Windows host.

## Checks Performed

### Build

- `pnpm run build`
  - Result: pass
  - Verified:
    - `next build --webpack`
    - `tsc -p tsconfig.cli.json`

### Tests

- `pnpm test`
  - Result: pass
  - Tests passed: 25/25

Covered regressions:

- agent discovery still ignores helper docs and out-of-scope paths
- benchmark markdown still backfills legacy metadata
- richer benchmark task fields round-trip through file creation and parsing
- seeded suites still cover browser and computer-use surfaces
- AI judge parsing and empty-response handling still work
- runtime evaluation still writes report artifacts without dist-only subprocess assumptions
- the seeded `fix-react-bug` sandbox task now passes on this Windows host under Docker fallback
- the seeded `computer-use-incident-drill` fixture still executes end-to-end
- batch execution still continues after one job failure
- failed jobs are now persisted as failed runs
- evaluator-aware scoring and efficiency scoring behave as expected
- server validation still enforces tag sanitization, agent deduplication, and batch limits

## Host-Specific Findings

- The previous failing sandbox regression on this machine was caused by the Docker provider requesting `--cpus 1.5` on a 1-core allocation.
- The sandbox now clamps Docker CPU limits to a safe local value, and the seeded `fix-react-bug` test passes again.
- The runner patching test was also hardened to tolerate CRLF line endings on Windows.

## Functional Coverage Verified By Tests

- guided batch execution still completes and returns persisted runs
- failed batch jobs now surface as real failed history items with summary/log artifacts
- sandbox-backed runs emit objective checks and high-confidence labels
- review-only runs continue to work through the rules/judge path
- richer benchmark authoring inputs are accepted by the backend file contract

## Manual Smoke

- Manual browser/UI smoke was not run in this workspace.
- Confidence in the release is based on:
  - production build success
  - full automated test pass
  - service/runtime regressions for failed-run persistence and sandbox execution

## Commands

```bash
pnpm run build
pnpm test
```
