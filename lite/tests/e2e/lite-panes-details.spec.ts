import { test, expect, type Page, type Locator } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Pane / details UX of the feature wave: the badge-click -> Step-details
// dialog hand-off (missing categories highlighted with the amber ring, rings
// cleared on edit), double-click-to-open for step blocks, explicit pane
// collapse/persistence, the owner browse-on-focus flow that works WITHOUT ever
// saving, and the two keyboard-accessible pane resizers (right details/props
// pane + left explorer) with localStorage persistence across a reload.
//
// Same harness as lite-org.spec.ts: BUILT single file over file://, forced
// fallback mode, programmatic modeling via window.__ORBITPM_LITE__.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

const AMBER_RING = '196, 127, 23' // #c47f17 — PALETTE.basisBorder
const PROPS_OPEN_KEY = 'orbitpm.lite.propsPanelOpen'

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

async function newProcess(page: Page, name: string): Promise<void> {
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

interface HookWindow {
  __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
}

/** Create a shape via the automation hook (optionally selecting it), refit
 *  the viewport, and return its element id. */
async function createShape(
  page: Page,
  type: string,
  pos: { x: number; y: number },
  opts?: { select?: boolean }
): Promise<string> {
  return page.evaluate(
    ({ type, pos, select }) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const modeling = m.get('modeling') as {
        createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): { id: string }
      }
      const elementFactory = m.get('elementFactory') as {
        createShape(attrs: Record<string, unknown>): unknown
      }
      const canvas = m.get('canvas') as {
        getRootElement(): unknown
        zoom(mode: 'fit-viewport'): void
      }
      const selection = m.get('selection') as { select(el: unknown): void }
      const shape = elementFactory.createShape({ type })
      const placed = modeling.createShape(shape, pos, canvas.getRootElement())
      canvas.zoom('fit-viewport')
      if (select) selection.select(placed)
      return placed.id
    },
    { type, pos, select: opts?.select ?? false }
  )
}

/** How many elements inside `root` currently paint the amber missing-info
 *  ring (box-shadow #c47f17). */
async function amberRingCount(root: Locator): Promise<number> {
  return root.evaluate(
    (node, amber) =>
      Array.from(node.querySelectorAll<HTMLElement>('*')).filter((el) =>
        getComputedStyle(el).boxShadow.includes(amber)
      ).length,
    AMBER_RING
  )
}

async function selectedElementIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as HookWindow
    const selection = w.__ORBITPM_LITE__.modeler.get('selection') as {
      get(): Array<{ id: string }>
    }
    return selection.get().map((element) => element.id)
  })
}

