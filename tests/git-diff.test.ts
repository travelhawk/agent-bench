import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeWorkspaceGitDiffStats, initWorkspaceGitBaseline } from "../src/runtime/git-diff";

test("initWorkspaceGitBaseline and computeWorkspaceGitDiffStats detect changes made after the baseline", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-git-diff-"));

  try {
    writeFileSync(path.join(workspace, "file.txt"), "line one\n");

    const initialized = initWorkspaceGitBaseline(workspace);
    assert.equal(initialized, true);

    writeFileSync(path.join(workspace, "file.txt"), "line one\nline two\n");
    writeFileSync(path.join(workspace, "new-file.txt"), "brand new\n");

    const diff = computeWorkspaceGitDiffStats(workspace);
    assert.equal(diff.available, true);
    assert.equal(diff.filesChanged, 2);
    assert.ok(diff.insertions >= 2);
    assert.ok(diff.patch.includes("new-file.txt"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("computeWorkspaceGitDiffStats reports unavailable without a git baseline", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "agent-bench-git-diff-"));

  try {
    const diff = computeWorkspaceGitDiffStats(workspace);
    assert.equal(diff.available, false);
    assert.equal(diff.filesChanged, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
