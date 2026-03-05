import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { RunInput, RuntimeEvaluationRequest } from "../types";

export function newRunKey(): string {
  return `run-${randomUUID()}`;
}

export async function runEvaluationInRuntime(input: RuntimeEvaluationRequest): Promise<RunInput> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agent-bench-runtime-"));
  const requestPath = path.join(tempDir, "request.json");
  const resultPath = path.join(tempDir, "result.json");
  const runtimeScriptPath = path.resolve(__dirname, "..", "runtime", "evaluator.js");

  writeFileSync(requestPath, JSON.stringify(input, null, 2));

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [runtimeScriptPath, requestPath, resultPath], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const detail = stderr.trim();
          reject(new Error(detail || `Runtime evaluator failed with exit code ${code}.`));
          return;
        }
        resolve();
      });
    });

    const raw = readFileSync(resultPath, "utf8");
    return JSON.parse(raw) as RunInput;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
