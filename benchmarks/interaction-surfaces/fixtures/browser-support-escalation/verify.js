const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const resultPath = path.join(process.cwd(), "result", "browser-escalation.json");
assert.equal(fs.existsSync(resultPath), true, "expected result/browser-escalation.json to exist");

const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

assert.equal(result.caseId, "CASE-2048");
assert.equal(result.decision, "escalate-to-engineering");
assert.equal(result.priority, "P1");
assert.equal(result.owner, "revenue-platform");
assert.ok(Array.isArray(result.evidence), "expected evidence array");
assert.ok(result.evidence.length >= 2, "expected at least two evidence items");
assert.ok(
  typeof result.note === "string" &&
  result.note.toLowerCase().includes("coupon sync rollback") &&
  result.note.toLowerCase().includes("har"),
  "expected note to mention coupon sync rollback and HAR capture"
);

console.log("browser-support-escalation fixture verified");
