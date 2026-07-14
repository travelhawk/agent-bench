import assert from "node:assert/strict";
import test from "node:test";
import { isNodeTestRunnerCommand, parseNodeTestTapSummary, parseVerifierChecksMarker } from "../src/runtime/test-summary";

test("isNodeTestRunnerCommand recognizes node --test invocations", () => {
  assert.equal(isNodeTestRunnerCommand("node --test tests/*.test.js"), true);
  assert.equal(isNodeTestRunnerCommand("node verify.js"), false);
  assert.equal(isNodeTestRunnerCommand("node ./run-checks.js --test-mode"), false);
});

test("parseNodeTestTapSummary extracts pass/fail/total counts from TAP output", () => {
  const stdout = [
    "TAP version 13",
    "# tests 3",
    "# suites 0",
    "# pass 2",
    "# fail 1",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 12.345"
  ].join("\n");

  const summary = parseNodeTestTapSummary(stdout);
  assert.deepEqual(summary, { available: true, total: 3, passed: 2, failed: 1 });
});

test("parseNodeTestTapSummary returns null when the summary lines are missing", () => {
  assert.equal(parseNodeTestTapSummary("some unrelated custom verify.js output"), null);
});

test("parseVerifierChecksMarker reads a custom verifier's graded checks marker", () => {
  assert.deepEqual(parseVerifierChecksMarker("noise\nAGENT_BENCH_CHECKS: 5/7\nmore noise"), {
    available: true, total: 7, passed: 5, failed: 2
  });
  assert.deepEqual(parseVerifierChecksMarker("AGENT_BENCH_CHECKS: 7/7"), {
    available: true, total: 7, passed: 7, failed: 0
  });
});

test("parseVerifierChecksMarker rejects a missing or malformed marker", () => {
  assert.equal(parseVerifierChecksMarker("landing page verifier passed"), null);
  assert.equal(parseVerifierChecksMarker("AGENT_BENCH_CHECKS: 9/7"), null); // passed > total
  assert.equal(parseVerifierChecksMarker("AGENT_BENCH_CHECKS: 1/0"), null); // total 0
});
