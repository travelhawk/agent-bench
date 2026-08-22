import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureWorkspaceVisuals, visualArtifactsEnabled, visualVideoEnabled } from "../src/runtime/screenshot";

async function canLaunchChromium(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const executablePath = process.env.AGENT_BENCH_CHROMIUM_PATH?.trim() || undefined;
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

test("visual artifact toggles default to enabled and honor opt-out", () => {
  const previousVisuals = process.env.AGENT_BENCH_VISUALS;
  const previousVideo = process.env.AGENT_BENCH_VISUAL_VIDEO;

  try {
    delete process.env.AGENT_BENCH_VISUALS;
    delete process.env.AGENT_BENCH_VISUAL_VIDEO;
    assert.equal(visualArtifactsEnabled(), true);
    assert.equal(visualVideoEnabled(), true);

    process.env.AGENT_BENCH_VISUALS = "false";
    process.env.AGENT_BENCH_VISUAL_VIDEO = "0";
    assert.equal(visualArtifactsEnabled(), false);
    assert.equal(visualVideoEnabled(), false);
  } finally {
    if (previousVisuals === undefined) delete process.env.AGENT_BENCH_VISUALS; else process.env.AGENT_BENCH_VISUALS = previousVisuals;
    if (previousVideo === undefined) delete process.env.AGENT_BENCH_VISUAL_VIDEO; else process.env.AGENT_BENCH_VISUAL_VIDEO = previousVideo;
  }
});

test("captureWorkspaceVisuals resolves to null artifacts when there is no index.html", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-visuals-"));

  try {
    const artifacts = path.join(workspace, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    const visuals = await captureWorkspaceVisuals(workspace, artifacts);
    assert.deepEqual(visuals, { screenshotFile: null, videoFile: null });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("captureWorkspaceVisuals renders a screenshot and a scroll video for index.html", async (t) => {
  if (!(await canLaunchChromium())) {
    t.skip("Chromium unavailable on this host (set AGENT_BENCH_CHROMIUM_PATH to enable)");
    return;
  }

  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-visuals-"));

  try {
    const artifacts = path.join(workspace, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(path.join(workspace, "index.html"), [
      "<!doctype html><html><head><title>Demo</title></head><body>",
      "<h1>Landing page</h1>",
      "<div style=\"height:2400px;background:linear-gradient(#fff,#88f)\">tall content</div>",
      "<footer>bottom</footer>",
      "</body></html>"
    ].join(""));

    const visuals = await captureWorkspaceVisuals(workspace, artifacts);

    assert.equal(visuals.screenshotFile, "page.png");
    assert.ok(existsSync(path.join(artifacts, "page.png")));
    assert.ok(statSync(path.join(artifacts, "page.png")).size > 0);

    assert.equal(visuals.videoFile, "page.webm");
    assert.ok(existsSync(path.join(artifacts, "page.webm")));
    assert.ok(statSync(path.join(artifacts, "page.webm")).size > 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
