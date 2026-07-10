const fs = require("node:fs");
const path = require("node:path");

const reportPath = path.join(process.cwd(), "audit-findings.json");

// Graded verifier: each content requirement is one check. A partially-correct
// report earns partial credit via the AGENT_BENCH_CHECKS marker; the command
// still exits non-zero unless every check passes.
const CONTENT_CHECKS = 7;

function reject(message) {
  console.error(message);
  console.log(`AGENT_BENCH_CHECKS: 0/${CONTENT_CHECKS}`);
  process.exit(1);
}

if (!fs.existsSync(reportPath)) {
  reject("Expected audit-findings.json in the workspace root.");
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  reject(`audit-findings.json is not valid JSON: ${error.message}`);
}

if (!Array.isArray(parsed) || parsed.length !== 1) {
  reject("audit-findings.json must be a JSON array with exactly one finding.");
}

const finding = parsed[0] || {};
const file = String(finding.file || "").replace(/\\/g, "/");
const title = String(finding.title || "").toLowerCase();
const evidence = String(finding.evidence || "").toLowerCase();
const remediation = String(finding.remediation || "").toLowerCase();

const checks = [
  ["id is command-injection", finding.id === "command-injection"],
  ["severity is high", String(finding.severity || "").toLowerCase() === "high"],
  ["file points at src/server.js", file.endsWith("src/server.js")],
  ["line is a plausible number", typeof finding.line === "number" && finding.line >= 1 && finding.line <= 20],
  ["title mentions command injection", title.includes("command injection")],
  ["evidence cites exec and req.query.cmd", evidence.includes("exec") && evidence.includes("req.query.cmd")],
  ["remediation describes a safe replacement", remediation.includes("allowlist") || remediation.includes("execfile") || remediation.includes("avoid shell")]
];

const passed = checks.filter(([, ok]) => ok).length;
console.log(`AGENT_BENCH_CHECKS: ${passed}/${checks.length}`);
checks.filter(([, ok]) => !ok).forEach(([label]) => console.error(`missing: ${label}`));

if (passed < checks.length) {
  process.exit(1);
}

console.log("security audit verifier passed");
