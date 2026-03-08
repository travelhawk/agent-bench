# Superagent Handoff Mesh

Key: superagent-handoff-mesh

## Task
Coordinate multiple specialist roles against a fixed project brief, merge their outputs, and resolve contradictory recommendations into one coherent result.

## Expected Outcome
Return the merged deliverable, role-by-role handoff notes, explicit conflict resolution, and remaining risks.

## Why This Task
This tests whether the agent can structure delegation and synthesis rather than merely mentioning collaboration.

## Inputs
Use the fixed project brief, specialist responsibilities, and conflicting sub-findings provided in the task brief.

## Deliverable Format
Return sections for Final Deliverable, Specialist Outputs, Conflict Resolution, Remaining Risks, and Handoff Notes.

## Success Checks
- Each specialist role has a bounded responsibility.
- Conflicts are resolved explicitly.
- The merged output is coherent and does not contradict sub-results.

## Failure Modes
- Mentions multiple agents without clear handoffs.
- Leaves conflicts unresolved.
- Final output contradicts one or more specialist summaries.

## Metadata
Resolution: swarm
Interaction: multi-agent
Evaluator: trace
Difficulty: high
Tags: multi-agent, delegation, orchestration
Requires Isolation: yes
Requires Network: no
