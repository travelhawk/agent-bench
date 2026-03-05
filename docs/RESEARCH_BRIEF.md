# Research Brief

Date: 2026-03-05

## Goal

Turn `agent-bench` from a run-history dashboard into a local workbench that makes agent testing feel structured, fast, and enjoyable: configure a provider, load several agents, choose a challenge or a full benchmark cycle, launch a batch, and compare outcomes with enough context to learn from them.

## What The Current Repo Already Gets Right

- The project already has a strong MVP spine: CLI, SQLite persistence, benchmark files, artifact snapshots, a local UI, and deterministic fallback evaluation.
- The tech stack is pragmatic for a local-first open-source tool: TypeScript, Node, SQLite, Express, Tailwind.
- The repo is already artifact-first enough to support a stronger inspection workflow later.

## What Is Missing In The Current Product Shape

- The UI is dashboard-first, not workflow-first. It starts with run summaries, not with the act of preparing an evaluation session.
- The current happy path is mostly single-agent and single-run oriented.
- Provider configuration is hidden in environment variables, which increases friction for first-time testers.
- Benchmarks exist as suites and tasks, but the UI does not yet turn them into a visible playlist or benchmark cycle.
- The scoring/runtime layer is still simulated, so UX must make clear what is “real infrastructure” versus “placeholder evaluation”.

## External Patterns That Repeatedly Show Up

### 1. Mature eval tools are dataset/experiment tools, not just prompt runners

- OpenAI’s eval guide frames evals around test data plus graders, and treats them as a core reliability mechanism rather than an optional add-on.
- LangSmith organizes evaluation around datasets, experiments, comparison, and human feedback loops.
- Braintrust makes the experiment the unit of record and uses experiment comparison as a first-class workflow.

Implication:
`agent-bench` should evolve from “run a benchmark” to “assemble and compare experiment batches”.

### 2. Comparison is the product, not a secondary feature

- Promptfoo’s viewer emphasizes diffing runs, filtering failures, inline scoring, comments, exports, and head-to-head inspection.
- Braintrust explicitly highlights improvements and regressions per example, not just aggregate scores.
- LangSmith exposes compare-experiments, UI filters, performance metrics, and annotation queues.

Implication:
The experience should default to side-by-side comparison and queue execution, not isolated single-run cards.

### 3. Human review remains important

- Promptfoo persists comments, pass/fail overrides, and scores to build training datasets.
- LangSmith positions annotation queues and inline run annotation as a structured part of evaluation workflows.

Implication:
Open-source credibility will increase if `agent-bench` eventually supports lightweight manual review and promotion of interesting runs into benchmark data.

### 4. Trace visibility matters more for agents than for plain prompts

- OpenAI’s trace grading guidance distinguishes black-box output checks from trace-level grading of decisions, tool calls, and reasoning flow.
- Braintrust’s experiment views surface detailed traces and row-level regressions.

Implication:
If this project wants to matter for agents, not only prompts, the long-term differentiator is trace inspection and artifact diffs, not just score math.

### 5. Great eval UX separates fast iteration from durable records

- Braintrust uses playgrounds for quick iteration and experiments for immutable comparisons.
- Promptfoo separates editing/rerunning from the viewer and export/share flows.

Implication:
`agent-bench` should eventually have two modes:
- a lab/workbench for quickly composing a test run
- an experiment/history area for durable comparison and auditability

## Product Opportunity

The repo makes sense if it positions itself as:

> the local-first, open-source evaluation workbench for agent developers who want fast setup, reproducible artifacts, and understandable comparisons without adopting a hosted platform first.

That is a credible angle because:

- hosted tools optimize for teams and cloud telemetry
- this repo can optimize for immediate local setup, repo-native benchmark definitions, and zero-ops experimentation
- the current codebase already aligns with that local-first posture

## UX Direction That Fits The Opportunity

### Recommended primary flow

1. Configure provider access in the UI.
2. Auto-discover agent definition files and let the user queue multiple agents.
3. Select either one challenge or a full benchmark cycle.
4. Show the run plan before execution: agents x tasks = total queued runs.
5. Launch the batch and keep the latest results visible in one place.
6. Open any run into a detail inspector with artifacts, score breakdown, and logs.

### Why this is better than the current dashboard-first shape

- It matches the user’s mental model: “I want to test these agents on these challenges.”
- It makes the product feel active and purposeful instead of archival.
- It turns benchmarking into a ritual with visible momentum, which is important for perceived fun.

## Risks

- The backend still simulates evaluation, so the UX can outgrow the runtime quickly if messaging is vague.
- API key handling in the browser must stay explicit and local-only unless a stronger security model is added.
- Without trace-level data, comparison value will plateau after the first wave of UI improvements.
- If benchmark tasks stay too generic, the product risks becoming a demo shell instead of a trusted quality gate.

## Open Questions

- Should benchmark tasks evolve into dataset-backed test cases instead of single markdown prompts?
- What is the long-term runtime contract for real agent execution: Docker, remote runners, or pluggable local sandboxes?
- Should manual review live directly in the UI first, or should the next major step focus on trace collection?
- How opinionated should provider support be: AI Gateway-first, or multi-provider config from day one?

## Decisions And Assumptions

- Decision: keep the existing local Node/Express architecture for now instead of jumping to a heavier framework migration.
- Decision: optimize the UI around “batch experiment setup” before building deeper charts.
- Assumption: the fastest route to open-source usefulness is lowering the friction of the first benchmark cycle.
- Assumption: clear local workflows and reproducible artifacts matter more right now than multi-user collaboration.

## Primary Sources

- Promptfoo, “Using the web viewer”, accessed 2026-03-05: https://www.promptfoo.dev/docs/usage/web-ui/
- LangSmith, “Evaluation concepts”, accessed 2026-03-05: https://docs.langchain.com/langsmith/evaluation-concepts
- Braintrust, “Evaluate systematically”, accessed 2026-03-05: https://www.braintrust.dev/docs/platform/experiments
- Braintrust, “Use playgrounds”, accessed 2026-03-05: https://www.braintrust.dev/docs/platform/playground
- Braintrust, “Interpret evals”, accessed 2026-03-05: https://www.braintrust.dev/docs/guides/evals/interpret
- OpenAI, “Working with evals”, accessed 2026-03-05: https://developers.openai.com/api/docs/guides/evals
- OpenAI, “Agent evals”, accessed 2026-03-05: https://developers.openai.com/api/docs/guides/agent-evals
- OpenAI, “Trace grading”, accessed 2026-03-05: https://developers.openai.com/api/docs/guides/trace-grading
