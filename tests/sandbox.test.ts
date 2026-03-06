import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runSandboxedCommand, supportsDockerSandbox } from "../src/runtime/sandbox";

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

    rmSync(workspace, { recursive: true, force: true });
  }
});
