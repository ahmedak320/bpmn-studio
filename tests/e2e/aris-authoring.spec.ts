import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

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
 * `src/aris/canvas/vocabulary.ts`'s `ARIS_CANVAS_OBJECT_TYPES` — the object
 * types the canvas authors — spelled out (not imported) so a silent shrink of
 * the product's own list cannot silently shrink this test with it.
 *
 * In the reworked DMT symbol library (`src/aris/canvas/dmtLibrary.ts` +
 * `paletteProvider.ts`) the tools panel derives one *default* create entry per
 * object type, keyed `create.<objectType lower-cased>`; non-default symbol
 * presentations get a `.<symbolNum>` suffix. The AND/OR/XOR rule operators are
 * three OT_RULE symbol variants (`ST_OPR_AND_1` is the default `create.ot_rule`,
 * OR and XOR its siblings) rather than the retired standalone `create.rule-*`
 * entries.
 */
const PALETTE_DEFAULT_CREATE_ACTIONS = [
  'create.ot_func',
  'create.ot_evt',
  'create.ot_rule',
  'create.ot_ent_type',
  'create.ot_info_carr',
  'create.ot_business_rule',
  'create.ot_perf',
  'create.ot_appl_sys',
  'create.ot_pers',
  'create.ot_requirement',
  'create.ot_policy',
  'create.ot_pers_type',
  'create.ot_org_unit',
  'create.ot_pos',
  'create.ot_grp',
  'create.ot_risk',
  'create.ot_service'
] as const

/** All three rule operators, as the OT_RULE default + its two symbol variants. */
const PALETTE_RULE_OPERATOR_ACTIONS = [
  'create.ot_rule', // ST_OPR_AND_1 (default)
  'create.ot_rule.st_opr_or_1',
  'create.ot_rule.st_opr_xor_1'
] as const

/** Lower-cased supported object-type tokens, for the "nothing unsupported" guard. */
const SUPPORTED_OBJECT_TYPES_LOWER = new Set(
  PALETTE_DEFAULT_CREATE_ACTIONS.map((action) => action.slice('create.'.length))
)

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
  await disableAutoTranslate(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 120_000 })
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
 * The id of an occurrence a person could actually click whose live presentation
 * is a specific catalog symbol (matched on the renderer's own
 * `data-aris-catalog-id`, src/aris/canvas/renderer.ts): big enough to hit, fully
 * inside the canvas box, and clear of the minimap. The AnimalWF models are
 * large real EPCs, so "the
 * first occurrence in DOM order" is routinely off-screen after Zoom Fit. Returns
 * '' when no occurrence of that symbol is reachable by pointer in this model, so
 * the caller can move on to the next model — pinning the object type this way
 * makes the context pad's helper manifest a knowable constant.
 */
