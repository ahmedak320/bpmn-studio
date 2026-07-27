import { defineConfig } from '@playwright/test'

// Browser tests load the freshly built `dist/index.html` directly over
// file:// to prove the shipped artifact is self-contained.
//
// Headless by design: headed chromium requires a live DISPLAY, which caused a
// ~4h hang in the CI/agent sandbox (no display => Playwright blocks waiting
// for a browser window that never appears). bpmn-js renders fully in headless
// chromium (real Canvas/SVG, no GPU dependency), so headed mode bought no
// coverage — only risk. Keep headless:true here; do not reintroduce headed
// mode without a display-detection guard.
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 60_000,
  globalTimeout: 600_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' }
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' }
    }
  ]
})