async function updateElementProperties(
  page: Page,
  elementId: string,
  properties: Record<string, unknown>
): Promise<void> {
  await page.evaluate(
    ({ elementId, properties }) => {
      const w = window as unknown as HookWindow
      const modeler = w.__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const modeling = modeler.get('modeling') as {
        updateProperties(element: unknown, next: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(elementId), properties)
    },
    { elementId, properties }
  )
}

// ---------------------------------------------------------------------------
// Badge click -> dialog with highlighted missing categories
// ---------------------------------------------------------------------------

test('badge click selects the element and opens Step details with missing categories highlighted', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Highlight Demo')

  // Deliberately NOT selected — the badge click itself must select it.
  // The click is dispatched WITH THE BADGE AS TARGET (canvasDecor's delegated
  // capture-phase handler); real-pointer delivery is covered in the next test.
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()
  await badge.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  const dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog).toBeVisible()

  // The click selected the element (element-mode dialog derives from it).
  expect(await selectedElementIds(page)).toEqual([taskId])

  // owner + inputs + outputs highlighted: one amber ring + role=note hint each.
  const notes = dialog.locator('[role="note"]')
  await expect(notes).toHaveCount(3)
  for (const note of await notes.all()) {
    await expect(note).toHaveText('This information is still missing.')
  }
  expect(await amberRingCount(dialog)).toBe(3)

  // The Owner section itself carries a ring (section-level highlight).
  const ownerSection = dialog
    .locator('section')
    .filter({ has: page.getByPlaceholder('Owner name…') })
  const ownerShadow = await ownerSection.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(ownerShadow).toContain(AMBER_RING)

  // Editing a highlighted field clears ITS ring + hint (the others stay).
  await dialog.getByLabel('Inputs / base information').fill('Signed contract')
  await expect(notes).toHaveCount(2)
  expect(await amberRingCount(dialog)).toBe(2)

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('badge is clickable with a REAL pointer (hit-testing reaches the badge)', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Click Hit Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()

  // Regression guard: tooltip/click wrappers must opt back into hit testing
  // despite diagram-js.css setting `.djs-visual { pointer-events: none }`.
  const hit = await badge.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      pointerEvents: getComputedStyle(el).pointerEvents,
      hitTag: target ? target.tagName.toLowerCase() : null,
      insideBadge: !!(target && target.closest('.orbitpm-missing-badge'))
    }
  })
  expect(
    hit.insideBadge,
    `badge center must hit-test to the badge itself, got <${hit.hitTag}> ` +
      `(badge computed pointer-events: ${hit.pointerEvents})`
  ).toBe(true)

  await badge.click()
  await expect(page.getByRole('dialog', { name: 'Step details' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Details card in the right side pane: default closed + step double-click
// ---------------------------------------------------------------------------

test('pane defaults closed; a single click only selects, while a step double-click opens Details without a modal', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Card Demo')

  const sidePane = page.locator('.orbitpm-lite-sidepane')
  const panelToggle = page.getByRole('button', { name: 'Details', exact: true })
  const propsResizer = page.getByRole('separator', { name: 'Resize the properties panel' })

  // Missing storage now means closed. The mounted wrapper remains available
  // for bpmn-js, but neither it nor the resizer occupies the editor.
  await expect(sidePane).toBeHidden()
  await expect(sidePane).toHaveAttribute('role', 'complementary')
  await expect(sidePane).toHaveAttribute('aria-label', /details|properties/i)
  await expect(panelToggle).toHaveCount(0)
  const paneId = await sidePane.getAttribute('id')
  expect(paneId).toBeTruthy()
  await expect(propsResizer).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const task = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  const taskHit = task.locator('.djs-hit').first()

  // A normal click keeps the pane closed and retains stock canvas selection.
  await taskHit.click()
  expect(await selectedElementIds(page)).toEqual([taskId])
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()

  // A step-block double-click selects and opens the pane. It is
  // deliberately NOT a shortcut to the modal, and stock inline editing is
  // suppressed for this gesture.
  await taskHit.dblclick()
  expect(await selectedElementIds(page)).toEqual([taskId])
  await expect(sidePane).toBeVisible()
  await expect(panelToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panelToggle).toHaveAttribute('aria-controls', paneId!)
  await expect(propsResizer).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()
  await expect(page.getByRole('dialog', { name: 'Step details' })).toHaveCount(0)
  await expect(page.locator('.djs-direct-editing-parent')).toHaveCount(0)

  const card = sidePane.locator('.orbitpm-lite-details-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Details')
  await expect(card.getByRole('button', { name: 'Open Details…' })).toBeVisible()

  // The selected incomplete task fills the card with the missing chips.
  await expect(card).toContainText('Missing information')
  await expect(card).toContainText('responsible party')
  await expect(card).toContainText('inputs')
  await expect(card).toContainText('outputs')

  // The card's button opens the same Step-details dialog (element mode, no
  // highlight rings from this path).
  await card.getByRole('button', { name: 'Open Details…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[role="note"]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // Explicit collapse hides the whole pane (card included), removes the
  // resizer. The control disappears too: only another step double-click can
  // reopen the pane.
  await panelToggle.click()
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  await expect(panelToggle).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()
})

test('pane always starts closed and ignores stale persisted visibility state', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.evaluate((key) => localStorage.setItem(key, '1'), PROPS_OPEN_KEY)
  await newProcess(page, 'Pane Persistence Open')

  const sidePane = page.locator('.orbitpm-lite-sidepane')
  const panelToggle = page.getByRole('button', { name: 'Details', exact: true })
  const propsResizer = page.getByRole('separator', { name: 'Resize the properties panel' })

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  await page
    .locator(`.djs-element[data-element-id="${taskId}"] .djs-hit`)
    .first()
    .dblclick()
  await expect(sidePane).toBeVisible()
  await expect(propsResizer).toBeVisible()

  await page.reload({ waitUntil: 'load' })
  await newProcess(page, 'Pane Starts Closed Again')
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  await expect(panelToggle).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBe('1')
})

test('non-step double-click leaves the pane closed; a linked CallActivity keeps drill-down precedence', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Double Click Routing Demo')

  const sidePane = page.locator('.orbitpm-lite-sidepane')
  const propsResizer = page.getByRole('separator', { name: 'Resize the properties panel' })

  const gatewayId = await createShape(page, 'bpmn:ExclusiveGateway', { x: 300, y: 220 })
  await page
    .locator(`.djs-element[data-element-id="${gatewayId}"] .djs-hit`)
    .first()
    .dblclick()
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()
  await page.keyboard.press('Escape')

  const callId = await createShape(page, 'bpmn:CallActivity', { x: 520, y: 220 })
  await updateElementProperties(page, callId, { calledElement: 'Process_link_target' })
  await page
    .locator(`.djs-element[data-element-id="${callId}"] .djs-hit`)
    .first()
    .dblclick()

  // Fallback mode has no process index, so the drill-down callback reports the
  // unresolved target. Most importantly, the CallActivity is not treated as a
  // generic step: no Details pane/modal opens despite being a step-block type.
  await expect(page.getByRole('status')).toContainText('Process_link_target')
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Step details' })).toHaveCount(0)
  await expect(page.locator('.djs-direct-editing-parent')).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), PROPS_OPEN_KEY)).toBeNull()
})

