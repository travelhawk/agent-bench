# Logic Puzzle

Key: logic-puzzle

## Task
Solve a deterministic reasoning benchmark with traceable steps.

## Expected Outcome
Produce the final answer with concise rationale and internally consistent steps.

## Why This Task
This keeps a low-cost review-only task in the suite for quick reasoning checks when no sandbox is needed.

## Inputs
Use only the prompt content in the task brief.

## Deliverable Format
Return the final answer first, then a short rationale that is internally consistent.

## Success Checks
- The final answer is explicit.
- The rationale does not contradict the answer.

## Failure Modes
- Ambiguous or missing final answer.
- Reasoning contradicts the stated conclusion.
- Overly long response that obscures the answer.

## Metadata
Resolution: atomic
Interaction: artifact
Evaluator: judge
Difficulty: low
Tags: reasoning, consistency
Requires Isolation: no
Requires Network: no
