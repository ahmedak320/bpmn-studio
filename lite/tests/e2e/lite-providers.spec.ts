import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const FIXTURE_PDF = resolve(HERE, 'fixtures/tiny.pdf')

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

function recordOffendingRequests(page: import('@playwright/test').Page): string[] {
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    offending.push(`${req.method()} ${url}`)
  })
  return offending
}

async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Get into the ready 3-zone app (fallback mode) with the AI panel mounted. */
async function openApp(page: import('@playwright/test').Page): Promise<void> {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
}

test('Settings lists all four browser providers, each with Test connection', async ({ page }) => {
  const offending = recordOffendingRequests(page)
  await openApp(page)

  await page.getByRole('button', { name: /Settings/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /Settings/i })
  await expect(dialog).toBeVisible()

  // All four provider sections are present.
  for (const label of ['OpenRouter', 'Anthropic', 'Google Gemini', 'Custom OpenAI-compatible']) {
    await expect(dialog.getByRole('region', { name: label })).toBeVisible()
  }
  // One "Test connection" button per provider (the CORS-vs-auth probe).
  await expect(dialog.getByRole('button', { name: 'Test connection' })).toHaveCount(4)

  // The unencrypted-storage warning is shown.
  await expect(dialog.getByText(/stored unencrypted in this browser profile/i)).toBeVisible()

  // The Custom endpoint exposes base URL + model + extra-headers fields.
  await expect(dialog.getByLabel('Base URL')).toBeVisible()
  await expect(dialog.getByLabel('Model id')).toBeVisible()
  await expect(dialog.getByLabel('Extra headers')).toBeVisible()

  // Opening Settings made ZERO network requests (we haven't probed yet).
  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})

test('AI panel documents the updated browser-capable provider set', async ({ page }) => {
  await openApp(page)
  // OpenRouter is now a browser-capable provider alongside Anthropic/Gemini.
  await expect(page.getByText(/can be called directly from a web page/i)).toBeVisible()
  await expect(page.getByText(/Reach GLM, Kimi, and DeepSeek through OpenRouter/i)).toBeVisible()
  await expect(page.getByText(/don.?t allow browser \(CORS\) access/i)).toBeVisible()
})

test('PDF flow: pick a PDF + Arabic hint, hit the no-key provider gate', async ({ page }) => {
  const offending = recordOffendingRequests(page)
  await openApp(page)

  // Switch the AI panel to the PDF source.
  await page.getByRole('tab', { name: /From PDF/i }).click()

  // The default provider (OpenRouter, no key) supports PDF → the file input is
  // present. Select the tiny fixture PDF.
  const fileInput = page.locator('input[type="file"][accept*="pdf"]')
  await fileInput.setInputFiles(FIXTURE_PDF)

  // The chosen file name + size are surfaced (and it's within the size gate).
  await expect(page.getByText(/tiny\.pdf/i)).toBeVisible()

  // The "which process?" hint accepts Arabic text (RTL, no translation).
  const arabicHint = 'عملية استلام الطلب'
  const hint = page.getByPlaceholder(/Which process from this document|العملية المطلوبة/i)
  await hint.fill(arabicHint)
  await expect(hint).toHaveValue(arabicHint)

  // With no API key stored, the UX stops at the provider gate (not a crash).
  await expect(page.getByText(/No key stored for OpenRouter/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Generate from PDF/i })).toBeDisabled()

  // The whole PDF-selection UX path ran with zero network requests (no key, no
  // send) — proving the client-side flow up to the gate.
  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})

test('switching to the Custom provider disables the PDF source', async ({ page }) => {
  await openApp(page)
  await page.getByLabel('Provider').selectOption('custom')
  // Custom has no verified PDF path — the From PDF tab is disabled.
  await expect(page.getByRole('tab', { name: /From PDF/i })).toBeDisabled()
})
