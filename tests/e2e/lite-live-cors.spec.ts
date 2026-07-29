import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// LIVE CORS verification against the REAL provider endpoints, keyless.
//
// Retargeted from the pre-ARIS BPMN Lite shell (plan §5.3 removed the "New
// blank diagram" dialog and the bpmn-js canvas this spec used to boot
// through). The Settings dialog and its per-provider "Test connection" probe
// are retained Phase-1 infrastructure — same component (SettingsDialogLite,
// dialog name "Settings — AI keys") lite-providers.spec.ts already retargeted
// — so only the bootstrap changes: the ARIS shell reaches its "ready" phase
// by importing the real reference AML export, not by opening a blank BPMN
// diagram. See tests/e2e/lite-providers.spec.ts and
// tests/e2e/aris-i18n-rtl.spec.ts for the same pattern.
//
// The tagged release gate sets LITE_LIVE_CORS=1 and makes real outbound
// network calls (allowed — runtime AI calls are exempt from the zero-network-
// at-load rule). Ordinary local runs use deterministic readable 401 responses
// so the same UI/classification assertions still execute without a network
// dependency. It serves the built single file over
// http://127.0.0.1 (a real Origin — file:// would send `Origin: null`, which
// some providers reject) and asserts the Test-connection probe reports the
// provider is REACHABLE (i.e. CORS is open — a keyless probe expectedly gets a
// 401/400 the browser CAN read), NOT "CORS-blocked".
//
// Run: LITE_LIVE_CORS=1 npx playwright test tests/e2e/lite-live-cors.spec.ts

const LIVE = process.env.LITE_LIVE_CORS === '1'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

let server: Server
let baseURL = ''

test.beforeAll(async () => {
  const html = readFileSync(DIST, 'utf8')
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
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
  for (const provider of ['OpenRouter', 'Anthropic', 'Google Gemini']) {
    test(`${provider} is reachable from the browser (CORS open)`, async ({ page }) => {
      if (!LIVE) {
        await page.route(
          /https:\/\/(?:openrouter\.ai|api\.anthropic\.com|generativelanguage\.googleapis\.com)\//,
          async (route) => {
            await route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ error: { message: 'deterministic keyless probe' } })
            })
          }
        )
      }
      await page.addInitScript(() => {
        localStorage.clear()
        Object.defineProperty(window, 'showDirectoryPicker', {
          configurable: true,
          value: undefined
        })
        Object.defineProperty(window, 'showOpenFilePicker', {
          configurable: true,
          value: undefined
        })
        Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
      })
      await page.goto(baseURL, { waitUntil: 'load' })
      await page
        .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
        .waitFor({ state: 'visible' })
      await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
      // The reference export parses 8 models; Playwright's default 5s expect
      // timeout is occasionally too tight for this under Firefox/WebKit
      // (observed flaky across every spec sharing this exact boot pattern) —
      // widen it here explicitly.
      await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 30_000 })
      await page
        .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
        .first()
        .waitFor({ state: 'attached' })

      await page
        .getByRole('banner')
        .getByRole('button', { name: '⚙ Settings', exact: true })
        .click()
      const section = page
        .getByRole('dialog', { name: 'Settings — AI keys', exact: true })
        .getByRole('region', { name: provider })
      await section
        .getByRole('checkbox', { name: /small inference request that may be billable/i })
        .check()
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
