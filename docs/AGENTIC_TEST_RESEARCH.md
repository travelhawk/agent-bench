# Agentic Test Research

Date: 2026-03-06

## Research Brief

The strongest current eval systems do not treat "agent benchmarks" as one flat bucket. They separate:

- the task resolution (`atomic`, `workflow`, `campaign`, `swarm`)
- the environment surface (`artifact`, `terminal`, `browser`, `computer-use`, `tool-use`, `multi-agent`)
- the scorer type (`state`, `artifact`, `trace`, `judge`, `hybrid`)
- the operational constraints (network, isolation, budget, latency, recovery)

This still matches the repo direction, but the default shipped set should stay smaller and more executable than the full design space. The project should store structured benchmark metadata so we can test:

- coding agents on deterministic repo tasks
- product-building agents on small web-app and CLI tasks
- one bounded frontend-design task that is easy for humans to inspect
- optional higher-resolution suites later, rather than by default

## Key Findings

### 1. The best eval stacks separate final output scoring from trajectory scoring

- OpenAI's eval guidance and trace grading material explicitly distinguish outcome grading from trajectory/trace grading.
- LangSmith's evaluation concepts likewise separate final response evaluation from trajectory evaluation.
- Braintrust's experiment model uses datasets plus scores over runs, not just one-off prompts.

Implication for this repo:

- atomic tests can stay artifact/state based
- workflow and swarm tests need trace-aware scoring
- superagent tests should not pass solely on final output if delegation or coordination was poor

### 2. Strong benchmarks are environment-specific, not generic

- SWE-bench evaluates repository-level software tasks with execution-based verification.
- WebArena evaluates autonomous web interaction in realistic browser environments.
- OSWorld evaluates open-ended computer-use tasks across real web and desktop applications.
- GAIA focuses on general assistants that need reasoning, browsing, multimodality, and tool use.
- tau-bench focuses on tool-agent-user interaction in real-world domains; tau^2-bench adds dual-control settings where the user also changes the shared state.

Implication for this repo:

- one benchmark format is fine
- one evaluator is not
- each task should declare its interaction surface and evaluator mode

### 3. Multi-agent and "superagent" evaluation needs explicit coordination checks

- TheAgentCompany frames evaluation around a simulated software company with role-specialized work.
- tau^2-bench shows why shared-world coordination and user guidance deserve their own benchmark dimension.
- Recent benchmark best-practice work argues for controlled complexity, programmatic verification, contamination awareness, and quality-control checklists.

Implication for this repo:

- superagent tests should measure:
  - decomposition quality
  - role assignment quality
  - duplicate-work rate
  - handoff completeness
  - conflict resolution quality
  - merged-output correctness

### 4. Good benchmark suites need multiple resolutions

- GAIA naturally spans easier and harder levels with longer tool chains.
- WebArena, OSWorld, and TheAgentCompany show that longer-horizon tasks break agents differently than atomic tasks.
- Best-practice work on agentic benchmarks emphasizes controlled complexity and benchmark design quality rather than a single aggregate score.

Implication for this repo:

- keep atomic tests for fast regression checks
- add workflow tests for multi-step completion
- add campaign tests for long-horizon recovery and state management
- add swarm tests for orchestration and delegation

## Recommended Test Matrix

| Resolution | What it tests | Typical evaluator | Example benchmark families |
| --- | --- | --- | --- |
| `atomic` | single objective, low variance, regression checks | `state`, `artifact` | SWE-bench-style coding subtasks |
| `workflow` | multi-step tool use within one bounded flow | `artifact`, `trace`, `hybrid` | tau-bench, research synthesis, internal ops |
| `campaign` | longer horizon, interruptions, recovery, memory | `trace`, `hybrid` | OSWorld-like operational flows, release management |
| `swarm` | delegation, handoffs, merge quality, specialist coordination | `trace`, `hybrid`, selective `judge` | TheAgentCompany-like orchestration, superagent meshes |

