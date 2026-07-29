import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Plan §21.3 — the browser half of the release matrix, run on Chromium,
// Firefox and WebKit.
//
// What this file deliberately does NOT repeat: the language/RTL matrix
// (tests/e2e/aris-i18n-rtl.spec.ts), the accessibility matrix
// (tests/e2e/aris-accessibility.spec.ts), the provider/consent matrix
// (tests/e2e/lite-providers.spec.ts) and the exact-release-artifact smoke
// (tests/e2e/aris-release-artifact.spec.ts). Everything below is a §21.3 bullet
// that had no real-browser coverage at all: authoring through the palette and
// context pad, the chat improvement loop, the local assistant, the derived
// export and the Excel template round trip. All of them were previously proved
// only in jsdom or in a Node unit test against the canvas API — never against
// the mounted product's own DOM.
//
// Same harness convention as the surviving ARIS specs: the BUILT single file
// over file://, fallback storage mode, real user gestures, no source-level
// mocking.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

/**
 * `src/aris/canvas/vocabulary.ts`'s `ARIS_CANVAS_OBJECT_TYPES`, plus the three
 * rule operators, expressed as the `data-action` ids
 * `ArisPaletteProvider.getPaletteEntries` derives from them. Spelled out rather
 * than imported so a silent shrink of the product's own list cannot silently
 * shrink this test with it.
 */
const PALETTE_CREATE_ACTIONS = [
  'create.ot_func',
  'create.ot_evt',
  'create.rule-and',
  'create.rule-or',
  'create.rule-xor',
  'create.ot_ent_type',
  'create.ot_info_carr',
  'create.ot_business_rule',
  'create.ot_perf',
  'create.ot_appl_sys',
  'create.ot_pers',
  'create.ot_requirement',
  'create.ot_policy',
  'create.ot_pers_type'
] as const

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
})

async function openReferenceExport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8)
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
}

function modelLayer(page: Page, modelId: string): Locator {
  return page.locator(`[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"]`)
}

function occurrencesOf(page: Page, modelId: string): Locator {
  return modelLayer(page, modelId).locator('g.djs-element[data-element-id^="ObjOcc."]')
}

async function activeModelId(page: Page): Promise<string> {
  const id = await page
    .locator('[data-orbitpm-aris-model][aria-current="true"]')
    .getAttribute('data-orbitpm-aris-model')
  expect(id).not.toBeNull()
  return id as string
}

/** Switch to a model and wait until its own layer carries drawn shapes. */
async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  await expect
    .poll(async () => occurrencesOf(page, modelId).count(), { timeout: 120_000 })
    .toBeGreaterThan(0)
}

/**
 * The id of an occurrence a person could actually click: big enough to hit,
 * fully inside the canvas box, and clear of the palette and minimap, both of
 * which float above the diagram. The AnimalWF models are large real EPCs, so
 * "the first occurrence in DOM order" is routinely off-screen after Zoom Fit.
 */
async function clickableOccurrenceId(page: Page, modelId: string): Promise<string> {
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  const id = await page.evaluate((scope) => {
    const canvas = document.querySelector('[data-orbitpm-aris-canvas]')
    if (!canvas) return ''
    const canvasRect = canvas.getBoundingClientRect()
    const overlays = ['.djs-palette', '.djs-minimap']
      .flatMap((selector) => Array.from(canvas.querySelectorAll(selector)))
      .map((node) => node.getBoundingClientRect())
    for (const node of Array.from(document.querySelectorAll(scope))) {
      const rect = node.getBoundingClientRect()
      const clear =
        rect.width >= 10 &&
        rect.height >= 10 &&
        rect.left >= canvasRect.left &&
        rect.right <= canvasRect.right &&
        rect.top >= canvasRect.top &&
        rect.bottom <= canvasRect.bottom &&
        overlays.every(
          (overlay) =>
            rect.right < overlay.left ||
            rect.left > overlay.right ||
            rect.bottom < overlay.top ||
            rect.top > overlay.bottom
        )
      if (clear) return node.getAttribute('data-element-id') ?? ''
    }
    return ''
  }, `[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"] g.djs-element[data-element-id^="ObjOcc."]`)
  expect(id, 'no occurrence is reachable by pointer after Zoom Fit').not.toBe('')
  return id
}

