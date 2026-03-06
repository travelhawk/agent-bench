import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export type RuntimeSandboxProvider = "process" | "macos-seatbelt" | "docker";

export interface SandboxCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  provider: RuntimeSandboxProvider;
  networkAccess: "enabled" | "disabled";
  profilePath?: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface RunSandboxedCommandInput {
  command: string;
  cwd: string;
  workspaceDir: string;
  artifactsDir: string;
  readOnlyDirs?: string[];
  timeoutMs: number;
  allowNetwork: boolean;
  label: string;
  provider?: RuntimeSandboxProvider;
  env?: Record<string, string | undefined>;
  providerApiKey?: string;
  model?: string;
}

interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

const SANDBOX_PROVIDER_ENV = "AGENT_BENCH_SANDBOX_PROVIDER";
const SANDBOX_DOCKER_IMAGE_ENV = "AGENT_BENCH_SANDBOX_DOCKER_IMAGE";
const DEFAULT_DOCKER_IMAGE = "node:22-bookworm-slim";
const DOCKER_MOUNT_ROOT = "/agent-bench";
const OUTPUT_LIMIT_BYTES = 64 * 1024;
const SAFE_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NODE_ENV",
  "PATH",
  "SHELL",
  "TERM",
  "TMP",
  "TEMP",
  "USER",
  "__CF_USER_TEXT_ENCODING"
] as const;

let dockerAvailableCache: boolean | undefined;

function resolveCommandPath(command: string): string | null {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return null;
  const resolved = result.stdout.trim();
  return resolved || null;
}

function commandExists(command: string): boolean {
  return resolveCommandPath(command) !== null;
}

function dockerDaemonAvailable(): boolean {
  if (dockerAvailableCache !== undefined) return dockerAvailableCache;
  if (!commandExists("docker")) {
    dockerAvailableCache = false;
    return dockerAvailableCache;
  }

  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "ignore",
    timeout: 3000
  });
  dockerAvailableCache = result.status === 0;
  return dockerAvailableCache;
}

export function resolveSandboxProvider(preferred?: string): RuntimeSandboxProvider {
  const raw = (preferred ?? process.env[SANDBOX_PROVIDER_ENV] ?? "auto").trim().toLowerCase();
  if (raw === "process") return "process";
  if (raw === "docker") {
    return dockerDaemonAvailable() ? "docker" : "process";
  }
  if (raw === "macos-seatbelt" || raw === "sandbox-exec") {
    return process.platform === "darwin" && commandExists("sandbox-exec") ? "macos-seatbelt" : "process";
  }

  if (process.platform === "darwin" && commandExists("sandbox-exec")) {
    return "macos-seatbelt";
  }
  if (dockerDaemonAvailable()) {
    return "docker";
  }

  return "process";
}

function resolveRealDir(inputPath: string, create: boolean): string {
  if (create) {
    mkdirSync(inputPath, { recursive: true });
  }

  if (!existsSync(inputPath)) {
    throw new Error(`Sandbox path not found: ${inputPath}`);
  }

  return realpathSync(inputPath);
}

function escapeSeatbeltPath(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function buildSeatbeltProfile(input: {
  workspaceDir: string;
  artifactsDir: string;
  tempDir: string;
  allowNetwork: boolean;
}): string {
  return [
    "(version 1)",
    "(import \"system.sb\")",
    "(allow process*)",
    "(allow file-read*)",
    `(allow file-write* (subpath "${escapeSeatbeltPath(input.workspaceDir)}") (subpath "${escapeSeatbeltPath(input.artifactsDir)}") (subpath "${escapeSeatbeltPath(input.tempDir)}"))`,
    input.allowNetwork ? "(allow network*)" : "(deny network*)",
    ""
  ].join("\n");
}

function shellSpec(command: string): { bin: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      bin: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command]
    };
  }

  return {
    bin: "/bin/sh",
    args: ["-c", command]
  };
}

function appendOutput(current: string, chunk: Buffer, limitBytes: number): { value: string; truncated: boolean } {
  const currentBytes = Buffer.byteLength(current);
  if (currentBytes >= limitBytes) {
    return { value: current, truncated: true };
  }

  const remainingBytes = limitBytes - currentBytes;
  if (chunk.byteLength <= remainingBytes) {
    return { value: current + chunk.toString("utf8"), truncated: false };
  }

  return {
    value: current + chunk.subarray(0, remainingBytes).toString("utf8"),
    truncated: true
  };
}

