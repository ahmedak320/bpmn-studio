import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { selectOccurrenceOnCanvas } from './helpers/canvasOverlay'
import { disableAutoTranslate } from './helpers/prefs'

// Lane X3 — New e2e specs: blank-model authoring through the picker fallback.
//
// Boots the built single file over file:// and forces fallback storage mode so
// the picker "＋ New model" path creates an in-memory single-file workspace.
// Exercises docked-tools creation, undo/redo, details-rail rename, and rail-tab
// persistence.

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
  await disableAutoTranslate(page)
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

test('picker fallback: new EPC model, docked authoring, undo/redo, rename and rail-tab persistence', async ({
  page
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await gotoLanding(page)
  await createBlankEpc(page, 'Blank EPC')

  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  const tools = page.locator('[data-orbitpm-aris-tools]')
  await expect(tools).toBeVisible()

  // Dismiss the empty-model hint before authoring.
  await page.locator('[data-orbitpm-aris-empty-hint] button').click()
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toHaveCount(0)

  // Fit the blank canvas so the drop point maps to a real diagram coordinate.
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()

  // Arm the function create tool from the rail, then place it on the canvas
  // with a real pointer gesture (the same convention as aris-authoring.spec.ts).
  const funcEntry = tools.locator('[data-action="create.ot_func"]')
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  // Drop low and right, clear of the top minimap.
  const dropX = canvasBox!.x + canvasBox!.width * 0.55
  const dropY = canvasBox!.y + canvasBox!.height * 0.75
  // Arm the create tool, then click the canvas to place it.
  await funcEntry.click()
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

  // Details-rail rename: ensure the occurrence is selected, then edit its
  // definition name. `selectOccurrenceOnCanvas` fits + pans it clear of the
  // canvas overlays and, because redo already auto-selected the re-created
  // occurrence, leaves that selection intact (a redundant click was firefox's
  // flaky failure mode — its synthetic mouseup sometimes read as a background
  // deselect, so the rail lost its selection and the Names tab vanished).
  const placedOccurrenceId = await occurrences.first().getAttribute('data-element-id')
  expect(placedOccurrenceId, 'placed occurrence has no element id').toBeTruthy()
  await selectOccurrenceOnCanvas(page, placedOccurrenceId!, { fitLabel: 'Zoom Fit' })
  await page.getByRole('tab', { name: 'Names', exact: true }).click()
  const nameField = page.locator('[data-orbitpm-aris-name-input="definition:en"]')
  await expect(nameField).toBeVisible()
  await nameField.fill('Review request')
  await nameField.press('Enter')
  await expect(nameField).toHaveValue('Review request')

  // Return to Tools and confirm that tab choice persists across reload.
  const toolsTab = page.locator('[data-orbitpm-aris-rail-tab="tools"]')
  await toolsTab.click()
  await expect(toolsTab).toHaveAttribute('aria-selected', 'true')
  await expect(tools).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('orbitpm.aris.railTab'))).toBe('tools')

  await page.reload({ waitUntil: 'load' })
  await createBlankEpc(page, 'Second EPC')

  await expect(toolsTab).toHaveAttribute('aria-selected', 'true')
  await expect(tools).toBeVisible()
})
