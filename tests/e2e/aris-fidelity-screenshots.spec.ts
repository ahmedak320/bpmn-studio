import {
  expect,
  test,
  webkit,
  type BrowserContext,
  type Locator,
  type Page
} from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

// Lane E3 — Real-browser fidelity gates and non-gated screenshot evidence for
// the two iterate AnimalWF models. The built single file is served over a
// loopback HTTP origin so the same real OPFS path is exercised in every engine.

test.describe.configure({ mode: 'serial' })

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

const ITERATE_MODELS = [
  {
    key: 'renew-profile',
    modelId: 'Model.-1rUudxIp-wP-u-L',
    occurrenceCount: 46
  },
  {
    key: 'register-owner',
    modelId: 'Model.3xqe8yXO9Z7-u-L',
    occurrenceCount: 94
  }
] as const

let loopbackServer: Server
let HTTP_URL = ''

test.beforeAll(async () => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
  loopbackServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html)
    })
    response.end(html)
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    loopbackServer.once('error', rejectListen)
    loopbackServer.listen(0, '127.0.0.1', () => {
      loopbackServer.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = loopbackServer.address() as AddressInfo
  HTTP_URL = `http://127.0.0.1:${address.port}/index.html`
})

test.afterAll(
  () =>
    new Promise<void>((resolveClose, rejectClose) => {
      loopbackServer.close((error) => (error ? rejectClose(error) : resolveClose()))
    })
)

/** Opens the built ARIS shell's landing screen over the loopback HTTP origin. */
async function gotoLanding(page: Page): Promise<void> {
  await disableAutoTranslate(page)
  await page.goto(HTTP_URL, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

function modelLayer(page: Page, modelId: string): Locator {
  return page.locator(`[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"]`)
}

function occurrencesOf(page: Page, modelId: string): Locator {
  return modelLayer(page, modelId).locator('g.djs-element[data-element-id^="ObjOcc."]')
}

test('iterate models render exact occurrence counts without symbol fallbacks and capture viewport evidence', async ({
  browserName,
  page
}) => {
  test.setTimeout(300_000)

  // Real OPFS needs the same WebKit accommodation the pre-retarget OPFS test
  // used (see lite-mandatory-reliability.spec.ts). Playwright's WPE MiniBrowser
  // ships StorageAPI/FileSystem/FileSystemWritableStream/AccessHandle but
  // disables them by default, and a browser.newContext() page does not inherit
  // MiniBrowser's --features flags — only a persistent context launched directly
  // with them does.
  let webkitOpfsContext: BrowserContext | undefined
  let opfsPage = page

  if (browserName === 'webkit') {
    webkitOpfsContext = await webkit.launchPersistentContext('', {
      headless: true,
      locale: undefined,
      args: ['--features=StorageAPI,FileSystem,FileSystemWritableStream,AccessHandle']
    })
    opfsPage = webkitOpfsContext.pages()[0] ?? (await webkitOpfsContext.newPage())
    opfsPage.setDefaultTimeout(30_000)
    opfsPage.setDefaultNavigationTimeout(30_000)
  }

  try {
    await opfsPage.setViewportSize({ width: 1600, height: 1000 })
    await gotoLanding(opfsPage)

    // Open a real OPFS ("Browser workspace") connection.
    await opfsPage
      .getByRole('button', { name: 'Open browser workspace' })
      .click({ timeout: 40_000 })
    const banner = opfsPage.getByRole('banner')
    await expect(banner).toContainText('Browser workspace', { timeout: 40_000 })

    await opfsPage.getByRole('button', { name: 'Open file…', exact: true }).click()
    await opfsPage.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
    await expect(opfsPage.locator('[data-orbitpm-aris-model]')).toHaveCount(8, {
      timeout: 120_000
    })
    await opfsPage
      .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
      .first()
      .waitFor({ state: 'attached', timeout: 120_000 })

    for (const model of ITERATE_MODELS) {
      const modelButton = opfsPage.locator(`[data-orbitpm-aris-model="${model.modelId}"]`)
      await modelButton.click()
      await expect(modelButton).toHaveAttribute('aria-current', 'true')

      const layer = modelLayer(opfsPage, model.modelId)
      await expect(layer).toBeAttached({ timeout: 120_000 })
      await expect
        .poll(async () => occurrencesOf(opfsPage, model.modelId).count(), {
          timeout: 120_000
        })
        .toBe(model.occurrenceCount)

      // A fidelity marker means the renderer fell back from the source symbol.
      await expect(layer.locator('[data-aris-fidelity]')).toHaveCount(0)

      const functionOccurrences = occurrencesOf(opfsPage, model.modelId).filter({
        has: opfsPage.locator('[data-aris-symbol^="MT_EEPC:OT_FUNC:"]')
      })
      await expect
        .poll(async () => functionOccurrences.locator('text[data-aris-caption]').count())
        .toBeGreaterThan(0)
      // Numbering is a distinct read-only attribute label inside the same
      // function occurrence; assert it explicitly so the evidence shows the
      // small process-code boxes as well as ordinary function captions.
      await expect
        .poll(async () => functionOccurrences.locator('text[data-aris-attribute-label]').count())
        .toBeGreaterThan(0)

      await opfsPage.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
      await opfsPage.screenshot({
        path: resolve(HERE, `../../test-results/fidelity/${model.key}-${browserName}.png`),
        fullPage: false
      })
    }
  } finally {
    await webkitOpfsContext?.close()
  }
})
