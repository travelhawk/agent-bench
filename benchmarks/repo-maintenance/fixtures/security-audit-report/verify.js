const fs = require("node:fs");
const path = require("node:path");

const reportPath = path.join(process.cwd(), "audit-findings.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(reportPath)) {
  fail("Expected audit-findings.json in the workspace root.");
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  fail(`audit-findings.json is not valid JSON: ${error.message}`);
}

if (!Array.isArray(parsed)) {
  fail("audit-findings.json must be a JSON array.");
}

if (parsed.length !== 1) {
  fail("audit-findings.json must contain exactly one finding.");
}

const finding = parsed[0] || {};
const file = String(finding.file || "").replace(/\\/g, "/");
const title = String(finding.title || "").toLowerCase();
const evidence = String(finding.evidence || "").toLowerCase();
const remediation = String(finding.remediation || "").toLowerCase();

if (finding.id !== "command-injection") {
  fail("Expected finding id to be command-injection.");
}

if (String(finding.severity || "").toLowerCase() !== "high") {
  fail("Expected severity to be high.");
}

if (!file.endsWith("src/server.js")) {
  fail("Expected finding file to end with src/server.js.");
}

if (typeof finding.line !== "number" || finding.line < 1 || finding.line > 20) {
  fail("Expected finding line to be a reasonable line number inside src/server.js.");
}

if (!title.includes("command injection")) {
  fail("Expected the finding title to mention command injection.");
}

if (!evidence.includes("exec") || !evidence.includes("req.query.cmd")) {
  fail("Expected evidence to mention exec and req.query.cmd.");
}

if (!remediation.includes("allowlist") && !remediation.includes("execfile") && !remediation.includes("avoid shell")) {
  fail("Expected remediation to describe a safe replacement such as an allowlist or execFile.");
}

console.log("security audit verifier passed");

