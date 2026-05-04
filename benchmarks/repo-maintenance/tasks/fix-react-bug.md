# Fix React Bug

Key: fix-react-bug

## Task
Repair a seeded regression in a tiny component repo and leave the workspace in a passing state.

## Expected Outcome
Modify the fixture repository so the failing behavior becomes deterministic and the verifier passes.

## Why This Task
This is the baseline coding regression task. It is cheap to run, easy to compare across agents, and impossible to pass by only describing a fix.

## Inputs
Use only the copied fixture repository inside the sandbox workspace.

## Deliverable Format
Edit the repo in place. The final workspace must satisfy the verifier command without manual follow-up.

## Success Checks
- The runner exits successfully.
- The verifier command passes.
- The component behavior is deterministic after the fix.

## Failure Modes
- The tests still fail.
- The patch relies on brittle behavior.
- The agent edits files outside the workspace.

## Sandbox
Fixture Dir: fixtures/fix-react-bug
Verify Command: node --test tests/*.test.js
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: low
Reliability: high
Tags: bugfix, react, tests, repo
Requires Isolation: yes
Requires Network: no
Time Budget Ms: 60000
Cost Budget Usd: 0.6
Default Trials: 1

