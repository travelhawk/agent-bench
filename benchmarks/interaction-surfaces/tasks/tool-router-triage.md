# Tool Router Triage

Key: tool-router-triage

## Task
Route a bounded operational request across multiple internal tools using the supplied tool catalog, escalation rules, and target outcome.

## Expected Outcome
Return the routing plan, tool-by-tool execution sequence, decision rationale, and final completion summary.

## Why This Task
This checks whether the agent can choose tools intentionally instead of spraying calls across every available surface.

## Inputs
Use the fixed tool catalog, request brief, and escalation rules from the task brief.

## Deliverable Format
Return sections for Routing Decision, Step Sequence, Tool Justification, Risks, and Final Summary.

## Success Checks
- The selected tools are justified against the request.
- The sequence is ordered and plausible.
- Risks or escalation boundaries are called out.

## Failure Modes
- Uses tools without justification.
- No ordered execution path.
- Ignores escalation boundaries.

## Metadata
Resolution: workflow
Interaction: tool-use
Evaluator: hybrid
Difficulty: medium
Tags: triage, tool-routing, ops
Requires Isolation: yes
Requires Network: no
