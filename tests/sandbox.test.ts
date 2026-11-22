import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  resolveCommandLookupSpec,
  resolveShellSpec,
  runSandboxedCommand,
  stopActiveChildren,
  supportsDockerSandbox
} from "../src/runtime/sandbox";

/**
 * Windows releases a killed process's handles after the kill call returns, so a
 * plain rmSync on its working directory can still fail with EPERM. Retry.
 */
function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}


test("resolveCommandLookupSpec uses where on Windows and which elsewhere", () => {
  assert.deepEqual(resolveCommandLookupSpec("node", "win32"), {
    bin: "where",
    args: ["node"]
  });
  assert.deepEqual(resolveCommandLookupSpec("node", "linux"), {
    bin: "which",
    args: ["node"]
  });
});

test("resolveShellSpec stays platform-aware for host runs and posix for containers", () => {
  assert.deepEqual(resolveShellSpec("echo ok", "win32"), {
    bin: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", "echo ok"]
  });
  assert.deepEqual(resolveShellSpec("echo ok", "linux"), {
    bin: "/bin/sh",
    args: ["-c", "echo ok"]
  });
});

function supportsDockerPythonSmoke(): boolean {
  if (!supportsDockerSandbox()) return false;
  const inspect = spawnSync("docker", ["image", "inspect", "python:3.11-slim"], {
    stdio: "ignore",
    timeout: 3000
  });
  return inspect.status === 0;
}

test("runSandboxedCommand can execute inside the docker provider when available", { skip: !supportsDockerPythonSmoke() }, async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-docker-"));
  const previousProvider = process.env.AGENT_BENCH_SANDBOX_PROVIDER;
  const previousImage = process.env.AGENT_BENCH_SANDBOX_DOCKER_IMAGE;

  try {
    const workspaceDir = path.join(workspace, "workspace");
    const artifactsDir = path.join(workspace, "artifacts");
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    process.env.AGENT_BENCH_SANDBOX_PROVIDER = "docker";
    process.env.AGENT_BENCH_SANDBOX_DOCKER_IMAGE = "python:3.11-slim";

    const result = await runSandboxedCommand({
      command: [
        "python -c",
        JSON.stringify("import os, pathlib; target = pathlib.Path(os.environ['AGENT_BENCH_WORKSPACE']) / 'from-docker.txt'; target.write_text('ok'); print(target.read_text())")
      ].join(" "),
      cwd: workspaceDir,
      workspaceDir,
      artifactsDir,
      timeoutMs: 15000,
      allowNetwork: false,
      label: "docker-smoke",
      env: {
        AGENT_BENCH_WORKSPACE: workspaceDir
      }
    });

    assert.equal(result.provider, "docker");
    assert.equal(result.networkAccess, "disabled");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "ok");
    assert.equal(existsSync(path.join(workspaceDir, "from-docker.txt")), true);
    assert.equal(existsSync(path.join(artifactsDir, "docker-smoke.docker.json")), true);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.AGENT_BENCH_SANDBOX_PROVIDER;
    } else {
      process.env.AGENT_BENCH_SANDBOX_PROVIDER = previousProvider;
    }

    if (previousImage === undefined) {
      delete process.env.AGENT_BENCH_SANDBOX_DOCKER_IMAGE;
    } else {
      process.env.AGENT_BENCH_SANDBOX_DOCKER_IMAGE = previousImage;
    }

    removeDir(workspace);
  }
});

test("stopActiveChildren kills a running detached command (used by the SIGINT/SIGTERM handler)", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-bench-sigint-"));
  const previousProvider = process.env.AGENT_BENCH_SANDBOX_PROVIDER;
  process.env.AGENT_BENCH_SANDBOX_PROVIDER = "process";
  try {
    writeFileSync(path.join(root, "hold.js"), "setTimeout(() => {}, 60000);\n");
    const started = Date.now();
    const pending = runSandboxedCommand({
      command: "node hold.js",
      cwd: root,
      workspaceDir: root,
      artifactsDir: root,
      timeoutMs: 60000,
      allowNetwork: false,
      label: "sigint",
      killLeftovers: true
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await stopActiveChildren();
    const result = await pending;
    assert.ok(Date.now() - started < 30000, "command should end well before its timeout");
    assert.equal(result.timedOut, false);
    assert.equal(result.provider, "process");
  } finally {
    if (previousProvider === undefined) delete process.env.AGENT_BENCH_SANDBOX_PROVIDER;
    else process.env.AGENT_BENCH_SANDBOX_PROVIDER = previousProvider;
    removeDir(root);
  }
});
