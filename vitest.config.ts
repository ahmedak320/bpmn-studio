import { defineConfig, configDefaults } from 'vitest/config'

// Unit tests run under vitest (`npm test`). The Playwright-Electron e2e specs
// live in tests/e2e and are driven by `npm run test:e2e` (see playwright.config.ts)
// — exclude them here so vitest doesn't try to collect them (they call
// @playwright/test's test() which throws outside the Playwright runner).
export default defineConfig({
  test: {
    // `lite/**` is the standalone single-file web editor subproject (its own
    // package.json, deps, vitest + Playwright configs). It is intentionally
    // isolated from this app's build/test — exclude it so the desktop suite
    // neither collects its unit tests nor trips over its Playwright specs.
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'lite/**']
  }
})
