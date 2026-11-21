import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolvePackagedBenchmarksDir, resolvePackagedEnvSample, resolvePackagedExamplesDir } from "../src/server/config";

/**
 * `init` seeds a fresh workspace from these directories, so they must resolve to
 * the package's data and not to compiled code. Resolving "benchmarks" by name
 * used to find `dist/src/benchmarks` — the compiled module directory — and
 * seeded a workspace with `files.js` and `metadata.js` instead of suites.
 */
test("the packaged benchmarks directory holds suites, not compiled modules", () => {
  const dir = resolvePackagedBenchmarksDir();
  assert.ok(dir, "benchmarks directory should resolve from inside the package");

  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  assert.deepEqual(files, [], `expected only suite directories, found ${files.join(", ")}`);

  const suites = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const suite of ["repo-maintenance", "product-builds", "creative-frontend", "workflow-builds"]) {
    assert.ok(suites.includes(suite), `shipped suite ${suite} is missing from ${dir}`);
  }
});

test("the packaged example workspace resolves to the shipped agents", () => {
  const dir = resolvePackagedExamplesDir();
  assert.ok(dir, "example workspace should resolve from inside the package");
  assert.equal(path.basename(dir), "sample-workspace");

  const agents = readdirSync(path.join(dir, "agents"));
  for (const agent of ["claude-code.md", "model-coder.md", "blind-reviewer"]) {
    assert.ok(agents.includes(agent), `shipped agent ${agent} is missing`);
  }
});

test("the packaged env sample resolves, so init can seed a workspace that has none", () => {
  const sample = resolvePackagedEnvSample();
  assert.ok(sample, "the .env.sample template should resolve from inside the package");
  assert.equal(path.basename(sample), ".env.sample");
});
