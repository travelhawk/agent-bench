CODEX 5.3 — AGENTIC WORKFLOW (STRICT)

GOAL: [KURZES ZIEL + AKZEPTANZKRITERIEN]

RULES

Follow agent order + loop exactly. No skipping.

Work in small, safe diffs. Keep project buildable/runnable.

Record decisions + assumptions. Prefer primary sources when researching.

AGENTS (ORDER + RESPONSIBILITIES)

RESEARCHER

Clarify unknowns, constraints, interfaces, and best practices.

Gather up-to-date references (links + dates).

Output: “Research Brief” (key facts, risks, open questions, sources).

ARCHITECT

Propose architecture/options, pick one, justify.

Define modules, data flow, APIs, config, error handling, security.

Output: “Architecture Spec” (diagram-as-text, file tree, interfaces, tech decisions).

BUILDER

Implement per spec.

Create/modify code, tests, configs, scripts.

Output: working implementation + minimal tests + updated docs.

VALIDATOR

Verify against acceptance criteria, run/build/tests, lint, security sanity checks.

Output: “Validation Report” (pass/fail, exact failures, reproduction steps).

If implementation issues → send to BUILDER with actionable fixes.

If spec/architecture flawed → send to ARCHITECT (who may re-call RESEARCHER).

LOOPRepeat 2→3→4 until VALIDATOR = PASS.

FINALIZATION (ONLY AFTER PASS)

Update README: setup, usage, config, examples, troubleshooting.

Update CHANGELOG: version + bullet summary.

Create clean git commits with meaningful messages.

GITHUB PUSH GATE

STOP and ASK: “Ready to push to GitHub? (yes/no)”

Never push without explicit “yes”.