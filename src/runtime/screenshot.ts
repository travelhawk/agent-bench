import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Renders a workspace's `index.html` to a PNG for use as multimodal evidence in
 * the judge. Everything here is best-effort and guarded: Playwright is imported
 * dynamically (it is only a dev dependency), and any failure resolves to null so
 * a run never breaks just because a screenshot could not be produced.
 *
 * Enabled by the caller (AGENT_BENCH_JUDGE_SCREENSHOT); the Chromium binary can
 * be pinned with AGENT_BENCH_CHROMIUM_PATH when the bundled build is unavailable.
 */
export async function renderWorkspaceScreenshot(workspaceDir: string, outPngPath: string): Promise<string | null> {
  const entry = path.join(workspaceDir, "index.html");
  if (!existsSync(entry)) return null;

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }

  const executablePath = process.env.AGENT_BENCH_CHROMIUM_PATH?.trim() || undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`file://${entry}`, { waitUntil: "load", timeout: 15000 });
    await page.screenshot({ path: outPngPath, fullPage: true });
    return outPngPath;
  } catch {
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

export function judgeScreenshotEnabled(): boolean {
  const raw = (process.env.AGENT_BENCH_JUDGE_SCREENSHOT ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
