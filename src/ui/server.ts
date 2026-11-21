import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const SHIM_NAME = process.platform === "win32" ? "next.cmd" : "next";

/**
 * Prefers Next's JavaScript entrypoint over the `node_modules/.bin` shim: since
 * Node 20.12 Windows refuses to spawn a `.cmd` file without a shell, so the shim
 * fails with EINVAL. Running the entrypoint with this process's own node binary
 * avoids both the shell and the platform difference.
 */
function resolveNextCommand(appRoot: string): { command: string; args: string[] } | null {
  try {
    const entrypoint = require.resolve("next/dist/bin/next", { paths: [appRoot, __dirname] });
    return { command: process.execPath, args: [entrypoint] };
  } catch {
    // Next is not resolvable from here; try the shim before giving up.
  }

  const shim = path.join(appRoot, "node_modules", ".bin", SHIM_NAME);
  return existsSync(shim) ? { command: shim, args: [] } : null;
}

export function startUi(dbPath: string, port: number): void {
  const appRoot = process.cwd();

  // Turbopack cannot treat a directory inside node_modules as a project root, so
  // the workbench only runs from a checkout. Say that instead of letting the
  // bundler fail later with "Could not find the Next.js package".
  if (!existsSync(path.join(appRoot, "app"))) {
    throw new Error(
      "The workbench needs the agent-bench repository, not just the installed CLI. " +
        "Clone https://github.com/travelhawk/agent-bench, run `pnpm install`, and start `agent-bench ui` there. " +
        "Every other command works from this directory."
    );
  }

  const next = resolveNextCommand(appRoot);
  if (!next) {
    throw new Error("Next.js is not installed. Run `pnpm install` before starting the full-stack UI.");
  }

  const mode = existsSync(path.join(appRoot, ".next")) ? "start" : "dev";
  const child = spawn(next.command, [...next.args, mode, "--port", String(port)], {
    cwd: appRoot,
    env: {
      ...process.env,
      AGENT_BENCH_DB_PATH: dbPath,
      PORT: String(port)
    },
    stdio: "inherit",
    // Only the shim needs a shell, and only on Windows; node is spawned directly.
    shell: next.command !== process.execPath && process.platform === "win32"
  });

  child.on("error", (error) => {
    throw error;
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
