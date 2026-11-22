# model-coder

Role: single-shot coding agent used to benchmark one model against another.

Runner: node model-coder/run.mjs
Requires Network: yes

Behavior:
- Reads the task brief and the whole sandbox workspace.
- Asks the model named by `AGENT_BENCH_PROVIDER_MODEL` for a complete set of file edits.
- Applies the edits in place, then restores `tests/` so the verifier cannot be gamed.
- Refuses any write that resolves outside the workspace.
- Self-reports token usage to `result/usage.json`.

The workflow is deliberately minimal and identical for every setup, so a batch that
varies only the model measures the model rather than the scaffolding around it.

`Requires Network: yes` is needed because the runner itself calls a model. The
benchmark task stays `Requires Network: no`, which still applies to the work.
