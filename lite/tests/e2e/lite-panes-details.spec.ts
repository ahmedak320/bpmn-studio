import { test, expect, type Page, type Locator } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Pane / details UX of the feature wave: the badge-click -> Step-details
// dialog hand-off (missing categories highlighted with the amber ring, rings
// cleared on edit), the Details card stacked above the properties panel, the
// owner browse-on-focus flow that works WITHOUT ever saving, and the two
// keyboard-accessible pane resizers (right props pane + left explorer) with
// localStorage persistence across a reload.
//
// Same harness as lite-org.spec.ts: BUILT single file over file://, forced
// fallback mode, programmatic modeling via window.__ORBITPM_LITE__.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

const AMBER_RING = '196, 127, 23' // #c47f17 — PALETTE.basisBorder

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
  // capture-phase handler); real-pointer delivery is covered (and currently
  // red) in the next test — see the pointer-events finding there.
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()
  await badge.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  const dialog = page.getByRole('dialog', { name: 'Step details' })
  await expect(dialog).toBeVisible()

  // The click selected the element (element-mode dialog derives from it).
  const selectedIds = await page.evaluate(() => {
    const w = window as unknown as HookWindow
    const selection = w.__ORBITPM_LITE__.modeler.get('selection') as {
      get(): Array<{ id: string }>
    }
    return selection.get().map((e) => e.id)
  })
  expect(selectedIds).toEqual([taskId])

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

  // KNOWN GAP as of this wave: the badge inherits `pointer-events: none` from
  // diagram-js.css's `.djs-visual` rule, so a real click lands on the root
  // <svg> instead — the dialog can never open from a user's click even though
  // the delegated handler itself works (previous test).
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
      `(badge computed pointer-events: ${hit.pointerEvents} — inherited from .djs-visual)`
  ).toBe(true)

  await badge.click()
  await expect(page.getByRole('dialog', { name: 'Step details' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Details card in the right side pane
// ---------------------------------------------------------------------------

test('Details card shows missing chips for the selection and opens the dialog; Panel toggle hides the pane', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Card Demo')

  // The right side pane (Details card + properties panel) is open by default.
  const sidePane = page.locator('.orbitpm-lite-sidepane')
  await expect(sidePane).toBeVisible()
  const card = sidePane.locator('.orbitpm-lite-details-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Details')
  await expect(card.getByRole('button', { name: 'Open Details…' })).toBeVisible()

  // Selecting an incomplete task fills the card with the missing chips.
  await createShape(page, 'bpmn:Task', { x: 420, y: 220 }, { select: true })
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

  // The toolbar Panel toggle hides the whole side pane (card included) and
  // removes the props resizer; toggling again restores both.
  const panelToggle = page.getByRole('button', { name: 'Panel', exact: true })
  const propsResizer = page.getByRole('separator', { name: 'Resize the properties panel' })
  await expect(panelToggle).toHaveAttribute('aria-pressed', 'true')
  await panelToggle.click()
  await expect(sidePane).toBeHidden()
  await expect(propsResizer).toHaveCount(0)
  await expect(panelToggle).toHaveAttribute('aria-pressed', 'false')
  await panelToggle.click()
  await expect(sidePane).toBeVisible()
  await expect(card).toBeVisible()
  await expect(propsResizer).toBeVisible()
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
