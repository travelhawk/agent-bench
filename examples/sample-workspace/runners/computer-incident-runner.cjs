const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const workspace = process.env.AGENT_BENCH_WORKSPACE;
  const alerts = readJson(path.join(workspace, "desktop", "alerts.json"));
  const terminalLog = fs.readFileSync(path.join(workspace, "desktop", "terminal.log"), "utf8");
  const runbook = fs.readFileSync(path.join(workspace, "desktop", "runbook.md"), "utf8");
  const ticket = fs.readFileSync(path.join(workspace, "desktop", "ticket.txt"), "utf8");

  fs.mkdirSync(path.join(workspace, "result"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "result", "incident-plan.json"), JSON.stringify({
    incidentId: alerts.incidentId,
    severity: alerts.severity,
    suspectedComponent: "token-cache",
    immediateActions: [
      "Disable stale token reuse before worker restart.",
      "Restart cache worker pool after the guardrail flag is off."
    ],
    recoveryPlan: [
      "Validate refresh latency is back below 1.5s.",
      "Keep identity-oncall engaged until customer re-login failures stop."
    ],
    evidence: [
      `alerts.json: ${alerts.symptoms[0]}`,
      `terminal.log: ${terminalLog.split(/\r?\n/)[2]}`,
      `runbook.md: ${runbook.split(/\r?\n/)[1]}`,
      `ticket.txt: ${ticket.split(/\r?\n/)[0]}`
    ]
  }, null, 2));
}

main();