async function clickableOccurrenceIdOfCatalog(
  page: Page,
  modelId: string,
  catalogId: string
): Promise<string> {
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  return page.evaluate(
    ({ scope, wantedCatalogId }) => {
      const canvas = document.querySelector('[data-orbitpm-aris-canvas]')
      if (!canvas) return ''
      const canvasRect = canvas.getBoundingClientRect()
      const overlays = ['.djs-minimap']
        .flatMap((selector) => Array.from(canvas.querySelectorAll(selector)))
        .map((node) => node.getBoundingClientRect())
      for (const node of Array.from(document.querySelectorAll(scope))) {
        if (node.querySelector(`[data-aris-catalog-id="${wantedCatalogId}"]`) === null) continue
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
    },
    {
      scope: `[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"] g.djs-element[data-element-id^="ObjOcc."]`,
      wantedCatalogId: catalogId
    }
  )
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

test('the rail tools panel offers every supported ARIS object type and rule operator, and each one authors a real occurrence', async ({
  page
}) => {
  test.setTimeout(180_000)
  await openReferenceExport(page)
  const modelId = await activeModelId(page)
  await selectModel(page, modelId)

  const tools = page.locator('[data-orbitpm-aris-rail] [data-orbitpm-aris-tools]')
  await expect(tools).toBeVisible()

  // Every tools entry renders a human-readable label (§11.4 create entries plus
  // the free-text annotation).
  await expect
    .poll(async () => tools.locator('.aris-palette-entry__label').count())
    .toBeGreaterThanOrEqual(15)

  // Every supported object type is offered as its default create entry…
  for (const action of PALETTE_DEFAULT_CREATE_ACTIONS) {
    await expect(
      tools.locator(`[data-action="${action}"]`),
      `tools panel is missing ${action}`
    ).toHaveCount(1)
  }
  // …the AND/OR/XOR rule operators are all offered as OT_RULE symbol variants…
  for (const action of PALETTE_RULE_OPERATOR_ACTIONS) {
    await expect(
      tools.locator(`[data-action="${action}"]`),
      `tools panel is missing rule operator ${action}`
    ).toHaveCount(1)
  }
  // …the free-text annotation is offered…
  await expect(tools.locator('[data-action="create.free-text"]')).toHaveCount(1)
  // …and nothing outside the supported object-type set is offered as a create
  // entry (the library may add symbol variants, but never an unsupported type).
  const createActions = await tools
    .locator('[data-action^="create."]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action') ?? ''))
  // The exact create.* count is a knowable constant, not a loose lower bound:
  // `dmtLibraryItems('MT_EEPC')` is the frozen 34-presentation EEPC inventory
  // (src/aris/canvas/dmtLibrary.ts), and ArisToolsPanel emits exactly one
  // `create.*` per row plus one `create.free-text`
  // ⇒ 34 + 1 = 35. Spelled out (not imported) so a silent loss of any of the 17
  // non-default symbol presentations (system-function, process-interface,
  // committee-team, SLA, law-regulation, internal/external person, risk, …) is
  // caught here instead of hiding behind a `> 17` tolerance.
  const EEPC_CREATE_ENTRY_COUNT = 35
  expect(createActions.length).toBe(EEPC_CREATE_ENTRY_COUNT)
  await expect(tools.locator('[data-action^="create."]')).toHaveCount(EEPC_CREATE_ENTRY_COUNT)
  for (const action of createActions) {
    if (action === 'create.free-text') continue
    const objectType = action.slice('create.'.length).split('.')[0]
    expect(
      SUPPORTED_OBJECT_TYPES_LOWER.has(objectType),
      `tools panel offers create action for unsupported object type: ${action}`
    ).toBe(true)
  }

  const canvasBox = await page.locator('[data-orbitpm-aris-canvas]').boundingBox()
  expect(canvasBox).not.toBeNull()
  // Drop point: inside the canvas and clear of the minimap (trailing top corner).
  const dropX = canvasBox!.x + canvasBox!.width * 0.6
  const dropY = canvasBox!.y + canvasBox!.height * 0.75

  // Every default object-type entry, plus the two non-default rule operators,
  // authors exactly one real occurrence and undoes cleanly.
  const authoringActions = [
    ...PALETTE_DEFAULT_CREATE_ACTIONS,
    'create.ot_rule.st_opr_or_1',
    'create.ot_rule.st_opr_xor_1'
  ]
  for (const action of authoringActions) {
    const before = await occurrencesOf(page, modelId).count()
    await page.locator('[data-orbitpm-aris-rail-tab="tools"]').click()
    await tools.locator(`[data-action="${action}"]`).click()
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

test('the context pad quick-connects a typed peer and deletes on the real canvas, and undo restores the document', async ({
  page
}) => {
  test.setTimeout(180_000)
  await openReferenceExport(page)

  // Pin the selected object type so the pad's quick-connect manifest is a
  // knowable constant. An EPC *event* (catalog `epc.event`, OT_EVT) has an exact,
  // deduped four-helper manifest in `contextPadProvider.helpersFor()`:
  //   • outgoing CT_ACTIV_1  → OT_FUNC   (event activates a function)
  //   • incoming CT_CRT_1    ← OT_FUNC   (function creates this event)
  //   • incoming CT_LEADS_TO_2 ← OT_RULE (a rule leads to this event)
  //   • outgoing CT_IS_EVAL_BY_1 → OT_RULE (this event is evaluated by a rule)
  // `dmtConnectionHelpers` yields these once each after the pad de-dupes on
  // direction+peer-type+connection-type — so the count is exactly 4, and a
  // regression that dropped any legal event affordance would break this.
  const EVENT_QUICK_CONNECT_HELPER_COUNT = 4

  // Find a model that actually draws a pointer-reachable event occurrence. Seven
  // of the eight AnimalWF models are EPCs, so this resolves on the first EPC.
  const modelButtons = page.locator('[data-orbitpm-aris-model]')
  const modelButtonCount = await modelButtons.count()
  let modelId = ''
  let targetId = ''
  for (let index = 0; index < modelButtonCount && targetId === ''; index += 1) {
    const candidate = (await modelButtons
      .nth(index)
      .getAttribute('data-orbitpm-aris-model')) as string
    await selectModel(page, candidate)
    const found = await clickableOccurrenceIdOfCatalog(page, candidate, 'epc.event')
    if (found !== '') {
      modelId = candidate
      targetId = found
    }
  }
  expect(targetId, 'no clickable event occurrence found in any AnimalWF model').not.toBe('')

  const occurrences = occurrencesOf(page, modelId)
  const connections = modelLayer(page, modelId).locator('g.djs-connection[data-element-id]')
  const shapesBefore = await occurrences.count()
  const connectionsBefore = await connections.count()
  const idsBefore = new Set(
    await occurrences.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-element-id') ?? '')
    )
  )

  const allOccurrenceIds = async (): Promise<string[]> =>
    occurrences.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-element-id') ?? '')
    )

  // The append/connect gestures were reworked (§11.4): the standalone
  // `connect` + `append.function`/`append.event` entries are replaced by
  // "quick-connect" helpers (`src/aris/canvas/contextPadProvider.ts`) — each one
  // appends a legal, typed peer AND the connection to it in a single gesture,
  // chosen from the exact connection-rule catalog for the selected object type.
  const target = modelLayer(page, modelId).locator(`g[data-element-id="${targetId}"]`)
  await target.click()

  const contextPad = page.locator('[data-orbitpm-aris-canvas] .djs-context-pad')
  await expect(contextPad).toBeVisible()

  // The pad offers delete plus the EXACT set of legal quick-connect helpers for
  // an event — not merely "at least one".
  await expect(contextPad.locator('[data-action="delete"]')).toBeVisible()
  const helpers = contextPad.locator('[data-action^="quick-connect."]')
  await expect.poll(async () => helpers.count()).toBe(EVENT_QUICK_CONNECT_HELPER_COUNT)

  // Both a known outgoing affordance (event → function) and a known incoming one
  // (function → event) must be present; the helper id's trailing ordinal is left
  // unpinned via the prefix match.
  const outgoingToFunction = contextPad.locator(
    '[data-action^="quick-connect.outgoing.ct-activ-1.epc-function."]'
  )
  const incomingFromFunction = contextPad.locator(
    '[data-action^="quick-connect.incoming.ct-crt-1.epc-function."]'
  )
  await expect(outgoingToFunction).toHaveCount(1)
  await expect(incomingFromFunction).toHaveCount(1)

  // -- quick-connect (gesture 1, outgoing): one gesture allocates a new
  //    occurrence AND the typed connection to it.
  await outgoingToFunction.click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 1)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore + 1)

  // -- quick-connect (gesture 2, incoming): the pad stays attached to the source
  //    event, so a second, differently-typed helper drives another typed append
  //    — this time an incoming peer wired INTO the event.
  await expect(contextPad).toBeVisible()
  await incomingFromFunction.click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 2)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore + 2)

  const appendedIds = (await allOccurrenceIds()).filter((id) => !idsBefore.has(id))
  expect(appendedIds.length, 'the two quick-connect gestures created two new occurrences').toBe(2)

  // -- delete: the pad stays attached to the source occurrence after the
  //    quick-connects, so its delete removes that one source occurrence (and
  //    every connection hanging off it — both new quick-connect edges plus any
  //    imported flow edges). The source itself was part of the baseline, and the
  //    two appended peers survive, so the net occurrence count is baseline + 2 − 1
  //    = baseline + 1, and every connection that touched the source is gone (so
  //    the count drops below connectionsBefore + 2). Exact restoration is proved
  //    by the full-undo-to-baseline id-set check below.
  await expect(contextPad).toBeVisible()
  await expect(contextPad.locator('[data-action="delete"]')).toBeVisible()
  await contextPad.locator('[data-action="delete"]').click()
  await expect.poll(async () => occurrences.count(), { timeout: 20_000 }).toBe(shapesBefore + 1)
  await expect.poll(async () => connections.count()).toBeLessThan(connectionsBefore + 2)
  const afterDeleteIds = await allOccurrenceIds()
  expect(afterDeleteIds).not.toContain(targetId)
  for (const appended of appendedIds) expect(afterDeleteIds).toContain(appended)

  // -- undo: every one of those gestures sits on the product's own command
  //    stack; undoing back to the imported baseline restores the document
  //    exactly — same occurrence count, same connection count, same ids — and
  //    empties the stack (the import itself is not undoable).
  const undo = page.locator('[data-orbitpm-aris-undo]')
  for (let step = 0; step < 30 && !(await undo.isDisabled()); step += 1) {
    await undo.click()
  }
  await expect(undo).toBeDisabled()
  await expect.poll(async () => occurrences.count()).toBe(shapesBefore)
  await expect.poll(async () => connections.count()).toBe(connectionsBefore)
  expect(new Set(await allOccurrenceIds())).toEqual(idsBefore)
})