function collectReadOnlyDirs(readOnlyDirs: string[], writableDirs: string[]): string[] {
  const writableSet = writableDirs.map((dir) => resolveRealDir(dir, true));
  const deduped = new Set<string>();

  readOnlyDirs.forEach((dir) => {
    if (!dir) return;
    const realDir = resolveRealDir(dir, false);
    const alreadyWritable = writableSet.some((writableDir) => realDir === writableDir || realDir.startsWith(`${writableDir}${path.sep}`));
    if (!alreadyWritable) {
      deduped.add(realDir);
    }
  });

  return [...deduped].sort((left, right) => left.localeCompare(right));
}

function buildDockerMounts(input: {
  workspaceDir: string;
  artifactsDir: string;
  readOnlyDirs: string[];
}): SandboxMount[] {
  const mounts: SandboxMount[] = [
    {
      hostPath: input.workspaceDir,
      containerPath: `${DOCKER_MOUNT_ROOT}/workspace`,
      readOnly: false
    },
    {
      hostPath: input.artifactsDir,
      containerPath: `${DOCKER_MOUNT_ROOT}/artifacts`,
      readOnly: false
    }
  ];

  input.readOnlyDirs.forEach((dir, index) => {
    mounts.push({
      hostPath: dir,
      containerPath: `${DOCKER_MOUNT_ROOT}/readonly/dir-${index}`,
      readOnly: true
    });
  });

  return mounts;
}

function normalizePathForMountLookup(inputPath: string): string {
  if (!path.isAbsolute(inputPath)) return inputPath;
  if (existsSync(inputPath)) {
    try {
      return realpathSync(inputPath);
    } catch {
      return path.resolve(inputPath);
    }
  }
  return path.resolve(inputPath);
}

function mapHostPathToContainer(inputPath: string, mounts: SandboxMount[]): string | null {
  const normalizedPath = normalizePathForMountLookup(inputPath);
  const match = mounts
    .filter((mount) => normalizedPath === mount.hostPath || normalizedPath.startsWith(`${mount.hostPath}${path.sep}`))
    .sort((left, right) => right.hostPath.length - left.hostPath.length)[0];

  if (!match) return null;
  const relativePath = path.relative(match.hostPath, normalizedPath);
  if (!relativePath || relativePath === ".") {
    return match.containerPath;
  }

  return path.posix.join(match.containerPath, ...relativePath.split(path.sep));
}

function buildProcessEnv(input: {
  tempDir: string;
  env?: Record<string, string | undefined>;
  providerApiKey?: string;
  model?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  SAFE_ENV_KEYS.forEach((key) => {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  });

  env.TMPDIR = input.tempDir;
  env.TMP = input.tempDir;
  env.TEMP = input.tempDir;

  if (input.providerApiKey?.trim()) {
    env.AGENT_BENCH_PROVIDER_API_KEY = input.providerApiKey.trim();
  }
  if (input.model?.trim()) {
    env.AGENT_BENCH_PROVIDER_MODEL = input.model.trim();
  }

  Object.entries(input.env ?? {}).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  });

  return env;
}

