# Research Brief

Date: 2026-03-05

## Key Facts

- The PRD requires strict decoupling between agent definitions and benchmark definitions, artifact-first runs, and a minimal TypeScript/Node + SQLite + Commander + Tailwind stack.
- SQLite is appropriate for local persistence with transactional writes and stable file-based portability.
- Commander.js provides structured CLI subcommands and options for a CLI-first workflow.
- Tailwind can be compiled locally into static CSS for a lightweight UI bundle.

## Risks

- Full sandboxed code execution is a large feature; this MVP currently simulates run execution while keeping the persistence/API model ready for real sandbox integration.
- LLM-judge integration requires provider keys and a stable API contract; this MVP keeps weighted scoring and a replaceable scoring pipeline.
- Diff viewer and full run explorer are broader than a single-pass MVP; current implementation focuses on dashboard + run history/compare commands as the first vertical slice.

## Open Questions

- Which sandbox runtime should be the default (Docker, Firecracker, or Node VM wrappers)?
- Which LLM provider and rubric schema should be canonical for judge scoring?
- What artifact retention policy is expected by default for local dev machines?

## Sources (Primary)

- Node.js child process docs (accessed 2026-03-05): https://nodejs.org/api/child_process.html
- SQLite SQL docs (accessed 2026-03-05): https://www.sqlite.org/lang.html
- Commander.js official repository/docs (accessed 2026-03-05): https://github.com/tj/commander.js
- Tailwind installation docs (accessed 2026-03-05): https://tailwindcss.com/docs/installation
- Express static middleware docs (accessed 2026-03-05): https://expressjs.com/en/starter/static-files.html

# Architecture Spec

Date: 2026-03-05
Chosen Option: Monorepo-style single Node package with modular core/services + static UI served by Express.

## Option Summary

- Option A: CLI-only first, defer UI entirely.
- Option B: Full CLI + server-rendered dashboard with JSON API (chosen).
- Option C: Split frontend SPA build system + separate API process.

Option B was chosen for minimal complexity while still meeting PRD dashboard visibility requirements.

## Diagram (Text)

User -> `agent-bench` CLI (Commander)
CLI -> Runner (simulate now, sandbox later)
Runner -> Scoring Engine (60/30/10 weighted)
Runner -> Artifact Writer (`.agent-bench/artifacts/run-*`)
CLI -> SQLite Store (`.agent-bench/data.db`)
UI Browser -> Express UI Server (`agent-bench ui`)
Express -> SQLite Store -> JSON API -> Dashboard widgets/logs

## File Tree

- `src/index.ts` CLI entrypoint + commands
- `src/core/scoring.ts` weighted scoring + perf scoring
- `src/core/runner.ts` run simulation + artifact/log output
- `src/db/schema.ts` SQLite initialization/schema
- `src/db/store.ts` CRUD queries + dashboard aggregations
- `src/ui/server.ts` Express UI server + API routes
- `src/ui/public/index.html` dashboard shell
- `src/ui/public/app.js` dashboard data binding
- `src/ui/styles/input.css` Tailwind source
- `tests/scoring.test.ts` minimal scoring tests

## Interfaces & APIs

CLI commands:
- `agent-bench init [--db <path>]`
- `agent-bench run --agent <path> [--suite <name>] [--db <path>]`
- `agent-bench history [--limit <n>] [--db <path>]`
- `agent-bench compare --left <runKey> --right <runKey> [--db <path>]`
- `agent-bench ui [--port <n>] [--db <path>]`

HTTP API:
- `GET /api/summary`
- `GET /api/runs?limit=n`
- `GET /api/benchmarks`
- `GET /api/logs/latest`

## Data Model

`benchmarks(key,title,description,created_at)`
`runs(run_key,agent_name,agent_version,suite_name,status,score,tests_score,llm_score,perf_score,latency_ms,cost_usd,duration_ms,artifacts_path,log_text,created_at)`

## Config

- Default DB path: `.agent-bench/data.db`
- Default artifacts path: `.agent-bench/artifacts/`
- CLI overrides: `--db`, `--suite`, `--port`

## Error Handling

- CLI throws for missing compare targets.
- DB schema is idempotently initialized.
- UI returns empty-state messages when no run data exists.

## Security Notes

- Current implementation does not execute arbitrary agent code in-process; runner is simulated.
- Future sandbox integration should isolate filesystem/network per run and enforce resource limits.

## Decisions & Assumptions

- Assumption: first deliverable should be a production-like scaffold that is runnable and extensible rather than complete sandbox/LLM integration.
- Decision: prioritize PRD dashboard parity and persistence/scoring contract as stable foundation.