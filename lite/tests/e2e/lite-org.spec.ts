import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

/** Force the single-file fallback path (the folder picker opens a native dialog
 *  that can't be automated). */
async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Create a new process via the New-process modal and wait for the modeler. */
async function newProcess(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
}

/** All text painted into the diagram SVG (base labels + org-pack decorations). */
async function svgTexts(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.djs-container svg text')).map((el) => el.textContent ?? '')
  )
}

test('element step details: owner + CC render, and the styling toggle refreshes live', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Owner Demo')

  // Add a task programmatically (there is no task in a fresh start-event-only
  // diagram) and select it, exactly like the smoke spec models elements.
  await page.evaluate(() => {
    const w = window as unknown as {
      __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
    }
    const m = w.__ORBITPM_LITE__.modeler
    const modeling = m.get('modeling') as {
      createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): unknown
    }
    const elementFactory = m.get('elementFactory') as { createShape(attrs: { type: string }): unknown }
    const canvas = m.get('canvas') as { getRootElement(): unknown }
    const selection = m.get('selection') as { select(el: unknown): void }
    const task = elementFactory.createShape({ type: 'bpmn:Task' })
    const shape = modeling.createShape(task, { x: 420, y: 220 }, canvas.getRootElement())
    selection.select(shape)
  })

  // Open the Step-details dialog in element mode.
  await page.getByRole('button', { name: /Details/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog).toBeVisible()

  // Set an owner and enable CC with a recipient.
  await dialog.getByPlaceholder('Owner name…').fill('Operations')
  await dialog.getByRole('checkbox').check()
  await dialog.getByPlaceholder('Name or role to copy').fill('Finance')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()

  // The custom renderer paints the owner chip + the "CC:" sub-label onto the shape.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.djs-container svg text')).some((el) =>
      (el.textContent ?? '').includes('Operations')
    )
  )
  const withStyling = await svgTexts(page)
  expect(withStyling.some((s) => s.includes('Operations'))).toBe(true)
  expect(withStyling.some((s) => s.includes('CC:'))).toBe(true)

  // Turn org styling OFF in Settings — every open modeler refreshes live and the
  // decorations vanish.
  await page.locator('header').getByRole('button', { name: /Settings/i }).click()
  const styleToggle = page.getByRole('checkbox', { name: 'DMT colour coding & step details' })
  await expect(styleToggle).toBeVisible()
  await styleToggle.uncheck()
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.djs-container svg text')).some((el) =>
        (el.textContent ?? '').includes('Operations')
      )
  )

  // Turn it back ON — the owner chip returns.
  await styleToggle.check()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.djs-container svg text')).some((el) =>
      (el.textContent ?? '').includes('Operations')
    )
  )
})

test('trigger validation: a DMT Hub trigger requires a service name before Apply', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Trigger Demo')

  // Nothing selected → process mode, which shows the Trigger section (a start
  // event in element mode would validate identically).
  await page.getByRole('button', { name: /Details/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Choose the DMT Hub trigger; with no service it must block Apply.
  await dialog.getByLabel('Trigger', { exact: true }).selectOption('dmthub')
  await expect(dialog.getByText('A DMT Hub service name is required.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()

  // Naming the service clears the error and re-enables Apply.
  await dialog.getByLabel('DMT Hub service').fill('ClaimsHub')
  await expect(dialog.getByText('A DMT Hub service name is required.')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeEnabled()
})
