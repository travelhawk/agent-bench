#!/usr/bin/env node
/**
 * The published entrypoint. Its only job is to check the Node version before
 * anything reaches for `node:sqlite`.
 *
 * ES imports are hoisted, so this guard cannot live in the CLI module itself:
 * `src/index.ts` imports the schema, which imports `node:sqlite` at load time,
 * so on an older Node the process dies with a raw "No such built-in module"
 * stack before commander ever parses argv — and `agent-bench doctor`, the
 * command whose whole job is to say "install a newer Node", can never print.
 */

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
// node:sqlite exists from 22.5.0, but needed --experimental-sqlite until 22.13.0.
const supported = major > 22 || (major === 22 && minor >= 13);

if (!supported) {
  process.stderr.write(
    [
      `agent-bench needs Node 22.13 or newer. This is Node v${process.versions.node}.`,
      "Runs are stored with the built-in node:sqlite module, which older versions",
      "do not expose without a command-line flag.",
      "",
      "Install Node 24 LTS and run the command again.",
      ""
    ].join("\n")
  );
  process.exit(1);
}

require("./index");