test('every AnimalWF model opens on the real canvas and draws exactly the records the explorer promises', async ({
  page
}) => {
  await openReferenceExport(page)

  const buttons = page.locator('[data-orbitpm-aris-model]')
  const count = await buttons.count()
  expect(count).toBe(8)

  const opened: { id: string; promised: number; drawn: number }[] = []
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)
    const modelId = (await button.getAttribute('data-orbitpm-aris-model')) as string
    const summary = (await button.innerText()).replace(/\s+/gu, ' ')
    const promised = Number(/(\d+) objects/u.exec(summary)?.[1] ?? Number.NaN)
    expect(Number.isFinite(promised), `model ${modelId} has no object count`).toBe(true)

    await selectModel(page, modelId)
    // The canvas keeps one layer per visited model, so counting inside this
    // model's own root is what proves the switch actually drew THIS model.
    await expect.poll(async () => occurrencesOf(page, modelId).count()).toBe(promised)
    opened.push({ id: modelId, promised, drawn: promised })
  }

  // All eight are distinct models, not the same one re-labelled.
  expect(new Set(opened.map((entry) => entry.id)).size).toBe(8)
  expect(opened.every((entry) => entry.promised > 0)).toBe(true)
})

test('the palette offers a create entry for every supported ARIS object type and rule operator, and each one authors a real occurrence', async ({
  page
}) => {
  await openReferenceExport(page)
  const modelId = await activeModelId(page)
  await selectModel(page, modelId)

  const palette = page.locator('[data-orbitpm-aris-canvas] .djs-palette')
  await expect(palette).toBeVisible()

  // Every supported type is offered — and nothing that is not supported is.
  for (const action of PALETTE_CREATE_ACTIONS) {
    await expect(
      palette.locator(`[data-action="${action}"]`),
      `palette is missing ${action}`
    ).toHaveCount(1)
  }
  await expect(palette.locator('[data-action^="create."]')).toHaveCount(
    PALETTE_CREATE_ACTIONS.length + 1 // + the free-text annotation entry
  )
  await expect(palette.locator('[data-action="create.free-text"]')).toHaveCount(1)

  const canvasBox = await page.locator('[data-orbitpm-aris-canvas]').boundingBox()
  expect(canvasBox).not.toBeNull()
  // Drop point: inside the canvas, clear of the palette (leading edge) and of
  // the minimap (trailing top corner).
  const dropX = canvasBox!.x + canvasBox!.width * 0.55
  const dropY = canvasBox!.y + canvasBox!.height * 0.75

  for (const action of PALETTE_CREATE_ACTIONS) {
    const before = await occurrencesOf(page, modelId).count()
    await palette.locator(`[data-action="${action}"]`).click()
    await page.mouse.move(dropX, dropY)
    await page.mouse.down()
    await page.mouse.up()
    await expect
      .poll(async () => occurrencesOf(page, modelId).count(), { timeout: 20_000 })
      .toBe(before + 1)

    // Every authored occurrence is undoable through the product's own toolbar.
    await page.locator('[data-orbitpm-aris-undo]').click()
    await expect.poll(async () => occurrencesOf(page, modelId).count()).toBe(before)
  }
})

