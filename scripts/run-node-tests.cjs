#!/usr/bin/env node
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function collectTestFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const distTestsDir = path.resolve(process.cwd(), 'dist', 'tests');
const testFiles = collectTestFiles(distTestsDir);

if (testFiles.length === 0) {
  console.error(`No compiled tests found under ${distTestsDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
