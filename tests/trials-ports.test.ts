import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatCliError, parseTrialsOption } from "../src/core/cli-helpers";
import { runTrapStep } from "../src/runtime/evaluator";
import { collectDescendants, findFreePort, type KnownProcess, selectKillTargets, TRAP_PORT_ENV } from "../src/runtime/ports";
import { firstOutputLine, resolveTrapResults } from "../src/runtime/traps";
import { expandTrialJobs, normalizeTrials } from "../src/server/service";
import { BenchmarkTaskRecord } from "../src/types";

test("--trials 3 over 3 setups and one task gives 9 jobs, trials of a setup kept together", () => {
  const jobs = expandTrialJobs(["vanilla", "vanilla+review", "forge"], ["haushaltsbuch"], 3);
  assert.equal(jobs.length, 9);
  assert.deepEqual(jobs.slice(0, 3).map((job) => [job.setup, job.trial]), [["vanilla", 1], ["vanilla", 2], ["vanilla", 3]]);
  assert.equal(jobs.filter((job) => job.setup === "forge").length, 3);
  assert.equal(expandTrialJobs(["a"], ["t1", "t2"], 2).length, 4);
});

test("trials are clamped to 1-5 and the CLI option rejects junk instead of silently running once", () => {
  assert.equal(normalizeTrials(undefined), 1);
  assert.equal(normalizeTrials(9), 5);
  assert.equal(parseTrialsOption(undefined), 1);
  assert.equal(parseTrialsOption("3"), 3);
  assert.equal(parseTrialsOption("7"), 5);
  assert.throws(() => parseTrialsOption("three"), /--trials must be a number/);
});

test("formatCliError always carries a message and the stack", () => {
  const withStack = formatCliError(new Error("boom"));
  assert.match(withStack, /agent-bench failed: Error: boom/);
  assert.match(withStack, /at /);
  assert.match(formatCliError(new Error("")), /agent-bench failed: Error/);
  assert.match(formatCliError(undefined), /agent-bench failed: unknown error/);
});

test("findFreePort returns a port that is free even while 4173-style ports are taken", async () => {
  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, resolve));
  const taken = (blocker.address() as net.AddressInfo).port;
  try {
    const port = await findFreePort();
    assert.ok(port > 0);
    assert.notEqual(port, taken);
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, resolve);
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test("collectDescendants follows orphans by recorded parent id and skips older pid reuse", () => {
  const since = 1_000_000;
  const rows = [
    { pid: 10, ppid: 1, startedAt: since },          // the shell (root)
    { pid: 11, ppid: 10, startedAt: since + 50 },    // npm
    { pid: 12, ppid: 11, startedAt: since + 90 },    // vite preview
    { pid: 13, ppid: 10, startedAt: since - 60_000 }, // older process whose recorded parent id was reused
    { pid: 14, ppid: 99, startedAt: since + 10 }     // unrelated
  ];
  assert.deepEqual(collectDescendants(rows, 10, since).sort(), [11, 12]);
});

const trapTask = {
  key: "t",
  traps: [{ id: "double-delete", description: "d" }, { id: "two-tabs", description: "t" }],
  sandbox: { trapCommand: "npx playwright test", trapsDir: "traps" }
} as unknown as BenchmarkTaskRecord;

function trapDirs(): { workspaceDir: string; artifactsDir: string; trapsSourceDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-bench-trapstep-"));
  const dirs = { workspaceDir: path.join(root, "ws"), artifactsDir: path.join(root, "art"), trapsSourceDir: path.join(root, "src-traps") };
  Object.values(dirs).forEach((dir) => mkdirSync(dir, { recursive: true }));
  writeFileSync(path.join(dirs.trapsSourceDir, "traps.config.ts"), "export default {}");
  return dirs;
}

test("runTrapStep passes a fresh AGENT_BENCH_TRAP_PORT to the trap command", async () => {
  const dirs = trapDirs();
  let seenEnv: Record<string, string> = {};
  const { results, port } = await runTrapStep({
    task: trapTask,
    runnerSucceeded: true,
    pickPort: async () => 51234,
    run: async (command, env) => {
      seenEnv = env;
      writeFileSync(path.join(dirs.workspaceDir, "trap-results.json"), JSON.stringify({
        suites: [{ title: "x", specs: [{ title: "double-delete: a", ok: true, tests: [{ status: "expected" }] }, { title: "two-tabs: b", ok: false, tests: [{ status: "unexpected" }] }] }]
      }));
      return { command, cwd: dirs.workspaceDir, exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false, provider: "process", networkAccess: "enabled", stdoutTruncated: false, stderrTruncated: false };
    },
    ...dirs
  });
  assert.equal(seenEnv[TRAP_PORT_ENV], "51234");
  assert.equal(port, 51234);
  assert.deepEqual(results.map((result) => result.status), ["pass", "fail"]);
  assert.equal(JSON.parse(readFileSync(path.join(dirs.artifactsDir, "traps.json"), "utf8")).port, 51234);
});

