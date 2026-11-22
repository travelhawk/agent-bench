#!/usr/bin/env node
/**
 * Claude Code workflow runner for agent-bench.
 *
 * Runs the locally installed `claude` CLI headless in the task workspace. The
 * workflow under test is whatever that install brings (CLAUDE.md, plugins,
 * skills) plus an optional follow-up prompt per setup, so two setups that share
 * this runner differ only in their follow-up (e.g. "vanilla" vs "vanilla+review").
 *
 * Contract with the harness:
 *   in  - AGENT_BENCH_WORKSPACE, AGENT_BENCH_TASK_FILE, AGENT_BENCH_ARTIFACTS_DIR,
 *         AGENT_BENCH_FOLLOWUP_PROMPT (optional), AGENT_BENCH_CLAUDE_MODEL (optional)
 *   out - edits in the workspace + result/usage.json (token self-report)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`[claude-code] ${message}`);
  process.exit(1);
}

const workspace = process.env.AGENT_BENCH_WORKSPACE;
if (!workspace || !existsSync(workspace)) fail("AGENT_BENCH_WORKSPACE is not set or does not exist.");
const taskFile = process.env.AGENT_BENCH_TASK_FILE;
if (!taskFile || !existsSync(taskFile)) fail("AGENT_BENCH_TASK_FILE is not set or does not exist.");
const logDir = process.env.AGENT_BENCH_ARTIFACTS_DIR || path.join(workspace, "..");
const followup = process.env.AGENT_BENCH_FOLLOWUP_PROMPT?.trim();
const model = process.env.AGENT_BENCH_CLAUDE_MODEL?.trim();

const brief = readFileSync(taskFile, "utf8");
const buildPrefix = process.env.AGENT_BENCH_BUILD_PROMPT?.trim();
const prompt = [
  ...(buildPrefix ? [buildPrefix, ""] : []),
  brief.trim(),
  "",
  "You are working in the current directory, which is the project. Do not ask questions;",
  "make reasonable decisions, finish the task completely and leave the project in a passing state."
].join("\n");

const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

// Lean by default: no user settings, user plugins, MCP servers or Chrome, so a run
// does not pay for the host's personal setup. Plugins a setup needs come in via
// AGENT_BENCH_CLAUDE_PLUGINS (";"-separated plugin dirs, "~" allowed).
// AGENT_BENCH_CLAUDE_LEAN=0 runs with the host's full setup instead.
const lean = process.env.AGENT_BENCH_CLAUDE_LEAN !== "0";
const home = process.env.USERPROFILE || process.env.HOME || "";
const pluginDirs = (process.env.AGENT_BENCH_CLAUDE_PLUGINS ?? "")
  .split(";").map((entry) => entry.trim()).filter(Boolean)
  .map((entry) => entry.startsWith("~") ? path.join(home, entry.slice(1)) : entry);
for (const dir of pluginDirs) if (!existsSync(dir)) fail(`plugin dir not found: ${dir}`);
const usesCommands = [process.env.AGENT_BENCH_BUILD_PROMPT, followup].some((text) => text?.trim().startsWith("/"));
const baseArgs = [];
if (lean) {
  const emptyMcp = path.join(logDir, "empty-mcp.json");
  writeFileSync(emptyMcp, '{"mcpServers":{}}');
  baseArgs.push("--setting-sources", "project,local", "--strict-mcp-config", "--mcp-config", emptyMcp, "--no-chrome");
  if (!usesCommands && pluginDirs.length === 0) baseArgs.push("--disable-slash-commands");
}
for (const dir of pluginDirs) baseArgs.push("--plugin-dir", dir);

/** One headless call; the prompt goes through stdin so no shell quoting is involved. */
function runClaude(label, input, extraArgs) {
  const args = ["-p", "--permission-mode", "bypassPermissions", "--output-format", "json", ...baseArgs, ...extraArgs];
  if (model) args.push("--model", model);
  const options = { cwd: workspace, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env };
  let result = spawnSync("claude", args, options);
  // npm installs ship `claude.cmd`, which Windows only starts through a shell. Args are fixed flags.
  if (result.error?.code === "ENOENT" && process.platform === "win32") {
    result = spawnSync("claude", args.map((arg) => /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg), { ...options, shell: true });
  }
  if (result.error) fail(`could not start claude: ${result.error.message}`);
  writeFileSync(path.join(logDir, `claude-${label}.json`), result.stdout ?? "");
  if (result.stderr) writeFileSync(path.join(logDir, `claude-${label}.stderr.log`), result.stderr);

  try {
    const parsed = JSON.parse(result.stdout);
    const u = parsed.usage ?? {};
    usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.outputTokens += u.output_tokens ?? 0;
    usage.costUsd += typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0;
    if (parsed.is_error) console.error(`[claude-code] ${label}: ${String(parsed.result ?? "error").slice(0, 500)}`);
  } catch {
    console.error(`[claude-code] ${label}: output was not JSON`);
  }
  console.log(`[claude-code] ${label} exit ${result.status}`);
  return result.status ?? 1;
}

let status = runClaude("build", prompt, []);
if (status === 0 && followup) {
  status = runClaude("followup", followup, ["--continue"]);
}

mkdirSync(path.join(workspace, "result"), { recursive: true });
writeFileSync(path.join(workspace, "result", "usage.json"), JSON.stringify(usage, null, 2));
process.exit(status);
