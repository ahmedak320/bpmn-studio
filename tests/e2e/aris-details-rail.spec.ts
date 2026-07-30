import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Lane R1 — Details rail collapse/expand + user-resizable width.
//
// Boots the built single file over file:// and forces fallback storage mode so
// the picker "＋ New model" path creates an in-memory single-file workspace.
// Exercises collapse/expand toggle, drag/keyboard resize, and persistence.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

async function gotoLanding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!window.name.includes('orbitpm-e2e-cleared')) {
      localStorage.clear()
      window.name += ' orbitpm-e2e-cleared'
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
  await dialog.locator('input[type="text"]').fill(name)
  await page
    .getByRole('dialog', { name: 'New ARIS model', exact: true })
    .getByRole('button', { name: 'Create model', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-orbitpm-aris-canvas]')).toBeVisible()
}

test('details rail collapses, expands, drag-resizes, and persists across reload', async ({
  page
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await gotoLanding(page)
  await createBlankEpc(page, 'Rail spec')

  const railEl = page.locator('[data-orbitpm-aris-rail]')
  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  await expect(railEl).toBeVisible()

  const railBox = await railEl.boundingBox()
  expect(railBox).not.toBeNull()
  expect(railBox!.width).toBeGreaterThanOrEqual(335)
  expect(railBox!.width).toBeLessThanOrEqual(345)

  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()

  const toggle = page.locator('[data-orbitpm-aris-rail-collapse]')
  await toggle.click()
  await expect(railEl).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('[data-orbitpm-aris-rail-resize]')).toBeHidden()

  const canvasBoxCollapsed = await canvas.boundingBox()
  expect(canvasBoxCollapsed).not.toBeNull()
  expect(canvasBoxCollapsed!.width).toBeGreaterThanOrEqual(canvasBox!.width + 250)

  await toggle.click()
  await expect(railEl).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const handle = page.locator('[data-orbitpm-aris-rail-resize]')
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()
  const cx = handleBox!.x + handleBox!.width / 2
  const cy = handleBox!.y + handleBox!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 120, cy, { steps: 10 })
  await page.mouse.up()

  const dragWidth = (await railEl.boundingBox())!.width
  expect(dragWidth).toBeGreaterThanOrEqual(455)
  expect(dragWidth).toBeLessThanOrEqual(465)

  const storedDrag = await page.evaluate(() =>
    Number(localStorage.getItem('orbitpm.aris.detailsRailWidth'))
  )
  expect(storedDrag).toBeGreaterThanOrEqual(455)
  expect(storedDrag).toBeLessThanOrEqual(465)

  const separator = page.getByRole('separator', { name: 'Resize the details rail' })
  await separator.focus()
  await page.keyboard.press('ArrowLeft')
  const storedKeyboard = await page.evaluate(() =>
    Number(localStorage.getItem('orbitpm.aris.detailsRailWidth'))
  )
  expect(storedKeyboard).toBe(storedDrag + 16)

  await page.reload({ waitUntil: 'load' })
  await createBlankEpc(page, 'Rail spec 2')
  const railBoxReload = await railEl.boundingBox()
  expect(railBoxReload).not.toBeNull()
  expect(railBoxReload!.width).toBeCloseTo(storedKeyboard, 0)

  await toggle.click()
  const collapsedAfterReload = await page.evaluate(() =>
    localStorage.getItem('orbitpm.aris.detailsRailCollapsed')
  )
  expect(collapsedAfterReload).toBe('1')

  await page.reload({ waitUntil: 'load' })
  await createBlankEpc(page, 'Rail spec 3')
  await expect(railEl).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('RTL moves the rail to the visual left and keeps the drag clamped', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await gotoLanding(page)
  await createBlankEpc(page, 'Rail RTL')

  const banner = page.getByRole('banner')
  const languageToggle = banner.getByRole('button', { name: /^(Interface|الواجهة):/ })
  await languageToggle.click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  const railEl = page.locator('[data-orbitpm-aris-rail]')
  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  await expect(railEl).toBeVisible()

  const railBox = await railEl.boundingBox()
  const canvasBox = await canvas.boundingBox()
  expect(railBox).not.toBeNull()
  expect(canvasBox).not.toBeNull()
  expect(railBox!.x).toBeLessThan(canvasBox!.x)

  const handle = page.locator('[data-orbitpm-aris-rail-resize]')
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()
  const cx = handleBox!.x + handleBox!.width / 2
  const cy = handleBox!.y + handleBox!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 5000, cy, { steps: 10 })
  await page.mouse.up()
  const wideWidth = (await railEl.boundingBox())!.width
  expect(wideWidth).toBeLessThanOrEqual(565)

  const handleBox2 = await handle.boundingBox()
  expect(handleBox2).not.toBeNull()
  const cx2 = handleBox2!.x + handleBox2!.width / 2
  const cy2 = handleBox2!.y + handleBox2!.height / 2
  await page.mouse.move(cx2, cy2)
  await page.mouse.down()
  await page.mouse.move(cx2 - 5000, cy2, { steps: 10 })
  await page.mouse.up()
  const narrowWidth = (await railEl.boundingBox())!.width
  expect(narrowWidth).toBeGreaterThanOrEqual(255)

  const toggle = page.locator('[data-orbitpm-aris-rail-collapse]')
  await toggle.click()
  await expect(railEl).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})
