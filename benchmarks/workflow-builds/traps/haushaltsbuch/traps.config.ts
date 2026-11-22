import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Hidden checks for the Haushaltsbuch task. agent-bench copies this folder to
// <workspace>/traps after the build finished; the agent never sees it.
// Each test name starts with the trap id from the task's `## Traps` section.
const root = fileURLToPath(new URL('..', import.meta.url))
// agent-bench picks a free port per trap run (AGENT_BENCH_TRAP_PORT), so a
// server the build left on 4173 cannot block the checks.
const port = Number(process.env.AGENT_BENCH_TRAP_PORT) || 4173

export default defineConfig({
  testDir: '.',
  testMatch: '*.trap.ts',
  outputDir: './.results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../trap-results.json', import.meta.url)) }]],
  use: { baseURL: `http://localhost:${port}`, acceptDownloads: true },
  webServer: {
    // vite directly: a type error must not hide data-loss bugs from the traps.
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    cwd: root,
    port,
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