/**
 * Runs the §18.2 interview to completion and returns the gap-count label as it
 * read before the interview started, plus how many fields were answered.
 */
async function completeSafeFields(
  page: Page
): Promise<{ gapsBefore: string; answered: number; gapCountLabel: () => Promise<string> }> {
  // The gap-completion interview now lives in the chat drawer's "Complete this
  // process" tab (authorized product change #4: the improve rail was removed and
  // its interview moved into the drawer). Open the drawer, switch to that tab,
  // and drive the same `data-orbitpm-aris-chat-*` interview surface.
  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('tab', { name: 'Complete this process' }).click()
  const rail = drawer.locator('[data-orbitpm-aris-chat]')
  await expect(rail).toBeVisible()
  // §18.1: the deterministic gap scanner runs on the LIVE document, with no key.
  await expect
    .poll(async () => rail.locator('[data-orbitpm-aris-chat-gaps] li').count(), {
      timeout: 60_000
    })
    .toBeGreaterThan(0)
  // The drawer's interview intro carries the live gap count ("…found N gap(s)…"),
  // re-scanned after every apply/undo; its whole text is stable except that
  // count, so it stands in for the removed rail's "{N} gaps found" line.
  const gapCountLabel = async (): Promise<string> =>
    (await rail.getByText(/found \d+ gap\(s\)/u).innerText()).trim()
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
  await dialog.getByRole('button', { name: 'Send', exact: true }).click()

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
