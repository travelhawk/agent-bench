# Browser Support Escalation

Key: browser-support-escalation

## Task
Work through a browser-based support console, collect state from multiple screens, update the case, and leave a concise operator note.

## Expected Outcome
Return the final case decision, the updated fields, and the note text that explains the escalation outcome.

## Why This Task
This verifies a real browser workflow where state collection and final operator notes both matter.

## Inputs
Use the seeded browser fixture exactly as loaded by the runner.

## Deliverable Format
Update the case through the browser flow and write the expected result artifact for the verifier.

## Success Checks
- The runner completes the browser workflow.
- The verifier passes.
- The final artifact contains the case decision, field updates, and note text.

## Failure Modes
- Incomplete browser traversal.
- Missing or malformed result artifact.
- Case note does not justify the escalation outcome.

## Sandbox
Fixture Dir: fixtures/browser-support-escalation
Verify Command: node verify.js
Provider: process
Timeout Ms: 120000

## Metadata
Resolution: workflow
Interaction: browser
Evaluator: trace
Difficulty: medium
Tags: browser, forms, state
Requires Isolation: yes
Requires Network: no
