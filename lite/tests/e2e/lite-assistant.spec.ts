import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

/** Force the single-file fallback path (the folder picker opens a native dialog
 *  that can't be automated). Removing showDirectoryPicker makes
 *  directoryPickerSupported() false. */
async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Create "Purchase Approval" via the New-process dialog, then model
 *  Start → "Review request" → "Approve payment" through the automation hook so
 *  the assistant has a real two-step flow to answer over (no AI key needed). */
async function createModeledProcess(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('Purchase Approval')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })

  await page.evaluate(() => {
    const w = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const m = w.__ORBITPM_LITE__.modeler
    const modeling = m.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): unknown
      connect(source: unknown, target: unknown): unknown
      updateProperties(element: unknown, props: Record<string, unknown>): void
    }
    const elementFactory = m.get('elementFactory') as {
      createShape(attrs: { type: string }): unknown
    }
    const elementRegistry = m.get('elementRegistry') as {
      getAll(): Array<{ type?: string }>
    }
    const canvas = m.get('canvas') as { getRootElement(): unknown }
    const root = canvas.getRootElement()

    const start = elementRegistry.getAll().find((e) => e.type === 'bpmn:StartEvent')
    const review = elementFactory.createShape({ type: 'bpmn:Task' })
    modeling.createShape(review, { x: 320, y: 200 }, root)
    modeling.updateProperties(review, { name: 'Review request' })
    const approve = elementFactory.createShape({ type: 'bpmn:Task' })
    modeling.createShape(approve, { x: 500, y: 200 }, root)
    modeling.updateProperties(approve, { name: 'Approve payment' })
    if (start) modeling.connect(start, review)
    modeling.connect(review, approve)
  })
}

test('assistant answers "what comes next" locally (no key, fallback mode)', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await createModeledProcess(page)

  // Open the assistant via its floating button; the panel appears.
  await page.getByRole('button', { name: 'Ask the process assistant' }).click()
  const panel = page.getByRole('complementary', { name: 'Process assistant' })
  await expect(panel).toBeVisible()

  // With no provider key, the drawer answers from the process files directly.
  await expect(panel.getByText('Direct answers from your process files')).toBeVisible()

  await panel.getByRole('textbox').fill('what comes after review request')
  await panel.getByRole('button', { name: 'Send' }).click()

  // The deterministic local answer names the next step.
  await expect(panel.getByText(/Approve payment/)).toBeVisible({ timeout: 15_000 })
})

test('assistant drawer opens and closes with Escape', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  // The floating button only renders in the ready phase, so bring up a diagram.
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })

  const openBtn = page.getByRole('button', { name: 'Ask the process assistant' })
  await openBtn.click()
  const panel = page.getByRole('complementary', { name: 'Process assistant' })
  await expect(panel).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  // The floating button is back once the drawer is closed.
  await expect(openBtn).toBeVisible()
})