test('the context pad appends, connects and deletes on the real canvas, and undo restores the document', async ({
  page
}) => {
  await openReferenceExport(page)
  const modelId = await activeModelId(page)
  await selectModel(page, modelId)

  const occurrences = occurrencesOf(page, modelId)
  const connections = modelLayer(page, modelId).locator('g.djs-connection[data-element-id]')
  const shapesBefore = await occurrences.count()
  const connectionsBefore = await connections.count()
  const idsBefore = new Set(
    await occurrences.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-element-id') ?? '')
    )
  )

  // Append is only offered for object occurrences, and the target has to be
  // reachable by a real pointer after Zoom Fit.
  const targetId = await clickableOccurrenceId(page, modelId)
  const target = modelLayer(page, modelId).locator(`g[data-element-id="${targetId}"]`)
  await target.click()

  const contextPad = page.locator('[data-orbitpm-aris-canvas] .djs-context-pad')
  await expect(contextPad).toBeVisible()

  // Every §11.4 gesture the pad is contractually required to offer for an
  // object occurrence is present on the real element.
  for (const action of ['connect', 'append.function', 'append.event', 'delete']) {
    await expect(contextPad.locator(`[data-action="${action}"]`)).toBeVisible()
  }

  // -- create + connect: append allocates a new occurrence AND the typed
  //    connection to it, in one gesture. The pad stays open on the result, so
  //    the second append chains off it without a re-select (clicking an already
  //    selected element toggles the selection off and closes the pad).
  await contextPad.locator('[data-action="append.function"]').click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 1)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore + 1)

  await expect(contextPad).toBeVisible()
  await contextPad.locator('[data-action="append.event"]').click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 2)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore + 2)

  const idsAfter = await occurrences.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-element-id') ?? '')
  )
  expect(idsAfter.filter((id) => !idsBefore.has(id))).toHaveLength(2)

  // -- delete: the pad removes the occurrence it is currently attached to ----
  await expect(contextPad).toBeVisible()
  await contextPad.locator('[data-action="delete"]').click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 1)

  // -- undo: every one of those gestures sits on one command stack ----------
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await undo.click() // undo the delete
  await expect.poll(async () => occurrences.count()).toBe(shapesBefore + 2)
  await undo.click() // undo the second append
  await undo.click() // undo the first append
  await expect.poll(async () => occurrences.count()).toBe(shapesBefore)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore)
  await expect(undo).toBeDisabled()
})

/**
 * Runs the §18.2 interview to completion and returns the gap-count label as it
 * read before the interview started, plus how many fields were answered.
 */
async function completeSafeFields(
  page: Page
): Promise<{ gapsBefore: string; answered: number; gapCountLabel: () => Promise<string> }> {
  const rail = page.locator('[data-orbitpm-aris-chat]')
  await expect(rail).toBeVisible()
  // §18.1: the deterministic gap scanner runs on the LIVE document, with no key.
  await expect
    .poll(async () => rail.locator('[data-orbitpm-aris-chat-gaps] li').count(), {
      timeout: 60_000
    })
    .toBeGreaterThan(0)
  const gapCountLabel = async (): Promise<string> =>
    (await rail.getByText(/gaps found$/u).innerText()).trim()
  const gapsBefore = await gapCountLabel()

  await rail.locator('[data-orbitpm-aris-chat-start]').click()
  const questions = rail.locator('[data-orbitpm-aris-chat-question]')
  await expect.poll(async () => questions.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  // §18.2 bounds the interview to three questions per round.
  expect(await questions.count()).toBeLessThanOrEqual(3)

  const textInputs = questions.locator('input:not([type="checkbox"])')
  const answered = await textInputs.count()
  expect(answered).toBeGreaterThan(0)
  for (let index = 0; index < answered; index += 1) {
    await textInputs.nth(index).fill(`Reviewed value ${index + 1}`)
  }
  await rail.locator('[data-orbitpm-aris-chat-submit]').click()

  // §18.5: the safe batch applied atomically and left one receipt per change.
  await expect
    .poll(async () => rail.locator('[data-orbitpm-aris-chat-receipts] li').count(), {
      timeout: 30_000
    })
    .toBe(answered)

  return { gapsBefore, answered, gapCountLabel }
}

test('the chat improvement rail auto-applies safe field completions atomically and records a receipt for each', async ({
  page
}) => {
  await openReferenceExport(page)
  const { gapsBefore, gapCountLabel } = await completeSafeFields(page)

  // The applied batch really changed the live document: the deterministic gap
  // scanner, which runs on that document, now reports fewer gaps.
  await expect.poll(gapCountLabel, { timeout: 30_000 }).not.toBe(gapsBefore)
})

test('one undo reverts the whole batch the chat rail applied', async ({ page }) => {
  await openReferenceExport(page)
  const { gapsBefore, gapCountLabel } = await completeSafeFields(page)

  // §18.5 step 7 / §18.8: the applied batch is undoable through the rail's own
  // affordance, and the document returns to its pre-application revision.
  const rail = page.locator('[data-orbitpm-aris-chat]')
  const railUndo = rail.locator('[data-orbitpm-aris-chat-undo]')
  await expect(railUndo).toBeEnabled()
  await railUndo.click()
  await expect.poll(gapCountLabel, { timeout: 30_000 }).toBe(gapsBefore)
  // A reverted gesture is a redoable one.
  await expect(page.locator('[data-orbitpm-aris-redo]')).toBeEnabled()
})

test('the process assistant answers a folder question with no provider key, and its chip selects the model on the canvas', async ({
  page
}) => {
  const offending: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (
      url.startsWith('file://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url === 'about:blank'
    ) {
      return
    }
    offending.push(`${request.method()} ${url}`)
  })

  await openReferenceExport(page)

  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await expect(dialog).toBeVisible()

  // The panel states, in the product's own copy, that this path uses no key.
  await expect(dialog.getByText('8 indexed models', { exact: true })).toBeVisible()

  await dialog
    .locator('[data-orbitpm-aris-assistant-question]')
    .fill('Which processes are available?')
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click()

  const answer = dialog.locator('[data-orbitpm-aris-assistant-answer]')
  await expect(answer).toBeVisible()
  await expect(answer.locator('[data-orbitpm-aris-assistant-chip]').first()).toBeVisible()

  const chip = answer.locator('[data-orbitpm-aris-assistant-chip]').first()
  const chipTarget = await chip.getAttribute('data-orbitpm-aris-assistant-chip')
  expect(chipTarget).not.toBeNull()
  await chip.click()

  // The chip closed the drawer and moved the canvas to the model it names.
  await expect(dialog).toBeHidden()
  await expect
    .poll(async () => occurrencesOf(page, await activeModelId(page)).count(), { timeout: 60_000 })
    .toBeGreaterThan(0)

  // Answering locally is answering offline.
  expect(offending).toEqual([])
})

