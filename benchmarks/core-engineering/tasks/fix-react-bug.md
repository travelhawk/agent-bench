# Fix React Bug

Key: fix-react-bug

## Task
Repair a failing React component behavior in an isolated repo.

## Expected Outcome
Return a patch and tests that make the component deterministic and pass all checks.

## Why This Task
This is the baseline deterministic engineering task. It should distinguish agents that can edit code safely from agents that only describe a fix.

## Inputs
Use only the fixture repository copied into the sandbox workspace.

## Deliverable Format
Modify the fixture code and leave the workspace in a passing state for the verifier command.

## Success Checks
- The runner exits successfully.
- The verifier command passes.
- The resulting component behavior is deterministic.

## Failure Modes
- The code still fails tests.
- The fix relies on brittle behavior or leaves the repo inconsistent.
- The runner edits files outside the allowed workspace.

## Sandbox
Fixture Dir: fixtures/fix-react-bug
Verify Command: node --test tests/*.test.js
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Tags: react, bugfix, tests
Requires Isolation: yes
Requires Network: no
