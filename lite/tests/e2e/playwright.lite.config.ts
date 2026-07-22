import { defineConfig } from '@playwright/test'

// Playwright config for the Lite single-file smoke test. Run from the desktop/
// repo root (where @playwright/test + the chromium browser are installed):
//
//   DISPLAY=:0 npx playwright test -c lite/tests/e2e/playwright.lite.config.ts
//
// It loads the BUILT lite/dist/index.html directly over file:// — no dev
// server — to prove the shipped artifact is self-contained.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    headless: false, // headed chromium on DISPLAY=:0 (real bpmn-js rendering)
    acceptDownloads: true
  },
  projects: [
    {
      name: 'chromium-lite',
      use: { browserName: 'chromium' }
    }
  ]
})
