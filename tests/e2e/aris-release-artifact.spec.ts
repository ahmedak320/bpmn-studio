import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Plan §21.5 — artifact verification, run on Chromium, Firefox and WebKit.
//
// `npm run test:aris:file-smoke` (scripts/aris-file-smoke.mjs) already drives
// the EXACT release artifact over file:// with an EN/AR + LTR/RTL matrix and a
// zero-unexpected-request allow-list — but it launches Chromium directly, so
// §21.5's "Pass Chromium/Firefox/WebKit" is unproven for the shipped file. This
// spec closes exactly that gap and nothing else: it runs under the standard
// Playwright projects, against `release/OrbitPM-ARIS-Studio-Lite.html` rather
// than `dist/index.html`.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const RELEASE = resolve(HERE, '../../release/OrbitPM-ARIS-Studio-Lite.html')
const RELEASE_URL = pathToFileURL(RELEASE).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

test.beforeAll(() => {
  expect(statSync(RELEASE, { throwIfNoEntry: false })?.isFile(), `missing ${RELEASE}`).toBe(true)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
})

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Requests a self-contained file:// page is allowed to make at rest. Everything
 * else — including a single font, a single analytics beacon or a source map —
 * is a §21.5 violation.
 */
function isPermitted(url: string): boolean {
  return (
    url.startsWith('file://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url === 'about:blank'
  )
}

async function openRelease(
  page: Page,
  language: 'en' | 'ar'
): Promise<{ requests: string[]; consoleErrors: string[] }> {
  const requests: string[] = []
  const consoleErrors: string[] = []
  page.on('request', (request) => {
    if (!isPermitted(request.url())) requests.push(`${request.method()} ${request.url()}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript((selected) => {
    localStorage.clear()
    localStorage.setItem('orbitpm.lite.lang', selected)
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  }, language)
  await page.goto(RELEASE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  return { requests, consoleErrors }
}

test('the release artifact is one self-contained file that is byte-identical to the built dist artifact', () => {
  const release = readFileSync(RELEASE)
  const dist = readFileSync(DIST)
  expect(release.byteLength).toBeGreaterThan(500_000)
  // §21.5 "be one file": no sibling asset, worker or template is referenced by
  // a relative URL that would have to sit next to the HTML.
  const text = release.toString('utf8')
  expect(text).not.toMatch(/<script[^>]+src="(?!data:)/u)
  expect(text).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="(?!data:)/u)
  // §21.5 "contain no API key": no provider secret was baked in at build time.
  expect(text).not.toMatch(/sk-[A-Za-z0-9]{20,}/u)
  // §21.5 "contain no private fixture": the AnimalWF export never ships.
  expect(text).not.toContain('ARISAMLExport')
  // §21.5 "be committed with every product-code push": the rolling artifact and
  // the build output are the same bytes.
  expect(sha256(RELEASE)).toBe(sha256(DIST))
  expect(release.equals(dist)).toBe(true)
})

for (const scenario of [
  {
    language: 'en' as const,
    dir: 'ltr',
    assistant: 'Assistant',
    assistantTitle: 'Process assistant',
    closeAssistant: 'Close assistant'
  },
  {
    language: 'ar' as const,
    dir: 'rtl',
    assistant: 'المساعد',
    assistantTitle: 'مساعد العمليات',
    closeAssistant: 'إغلاق المساعد'
  }
]) {
  test(`the exact release artifact runs from file:// in ${scenario.language}/${scenario.dir}, makes no request of its own, and imports the reference export`, async ({
    page
  }) => {
    const observed = await openRelease(page, scenario.language)

    await expect(page.locator('html')).toHaveAttribute('dir', scenario.dir)
    await expect(page.locator('html')).toHaveAttribute('lang', scenario.language)

    // §21.5 "make no unexpected request": nothing has been asked for at rest.
    expect(observed.requests).toEqual([])

    // §21.5 "work offline except explicit AI calls": the whole import, parse,
    // account and render pipeline runs with the network untouched.
    await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
    await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 120_000 })
    await page
      .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
      .first()
      .waitFor({ state: 'attached', timeout: 120_000 })
    await expect(page.locator('[data-orbitpm-aris-accounting]')).toBeVisible()
    await expect(page.locator('[data-orbitpm-aris-fidelity]')).toBeVisible()

    // The bilingual chrome is live in this exact file, in this exact engine.
    await page.getByRole('button', { name: scenario.assistant, exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: scenario.assistantTitle, exact: true })
    await expect(dialog).toBeVisible()
    await page.getByLabel(scenario.closeAssistant, { exact: true }).click()
    await expect(dialog).toBeHidden()

    expect(observed.requests).toEqual([])
    expect(observed.consoleErrors).toEqual([])
  })
}