## Recommended Starter Suite Set

To keep the repo useful as a fast local workbench, the default seeded benchmarks should stay narrow:

| Suite | Primary purpose | Coverage |
| --- | --- | --- |
| `repo-maintenance` | fast deterministic regressions on existing code | bug fixing, security auditing, executable verification |
| `product-builds` | bounded implementation tasks | simple web app, simple CLI, low runtime variance |
| `creative-frontend` | visually inspectable output with bounded structure | one landing-page style task with human and LLM review value |

That gives the project a better starter shape:

- cheap atomic regressions for every commit
- one simple product-app task
- one simple tooling task
- one visually obvious task for human comparison
- no default dependence on complex browser or desktop simulators

## Proposed Repo Structure

The benchmark model in this repo should carry these fields per task:

- `resolution`
- `interaction`
- `evaluator`
- `difficulty`
- `reliability`
- `tags`
- `requiresIsolation`
- `requiresNetwork`
- `timeBudgetMs`
- `costBudgetUsd`
- `defaultTrials`

Suite-level metadata should carry:

- `resolution` for the suite's dominant horizon
- `domain`
- `tags`

This lets us answer useful product questions later:

- "show me only deterministic atomic regressions"
- "run all browser workflows"
- "compare swarm tasks only"
- "skip anything requiring network"

## Superagent Test Design

If we want to evaluate "superagents" instead of single workers, add scenarios where success depends on coordination rather than raw generation quality:

- delegation plan creation
- specialist routing
- handoff packet completeness
- merged-result consistency
- duplicated or conflicting sub-work
- budget/time discipline across sub-agents
- recovery when one worker fails or returns contradictory evidence

The current metadata model is enough to start labeling these tasks as `swarm` plus `multi-agent`, but later we should add trace fields for:

- role graph
- sub-task assignment
- handoff artifacts
- merge decisions

## Sources

- OpenAI Evals Guide. Accessed 2026-03-06. [https://developers.openai.com/api/docs/guides/evals](https://developers.openai.com/api/docs/guides/evals)
- OpenAI Trace Grading Guide. Accessed 2026-03-06. [https://developers.openai.com/api/docs/guides/trace-grading](https://developers.openai.com/api/docs/guides/trace-grading)
- LangSmith Evaluation Concepts. Accessed 2026-03-06. [https://docs.langchain.com/langsmith/evaluation-concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- Braintrust Experiments Docs. Accessed 2026-03-06. [https://www.braintrust.dev/docs/platform/experiments](https://www.braintrust.dev/docs/platform/experiments)
- SWE-bench Leaderboards. Accessed 2026-03-06. [https://www.swebench.com](https://www.swebench.com)
- WebArena project site. ICLR 2024 paper family; site accessed 2026-03-06. [https://webarena.dev/](https://webarena.dev/)
- OSWorld project site. 2024 benchmark family; site accessed 2026-03-06. [https://os-world.github.io/](https://os-world.github.io/)
- GAIA paper. Published 2023-11-21; accessed 2026-03-06. [https://arxiv.org/abs/2311.12983](https://arxiv.org/abs/2311.12983)
- tau-bench paper. ICLR 2025 paper family; accessed 2026-03-06. [https://arxiv.org/abs/2406.12045](https://arxiv.org/abs/2406.12045)
- tau^2-bench paper. Published 2025-06-09; accessed 2026-03-06. [https://arxiv.org/abs/2506.07982](https://arxiv.org/abs/2506.07982)
- TheAgentCompany repository. Accessed 2026-03-06. [https://github.com/TheAgentCompany/TheAgentCompany](https://github.com/TheAgentCompany/TheAgentCompany)
- Establishing Best Practices for Building Rigorous Agentic Benchmarks. OpenReview preprint surfaced in 2026; accessed 2026-03-06. [https://openreview.net/pdf?id=E58HNCqoaA](https://openreview.net/pdf?id=E58HNCqoaA)
