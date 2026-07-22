import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

/** Force the single-file fallback path (the File System Access folder picker
 *  opens a native dialog that can't be automated in CI). */
async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

test('language toggle: EN -> Arabic sets dir=rtl and translates chrome, then back to EN', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // Starts English, ltr.
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: /New process/i }).first()).toBeVisible()

  // Toggle to Arabic via the header language button.
  await page.getByRole('button', { name: /العربية/ }).click()

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

  // A known button now shows Arabic text (New process -> ＋ عملية جديدة).
  await expect(page.getByRole('button', { name: 'عملية جديدة', exact: false }).first()).toBeVisible()

  // Persisted across the toggle: localStorage carries the language.
  const stored = await page.evaluate(() => localStorage.getItem('orbitpm.lite.lang'))
  expect(stored).toBe('ar')

  // Toggle back to English (button label is now "EN").
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: /New process/i }).first()).toBeVisible()
})

test('create a process with an Arabic name (fallback mode) and export SVG containing the Arabic label', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })

  // Switch to Arabic first so the New-process dialog itself is Arabic too.
  await page.getByRole('button', { name: /العربية/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await page.getByRole('button', { name: /عملية جديدة/ }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('طلب العميل')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()

  const svg = page.locator('.djs-container svg').first()
  await expect(svg).toBeVisible({ timeout: 20_000 })

  // Programmatically set an element's label to Arabic text via the exposed
  // automation hook (bpmn-js's own label-editing UI can't be driven headlessly
  // in this harness), then assert the rendered SVG <tspan> contains it —
  // proves bpmn-js correctly renders/shapes Arabic glyphs on the canvas.
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
  const arabicLabel = 'مهمة الموافقة'
  await page.evaluate((label) => {
    const w = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const m = w.__ORBITPM_LITE__.modeler
    const modeling = m.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): unknown
      updateLabel(element: unknown, text: string): void
    }
    const elementFactory = m.get('elementFactory') as {
      createShape(attrs: { type: string }): unknown
    }
    const canvas = m.get('canvas') as { getRootElement(): unknown }
    const task = elementFactory.createShape({ type: 'bpmn:Task' }) as { businessObject?: unknown }
    const shape = modeling.createShape(task, { x: 420, y: 220 }, canvas.getRootElement())
    modeling.updateLabel(shape, label)
  }, arabicLabel)

  // The SVG canvas now renders a <tspan> containing the Arabic text.
  await expect(page.locator('.djs-container svg tspan', { hasText: arabicLabel })).toBeVisible({
    timeout: 10_000
  })

  // Export SVG: the downloaded file's content contains the Arabic string.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'تصدير SVG' }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const svgText = Buffer.concat(chunks).toString('utf8')
  expect(svgText).toContain('<svg')
  expect(svgText).toContain(arabicLabel)
})

test('the bpmn-js canvas region stays LTR even while the app chrome is Arabic/RTL', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /العربية/ }).click()
  await page.getByRole('button', { name: /عملية جديدة/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click()

  const editor = page.locator('.orbitpm-editor')
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await expect(editor).toHaveAttribute('dir', 'ltr')

  // ...while the app root stays rtl.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})
