const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const resultPath = path.join(process.cwd(), "result", "incident-plan.json");
assert.equal(fs.existsSync(resultPath), true, "expected result/incident-plan.json to exist");

const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

assert.equal(result.incidentId, "INC-442");
assert.equal(result.severity, "sev-1");
assert.equal(result.suspectedComponent, "token-cache");
assert.ok(Array.isArray(result.immediateActions), "expected immediateActions array");
assert.ok(
  result.immediateActions.some((entry) => String(entry).toLowerCase().includes("disable stale token reuse")),
  "expected disable stale token reuse action"
);
assert.ok(
  result.immediateActions.some((entry) => String(entry).toLowerCase().includes("restart cache worker")),
  "expected restart cache worker action"
);
assert.ok(Array.isArray(result.evidence), "expected evidence array");
assert.ok(
  result.evidence.some((entry) => String(entry).includes("alerts.json")) &&
  result.evidence.some((entry) => String(entry).includes("terminal.log")) &&
  result.evidence.some((entry) => String(entry).includes("runbook.md")),
  "expected evidence to cite alerts.json, terminal.log, and runbook.md"
);

console.log("computer-use-incident-drill fixture verified");
