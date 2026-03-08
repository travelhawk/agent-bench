# Computer Use Incident Drill

Key: computer-use-incident-drill

## Task
Triage a noisy incident from a desktop-style environment, gather evidence from multiple tools, and publish a recovery plan under time pressure.

## Expected Outcome
Return the incident decision, the evidence captured from each tool, and a recovery plan with explicit next actions.

## Why This Task
This tests multi-surface evidence gathering and operational decision making under pressure.

## Inputs
Use the seeded desktop fixture with alerts, terminal output, ticket text, and runbook notes.

## Deliverable Format
Produce the expected incident-plan artifact with a decision, evidence, and ordered recovery actions.

## Success Checks
- The runner captures evidence from the provided surfaces.
- The verifier passes.
- The plan includes explicit next actions.

## Failure Modes
- Ignores one or more evidence sources.
- Missing incident artifact.
- Recovery plan is vague or unordered.

## Sandbox
Fixture Dir: fixtures/computer-use-incident-drill
Verify Command: node verify.js
Timeout Ms: 120000

## Metadata
Resolution: campaign
Interaction: computer-use
Evaluator: trace
Difficulty: high
Tags: computer-use, incident-response, recovery
Requires Isolation: yes
Requires Network: no