// ---------------------------------------------------------------------------
// Owner browse-on-focus without ever saving
// ---------------------------------------------------------------------------

test('an owner applied on step A is browsable on step B without any save', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Owner Browse Demo')

  // Step A: set an owner via the dialog and Apply (in-memory only — the
  // fallback workspace has no files and Save is never pressed).
  await createShape(page, 'bpmn:Task', { x: 420, y: 220 }, { select: true })
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  const dialogA = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialogA).toBeVisible()
  await dialogA.getByPlaceholder('Owner name…').fill('Fatima')
  await dialogA.getByRole('button', { name: 'Apply' }).click()
  await expect(dialogA).toBeHidden()

  // Step B: a different, still-ownerless task.
  await createShape(page, 'bpmn:Task', { x: 620, y: 220 }, { select: true })
  await page.getByRole('button', { name: 'Details…', exact: true }).click()
  const dialogB = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialogB).toBeVisible()

  const ownerInput = dialogB.getByPlaceholder('Owner name…')
  await expect(ownerInput).toHaveValue('')
  // The ▾ browse affordance is present.
  await expect(dialogB.getByRole('button', { name: 'Browse all owners' })).toBeVisible()

  // Browse-on-focus: focusing the EMPTY input lists the session owners.
  await ownerInput.click()
  const listbox = dialogB.getByRole('listbox', { name: 'Owner suggestions' })
  await expect(listbox).toBeVisible()
  const fatima = listbox.getByRole('option').filter({ hasText: 'Fatima' })
  await expect(fatima).toBeVisible()

  // Picking the suggestion fills the input.
  await fatima.click()
  await expect(ownerInput).toHaveValue('Fatima')
  await dialogB.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialogB).toBeHidden()
})

// ---------------------------------------------------------------------------
// Right props-pane resizer
// ---------------------------------------------------------------------------

test('props-pane resizer: a11y contract, keyboard resize, bounds, reset, persistence', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Props Resize Demo')

  // The pane defaults closed; a step double-click opens it before exercising
  // handle. Width persistence remains independent of open/closed persistence.
  const firstTask = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  await page
    .locator(`.djs-element[data-element-id="${firstTask}"] .djs-hit`)
    .first()
    .dblclick()
  const resizer = page.getByRole('separator', { name: 'Resize the properties panel' })
  await expect(resizer).toBeVisible()
  await expect(resizer).toHaveClass(/orbitpm-lite-resizer/)
  await expect(resizer).toHaveAttribute('aria-orientation', 'vertical')
  await expect(resizer).toHaveAttribute('tabindex', '0')
  await expect(resizer).toHaveAttribute('title', 'Drag to resize — double-click to reset')
  await expect(resizer).toHaveAttribute('aria-valuemin', '240')
  await expect(resizer).toHaveAttribute('aria-valuemax', '560')
  await expect(resizer).toHaveAttribute('aria-valuenow', '300')

  const sidePane = page.locator('.orbitpm-lite-sidepane')
  const paneWidth = () => sidePane.evaluate((el) => el.getBoundingClientRect().width)

  // Keyboard: the handle sits on the pane's inline-start edge (LTR), so
  // ArrowLeft grows the pane by 16px and ArrowRight shrinks it back.
  await resizer.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(resizer).toHaveAttribute('aria-valuenow', '316')
  expect(Math.abs((await paneWidth()) - 316)).toBeLessThanOrEqual(2)
  expect(
    await page.evaluate(() => localStorage.getItem('orbitpm.lite.propsPanelWidth'))
  ).toBe('316')
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '300')

  // Home/End clamp to min/max.
  await page.keyboard.press('Home')
  await expect(resizer).toHaveAttribute('aria-valuenow', '240')
  await page.keyboard.press('End')
  await expect(resizer).toHaveAttribute('aria-valuenow', '560')
  expect(Math.abs((await paneWidth()) - 560)).toBeLessThanOrEqual(2)

  // Double-click resets to the stylesheet default and clears the stored key.
  await resizer.dblclick()
  await expect(resizer).toHaveAttribute('aria-valuenow', '300')
  expect(
    await page.evaluate(() => localStorage.getItem('orbitpm.lite.propsPanelWidth'))
  ).toBeNull()

  // Persist a distinctive width, then reload + re-enter fallback mode: the
  // width must be restored from localStorage.
  await resizer.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(resizer).toHaveAttribute('aria-valuenow', '332')
  expect(
    await page.evaluate(() => localStorage.getItem('orbitpm.lite.propsPanelWidth'))
  ).toBe('332')

  await page.reload({ waitUntil: 'load' })
  await newProcess(page, 'Props Resize Again')
  const secondTask = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  await page
    .locator(`.djs-element[data-element-id="${secondTask}"] .djs-hit`)
    .first()
    .dblclick()
  await expect(resizer).toHaveAttribute('aria-valuenow', '332')
  expect(Math.abs((await paneWidth()) - 332)).toBeLessThanOrEqual(2)
})

