# Working in this repository

Guidance for coding agents and new contributors. It describes this project, not a general workflow.

## What this is

`agent-bench` compares coding agents, workflows and models on the same task. The point of the tool is
evidence, so the code that produces a number has to be trustworthy. Two rules follow from that:

- **A measurement must not depend on the thing being measured.** The model under test never grades its
  own work, trap tests never reach the agent before it is finished, and the blind reviewer never learns
  which setup produced which build.
- **Reading a result costs nothing.** Comparison, matrix and export render only from persisted SQLite
  rows. Never add a model call to a code path that only displays stored data.

## Commands

```bash
pnpm install
pnpm test                 # builds the CLI, then runs the node:test suite
npx tsc -p tsconfig.json --noEmit
pnpm run build            # Next.js app + CLI
pnpm run ui               # local workbench on http://localhost:4173
```

`pnpm test` must pass before a commit. Some tests are platform-gated (macOS seatbelt) and skip
elsewhere; a skip is not a failure.

## Conventions

- TypeScript throughout, Node 22.13+ (`node:sqlite` is built in — do not add a native SQLite
  dependency). The module exists from 22.5.0 but needed `--experimental-sqlite` until 22.13.0.
- Pure functions in `src/core/`, IO and process handling in `src/runtime/`, persistence and config in
  `src/server/`. Put logic where it can be tested without a database.
- A comment explains *why*, not what. Most code needs none.
- Benchmarks and agents are markdown files, not code. Adding a benchmark should never require a code
  change.
- Small, reviewable diffs. Keep the repo buildable at every commit.

## Things that are easy to get wrong

- **Trap tests are holdout data.** They live in `benchmarks/<suite>/traps/` and are copied into the
  workspace only after the runner exits. Anything that leaks them earlier invalidates every result.
- **The blind folder must stay blind.** `src/core/blind.ts` strips VCS data, dependencies, harness
  output, `traps/`, agent instruction files, secrets — and every dotted directory it does not
  explicitly keep, at any depth. That last rule is the important one: a workflow that leaves
  `.oneshot/` or `.agent/` behind, next to one that leaves nothing, tells the reviewer which build is
  which before it reads a line of code. So the list denies by default and names only the exceptions.
  Agent output belongs in the run's artifacts folder, never in the workspace.
- **Runner environments are scrubbed by default.** A runner gets a small safe host env plus explicit
  `AGENT_BENCH_*` variables. Widen that only through an agent's `Env Passthrough:` line.
- **Setups must be portable.** `benchmarks/<suite>/setups.json` ships in the package, so it must not
  reference a local plugin path, a pinned plugin version or a slash command that only exists on one
  machine. Machine-specific variants belong in a user's own `--setups-file`.

## Before pushing

Update `README.md` and `CHANGELOG.md` when behaviour changes, then ask before pushing to GitHub.
Never push without being asked to.
