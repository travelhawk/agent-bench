#!/usr/bin/env node
/**
 * Generic single-shot coding runner for agent-bench.
 *
 * The model under test is whatever `AGENT_BENCH_PROVIDER_MODEL` names, so the
 * same agent definition benchmarks any gateway model: point two setups at this
 * runner with different models and the comparison is model-vs-model with the
 * workflow held constant.
 *
 * Contract with the harness:
 *   in  - AGENT_BENCH_WORKSPACE, AGENT_BENCH_TASK_FILE,
 *         AGENT_BENCH_PROVIDER_MODEL, AGENT_BENCH_PROVIDER_API_KEY
 *   out - edits in the workspace + result/usage.json (token self-report)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SELF_TEST = process.env.AGENT_BENCH_RUNNER_SELFTEST === "1";
const MAX_FILE_BYTES = 24_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "result", "dist", ".next", "coverage"]);

function fail(message) {
  console.error(`[model-coder] ${message}`);
  process.exit(1);
}

const workspace = process.env.AGENT_BENCH_WORKSPACE;
if (!workspace || !existsSync(workspace)) fail("AGENT_BENCH_WORKSPACE is not set or does not exist.");

const model = process.env.AGENT_BENCH_PROVIDER_MODEL?.trim();
const apiKey = process.env.AGENT_BENCH_PROVIDER_API_KEY?.trim();
if (!SELF_TEST && !model) fail("AGENT_BENCH_PROVIDER_MODEL is not set — nothing to benchmark.");
if (!SELF_TEST && !apiKey) {
  fail("AGENT_BENCH_PROVIDER_API_KEY is not set. Put AI_GATEWAY_API_KEY in .env so the runner can reach the model.");
}

/** Collect the workspace as prompt context, smallest-first so budget goes to real source. */
function collectFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full, base));
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    out.push({ rel: path.relative(base, full).split(path.sep).join("/"), content: readFileSync(full, "utf8") });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const taskFile = process.env.AGENT_BENCH_TASK_FILE;
const brief = taskFile && existsSync(taskFile) ? readFileSync(taskFile, "utf8") : "(no task brief provided)";
const files = collectFiles(workspace);

/**
 * The verifier runs the workspace's own tests, so an agent that rewrites them
 * would "pass" without fixing anything. Snapshot them and put them back.
 */
const testDirs = ["tests", "test", "__tests__"]
  .map((name) => path.join(workspace, name))
  .filter((dir) => existsSync(dir));
const snapshotRoot = path.join(os.tmpdir(), `agent-bench-tests-${process.pid}`);
for (const dir of testDirs) {
  cpSync(dir, path.join(snapshotRoot, path.basename(dir)), { recursive: true });
}
function restoreTests() {
  for (const dir of testDirs) {
    const saved = path.join(snapshotRoot, path.basename(dir));
    if (!existsSync(saved)) continue;
    rmSync(dir, { recursive: true, force: true });
    cpSync(saved, dir, { recursive: true });
  }
  rmSync(snapshotRoot, { recursive: true, force: true });
}

const prompt = [
  "You are a senior engineer. Fix the repository so its existing test suite passes.",
  "",
  "## Task brief",
  brief,
  "",
  "## Repository files",
  ...files.map((file) => `### ${file.rel}\n\`\`\`\n${file.content}\n\`\`\``),
  "",
  "## Output contract",
  "Reply with JSON only, no prose and no markdown fence:",
  '{"files":[{"path":"<repo-relative path>","content":"<complete new file content>"}]}',
  "Include only files you are changing, and give each one's COMPLETE new content.",
  "Do not modify anything under tests/ — those define the contract you must satisfy."
].join("\n");

function parseEdits(raw) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model did not return a JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed.files)) throw new Error("model response has no files[] array");
  return parsed.files;
}

/** Reject writes that escape the workspace. */
function resolveInsideWorkspace(relPath) {
  const target = path.resolve(workspace, relPath);
  const rel = path.relative(workspace, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`refused write outside workspace: ${relPath}`);
  return target;
}

function writeUsage({ inputTokens, outputTokens }) {
  const perMillion = Number(process.env.AGENT_BENCH_RATE_USD_PER_1M_TOKENS);
  const costUsd = Number.isFinite(perMillion) && perMillion > 0
    ? ((inputTokens + outputTokens) / 1_000_000) * perMillion
    : null;
  const resultDir = path.join(workspace, "result");
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(
    path.join(resultDir, "usage.json"),
    JSON.stringify({ model: model ?? null, inputTokens, outputTokens, costUsd }, null, 2),
    "utf8"
  );
  return costUsd;
}

async function main() {
  if (SELF_TEST) {
    console.log(`[model-coder] self-test: ${files.length} file(s), ${testDirs.length} test dir(s) snapshotted`);

    // Prove the anti-cheat guard: tamper with the tests the way a cheating
    // agent would, then confirm restoreTests() puts the originals back.
    const probes = testDirs.flatMap((dir) => readdirSync(dir).map((name) => path.join(dir, name)));
    const before = probes.map((file) => readFileSync(file, "utf8"));
    probes.forEach((file) => writeFileSync(file, "test('cheat', () => {});\n", "utf8"));
    restoreTests();
    const restored = probes.every((file, index) => readFileSync(file, "utf8") === before[index]);
    console.log(`[model-coder] self-test: tamper guard restored ${probes.length} test file(s) -> ${restored ? "OK" : "FAILED"}`);
    if (!restored) fail("tests were not restored after tampering");

    // Prove the workspace escape guard.
    let escaped = false;
    try { resolveInsideWorkspace("../../evil.js"); escaped = true; } catch { /* expected */ }
    console.log(`[model-coder] self-test: workspace escape guard -> ${escaped ? "FAILED" : "OK"}`);
    if (escaped) fail("workspace escape guard did not hold");

    const cost = writeUsage({ inputTokens: 0, outputTokens: 0 });
    console.log(`[model-coder] self-test: usage.json written (costUsd=${cost})`);
    return;
  }

  const { generateText } = await import("ai");
  console.log(`[model-coder] model=${model} files=${files.length}`);

  const started = Date.now();
  const { text, usage } = await generateText({
    model,
    prompt,
    temperature: 0,
    providerOptions: { gateway: { apiKey } }
  });

  const edits = parseEdits(text ?? "");
  let written = 0;
  for (const edit of edits) {
    if (typeof edit?.path !== "string" || typeof edit?.content !== "string") continue;
    const target = resolveInsideWorkspace(edit.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, edit.content, "utf8");
    written += 1;
    console.log(`[model-coder] wrote ${edit.path}`);
  }

  restoreTests();

  const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0;
  writeUsage({ inputTokens, outputTokens });

  console.log(`[model-coder] ${written} file(s) in ${((Date.now() - started) / 1000).toFixed(1)}s, ${inputTokens}+${outputTokens} tokens`);
  if (written === 0) fail("model returned no file edits");
}

main().catch((error) => {
  try { restoreTests(); } catch { /* best effort */ }
  fail(error instanceof Error ? error.message : String(error));
});
