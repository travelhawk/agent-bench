# Research Brief

Date: 2026-05-04

## Goal

Refocus `agent-bench` around fast, comparable benchmark tasks that actually test agent capability instead of mostly testing prompt fit or vague planning quality.

## Key Facts

- Execution-backed repo tasks should remain the benchmark backbone. SWE-bench is still the clearest primary example of why real codebase edits plus executable verification are a strong software-agent evaluation pattern. Published 2023-10-10. Accessed 2026-05-04. https://arxiv.org/abs/2310.06770
- Web-style tasks are useful when the environment matters, but they become expensive and noisy quickly. WebArena is a good reminder that realistic environments are valuable, but only when task success remains concretely checkable. Published 2023-07-26. Accessed 2026-05-04. https://arxiv.org/abs/2307.13854
- Recent benchmark guidance keeps pushing in the same direction: controlled complexity, programmatic verification where possible, and careful scope boundaries. Accessed 2026-05-04. https://openreview.net/forum?id=E58HNCqoaA
- OpenAI’s eval guidance and trace-grading guidance both reinforce the split between outcome checks and process checks. For this repo, that means deterministic verifiers should decide the core score whenever possible, while LLM judging should be reserved for residual qualities like design quality or written rationale. Accessed 2026-05-04. https://developers.openai.com/api/docs/guides/evals and https://developers.openai.com/api/docs/guides/trace-grading

## Review Of The Current Repo

- Fresh per-run workspaces already existed. That part of the runner model was correct.
- True dedicated sandboxing did not exist on every host. On Windows without Docker, `auto` still degraded to host-process execution, which is a fresh workspace but not a hard isolation boundary.
- Running without a provider key was too easy to misinterpret. The rules-based fallback is acceptable for low-cost smoke guidance, but it is not a strong measurement of AI capability on its own.
- The seeded tasks were too mixed. Some were good deterministic software tasks, but several were abstract workflow tasks that are hard to compare after small prompt changes.

## Answer To The API-Key Question

- For deterministic sandbox tasks, running without an LLM judge key can still make sense if the agent itself can execute and the verifier is the main source of truth.
- For review-only or design-heavy tasks, no-key runs should be treated as directional only, not as benchmark-grade capability claims.
- The strongest setup is:
  - agent execution uses a model key or a local model
  - the benchmark outcome is decided by tests or a verifier
  - an LLM judge is optional and secondary
- The weakest setup is:
  - no execution
  - no deterministic verifier
  - no judge key
  - only a rules heuristic

## Recommended Benchmark Shape

Keep the shipped suite set small and product-like:

- `repo-maintenance`
  - `fix-react-bug`
  - `security-audit-report`
- `product-builds`
  - `simple-feedback-web-app`
  - `release-notes-cli`
- `creative-frontend`
  - `landing-page-refresh`

Why this shape is better:

- each task can run individually
- deterministic tasks stay cheap
- prompt changes are easier to compare
- at least one task remains easy for humans to inspect visually
- the abstract long-horizon tasks are removed from the default seed set, but can return later as optional suites

## Risks

- `landing-page-refresh` is still partly subjective. The verifier can bound structure and copy, but visual quality still needs human or LLM review.
- A fresh workspace is not the same thing as a dedicated sandbox. Hard isolation only exists when Docker or macOS seatbelt is actually used.
- The current provider flow still couples execution and judging around one key path. That is serviceable for now, but a later split between execution credentials and judge credentials would be cleaner.

## Open Questions

- Should strict sandbox mode become the default for all `Requires Isolation: yes` tasks, even if that fails closed on Windows hosts without Docker?
- Should the provider setup be split into `execution key` and `judge key` in the UI and API?
- Should the next visual task be a landing page variant pack or a tiny game, after enough low-variance frontend scoring infrastructure exists?

## Sources

- OpenAI, “Working with evals.” Accessed 2026-05-04. https://developers.openai.com/api/docs/guides/evals
- OpenAI, “Trace grading.” Accessed 2026-05-04. https://developers.openai.com/api/docs/guides/trace-grading
- Jimenez et al., “SWE-bench: Can Language Models Resolve Real-World GitHub Issues?” Published 2023-10-10. Accessed 2026-05-04. https://arxiv.org/abs/2310.06770
- Zhou et al., “WebArena: A Realistic Web Environment for Building Autonomous Agents.” Published 2023-07-26. Accessed 2026-05-04. https://arxiv.org/abs/2307.13854
- “Establishing Best Practices in Building Rigorous Agentic Benchmarks.” Accessed 2026-05-04. https://openreview.net/forum?id=E58HNCqoaA