// ---------------------------------------------------------------------------
// Left sidebar resizer (via the rail, since opening a file auto-collapses)
// ---------------------------------------------------------------------------

test('sidebar resizer exists only while the sidebar is open; keyboard resize + persistence', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Sidebar Resize Demo')

  const aside = page.locator('aside')
  const resizer = page.getByRole('separator', { name: 'Resize the explorer panel' })
  const rail = page.getByRole('button', { name: 'Toggle side panel' })

  // Opening a file auto-collapsed the sidebar — no sidebar resizer yet.
  await expect(aside).toBeHidden()
  await expect(resizer).toHaveCount(0)

  // Reopen via the rail: the resizer appears with its default width.
  await rail.click()
  await expect(aside).toBeVisible()
  await expect(resizer).toBeVisible()
  await expect(resizer).toHaveClass(/orbitpm-lite-resizer/)
  await expect(resizer).toHaveAttribute('aria-orientation', 'vertical')
  await expect(resizer).toHaveAttribute('aria-valuemin', '200')
  await expect(resizer).toHaveAttribute('aria-valuemax', '560')
  await expect(resizer).toHaveAttribute('aria-valuenow', '320')

  const asideWidth = () => aside.evaluate((el) => el.getBoundingClientRect().width)

  // The handle sits on the sidebar's inline-end edge (LTR): ArrowRight grows.
  await resizer.focus()
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '336')
  expect(Math.abs((await asideWidth()) - 336)).toBeLessThanOrEqual(2)
  expect(await page.evaluate(() => localStorage.getItem('orbitpm.lite.sidebarWidth'))).toBe('336')

  await page.keyboard.press('Home')
  await expect(resizer).toHaveAttribute('aria-valuenow', '200')
  await page.keyboard.press('End')
  await expect(resizer).toHaveAttribute('aria-valuenow', '560')

  // Double-click reset: default width back, stored key cleared.
  await resizer.dblclick()
  await expect(resizer).toHaveAttribute('aria-valuenow', '320')
  expect(await page.evaluate(() => localStorage.getItem('orbitpm.lite.sidebarWidth'))).toBeNull()

  // Persist 336 again, then reload + re-enter fallback mode + reopen the
  // sidebar via the rail: the stored width is restored.
  await resizer.focus()
  await page.keyboard.press('ArrowRight')
  await expect(resizer).toHaveAttribute('aria-valuenow', '336')

  await page.reload({ waitUntil: 'load' })
  await newProcess(page, 'Sidebar Resize Again')
  await expect(aside).toBeHidden()
  await rail.click()
  await expect(aside).toBeVisible()
  await expect(resizer).toHaveAttribute('aria-valuenow', '336')
  expect(Math.abs((await asideWidth()) - 336)).toBeLessThanOrEqual(2)

  // Collapsing the sidebar removes its resizer (it exists only while open).
  await rail.click()
  await expect(aside).toBeHidden()
  await expect(resizer).toHaveCount(0)
})
