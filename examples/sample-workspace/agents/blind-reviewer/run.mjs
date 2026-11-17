#!/usr/bin/env node
/**
 * Default blind reviewer for `--blind-review "node agents/blind-reviewer/run.mjs"`.
 *
 * Runs `claude -p` once inside AGENT_BENCH_BLIND_DIR, where each folder (A, B,
 * C, ...) is one anonymous build of the same task and TASK.md holds the task
 * and the list of known risk areas. The reviewer must write ranking.json:
 *   [{ "letter": "A", "rank": 1, "notes": "..." }, ...]
 *
 * It also writes usage.json (tokens, cost, time) next to the blind folder, never
 * inside it, so the batch report can show what the review itself cost.
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
   browser if available). Use a different port per build (pick free ports, not 4173) and stop servers between builds.
   Process safety (hard rule): NEVER kill processes by name or image (no "taskkill /IM", "pkill", "killall",
   "Stop-Process -Name", "kill-port" on ports you did not open). Other tools on this machine run on node too, and
   killing them aborts the whole review. Only stop processes you started yourself, by the PID you recorded.
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
// Belt and braces for the prompt rule above: a name-based kill takes down agent-bench itself.
args.push("--disallowedTools", "Bash(taskkill:*)", "Bash(pkill:*)", "Bash(killall:*)", "PowerShell(Stop-Process:*)");
// Lean like the claude-code runner: the reviewer needs no user plugins, MCP servers or settings.
if (process.env.AGENT_BENCH_CLAUDE_LEAN !== "0") {
  // Kept outside the blind folder so the reviewer never sees it.
  const emptyMcp = path.join(path.dirname(blindDir), "empty-mcp.json");
  writeFileSync(emptyMcp, '{"mcpServers":{}}');
  args.push("--setting-sources", "project,local", "--strict-mcp-config", "--mcp-config", emptyMcp, "--no-chrome", "--disable-slash-commands");
}
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
writeFileSync(path.join(blindDir, "..", "usage.json"), JSON.stringify(readUsage(result.stdout ?? ""), null, 2));
if (!existsSync(path.join(blindDir, "ranking.json"))) {
  console.error("[blind-reviewer] claude finished without writing ranking.json.");
  process.exit(1);
}
console.log("[blind-reviewer] ranking.json written.");

/** `claude -p --output-format json` prints one result object; same token math as the claude-code runner. */
function readUsage(stdout) {
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      const u = parsed.usage ?? {};
      usage.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      usage.outputTokens = u.output_tokens ?? 0;
      usage.costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0;
      usage.durationMs = typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0;
      break;
    } catch {
      // not the result line
    }
  }
  return usage;
}
