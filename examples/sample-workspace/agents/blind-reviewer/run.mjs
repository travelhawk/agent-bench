#!/usr/bin/env node
/**
 * Default blind reviewer for `--blind-review "node agents/blind-reviewer/run.mjs"`.
 *
 * Runs `claude -p` once inside AGENT_BENCH_BLIND_DIR, where each folder (A, B,
 * C, ...) is one anonymous build of the same task and TASK.md holds the task
 * and the list of known risk areas. The reviewer must write ranking.json:
 *   [{ "letter": "A", "rank": 1, "notes": "..." }, ...]
 *
 * Optional: AGENT_BENCH_BLIND_MODEL pins `--model`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const blindDir = process.env.AGENT_BENCH_BLIND_DIR;
if (!blindDir || !existsSync(blindDir)) {
  console.error("[blind-reviewer] AGENT_BENCH_BLIND_DIR is not set or does not exist.");
  process.exit(1);
}
const letters = readdirSync(blindDir).filter((name) => /^[A-Z]+$/.test(name) && statSync(path.join(blindDir, name)).isDirectory());

const prompt = `You are a strict, independent reviewer. Read TASK.md in this folder. The folders ${letters.join(", ")} are
independent builds of that same task by unknown teams. You do not know who built what; do not guess.

For EACH build:
1. Install and run it yourself (e.g. npm install, npm test, npm run build, start the app, use Playwright or a
   browser if available). Use a different port per build or stop servers between builds.
2. Judge it on this rubric, in order of weight:
   - Data safety: no silent data loss (double actions, corrupt or foreign stored data, concurrent tabs, import/export round trips).
   - Spec fidelity: every requirement in TASK.md / docs/SPEC.md, including formats and edge cases.
   - Accessibility: labels, keyboard use, error messages tied to fields, mobile width.
   - Code quality: structure, tests that actually test behaviour, no dead code.
3. Check every item under "Known risk areas" in TASK.md for every build.

Rules: only report a bug you reproduced (state the exact steps and what you observed). Never rank on guesses,
file names or style alone. Ties are not allowed.

Finish by writing ranking.json in this folder (the folder that contains TASK.md), exactly:
[{"letter": "A", "rank": 1, "notes": "short verdict with the reproduced bugs"}, ...]
with one entry per build and rank 1 = best.`;

const args = ["-p", "--permission-mode", "bypassPermissions", "--output-format", "json"];
if (process.env.AGENT_BENCH_BLIND_MODEL?.trim()) args.push("--model", process.env.AGENT_BENCH_BLIND_MODEL.trim());
const options = { cwd: blindDir, input: prompt, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env };
let result = spawnSync("claude", args, options);
if (result.error?.code === "ENOENT" && process.platform === "win32") {
  result = spawnSync("claude", args, { ...options, shell: true });
}
if (result.error) {
  console.error(`[blind-reviewer] could not start claude: ${result.error.message}`);
  process.exit(1);
}
writeFileSync(path.join(blindDir, "..", "blind-reviewer.claude.json"), result.stdout ?? "");
if (!existsSync(path.join(blindDir, "ranking.json"))) {
  console.error("[blind-reviewer] claude finished without writing ranking.json.");
  process.exit(1);
}
console.log("[blind-reviewer] ranking.json written.");
