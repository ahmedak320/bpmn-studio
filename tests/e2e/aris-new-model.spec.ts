import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Lane X3 — New e2e specs: blank-model authoring through the picker fallback.
//
// Boots the built single file over file:// and forces fallback storage mode so
// the picker "＋ New model" path creates an in-memory single-file workspace.
// Exercises palette creation, undo/redo, details-rail rename, and palette-grip
// reposition persistence.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

async function gotoLanding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // WebKit resets window.name to '' across a file:// reload (file:// pages
    // are opaque origins), so a window.name guard re-clears storage on every
    // reload there. localStorage itself DOES persist across file:// reloads on
    // all three engines, so the first-load sentinel lives in localStorage.
    if (!localStorage.getItem('orbitpm.e2e.cleared')) {
      localStorage.clear()
      localStorage.setItem('orbitpm.e2e.cleared', '1')
    }
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
}

async function createBlankEpc(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '＋ New model' }).click()
  const dialog = page.locator('[data-orbitpm-aris-new-model]')
  await expect(dialog).toBeVisible()
  // EPC is the default model type; just name and confirm.
  await dialog.locator('input[type="text"]').fill(name)
  await page
    .getByRole('dialog', { name: 'New ARIS model', exact: true })
    .getByRole('button', { name: 'Create model', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-orbitpm-aris-canvas]')).toBeVisible()
}

test('picker fallback: new EPC model, palette authoring, undo/redo, rename and palette-grip persistence', async ({
  page
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await gotoLanding(page)
  await createBlankEpc(page, 'Blank EPC')

  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  const palette = canvas.locator('.djs-palette')
  await expect(palette).toBeVisible()

  // Dismiss the empty-model hint so it does not intercept palette clicks.
  await page.locator('[data-orbitpm-aris-empty-hint] button').click()
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toHaveCount(0)

  // Fit the blank canvas so the drop point maps to a real diagram coordinate.
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()

  // Arm the function create tool from the palette, then place it on the canvas
  // with a real pointer gesture (the same convention as aris-authoring.spec.ts).
  const funcEntry = palette.locator('[data-action="create.ot_func"]')
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  // Drop low and right, clear of the left-edge palette and top minimap.
  const dropX = canvasBox!.x + canvasBox!.width * 0.55
  const dropY = canvasBox!.y + canvasBox!.height * 0.75
  // Arm the create tool. The entry div is draggable and its child label can
  // intercept ordinary clicks in some layouts; click near the icon (top-left of
  // the entry) to hit the entry div itself, then click the canvas to place it.
  const entryBox = await funcEntry.boundingBox()
  expect(entryBox).not.toBeNull()
  await page.mouse.click(entryBox!.x + 4, entryBox!.y + 4)
  await page.mouse.click(dropX, dropY)

  // Exactly one authored occurrence exists and the empty hint is gone.
  const occurrences = canvas.locator('[data-element-id^="ObjOcc."]')
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(1)
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toHaveCount(0)

  // Focus the canvas and undo via keyboard.
  await canvas.locator('.djs-container > svg').first().focus()
  await page.keyboard.press('Control+Z')
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(0)

  // Redo via the toolbar button.
  const redo = page.locator('[data-orbitpm-aris-redo]')
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(1)

  // Details-rail rename: select the occurrence and edit its definition name.
  await occurrences.first().click()
  await page.getByRole('tab', { name: 'Names', exact: true }).click()
  const nameField = page.locator('[data-orbitpm-aris-name-input="definition:en"]')
  await expect(nameField).toBeVisible()
  await nameField.fill('Review request')
  await nameField.press('Enter')
  await expect(nameField).toHaveValue('Review request')

  // Palette grip: drag it 60px to the right and confirm storage + persistence.
  const grip = canvas.locator('.orbitpm-palette-grip')
  await expect(grip).toBeVisible()
  const gripBox = await grip.boundingBox()
  expect(gripBox).not.toBeNull()
  await grip.hover()
  await page.mouse.down()
  await page.mouse.move(gripBox!.x + gripBox!.width / 2 + 60, gripBox!.y + gripBox!.height / 2)
  await page.mouse.up()

  const storedBefore = await page.evaluate(() => localStorage.getItem('orbitpm.aris.palettePos'))
  expect(storedBefore).not.toBeNull()
  const posBefore = JSON.parse(storedBefore!)
  expect(typeof posBefore.left).toBe('number')

  await page.reload({ waitUntil: 'load' })
  await createBlankEpc(page, 'Second EPC')

  const paletteEl = canvas.locator('.djs-palette').first()
  const leftAfterReload = await paletteEl.evaluate((el) => getComputedStyle(el).left)
  expect(parseFloat(leftAfterReload)).toBeCloseTo(posBefore.left, 0)
})
