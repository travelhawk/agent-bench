# Changelog

## 0.2.1 - 2026-03-05

- Stopped tracking the repository sample `agents/` workspace so local agent definitions remain gitignored by default
- Kept the workbench, research, architecture, and validation updates from `0.2.0` as the functional baseline

## 0.2.0 - 2026-03-05

- Reframed the UI into a workbench-style Test Lab with provider setup, agent queueing, benchmark playlists, and batch launch planning
- Added agent discovery and manual inspection APIs for markdown definitions under `./agents`
- Added multi-agent batch execution with `single-task` and `benchmark-cycle` modes
- Added research and architecture docs for the next-stage product direction
- Added tests for agent discovery and updated `.gitignore` so local `agents/` work stays out of commits by default

## 0.1.0 - 2026-03-05

- Implemented CLI commands: `init`, `run`, `history`, `compare`, `ui`
- Added SQLite schema, benchmark seeding, run persistence, and dashboard summaries
- Implemented weighted scoring (60/30/10) and regression alerting
- Added artifact/log snapshot generation under `.agent-bench/artifacts`
- Built dashboard UI (sidebar, stats cards, recent runs, quick start, live logs panel)
- Added minimal scoring tests and validation workflow documentation
