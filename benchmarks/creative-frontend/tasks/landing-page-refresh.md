# Landing Page Refresh

Key: landing-page-refresh

## Task
Turn a flat starter page into a polished landing page for a fictional product using the supplied brand and copy constraints.

## Expected Outcome
Produce a visually coherent landing page that satisfies the required sections, uses the supplied positioning, and passes the structural verifier.

## Why This Task
This is the one intentionally subjective task. Humans can compare the page visually, while the verifier and task contract keep the work bounded enough for LLM review and regression tracking.

## Inputs
Use the copied static-site fixture. The brief defines the audience, product promise, tone, required sections, forbidden claims, and CTA.

## Deliverable Format
Edit `index.html` and `styles.css` in place. Leave the workspace ready for manual inspection and the automated verifier.

## Success Checks
- The required sections are present and non-placeholder.
- The verifier passes.
- The page is visually easy to compare by a human reviewer.

## Failure Modes
- Required sections or CTA are missing.
- Copy contains forbidden placeholder text or unsupported claims.
- The page remains structurally valid but visually unchanged.

## Sandbox
Fixture Dir: fixtures/landing-page-refresh
Verify Command: node verify.js
Timeout Ms: 120000

## Metadata
Resolution: workflow
Interaction: terminal
Evaluator: hybrid
Difficulty: medium
Reliability: medium
Tags: landing-page, copywriting, design, frontend
Requires Isolation: yes
Requires Network: no
Time Budget Ms: 90000
Cost Budget Usd: 0.8
Default Trials: 1

