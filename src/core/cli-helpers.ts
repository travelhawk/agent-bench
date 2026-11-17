/** `--trials <n>`: runs per setup, clamped to 1-5. Rejects non-numbers instead of silently running once. */
export function parseTrialsOption(value: unknown): number {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--trials must be a number from 1 to 5, got "${String(value)}".`);
  }
  return Math.min(5, Math.floor(parsed));
}

/** Top-level CLI errors: always a message, plus the stack when there is one. */
export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || error.name || "Unknown error";
    const stack = error.stack && !error.stack.includes(message) ? `${message}\n${error.stack}` : error.stack;
    return `agent-bench failed: ${stack ?? message}`;
  }
  const text = typeof error === "string" ? error : JSON.stringify(error);
  return `agent-bench failed: ${text || "unknown error (no message)"}`;
}
