import { execFile } from "node:child_process";
import net from "node:net";

/** Env var the trap command gets: a port that was free right before it started. */
export const TRAP_PORT_ENV = "AGENT_BENCH_TRAP_PORT";

/**
 * Asks the OS for a free TCP port. Listens without a host so the port is free
 * on both IPv4 and IPv6 (vite/playwright may bind either `localhost` flavour).
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("Could not allocate a free port."))));
    });
  });
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** Start time in ms since epoch, or null when unknown. */
  startedAt: number | null;
}

/**
 * Every process that descends from `rootPid` and started at or after
 * `sinceMs`. Orphans keep their recorded parent id on Windows, so this still
 * finds a `vite preview` whose shell already exited. The start-time filter
 * guards against pid reuse by unrelated older processes.
 */
export function collectDescendants(rows: ProcessRow[], rootPid: number | number[], sinceMs: number): number[] {
  const roots = Array.isArray(rootPid) ? rootPid : [rootPid];
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const found: number[] = [];
  const seen = new Set<number>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.pid)) continue;
      if (child.startedAt != null && child.startedAt + 1000 < sinceMs) continue;
      seen.add(child.pid);
      found.push(child.pid);
      queue.push(child.pid);
    }
  }
  return found;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout));
    });
  });
}

async function listProcesses(): Promise<ProcessRow[]> {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { '-' })\" }";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return out.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 3).map(([pid, ppid, started]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      startedAt: started === "-" ? null : Number(started)
    })).filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.ppid));
  }
  // POSIX: orphans get re-parented to init, so only still-attached descendants are found here;
  // the sandbox also kills the child's process group, which covers the rest.
  const out = await run("ps", ["-A", "-o", "pid=,ppid="]);
  return out.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 2).map(([pid, ppid]) => ({
    pid: Number(pid),
    ppid: Number(ppid),
    startedAt: null
  })).filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}

/**
 * Watches the process tree of a running command, so an intermediate parent
 * that exits early (npm/npx/a spawner) does not hide the server it started.
 * `stop()` kills everything still alive that descends from the root or from
 * any process seen in the tree. Best effort: never throws.
 */
export function watchProcessTree(rootPid: number | undefined, sinceMs: number, intervalMs = 3000): { stop: () => Promise<number[]> } {
  const known = new Set<number>();
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  const snapshot = async () => {
    if (!rootPid || busy) return;
    busy = true;
    try {
      for (const pid of collectDescendants(await listProcesses(), [rootPid, ...known], sinceMs)) known.add(pid);
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  };
  if (rootPid) {
    timer = setInterval(() => void snapshot(), intervalMs);
    timer.unref();
    // Early snapshots catch short-lived launchers (npx, npm run) before they exit.
    for (const delay of [200, 700, 1500]) {
      if (delay < intervalMs) setTimeout(() => void snapshot(), delay).unref();
    }
  }
  return {
    stop: async () => {
      if (timer) clearInterval(timer);
      if (!rootPid) return [];
      try {
        if (process.platform !== "win32") {
          try {
            process.kill(-rootPid, "SIGKILL");
          } catch {
            // group already gone
          }
        }
        const rows = await listProcesses();
        const alive = new Set(rows.map((row) => row.pid));
        const targets = new Set<number>([
          ...[...known].filter((pid) => alive.has(pid)),
          ...collectDescendants(rows, [rootPid, ...known], sinceMs)
        ]);
        targets.delete(process.pid);
        for (const pid of targets) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // already exited
          }
        }
        return [...targets];
      } catch {
        return [];
      }
    }
  };
}
