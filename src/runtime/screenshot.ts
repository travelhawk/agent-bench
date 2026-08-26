import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
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

/** Default-on visual artifacts (screenshot + video) for runs that produce an index.html. */
export function visualArtifactsEnabled(): boolean {
  const raw = (process.env.AGENT_BENCH_VISUALS ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export function visualVideoEnabled(): boolean {
  const raw = (process.env.AGENT_BENCH_VISUAL_VIDEO ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export interface WorkspaceVisuals {
  screenshotFile: string | null;
  videoFile: string | null;
}

const VIDEO_VIEWPORT = { width: 1280, height: 800 };
const MAX_VIDEO_SCROLL_STEPS = 12;

/**
 * Captures a full-page screenshot and a short scroll-through video of the
 * workspace's `index.html` so different workflows for the same task can be
 * compared visually from run history. Pure local Playwright rendering — no
 * model call is involved. Best-effort like the judge screenshot: any failure
 * (missing Playwright, missing browser, timeout) leaves that artifact null and
 * never fails the run.
 */
export async function captureWorkspaceVisuals(
  workspaceDir: string,
  artifactsPath: string,
  options: { video?: boolean } = {}
): Promise<WorkspaceVisuals> {
  const result: WorkspaceVisuals = { screenshotFile: null, videoFile: null };
  const entry = path.join(workspaceDir, "index.html");
  if (!existsSync(entry)) return result;

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return result;
  }

  const executablePath = process.env.AGENT_BENCH_CHROMIUM_PATH?.trim() || undefined;
  const url = `file://${entry}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const outPngPath = path.join(artifactsPath, "page.png");
      await page.goto(url, { waitUntil: "load", timeout: 15000 });
      await page.screenshot({ path: outPngPath, fullPage: true });
      await page.close();
      result.screenshotFile = "page.png";
    } catch {
      // screenshot stays null
    }

    if (options.video !== false && visualVideoEnabled()) {
      const videoTmpDir = mkdtempSync(path.join(os.tmpdir(), "agent-bench-video-"));
      try {
        const context = await browser.newContext({
          viewport: VIDEO_VIEWPORT,
          recordVideo: { dir: videoTmpDir, size: VIDEO_VIEWPORT }
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load", timeout: 15000 });
        // Scroll through the page so the video shows the whole deliverable,
        // bounded so a very tall page cannot produce an endless recording.
        await page.evaluate(async (maxSteps: number) => {
          const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
          await wait(600);
          const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
          const total = Math.max(document.body.scrollHeight - window.innerHeight, 0);
          for (let index = 1; index <= maxSteps && (index - 1) * step < total; index += 1) {
            window.scrollTo({ top: Math.min(index * step, total), behavior: "smooth" });
            await wait(450);
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
          await wait(700);
        }, MAX_VIDEO_SCROLL_STEPS);
        const video = page.video();
        await context.close();
        if (video) {
          const outVideoPath = path.join(artifactsPath, "page.webm");
          await video.saveAs(outVideoPath);
          result.videoFile = "page.webm";
        }
      } catch {
        // video stays null
      } finally {
        rmSync(videoTmpDir, { recursive: true, force: true });
      }
    }
  } catch {
    return result;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  return result;
}
