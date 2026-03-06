# Sample Agents Workspace

This folder is a reference workspace for local experiments.

- `AGENTS.md`: baseline global instructions for deterministic behavior.
- `agents/`: example agent prompt files, including sandbox-capable runners.
- `runners/`: sample runner scripts for fixture-backed benchmarks.

Notes:

- `agents/browser-operator.md` targets the `browser-support-escalation` fixture and uses the repo-local `playwright` dependency.
- `agents/computer-operator.md` targets the `computer-use-incident-drill` fixture and reads multiple desktop-style files before writing a deterministic result artifact.
