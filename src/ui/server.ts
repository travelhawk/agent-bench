import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function resolveNextBinary(workspaceRoot: string): string {
  const binaryName = process.platform === "win32" ? "next.cmd" : "next";
  return path.join(workspaceRoot, "node_modules", ".bin", binaryName);
}

export function startUi(dbPath: string, port: number): void {
  const workspaceRoot = process.cwd();
  const nextBinary = resolveNextBinary(workspaceRoot);

  if (!existsSync(nextBinary)) {
    throw new Error("Next.js is not installed. Run `pnpm install` before starting the full-stack UI.");
  }

  const mode = existsSync(path.join(workspaceRoot, ".next")) ? "start" : "dev";
  const child = spawn(nextBinary, [mode, "--port", String(port)], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      AGENT_BENCH_DB_PATH: dbPath,
      PORT: String(port)
    },
    stdio: "inherit"
  });

  child.on("error", (error) => {
    throw error;
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
