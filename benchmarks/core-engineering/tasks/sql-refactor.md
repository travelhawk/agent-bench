# SQL Refactor

Key: sql-refactor

## Task
Refactor a flawed reporting query against a fixed schema so it becomes correct, maintainable, and measurably cheaper to execute.

## Expected Outcome
Return corrected SQL, explain the correctness fix, and describe the expected performance improvements against the supplied query shape.

## Why This Task
This checks whether the agent can reason about correctness and query design instead of only rewriting syntax.

## Inputs
Use the fixed schema, broken query, and performance symptoms provided in the task brief.

## Deliverable Format
Return sections for Corrected Query, Correctness Notes, Performance Notes, and Validation Plan.

## Success Checks
- The corrected query addresses the stated bug.
- The explanation names at least one concrete performance improvement.
- The output references the supplied schema and constraints.

## Failure Modes
- Returns SQL without explaining why it is correct.
- Optimizes the query while changing the requested semantics.
- Uses unsupported tables or columns.

## Metadata
Resolution: atomic
Interaction: artifact
Evaluator: artifact
Difficulty: medium
Tags: sql, optimization, correctness
Requires Isolation: yes
Requires Network: no
