# claude-code

Role: a full Claude Code workflow (the user's own install: CLAUDE.md, plugins, skills) builds the task.

Runner: node claude-code/run.mjs
Requires Network: yes
Env Passthrough: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CONFIG_DIR, AGENT_BENCH_CLAUDE_MODEL

Behavior:
- Runs `claude -p --permission-mode bypassPermissions` inside the task workspace with the task brief as prompt.
- If the setup sets `followupPrompt` (env `AGENT_BENCH_FOLLOWUP_PROMPT`), runs it as a second call with
  `claude -p --continue` in the same workspace, e.g. a review-and-fix pass.
- Writes the raw CLI output to the run's artifacts folder (not the workspace, so blind review stays blind).
- Self-reports token usage and cost to `result/usage.json`.

Variants of this workflow are defined in a setups file (`benchmarks/<suite>/setups.json`), not as new agent files.

Auth: `claude` finds its login through `USERPROFILE`/`HOME` (Windows: `%USERPROFILE%\.claude`), which the
sandbox passes through. `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` are forwarded only if set.
`AGENT_BENCH_CLAUDE_MODEL` pins `--model` for every call.
