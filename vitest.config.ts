import { defineConfig, configDefaults } from 'vitest/config'

// Unit tests run under vitest (`npm test`). The Playwright-Electron e2e specs
// live in tests/e2e and are driven by `npm run test:e2e` (see playwright.config.ts)
// — exclude them here so vitest doesn't try to collect them (they call
// @playwright/test's test() which throws outside the Playwright runner).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**']
  }
})
