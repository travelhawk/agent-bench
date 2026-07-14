import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listBenchmarkSuitesFromFiles } from "../src/benchmarks/files";
import { runEvaluationInRuntime } from "../src/core/runner";
import { supportsSeatbeltSandbox } from "../src/runtime/sandbox";
import { computeWeightedScore } from "../src/core/scoring";

test("runEvaluationInRuntime writes artifacts without requiring a dist-only evaluator path", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;

  try {
    delete process.env.AI_GATEWAY_API_KEY;
    const agentPath = path.join(workspace, "agents", "agent.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    writeFileSync(agentPath, "# Agent\nDelivers patches.\n");

    const result = await runEvaluationInRuntime({
      runKey: "run-test",
      agentPath,
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const runArtifactsDir = path.join(artifactsRoot, "run-test");

    assert.equal(result.runKey, "run-test");
    assert.equal(result.suiteName, "repo-maintenance/fix-react-bug");
    assert.ok(existsSync(path.join(runArtifactsDir, "summary.json")));
    assert.ok(existsSync(path.join(runArtifactsDir, "session.log")));
    assert.ok(existsSync(path.join(runArtifactsDir, "report.svg")));

    const summary = JSON.parse(readFileSync(path.join(runArtifactsDir, "summary.json"), "utf8")) as {
      reviewMode?: string;
      assessment?: { matchedSignals?: string[] };
    };
    assert.equal(summary.reviewMode, "rules");
    assert.ok(Array.isArray(summary.assessment?.matchedSignals));
  } finally {
    if (previousGatewayKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime honors AGENT_BENCH_SCORE_PROFILE and folds quality into the craft total", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousProfile = process.env.AGENT_BENCH_SCORE_PROFILE;

  try {
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.AGENT_BENCH_SCORE_PROFILE = "craft";
    const agentPath = path.join(workspace, "agents", "agent.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    writeFileSync(agentPath, "# Agent\nDelivers patches.\n");

    const result = await runEvaluationInRuntime({
      runKey: "run-craft",
      agentPath,
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    assert.equal(result.scoreProfile, "craft");
    assert.ok(result.qualityScore != null, "rules fallback should still produce a quality score");

    // The stored total must reflect the craft weighting over its components,
    // including the quality component the default profiles ignore.
    const recomputed = computeWeightedScore({
      profile: "craft",
      outcome: result.scores.outcome,
      process: result.scores.process,
      review: result.scores.review,
      efficiency: result.scores.efficiency,
      quality: result.qualityScore ?? undefined
    });
    // Recompute from the rounded stored components, so allow a small tolerance.
    assert.ok(Math.abs(result.scores.total - recomputed.total) <= 0.1,
      `craft total ${result.scores.total} should match recompute ${recomputed.total}`);
  } finally {
    if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    if (previousProfile === undefined) delete process.env.AGENT_BENCH_SCORE_PROFILE;
    else process.env.AGENT_BENCH_SCORE_PROFILE = previousProfile;
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime can execute a sandboxed runner against a task fixture", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const target = path.join(process.env.AGENT_BENCH_WORKSPACE, 'Counter.js');",
      "const next = fs.readFileSync(target, 'utf8').replace(/(next = current \\+ 1;)(\\r?\\n)  next = current \\+ 1;/, '$1$2  next = next + 1;');",
      "fs.writeFileSync(target, next);"
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-sandbox",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const runArtifactsDir = path.join(artifactsRoot, "run-sandbox");
    const summary = JSON.parse(readFileSync(path.join(runArtifactsDir, "summary.json"), "utf8")) as {
      executionMode?: string;
      sandbox?: { provider?: string; runner?: { cwd?: string }; verifier?: { exitCode?: number } };
      scores?: { tests?: number };
      diff?: { available?: boolean; filesChanged?: number; insertions?: number };
      testMetrics?: { available?: boolean; total?: number; passed?: number };
      agentUsage?: { available?: boolean };
    };

    assert.equal(result.runKey, "run-sandbox");
    assert.equal(summary.executionMode, "sandbox");
    assert.ok(summary.sandbox?.provider);
    assert.equal(summary.sandbox?.runner?.cwd, path.dirname(agentPath));
    assert.equal(summary.sandbox?.verifier?.exitCode, 0);
    assert.ok((summary.scores?.tests ?? 0) >= 9.5);
    assert.ok(existsSync(path.join(runArtifactsDir, "workspace", "Counter.js")));
    assert.equal(summary.diff?.available, true);
    assert.ok((summary.diff?.filesChanged ?? 0) >= 1);
    assert.equal(summary.testMetrics?.available, true);
    assert.ok((summary.testMetrics?.passed ?? 0) >= 1);
    assert.equal(summary.agentUsage?.available, false);
    assert.equal(result.diffAvailable, true);
    assert.equal(result.verifierTestsAvailable, true);
    assert.equal(result.agentUsageAvailable, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("sandboxed runner cannot write outside the task workspace when seatbelt is available", { skip: !supportsSeatbeltSandbox() }, async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));
  const previousProvider = process.env.AGENT_BENCH_SANDBOX_PROVIDER;

  try {
    process.env.AGENT_BENCH_SANDBOX_PROVIDER = "macos-seatbelt";

    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");
    const forbiddenPath = path.join(workspace, "escape.txt");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(forbiddenPath)}, 'escape');`
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-seatbelt",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-seatbelt", "summary.json"), "utf8")) as {
      sandbox?: { runner?: { exitCode?: number; stderr?: string; provider?: string } };
      scores?: { tests?: number };
    };

    assert.equal(result.runKey, "run-seatbelt");
    assert.equal(summary.sandbox?.runner?.provider, "macos-seatbelt");
    assert.notEqual(summary.sandbox?.runner?.exitCode, 0);
    assert.ok((summary.sandbox?.runner?.stderr ?? "").length > 0);
    assert.equal(existsSync(forbiddenPath), false);
    assert.ok((summary.scores?.tests ?? 10) < 6);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AGENT_BENCH_SANDBOX_PROVIDER;
    } else {
      process.env.AGENT_BENCH_SANDBOX_PROVIDER = previousProvider;
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime can execute the security audit fixture", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const workspace = process.env.AGENT_BENCH_WORKSPACE;",
      "const report = [{",
      "  id: 'command-injection',",
      "  severity: 'high',",
      "  file: 'src/server.js',",
      "  line: 7,",
      "  title: 'Command injection via unsanitized shell execution',",
      "  evidence: 'The handler passes req.query.cmd directly into exec(command).',",
      "  impact: 'An attacker can execute arbitrary shell commands on the host.',",
      "  remediation: 'Avoid shell execution, use an allowlist, and prefer execFile for fixed commands.'",
      "}];",
      "fs.writeFileSync(path.join(workspace, 'audit-findings.json'), JSON.stringify(report, null, 2));"
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-security-audit",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "security-audit-report",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const runArtifactsDir = path.join(artifactsRoot, "run-security-audit");
    const summary = JSON.parse(readFileSync(path.join(runArtifactsDir, "summary.json"), "utf8")) as {
      executionMode?: string;
      sandbox?: { verifier?: { exitCode?: number } };
      scores?: { tests?: number };
      diff?: { available?: boolean; filesChanged?: number };
      testMetrics?: { available?: boolean; total?: number; passed?: number };
    };

    assert.equal(result.runKey, "run-security-audit");
    assert.equal(summary.executionMode, "sandbox");
    assert.equal(summary.sandbox?.verifier?.exitCode, 0);
    assert.ok((summary.scores?.tests ?? 0) >= 9.5);
    assert.ok(existsSync(path.join(runArtifactsDir, "workspace", "audit-findings.json")));
    assert.equal(summary.diff?.available, true);
    assert.ok((summary.diff?.filesChanged ?? 0) >= 1);
    // Custom verifier now grades via the AGENT_BENCH_CHECKS marker: a correct
    // report passes every check.
    assert.equal(summary.testMetrics?.available, true);
    assert.equal(result.verifierTestsAvailable, true);
    assert.ok((result.verifierTestsTotal ?? 0) >= 1);
    assert.equal(result.verifierTestsPassed, result.verifierTestsTotal);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime persists agent bundle files into artifacts for sandbox runs", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentDir = path.join(workspace, "agents", "bundle-agent");
    const agentPath = path.join(agentDir, "AGENTS.md");
    const runnerScriptPath = path.join(agentDir, "runner.js");
    const skillFilePath = path.join(agentDir, ".agents", "skills", "patch-guide", "SKILL.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");

    mkdirSync(path.dirname(skillFilePath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Bundle Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const target = path.join(process.env.AGENT_BENCH_WORKSPACE, 'Counter.js');",
      "const next = fs.readFileSync(target, 'utf8').replace(/(next = current \\+ 1;)(\\r?\\n)  next = current \\+ 1;/, '$1$2  next = next + 1;');",
      "fs.writeFileSync(target, next);"
    ].join("\n"));
    writeFileSync(skillFilePath, "# Patch Guide\nAlways inspect verifier output.\n");

    await runEvaluationInRuntime({
      runKey: "run-agent-bundle",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-agent-bundle", "summary.json"), "utf8")) as {
      agentSystem?: { bundleMode?: string; skillCount?: number };
    };

    assert.equal(summary.agentSystem?.bundleMode, "bundle");
    assert.equal(summary.agentSystem?.skillCount, 1);
    assert.ok(existsSync(path.join(artifactsRoot, "run-agent-bundle", "agent-system", "AGENTS.md")));
    assert.ok(existsSync(path.join(artifactsRoot, "run-agent-bundle", "agent-system", ".agents", "skills", "patch-guide", "SKILL.md")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime grades the outcome by verifier test-pass ratio for partial passes", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "product-builds");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "product-builds"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");

    // Implement groupChanges correctly but leave renderReleaseNotes as a stub, so
    // only 1 of the 3 seeded tests passes.
    const partialImpl = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const ORDER = ['added','fixed','docs','removed'];",
      "const LABELS = { added:'Added', fixed:'Fixed', docs:'Docs', removed:'Removed' };",
      "function groupChanges(changes){ const g={}; for (const c of changes||[]){ if(!ORDER.includes(c.type)) continue; (g[c.type]=g[c.type]||[]).push(c.text);} for(const k of Object.keys(g)) g[k].sort(); return g; }",
      "function renderReleaseNotes(data){ void data; return 'TODO'; }",
      "function main(argv=process.argv.slice(2)){ const p=argv[0]; if(!p){ console.error('usage'); return 1;} const payload=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),p),'utf8')); process.stdout.write(renderReleaseNotes(payload)+'\\n'); return 0; }",
      "if(require.main===module){ process.exitCode=main(); }",
      "module.exports={ORDER,LABELS,groupChanges,renderReleaseNotes,main};"
    ].join("\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.writeFileSync(path.join(process.env.AGENT_BENCH_WORKSPACE, 'src', 'index.js'), ${JSON.stringify(partialImpl)});`
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-partial-grade",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "product-builds",
      taskKey: "release-notes-cli",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-partial-grade", "summary.json"), "utf8")) as {
      testMetrics?: { available?: boolean; total?: number; passed?: number };
      scores?: { outcome?: number };
      objectivePass?: boolean;
    };

    assert.equal(result.verifierTestsAvailable, true);
    assert.equal(result.verifierTestsTotal, 3);
    assert.equal(result.verifierTestsPassed, 1);
    assert.equal(summary.testMetrics?.passed, 1);
    // Runner exited 0 (+4.5) plus a graded 1/3 of the 5.5 verifier weight ≈ 6.33.
    assert.ok((summary.scores?.outcome ?? 0) > 5.5 && (summary.scores?.outcome ?? 0) < 8, `graded outcome was ${summary.scores?.outcome}`);
    assert.equal(summary.objectivePass, false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime reads a runner's self-reported token usage from result/usage.json", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentPath = path.join(workspace, "agents", "sandbox", "agent.md");
    const runnerScriptPath = path.join(path.dirname(agentPath), "runner.js");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");

    mkdirSync(path.dirname(agentPath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const workspace = process.env.AGENT_BENCH_WORKSPACE;",
      "const target = path.join(workspace, 'Counter.js');",
      "const next = fs.readFileSync(target, 'utf8').replace(/(next = current \\+ 1;)(\\r?\\n)  next = current \\+ 1;/, '$1$2  next = next + 1;');",
      "fs.writeFileSync(target, next);",
      "fs.mkdirSync(path.join(workspace, 'result'), { recursive: true });",
      "fs.writeFileSync(path.join(workspace, 'result', 'usage.json'), JSON.stringify({ inputTokens: 500, outputTokens: 150, costUsd: 0.0042 }));"
    ].join("\n"));

    const result = await runEvaluationInRuntime({
      runKey: "run-agent-usage",
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    assert.equal(result.agentUsageAvailable, true);
    assert.equal(result.agentInputTokens, 500);
    assert.equal(result.agentOutputTokens, 150);
    assert.equal(result.agentCostUsd, 0.0042);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runEvaluationInRuntime persists shared project .agents files for flat agents", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runner-"));

  try {
    const agentDir = path.join(workspace, "agents", "flat-agent");
    const agentPath = path.join(agentDir, "agent.md");
    const runnerScriptPath = path.join(agentDir, "runner.js");
    const sharedSkillFilePath = path.join(workspace, ".agents", "skills", "find-skills", "SKILL.md");
    const artifactsRoot = path.join(workspace, "artifacts");
    const benchmarksDir = path.join(workspace, "benchmarks");
    const sourceBenchmarksDir = path.resolve(process.cwd(), "benchmarks", "repo-maintenance");

    mkdirSync(agentDir, { recursive: true });
    mkdirSync(path.dirname(sharedSkillFilePath), { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(benchmarksDir, { recursive: true });
    cpSync(sourceBenchmarksDir, path.join(benchmarksDir, "repo-maintenance"), { recursive: true });
    writeFileSync(agentPath, "# Flat Agent\nRunner: node ./runner.js\n");
    writeFileSync(runnerScriptPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const target = path.join(process.env.AGENT_BENCH_WORKSPACE, 'Counter.js');",
      "const next = fs.readFileSync(target, 'utf8').replace(/(next = current \\+ 1;)(\\r?\\n)  next = current \\+ 1;/, '$1$2  next = next + 1;');",
      "fs.writeFileSync(target, next);"
    ].join("\n"));
    writeFileSync(sharedSkillFilePath, "# Find Skills\n");

    await runEvaluationInRuntime({
      runKey: "run-flat-shared-system",
      workspaceRoot: workspace,
      agentPath,
      agentRunnerCommand: "node ./runner.js",
      benchmarkKey: "repo-maintenance",
      taskKey: "fix-react-bug",
      artifactsRoot,
      benchmarksDir,
      benchmarks: listBenchmarkSuitesFromFiles(benchmarksDir)
    });

    const summary = JSON.parse(readFileSync(path.join(artifactsRoot, "run-flat-shared-system", "summary.json"), "utf8")) as {
      agentSystem?: { bundleMode?: string; sharedAgentsPath?: string | null; skillCount?: number };
    };

    assert.equal(summary.agentSystem?.bundleMode, "flat");
    assert.equal(summary.agentSystem?.sharedAgentsPath, ".agents");
    assert.equal(summary.agentSystem?.skillCount, 1);
    assert.ok(existsSync(path.join(artifactsRoot, "run-flat-shared-system", "agent-system", "agent.md")));
    assert.ok(existsSync(path.join(artifactsRoot, "run-flat-shared-system", "agent-system", ".agents", "skills", "find-skills", "SKILL.md")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
