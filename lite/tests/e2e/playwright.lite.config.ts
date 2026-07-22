import { defineConfig } from '@playwright/test'

// Playwright config for the Lite single-file smoke test. Run from the desktop/
// repo root (where @playwright/test + the chromium browser are installed):
//
//   npx playwright test -c lite/tests/e2e/playwright.lite.config.ts
//
// It loads the BUILT lite/dist/index.html directly over file:// — no dev
// server — to prove the shipped artifact is self-contained.
//
// Headless by design: headed chromium requires a live DISPLAY, which caused a
// ~4h hang in the CI/agent sandbox (no display => Playwright blocks waiting
// for a browser window that never appears). bpmn-js renders fully in headless
// chromium (real Canvas/SVG, no GPU dependency), so headed mode bought no
// coverage — only risk. Keep headless:true here; do not reintroduce headed
// mode without a display-detection guard.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  globalTimeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium-lite',
      use: { browserName: 'chromium' }
    }
  ]
})
