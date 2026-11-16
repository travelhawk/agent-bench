# Haushaltsbuch

Key: haushaltsbuch

## Task
Build the app described in docs/SPEC.md (German household expense tracker, Vite + TypeScript without a framework, Vitest, Playwright) in this repository. The spec is approved; follow its decision policy and do not ask questions.

## Expected Outcome
All features F1-F6 from docs/SPEC.md work in the browser, each has unit tests, the core flows have E2E tests, and `npm run typecheck`, `npm test` and `npm run build` pass.

## Inputs
The starter repository (docs/SPEC.md, a one-line app, Vitest and Playwright config). Run `npm install` first.

## Deliverable Format
Source, tests and docs in the workspace. Keep the existing npm scripts.

## Success Checks
- `npm run typecheck`, `npm test` and `npm run build` pass.
- Every feature F1-F6 of docs/SPEC.md is implemented.

## Failure Modes
- Features are missing or only partly built.
- Stored data is lost or corrupted in edge cases.

## Traps
- double-delete: a double click on a delete button removes two rows
- corrupt-storage: corrupt or foreign localStorage data is silently overwritten on the next save
- two-tabs: two open tabs overwrite each other's expenses
- amount-thousands: the amount 1.234,56 (the spec's own format) is rejected
- csv-formula-roundtrip: CSV formula escaping is missing or not reversed on import

## Sandbox
Fixture Dir: fixtures/haushaltsbuch
Verify Command: npm install --no-audit --no-fund && npm run typecheck && npm test && npm run build
Provider: process
Timeout Ms: 5400000
Traps Dir: traps/haushaltsbuch
Trap Command: npx playwright test --config traps/traps.config.ts

## Metadata
Resolution: workflow
Interaction: terminal
Evaluator: hybrid
Difficulty: high
Reliability: medium
Tags: web-app, vite, typescript, spec-build
Requires Isolation: yes
Requires Network: yes
Time Budget Ms: 5400000
Cost Budget Usd: 20
Default Trials: 1
