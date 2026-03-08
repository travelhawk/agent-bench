# Research Synthesis Loop

Key: research-synthesis-loop

## Task
Collect evidence across multiple sources, reconcile conflicts, and deliver a concise research brief with citations and open questions.

## Expected Outcome
Return a source-backed brief, a compact evidence table, and explicit uncertainty notes for anything unresolved.

## Why This Task
This evaluates whether the agent can synthesize evidence instead of dumping search results.

## Inputs
Use at least three current external sources, include publication or access dates, and explicitly reconcile conflicting claims.

## Deliverable Format
Return sections for Executive Brief, Evidence Table, Conflicts, Open Questions, and Sources.

## Success Checks
- At least three sources are cited.
- Conflicting evidence is reconciled or left explicitly unresolved.
- The output includes a compact evidence table.

## Failure Modes
- Uncited factual claims.
- No conflict handling.
- Source list without synthesis.

## Metadata
Resolution: workflow
Interaction: tool-use
Evaluator: trace
Difficulty: medium
Tags: research, synthesis, citations
Requires Isolation: no
Requires Network: yes
