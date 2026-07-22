import { defineConfig } from '@playwright/test'

// End-to-end suite for the OrbitPM Process Studio Electron app (D1).
//
// Each spec launches the *built* app (out/main/index.js) via Playwright's
// _electron.launch and drives the real renderer UI. The app must be built
// first (`npm run build`) — see tests/e2e/harness.ts for the launch details.
//
// Runs headed under the ambient DISPLAY (:0) — no xvfb in this environment.
// Serial (workers: 1) because the app takes a single-instance lock and shares
// one X display. Screenshots + traces on failure land in tests/e2e/artifacts
// (gitignored); the harness captures them manually since these tests manage
// the Electron context directly rather than using Playwright's `page` fixture.
export default defineConfig({
  // Relative paths are resolved by Playwright against this config's directory.
  testDir: './tests/e2e',
  outputDir: './tests/e2e/artifacts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
