import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Hidden checks for the Haushaltsbuch task. agent-bench copies this folder to
// <workspace>/traps after the build finished; the agent never sees it.
// Each test name starts with the trap id from the task's `## Traps` section.
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: '*.trap.ts',
  outputDir: './.results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../trap-results.json', import.meta.url)) }]],
  use: { baseURL: 'http://localhost:4173', acceptDownloads: true },
  webServer: {
    // vite directly: a type error must not hide data-loss bugs from the traps.
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    cwd: root,
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
