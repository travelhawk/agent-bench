# Security Audit Report

Key: security-audit-report

## Task
Inspect a seeded mini service repo, identify the single highest-severity vulnerability, and write a structured audit finding.

## Expected Outcome
Produce `audit-findings.json` in the workspace root with the required schema and the correct highest-severity issue.

## Why This Task
This gives you a fast, comparable security task that can be checked deterministically without requiring the agent to fix the code.

## Inputs
Use only the copied fixture repository. The repo contains one intentionally seeded high-severity issue that should be reported.

## Deliverable Format
Write `audit-findings.json` with exactly one finding containing `id`, `severity`, `file`, `line`, `title`, `evidence`, `impact`, and `remediation`.

## Success Checks
- The report file exists in the expected path.
- The finding matches the seeded vulnerability.
- The report does not include extra false-positive findings.

## Failure Modes
- The report misses the seeded issue.
- The report contains multiple speculative findings.
- The JSON schema is malformed.

## Sandbox
Fixture Dir: fixtures/security-audit-report
Verify Command: node verify.js
Timeout Ms: 120000

## Metadata
Resolution: atomic
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Reliability: high
Tags: security, audit, report, repo
Requires Isolation: yes
Requires Network: no
Time Budget Ms: 60000
Cost Budget Usd: 0.75
Default Trials: 1