test("a trap command that dies before any test ran marks every trap 'error' with the first output line", async () => {
  const dirs = trapDirs();
  const { results } = await runTrapStep({
    task: trapTask,
    runnerSucceeded: true,
    pickPort: async () => 4173,
    run: async (command) => ({
      command, cwd: dirs.workspaceDir, exitCode: 1,
      stdout: "",
      stderr: "\n> npx playwright test\nError: http://localhost:4173 is already used, make sure that nothing is running on the port\n    at x",
      durationMs: 1, timedOut: false, provider: "process", networkAccess: "enabled", stdoutTruncated: false, stderrTruncated: false
    }),
    ...dirs
  });
  assert.deepEqual(results.map((result) => result.status), ["error", "error"]);
  assert.match(results[0].detail ?? "", /^Error: http:\/\/localhost:4173 is already used/);

  // Exit 0 with no tests stays "unknown"; a run with tests keeps pass/fail.
  assert.equal(resolveTrapResults(trapTask.traps!, [], { exitCode: 0, stdout: "", stderr: "" })[0].status, "unknown");
  assert.equal(resolveTrapResults(trapTask.traps!, [], { exitCode: null, timedOut: true, stdout: "", stderr: "" })[0].detail, "trap command timed out before any test ran");
  assert.equal(firstOutputLine("\n\n"), null);
});

test("selectKillTargets skips a known pid that Windows reused for an unrelated process", () => {
  const since = 1_000_000;
  // Seen during the run: root 10 and its child 11.
  const known = new Map<number, KnownProcess>([
    [10, { startedAt: since, lastSeenMs: since }],
    [11, { startedAt: since + 50, lastSeenMs: since + 50 }]
  ]);
  const rows = [
    { pid: 10, ppid: 1, startedAt: since + 90_000 },   // pid 10 reused by an unrelated process
    { pid: 11, ppid: 10, startedAt: since + 50 },      // our child, still alive
    { pid: 20, ppid: 10, startedAt: since + 95_000 },  // child of the unrelated reused pid 10
    { pid: 21, ppid: 11, startedAt: since + 100 }      // grandchild of our child
  ];
  assert.deepEqual(selectKillTargets(rows, 10, known, since).sort(), [11, 21]);
});

test("selectKillTargets uses an unseen root only when it started after the run began", () => {
  const since = 1_000_000;
  const rows = [
    { pid: 10, ppid: 1, startedAt: since - 60_000 },
    { pid: 11, ppid: 10, startedAt: since + 50 }
  ];
  assert.deepEqual(selectKillTargets(rows, 10, new Map(), since), []);
});

test("selectKillTargets still follows orphans of a root that already exited", () => {
  const since = 1_000_000;
  const rows = [{ pid: 11, ppid: 10, startedAt: since + 50 }];
  assert.deepEqual(selectKillTargets(rows, 10, new Map(), since), [11]);
});

test("selectKillTargets does not adopt a stranger's child after a dead pid was reused", () => {
  const since = 1_000_000;
  // Our launcher held pid 10 and was last seen two seconds into the run. It is
  // gone from the live table now, so it still works as a root for its orphans.
  const known = new Map<number, KnownProcess>([[10, { startedAt: since, lastSeenMs: since + 2_000 }]]);
  const rows = [
    // A genuine orphan: started while we still knew the launcher was alive.
    { pid: 11, ppid: 10, startedAt: since + 1_500 },
    // Windows handed pid 10 to a stranger an hour later; this is the stranger's
    // child. `sinceMs` does not exclude it, because the run is still going.
    { pid: 20, ppid: 10, startedAt: since + 3_600_000 }
  ];
  assert.deepEqual(selectKillTargets(rows, 10, known, since).sort(), [11]);
});

test("collectDescendants honours a per-root start-time ceiling", () => {
  const since = 1_000_000;
  const rows = [
    { pid: 11, ppid: 10, startedAt: since + 100 },
    { pid: 12, ppid: 11, startedAt: since + 200 },
    { pid: 20, ppid: 10, startedAt: since + 90_000 }
  ];
  const ceiling = new Map([[10, since + 1_000]]);
  // The ceiling is inherited down the tree, so 12 survives with its parent.
  assert.deepEqual(collectDescendants(rows, 10, since, ceiling).sort(), [11, 12]);
  assert.deepEqual(collectDescendants(rows, 10, since).sort(), [11, 12, 20]);
});
