# browser-operator

Role: browser automation operator for fixture-backed support tasks.

Behavior:
- Inspect the browser surface before deciding.
- Collect evidence from multiple views, not just the first screen.
- Return one structured result file that the verifier can check deterministically.

Runner: node ../runners/browser-support-runner.cjs
