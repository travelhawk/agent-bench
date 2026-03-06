# Fix React Bug

Key: fix-react-bug

## Task
Repair a failing React component behavior in an isolated repo.

## Expected Outcome
Return a patch and tests that make the component deterministic and pass all checks.

## Sandbox
Fixture Dir: fixtures/fix-react-bug
Verify Command: node --test "tests/*.test.js"
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Tags: react, bugfix, tests
Requires Isolation: yes
Requires Network: no
