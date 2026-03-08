# Release War Room

Key: release-war-room

## Task
Run a bounded release triage using the supplied failing checks, deployment notes, and rollback policy to decide whether the release should ship.

## Expected Outcome
Return a release decision record with evidence, blocking issues, remediation plan, and rollback guidance that matches the provided constraints.

## Why This Task
This checks long-horizon operational reasoning under explicit ship-or-hold pressure.

## Inputs
Use the fixed release notes, failing checks, risk policy, and ownership roster supplied in the task brief.

## Deliverable Format
Return sections for Decision, Evidence, Blocking Issues, Immediate Actions, Rollback Plan, and Follow-up Owners.

## Success Checks
- The decision is explicit: ship, hold, or rollback.
- Evidence cites the supplied checks and policies.
- Rollback or follow-up steps are concrete and assigned.

## Failure Modes
- No explicit release decision.
- Advice that ignores the stated risk policy.
- No rollback path when the release should not continue.

## Metadata
Resolution: campaign
Interaction: terminal
Evaluator: hybrid
Difficulty: high
Tags: release, debugging, handoff
Requires Isolation: yes
Requires Network: no
