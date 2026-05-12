const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { groupChanges, renderReleaseNotes } = require("../src/index.js");

test("groupChanges groups entries by known type and sorts text alphabetically", () => {
  const grouped = groupChanges([
    { type: "fixed", text: "zeta" },
    { type: "added", text: "beta" },
    { type: "fixed", text: "alpha" },
    { type: "unknown", text: "skip me" }
  ]);

  assert.deepEqual(grouped, {
    added: ["beta"],
    fixed: ["alpha", "zeta"]
  });
});

test("renderReleaseNotes returns stable markdown output", () => {
  const output = renderReleaseNotes({
    version: "1.4.0",
    date: "2026-05-01",
    changes: [
      { type: "fixed", text: "Correct invoice tax rounding." },
      { type: "docs", text: "Document the billing retry policy." },
      { type: "added", text: "Add draft invoice preview." },
      { type: "fixed", text: "Avoid duplicate reminder emails." }
    ]
  });

  assert.equal(output, [
    "# Release 1.4.0",
    "Date: 2026-05-01",
    "",
    "## Added",
    "- Add draft invoice preview.",
    "",
    "## Fixed",
    "- Avoid duplicate reminder emails.",
    "- Correct invoice tax rounding.",
    "",
    "## Docs",
    "- Document the billing retry policy."
  ].join("\n"));
});

test("cli prints release notes for the seeded fixture", () => {
  const fixturePath = path.join(__dirname, "..", "fixtures", "changes.json");
  const result = spawnSync(process.execPath, ["src/index.js", fixturePath], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Release 1\.4\.0/);
  assert.match(result.stdout, /## Fixed/);
});

*** Add File: D:\DevProjects\private\agent-bench\benchmarks\product-builds\fixtures\simple-feedback-web-app\package.json
{
  "name": "simple-feedback-web-app-fixture",
  "private": true,
  "type": "commonjs"
}

