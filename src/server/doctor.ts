import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { listAgentFiles } from "../agents/files";
import { listBenchmarkSuitesFromFiles } from "../benchmarks/files";
import { createDb, initializeSchema } from "../db/schema";
import { resolveSandboxProvider } from "../runtime/sandbox";
import { resolveBenchmarksDir } from "./config";

/**
 * `agent-bench doctor` answers one question: can this machine run a comparison
 * right now? Every check therefore reports the fix next to the problem, and
 * only a genuine blocker is a FAIL — a missing gateway key still allows the
 * deterministic review path, so that is a WARN.
 */

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  summary: string;
}

/** node:sqlite landed in 22.5.0, so anything older cannot open the store at all. */
export function checkNodeVersion(version: string): DoctorCheck {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  const supported = major > 22 || (major === 22 && minor >= 5);
  if (!supported) {
    return {
      name: "Node",
      status: "fail",
      detail: `${version} has no node:sqlite`,
      fix: "Install Node 22.5 or newer (24 LTS recommended)."
    };
  }
  return {
    name: "Node",
    status: major >= 24 ? "pass" : "warn",
    detail: major >= 24 ? `${version} (node:sqlite stable)` : `${version} (node:sqlite is experimental before 24)`,
    fix: major >= 24 ? undefined : "Node 24 silences the experimental-sqlite warning."
  };
}

export function summarizeDoctorChecks(checks: DoctorCheck[]): { ok: boolean; summary: string } {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  const ok = failed === 0;
  if (!ok) {
    return { ok, summary: `${failed} blocker(s), ${warned} warning(s). Fix the FAIL lines above, then re-run doctor.` };
  }
  return {
    ok,
    summary: warned === 0
      ? "Ready. Try `agent-bench compare-models --models <a>,<b>`."
      : `Ready with ${warned} warning(s). Try \`agent-bench compare-models --models <a>,<b>\`.`
  };
}

function checkDatabase(dbPath: string): DoctorCheck {
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = createDb(dbPath);
    initializeSchema(db);
    db.close();
    return { name: "Database", status: "pass", detail: dbPath };
  } catch (error: unknown) {
    return {
      name: "Database",
      status: "fail",
      detail: `cannot open ${dbPath}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Point AGENT_BENCH_DB_PATH or --db at a writable location."
    };
  }
}

function checkGatewayKey(): DoctorCheck {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (key) return { name: "Gateway key", status: "pass", detail: "AI_GATEWAY_API_KEY is set" };
  return {
    name: "Gateway key",
    status: "warn",
    detail: "AI_GATEWAY_API_KEY is missing, so model-backed runs and the LLM judge cannot start",
    fix: "Put AI_GATEWAY_API_KEY=... in .env (https://vercel.com/ai-gateway), or pass --no-judge for rules-only review."
  };
}

function checkBenchmarks(workspaceRoot: string): DoctorCheck {
  const dir = resolveBenchmarksDir(workspaceRoot);
  if (!existsSync(dir)) {
    return {
      name: "Benchmarks",
      status: "fail",
      detail: `no benchmarks/ directory in ${workspaceRoot}`,
      fix: "Run `agent-bench init` here, or cd into a workspace that has one."
    };
  }
  const suites = listBenchmarkSuitesFromFiles(dir);
  const tasks = suites.reduce((total, suite) => total + suite.tasks.length, 0);
  if (tasks === 0) {
    return {
      name: "Benchmarks",
      status: "fail",
      detail: "benchmarks/ has no tasks",
      fix: "Add a task with `agent-bench init` or copy one from examples/sample-workspace/benchmarks/."
    };
  }
  return { name: "Benchmarks", status: "pass", detail: `${suites.length} suite(s), ${tasks} task(s)` };
}

function checkAgents(workspaceRoot: string): DoctorCheck {
  const agents = listAgentFiles(workspaceRoot);
  if (agents.length === 0) {
    return {
      name: "Agents",
      status: "fail",
      detail: `no agent definitions in ${workspaceRoot}`,
      fix: "Run `agent-bench init` to install the starter agents."
    };
  }
  const executable = agents.filter((agent) => agent.executionMode === "sandbox");
  if (executable.length === 0) {
    return {
      name: "Agents",
      status: "warn",
      detail: `${agents.length} agent(s), none executable — reviews only, nothing runs in the sandbox`,
      fix: "Add a `Runner:` line to an agent, or copy examples/sample-workspace/agents/model-coder.md."
    };
  }
  return {
    name: "Agents",
    status: "pass",
    detail: `${agents.length} agent(s), ${executable.length} executable (${executable.map((agent) => agent.name).join(", ")})`
  };
}

function checkSandbox(): DoctorCheck {
  const provider = resolveSandboxProvider();
  if (provider === "process") {
    return {
      name: "Sandbox",
      status: "warn",
      detail: "provider `process` — runs are not isolated and network denial is not enforced",
      fix: "Install Docker and set AGENT_BENCH_SANDBOX_PROVIDER=docker for isolated runs."
    };
  }
  return { name: "Sandbox", status: "pass", detail: `provider \`${provider}\`` };
}

export async function runDoctorChecks(input: { workspaceRoot: string; dbPath: string }): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    checkNodeVersion(process.version),
    checkDatabase(input.dbPath),
    checkGatewayKey(),
    checkBenchmarks(input.workspaceRoot),
    checkAgents(input.workspaceRoot),
    checkSandbox()
  ];
  return { checks, ...summarizeDoctorChecks(checks) };
}