test('the derived AML export downloads real bytes for an untouched import', async ({ page }) => {
  await openReferenceExport(page)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-orbitpm-aris-export-derived]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.derived\.(?:aml|xml)$/u)

  const saved = join(mkdtempSync(join(tmpdir(), 'orbitpm-aris-export-')), 'derived.xml')
  await download.saveAs(saved)
  const derived = readFileSync(saved)
  const original = readFileSync(REFERENCE_AML)

  // §9: an untouched import re-exports the original byte-for-byte. Anything
  // else means the writer rewrote records it was never asked to touch.
  expect(derived.byteLength).toBe(original.byteLength)
  expect(derived.equals(original)).toBe(true)
})

test('the official ARIS Excel template downloads from the single file and re-opens as native AML', async ({
  page
}) => {
  await openReferenceExport(page)

  const createPanel = page.locator('[data-orbitpm-aris-create]').first()
  await createPanel.locator('[data-orbitpm-aris-create-excel-tab]').click()

  const templateDownload = page.waitForEvent('download')
  await createPanel.locator('[data-orbitpm-aris-template-example]').click()
  const workbook = await templateDownload
  expect(workbook.suggestedFilename()).toMatch(/\.xlsx$/u)

  const saved = join(mkdtempSync(join(tmpdir(), 'orbitpm-aris-template-')), 'example.xlsx')
  await workbook.saveAs(saved)
  // A real OOXML ZIP container, not a stub.
  expect(Array.from(readFileSync(saved).subarray(0, 2))).toEqual([0x50, 0x4b])

  const tabsBefore = await page.getByRole('tab').count()
  await page.locator('input[accept=".xlsx"]').setInputFiles(saved)

  // The workbook became a real source tab whose canvas drew real occurrences —
  // no AI, no provider, no key.
  await expect
    .poll(async () => page.getByRole('tab').count(), { timeout: 120_000 })
    .toBe(tabsBefore + 1)
  await expect
    .poll(async () => occurrencesOf(page, await activeModelId(page)).count(), { timeout: 120_000 })
    .toBeGreaterThan(0)
  await expect(page.locator('[data-orbitpm-aris-excel-issues]')).toHaveCount(0)
})
