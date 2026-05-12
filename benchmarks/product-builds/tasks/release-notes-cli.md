# Release Notes CLI

Key: release-notes-cli

## Task
Implement a tiny CLI that reads a JSON change log and prints a deterministic Markdown release summary.

## Expected Outcome
Complete the CLI so the seeded tests pass and the output format is stable across runs.

## Why This Task
CLI tasks are cheap, highly comparable, and sensitive to instruction-quality changes without needing a large runtime budget.

## Inputs
Use the copied fixture repository and the seeded sample input files only.

## Deliverable Format
Implement the CLI and supporting helpers in place so the verifier passes.

## Success Checks
- The test suite passes.
- Markdown output matches the required structure.
- Entries are grouped and ordered exactly as specified.

## Failure Modes
- The CLI ignores invalid input handling.
- Output structure is unstable or incomplete.
- Sorting and grouping rules are wrong.

## Sandbox
Fixture Dir: fixtures/release-notes-cli
Verify Command: node --test tests/*.test.js
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: low
Reliability: high
Tags: cli, node, formatting, product
Requires Isolation: yes
Requires Network: no
Time Budget Ms: 45000
Cost Budget Usd: 0.4
Default Trials: 1