function buildDockerEnv(input: {
  containerTempDir: string;
  mounts: SandboxMount[];
  env?: Record<string, string | undefined>;
  providerApiKey?: string;
  model?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const nodeEnv = process.env.NODE_ENV?.trim();
  if (nodeEnv) {
    env.NODE_ENV = nodeEnv;
  }

  if (input.providerApiKey?.trim()) {
    env.AGENT_BENCH_PROVIDER_API_KEY = input.providerApiKey.trim();
  }
  if (input.model?.trim()) {
    env.AGENT_BENCH_PROVIDER_MODEL = input.model.trim();
  }

  Object.entries(input.env ?? {}).forEach(([key, value]) => {
    if (typeof value !== "string" || value.length === 0) return;
    if (path.isAbsolute(value)) {
      env[key] = mapHostPathToContainer(value, input.mounts) ?? value;
      return;
    }
    env[key] = value;
  });

  env.TMPDIR = input.containerTempDir;
  env.TMP = input.containerTempDir;
  env.TEMP = input.containerTempDir;
  return env;
}

function buildDockerInvocation(input: {
  command: string;
  cwd: string;
  mounts: SandboxMount[];
  allowNetwork: boolean;
  env: Record<string, string>;
  profilePath: string;
}): { bin: string; args: string[] } {
  const shell = shellSpec(input.command);
  const containerCwd = mapHostPathToContainer(input.cwd, input.mounts);
  if (!containerCwd) {
    throw new Error(`Docker sandbox cannot map cwd into the container: ${input.cwd}`);
  }
  const dockerBinary = resolveCommandPath("docker");
  if (!dockerBinary) {
    throw new Error("Docker binary not found for sandbox execution.");
  }

  const image = (process.env[SANDBOX_DOCKER_IMAGE_ENV] ?? DEFAULT_DOCKER_IMAGE).trim() || DEFAULT_DOCKER_IMAGE;
  const args = [
    "run",
    "--rm",
    "--init",
    "--workdir",
    containerCwd,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    process.env.AGENT_BENCH_SANDBOX_DOCKER_PIDS_LIMIT?.trim() || "256",
    "--memory",
    process.env.AGENT_BENCH_SANDBOX_DOCKER_MEMORY?.trim() || "1g",
    "--cpus",
    process.env.AGENT_BENCH_SANDBOX_DOCKER_CPUS?.trim() || "1.5",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m"
  ];

  if (!input.allowNetwork) {
    args.push("--network", "none");
  }

  input.mounts.forEach((mount) => {
    args.push(
      "--mount",
      `type=bind,src=${mount.hostPath},dst=${mount.containerPath}${mount.readOnly ? ",readonly" : ""}`
    );
  });

  Object.entries(input.env).forEach(([key, value]) => {
    args.push("-e", `${key}=${value}`);
  });

  args.push(image, shell.bin, ...shell.args);

  writeFileSync(input.profilePath, JSON.stringify({
    provider: "docker",
    image,
    allowNetwork: input.allowNetwork,
    containerCwd,
    mounts: input.mounts,
    env: input.env
  }, null, 2), "utf8");

  return {
    bin: dockerBinary,
    args
  };
}

export async function runSandboxedCommand(input: RunSandboxedCommandInput): Promise<SandboxCommandResult> {
  const provider = resolveSandboxProvider(input.provider);
  const workspaceDir = resolveRealDir(input.workspaceDir, true);
  const artifactsDir = resolveRealDir(input.artifactsDir, true);
  const tempDir = resolveRealDir(path.join(artifactsDir, "sandbox-tmp"), true);
  const readOnlyDirs = collectReadOnlyDirs(input.readOnlyDirs ?? [], [workspaceDir, artifactsDir]);

  let bin: string;
  let args: string[];
  let env: Record<string, string>;
  let profilePath: string | undefined;

  if (provider === "docker") {
    const mounts = buildDockerMounts({
      workspaceDir,
      artifactsDir,
      readOnlyDirs
    });
    const containerTempDir = path.posix.join(`${DOCKER_MOUNT_ROOT}/artifacts`, "sandbox-tmp");
    env = buildDockerEnv({
      containerTempDir,
      mounts,
      env: input.env,
      providerApiKey: input.providerApiKey,
      model: input.model
    });
    profilePath = path.join(artifactsDir, `${input.label}.docker.json`);
    const docker = buildDockerInvocation({
      command: input.command,
      cwd: input.cwd,
      mounts,
      allowNetwork: input.allowNetwork,
      env,
      profilePath
    });
    bin = docker.bin;
    args = docker.args;
  } else {
    env = buildProcessEnv({
      tempDir,
      env: input.env,
      providerApiKey: input.providerApiKey,
      model: input.model
    });
    const shell = shellSpec(input.command);
    bin = shell.bin;
    args = shell.args;

    if (provider === "macos-seatbelt") {
      profilePath = path.join(artifactsDir, `${input.label}.sb`);
      writeFileSync(profilePath, buildSeatbeltProfile({
        workspaceDir,
        artifactsDir,
        tempDir,
        allowNetwork: input.allowNetwork
      }), "utf8");
      bin = "/usr/bin/sandbox-exec";
      args = ["-f", profilePath, shell.bin, ...shell.args];
    }
  }

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: input.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2000);
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendOutput(stdout, chunk, OUTPUT_LIMIT_BYTES);
      stdout = next.value;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendOutput(stderr, chunk, OUTPUT_LIMIT_BYTES);
      stderr = next.value;
      stderrTruncated ||= next.truncated;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        command: input.command,
        cwd: input.cwd,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - started,
        timedOut,
        provider,
        networkAccess: input.allowNetwork ? "enabled" : "disabled",
        profilePath,
        stdoutTruncated,
        stderrTruncated
      });
    });
  });
}

export function supportsSeatbeltSandbox(): boolean {
  return resolveSandboxProvider("macos-seatbelt") === "macos-seatbelt";
}

export function supportsDockerSandbox(): boolean {
  return resolveSandboxProvider("docker") === "docker";
}
