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

test('rail tools: docked placement, hover title, friendly details, right-click change-type', async ({
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
  const logShape = canvas.locator(
    'g.djs-element[data-element-id^="ObjOcc."]:has([data-aris-catalog-id="information.log"])'
  )
  await expect(logShape).toHaveCount(1)
  await expect(detailsTab).toHaveAttribute('aria-selected', 'true')
  const details = rail.locator('[data-orbitpm-aris-details]')
  await expect(details).toBeVisible()
  await expect(details).toContainText('Log block')
  await expect(details).not.toContainText('OT_INFO_CARR')

  await page.keyboard.press('Escape')
  // The type tooltip is intentionally suppressed while a shape is selected, so
  // the shape must be genuinely deselected before hovering. Firefox
  // occasionally drops a single synthetic background click, so retry the
  // empty-canvas click until diagram-js clears the selection.
  const emptyX = canvasBox!.x + canvasBox!.width * 0.2
  const emptyY = canvasBox!.y + canvasBox!.height * 0.2
  await expect(async () => {
    await page.mouse.click(emptyX, emptyY)
    await expect(logShape).not.toHaveClass(/\bselected\b/, { timeout: 250 })
  }).toPass({ timeout: 5000 })
  // Hover the (now unselected) shape with a real pointer move to its centre;
  // firefox does not reliably dispatch the SVG hover from locator.hover().
  const logBox = await logShape.boundingBox()
  expect(logBox).not.toBeNull()
  await page.mouse.move(emptyX, emptyY)
  await page.mouse.move(logBox!.x + logBox!.width / 2, logBox!.y + logBox!.height / 2)
  await expect(page.locator('[data-orbitpm-aris-type-tip]')).toContainText('Log block', {
    timeout: 2000
  })

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

  await page.keyboard.press('Escape')
  await toolsTab.click()
  await tools.locator('.aris-library-search__input').fill('event')
  await tools.locator('button[data-aris-catalog-id="epc.event"]').click()
  await page.mouse.click(
    canvasBox!.x + canvasBox!.width * 0.35,
    canvasBox!.y + canvasBox!.height * 0.3
  )
  const eventShape = canvas.locator(
    'g.djs-element[data-element-id^="ObjOcc."]:has([data-aris-catalog-id="epc.event"])'
  )
  await expect(eventShape).toHaveCount(1)
  await page.keyboard.press('Escape')
  // Select the shape with a real pointer click at its centre. Webkit does not
  // dispatch diagram-js selection from locator.click() on the SVG <g>, and even
  // a synthetic pointer click occasionally fails to register — so retry the
  // centre click until the context pad opens. A mouse click at the hit-area
  // centre is robust across all three engines.
  const eventBox = await eventShape.boundingBox()
  expect(eventBox).not.toBeNull()
  const eventCenterX = eventBox!.x + eventBox!.width / 2
  const eventCenterY = eventBox!.y + eventBox!.height / 2
  const contextPad = canvas.locator('.djs-context-pad.open')
  await expect(async () => {
    await page.mouse.click(eventCenterX, eventCenterY)
    await expect(contextPad).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 5000 })
  const quickConnect = contextPad.locator(
    '[data-action^="quick-connect.outgoing.ct-activ-1.epc-function."]'
  )
  await expect(quickConnect).toBeVisible()
  await quickConnect.click()
  const connections = canvas.locator('.djs-connection[data-element-id]')
  await expect(connections).toHaveCount(1)
  const connectionsBeforeChange = await connections.count()

  await eventShape.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Element actions' })
  await menu.getByRole('menuitem', { name: 'Change object type…' }).click()
  await page
    .getByRole('dialog', { name: 'Change object type' })
    .locator('button[data-aris-catalog-id="epc.function"]')
    .click()

  await expect(connections).toHaveCount(connectionsBeforeChange)
  await expect(details).toContainText('Function block')
  await expect(page.locator('[data-orbitpm-aris-epc-finding="epc.alternation"]')).toContainText(
    'Function'
  )
  await page.locator('[data-orbitpm-aris-undo]').click()
  await expect(connections).toHaveCount(connectionsBeforeChange)
  await expect(details).toContainText('Event block')
})
