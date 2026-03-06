import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export type RuntimeSandboxProvider = "process" | "macos-seatbelt";

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
  timeoutMs: number;
  allowNetwork: boolean;
  label: string;
  env?: Record<string, string | undefined>;
  providerApiKey?: string;
  model?: string;
}

const SANDBOX_PROVIDER_ENV = "AGENT_BENCH_SANDBOX_PROVIDER";
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

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export function resolveSandboxProvider(preferred?: string): RuntimeSandboxProvider {
  const raw = (preferred ?? process.env[SANDBOX_PROVIDER_ENV] ?? "auto").trim().toLowerCase();
  if (raw === "process") return "process";
  if (raw === "macos-seatbelt" || raw === "sandbox-exec") {
    return commandExists("sandbox-exec") ? "macos-seatbelt" : "process";
  }

  if (process.platform === "darwin" && commandExists("sandbox-exec")) {
    return "macos-seatbelt";
  }

  return "process";
}

function resolveRealDir(inputPath: string): string {
  mkdirSync(inputPath, { recursive: true });
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

function buildSandboxEnv(input: {
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

export async function runSandboxedCommand(input: RunSandboxedCommandInput): Promise<SandboxCommandResult> {
  const provider = resolveSandboxProvider();
  const workspaceDir = resolveRealDir(input.workspaceDir);
  const artifactsDir = resolveRealDir(input.artifactsDir);
  const tempDir = resolveRealDir(path.join(artifactsDir, "sandbox-tmp"));
  const env = buildSandboxEnv({
    tempDir,
    env: input.env,
    providerApiKey: input.providerApiKey,
    model: input.model
  });
  const spec = shellSpec(input.command);

  let bin = spec.bin;
  let args = spec.args;
  let profilePath: string | undefined;
  if (provider === "macos-seatbelt") {
    profilePath = path.join(artifactsDir, `${input.label}.sb`);
    writeFileSync(profilePath, buildSeatbeltProfile({
      workspaceDir,
      artifactsDir,
      tempDir,
      allowNetwork: input.allowNetwork
    }), "utf8");
    bin = "/usr/bin/sandbox-exec";
    args = ["-f", profilePath, spec.bin, ...spec.args];
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
