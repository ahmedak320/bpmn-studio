import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

async function gotoLanding(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
  await dialog.locator('input[type="text"]').fill(name)
  await page
    .getByRole('dialog', { name: 'New ARIS model', exact: true })
    .getByRole('button', { name: 'Create model', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-orbitpm-aris-empty-hint]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-orbitpm-aris-canvas]')).toBeVisible()
}

test('rail tools: tabs, no floating palette, and docked click plus drag placement', async ({
  page
}) => {
  await page.setViewportSize({ width: 1500, height: 950 })
  await gotoLanding(page)
  await createBlankEpc(page, 'Rail tools')

  const rail = page.locator('[data-orbitpm-aris-rail]')
  const toolsTab = rail.locator('[data-orbitpm-aris-rail-tab="tools"]')
  const detailsTab = rail.locator('[data-orbitpm-aris-rail-tab="details"]')
  const tools = rail.locator('[data-orbitpm-aris-tools]')
  const canvas = page.locator('[data-orbitpm-aris-canvas]')

  await expect(toolsTab).toHaveAttribute('aria-selected', 'true')
  await expect(detailsTab).toHaveAttribute('aria-selected', 'false')
  await expect(tools).toBeVisible()
  await expect(canvas.locator('.djs-palette')).toHaveCount(0)

  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()

  await tools.locator('.aris-library-search__input').fill('log')
  await tools.locator('button[data-aris-catalog-id="information.log"]').click()
  await page.mouse.click(
    canvasBox!.x + canvasBox!.width * 0.45,
    canvasBox!.y + canvasBox!.height * 0.6
  )
  await expect(
    canvas.locator(
      'g.djs-element[data-element-id^="ObjOcc."]:has([data-aris-catalog-id="information.log"])'
    )
  ).toHaveCount(1)
  await expect(detailsTab).toHaveAttribute('aria-selected', 'true')
  await expect(rail.locator('[data-orbitpm-aris-details]')).toBeVisible()

  await page.keyboard.press('Escape')
  await toolsTab.click()
  await tools.locator('.aris-library-search__input').fill('sms')
  const sms = tools.locator('button[data-aris-catalog-id="information.sms"]')
  const smsBox = await sms.boundingBox()
  expect(smsBox).not.toBeNull()
  await page.mouse.move(smsBox!.x + smsBox!.width / 2, smsBox!.y + smsBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    canvasBox!.x + canvasBox!.width * 0.7,
    canvasBox!.y + canvasBox!.height * 0.7,
    { steps: 12 }
  )
  await page.mouse.up()
  await expect(
    canvas.locator(
      'g.djs-element[data-element-id^="ObjOcc."]:has([data-aris-catalog-id="information.sms"])'
    )
  ).toHaveCount(1)
})
