import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// LIVE CORS verification against the REAL provider endpoints, keyless.
//
// This spec makes real outbound network calls (allowed — runtime AI calls are
// exempt from the zero-network-at-LOAD rule), so it is OFF by default and only
// runs with LITE_LIVE_CORS=1. It serves the built single file over
// http://127.0.0.1 (a real Origin — file:// would send `Origin: null`, which
// some providers reject) and asserts the Test-connection probe reports the
// provider is REACHABLE (i.e. CORS is open — a keyless probe expectedly gets a
// 401/400 the browser CAN read), NOT "CORS-blocked".
//
// Run: LITE_LIVE_CORS=1 npx playwright test \
//        -c lite/tests/e2e/playwright.lite.config.ts lite-live-cors

const LIVE = process.env.LITE_LIVE_CORS === '1'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')

let server: Server
let baseURL = ''

test.beforeAll(async () => {
  if (!LIVE) return
  const html = readFileSync(DIST, 'utf8')
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  baseURL = `http://127.0.0.1:${port}/`
})

test.afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()))
})

test.describe('live CORS probe against real endpoints', () => {
  test.skip(!LIVE, 'set LITE_LIVE_CORS=1 (and have internet) to run real-network CORS probes')

  for (const provider of ['OpenRouter', 'Anthropic', 'Google Gemini']) {
    test(`${provider} is reachable from the browser (CORS open)`, async ({ page }) => {
      await page.addInitScript(() => {
        // @ts-expect-error force fallback so no native folder dialog blocks us
        delete window.showDirectoryPicker
      })
      await page.goto(baseURL, { waitUntil: 'load' })
      await page.getByRole('button', { name: /New blank diagram/i }).click()
      await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })

      await page.getByRole('button', { name: /Settings/i }).first().click()
      const section = page
        .getByRole('dialog', { name: /Settings/i })
        .getByRole('region', { name: provider })
      await section.getByRole('button', { name: 'Test connection' }).click()

      // Keyless probe: a readable 401/400 ⇒ "Reachable (CORS OK)". A thrown
      // TypeError (CORS block / no egress) ⇒ "CORS-blocked". We require the
      // former, which is the whole point of shipping these three providers.
      const verdict = section.getByRole('status')
      await expect(verdict).toBeVisible({ timeout: 30_000 })
      await expect(verdict).toContainText(/Reachable/i)
      await expect(verdict).not.toContainText(/CORS-blocked/i)
    })
  }
})
