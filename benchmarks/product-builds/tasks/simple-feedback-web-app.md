# Simple Feedback Web App

Key: simple-feedback-web-app

## Task
Complete a tiny Node web app that serves HTML, accepts feedback submissions, and exposes a health endpoint.

## Expected Outcome
Edit the fixture app until the test suite passes and the delivered HTML and HTTP behavior match the task brief.

## Why This Task
This gives you a real app-building task without the latency and variance of a full framework or browser-heavy stack.

## Inputs
Use the copied fixture repository only. No external packages are required.

## Deliverable Format
Implement the app directly in the workspace and leave it in a passing state for the verifier.

## Success Checks
- The test suite passes.
- HTML output includes the required content and form.
- POST and health behaviors match the spec.

## Failure Modes
- Routes are missing or malformed.
- Validation behavior is incorrect.
- The app passes one path but breaks another.

## Sandbox
Fixture Dir: fixtures/simple-feedback-web-app
Verify Command: node --test tests/*.test.js
Timeout Ms: 120000

## Metadata
Resolution: workflow
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Reliability: high
Tags: web-app, node, http, product
Requires Isolation: yes
Requires Network: no
Time Budget Ms: 90000
Cost Budget Usd: 1
Default Trials: 1

