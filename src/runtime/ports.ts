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
export function collectDescendants(
  rows: ProcessRow[],
  rootPid: number | number[],
  sinceMs: number,
  /**
   * Latest start time a descendant of that root may have, inherited down the
   * tree. `selectKillTargets` sets it for roots that have already exited; see
   * the note there on pid reuse.
   */
  startedBefore?: Map<number, number>
): number[] {
  const roots = Array.isArray(rootPid) ? rootPid : [rootPid];
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const found: number[] = [];
  const seen = new Set<number>(roots);
  const queue = roots.map((pid) => ({ pid, limit: startedBefore?.get(pid) }));
  while (queue.length > 0) {
    const { pid: parent, limit } = queue.shift()!;
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.pid)) continue;
      if (child.startedAt != null && child.startedAt + 1000 < sinceMs) continue;
      if (limit != null && child.startedAt != null && child.startedAt > limit) continue;
      seen.add(child.pid);
      found.push(child.pid);
      queue.push({ pid: child.pid, limit });
    }
  }
  return found;
}

/**
 * Enumerating the process table normally takes well under a second. The wait is
 * short because reaping leftovers is best effort and sits on the Ctrl-C path:
 * a 30 second bound here made quitting a run take 30 seconds whenever the
 * machine was loaded enough to stall PowerShell.
 */
const PROCESS_LIST_TIMEOUT_MS = 8_000;

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const options = { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: PROCESS_LIST_TIMEOUT_MS };
    execFile(bin, args, options, (error, stdout) => {
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

/** What the watcher remembers about a pid it saw during the run. */
export interface KnownProcess {
  /** Creation time, or null when the platform did not report one. */
  startedAt: number | null;
  /** When this pid was last confirmed alive, in ms since epoch. */
  lastSeenMs: number;
}

/**
 * How stale `lastSeenMs` may be: a child can appear between two snapshots, so
 * the bound has to be at least the watch interval plus clock skew.
 */
const REUSE_GRACE_MS = 15_000;

/**
 * Picks the pids `stop()` may kill. A pid counts only while the live process
 * still has the creation time we recorded, because Windows reuses pids and a
 * reused pid must neither be killed nor used as a tree root. An unseen root
 * counts only when it started after the run began.
 *
 * An exited pid stays a tree root, because an orphan keeps its id as the
 * recorded parent. That is also the dangerous case: once Windows hands the id
 * to a stranger, the stranger's children have our dead pid as their parent.
 * `sinceMs` does not catch them, since it is the start of the run and every
 * process born during the run passes it. So a dead root only adopts children
 * that started while we last knew it was alive.
 */
export function selectKillTargets(rows: ProcessRow[], rootPid: number, known: Map<number, KnownProcess>, sinceMs: number): number[] {
  const live = new Map(rows.map((row) => [row.pid, row]));
  const same = (pid: number) => {
    const row = live.get(pid);
    if (!row) return false;
    const seen = known.get(pid);
    if (seen) return seen.startedAt === row.startedAt;
    return row.startedAt != null && row.startedAt + 1000 >= sinceMs;
  };
  const candidates = [rootPid, ...known.keys()].filter((pid, index, all) => all.indexOf(pid) === index);
  const roots = candidates.filter((pid) => !live.has(pid) || same(pid));
  const startedBefore = new Map<number, number>();
  for (const pid of roots) {
    if (live.has(pid)) continue;
    const seen = known.get(pid);
    if (seen) startedBefore.set(pid, seen.lastSeenMs + REUSE_GRACE_MS);
  }
  const targets = new Set<number>([...roots.filter(same), ...collectDescendants(rows, roots, sinceMs, startedBefore)]);
  targets.delete(process.pid);
  return [...targets];
}

/**
 * Watches the process tree of a running command, so an intermediate parent
 * that exits early (npm/npx/a spawner) does not hide the server it started.
 * `stop()` kills everything still alive that descends from the root or from
 * any process seen in the tree, guarded by creation time against pid reuse.
 * On POSIX only the process group is killed. Best effort: never throws.
 *
 * Each snapshot is a full WMI process enumeration through PowerShell, and a
 * task may run for 90 minutes on the same machine whose wall time becomes the
 * efficiency score. The steady interval is therefore loose; the early snapshots
 * below are what catch a launcher that exits seconds in.
 */
export function watchProcessTree(rootPid: number | undefined, sinceMs: number, intervalMs = 10_000): { stop: () => Promise<number[]> } {
  const known = new Map<number, KnownProcess>();
  const isWindows = process.platform === "win32";
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  const snapshot = async () => {
    if (!rootPid || busy) return;
    busy = true;
    try {
      const rows = await listProcesses();
      const now = Date.now();
      for (const pid of selectKillTargets(rows, rootPid, known, sinceMs)) {
        const seen = known.get(pid);
        if (seen) seen.lastSeenMs = now;
        else known.set(pid, { startedAt: rows.find((row) => row.pid === pid)?.startedAt ?? null, lastSeenMs: now });
      }
    } catch {
      // ignore
    } finally {
      busy = false;
    }
  };
  if (rootPid && isWindows) {
    timer = setInterval(() => void snapshot(), intervalMs);
    timer.unref();
    // Early snapshots catch short-lived launchers (npx, npm run) before they exit.
    for (const delay of [0, 200, 700, 1500]) {
      if (delay < intervalMs) setTimeout(() => void snapshot(), delay).unref();
    }
  }
  return {
    stop: async () => {
      if (timer) clearInterval(timer);
      if (!rootPid) return [];
      if (!isWindows) {
        try {
          process.kill(-rootPid, "SIGKILL");
        } catch {
          // group already gone
        }
        return [];
      }
      try {
        const targets = selectKillTargets(await listProcesses(), rootPid, known, sinceMs);
        for (const pid of targets) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // already exited
          }
        }
        return targets;
      } catch {
        return [];
      }
    }
  };
}
