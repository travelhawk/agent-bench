const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function openTab(page, tab) {
  await page.locator(`button[data-tab-target="${tab}"]`).click();
}

async function main() {
  const workspace = process.env.AGENT_BENCH_WORKSPACE;
  const artifactsDir = process.env.AGENT_BENCH_ARTIFACTS_DIR;
  const consoleUrl = pathToFileURL(path.join(workspace, "app", "index.html")).href;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto(consoleUrl);

  const caseId = (await page.locator("[data-case-id]").textContent()).trim();

  await openTab(page, "timeline");
  const timeline = await page.locator("[data-timeline]").locator("li").allTextContents();

  await openTab(page, "billing");
  const decision = (await page.locator("[data-decision]").textContent()).trim();
  const priority = (await page.locator("[data-priority]").textContent()).trim();
  const owner = (await page.locator("[data-owner]").textContent()).trim();
  const guidance = (await page.locator("[data-note-guidance]").textContent()).trim();

  fs.mkdirSync(path.join(workspace, "result"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "result", "browser-escalation.json"), JSON.stringify({
    caseId,
    decision,
    priority,
    owner,
    note: "Escalating to engineering. Customer hit the coupon sync rollback edge case; request HAR capture before handoff.",
    evidence: [
      timeline[0],
      timeline[1],
      guidance
    ]
  }, null, 2));

  await page.screenshot({
    path: path.join(artifactsDir, "browser-support-console.png"),
    fullPage: true
  });
  await browser.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
