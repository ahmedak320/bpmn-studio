import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Plan §21.3 — the details rail's *editing* surface, in a real browser.
 *
 * Phase 18 found the rail read-only: `src/aris/shell/ArisDetailsRail.tsx` had no
 * input, no textarea and no onChange, so the §21.3 bullets "edit bilingual
 * attributes" and "edit styles/routes/lanes/text/attachments" had product
 * coverage only through the palette, the context pad and the chat rail. Five
 * §11.4 operations were unreachable by a user entirely.
 *
 * What this file proves against the built artifact, which no unit test can:
 *
 *  - a bilingual name edit made in the rail persists and updates **every**
 *    occurrence of that definition on the canvas (§8.2);
 *  - an occurrence-scoped edit changes that shape and leaves its siblings alone;
 *  - each edit is exactly one step on the product's own undo stack;
 *  - the rail is reachable, navigable and editable with the keyboard alone, in
 *    LTR and in RTL.
 *
 * Harness convention matches the surviving ARIS specs: the BUILT single file
 * over file://, forced fallback storage, real user gestures, no source-level
 * mocking.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

/**
 * Verified against the source XML: in `Model.3i-a2j4HRS3-u-L`,
 * `ObjDef.-7D6lSfS2UiC-p-L` ("Smart Hub" in both the English and the Arabic
 * locale) is drawn 13 times, and it is the ONLY definition drawn in that model
 * carrying that name — so counting captions by text is an exact count of that
 * definition's occurrences, and a rename that misses even one of them is
 * visible immediately. The two occurrence ids below are real `ObjOcc` records
 * of that definition in that model; they are selected through the accounting
 * rail rather than clicked, because a large real EPC puts most shapes outside
 * the initial viewport (the same reason tests/e2e/aris-i18n-rtl.spec.ts selects
 * that way).
 */
const SHARED_MODEL_ID = 'Model.3i-a2j4HRS3-u-L'
const SHARED_DEFINITION_ID = 'ObjDef.-7D6lSfS2UiC-p-L'
const SHARED_NAME = 'Smart Hub'
const SHARED_OCCURRENCE_COUNT = 13
const OCCURRENCE_A = 'ObjOcc.3i-a2j4HRS3-u-L-2RrG0o5obHn-x-L-33-c'
const OCCURRENCE_B = 'ObjOcc.3i-a2j4HRS3-u-L--oQd_Yb3pM-x-L-33-c'

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
  // Parsing the 4.3 MB reference export is genuinely slow — several seconds in
  // Chromium, noticeably more in WebKit — so this waits on the explorer rather
  // than on the default 5 s assertion timeout.
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 120_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
}

function modelLayer(page: Page, modelId: string): Locator {
  return page.locator(`[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"]`)
}

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  await expect
    .poll(
      async () =>
        modelLayer(page, modelId).locator('g.djs-element[data-element-id^="ObjOcc."]').count(),
      { timeout: 120_000 }
    )
    .toBeGreaterThan(0)
}

/** Reveal one occurrence through the accounting rail's own "select" action. */
async function selectOccurrence(page: Page, occurrenceId: string): Promise<void> {
  const filter = page.locator('[data-orbitpm-aris-accounting] input[type="search"]')
  await filter.fill(occurrenceId)
  const row = page.getByRole('button', {
    name: `Select ${occurrenceId} on the canvas`,
    exact: true
  })
  await expect(row).toBeVisible()
  await row.click()
  await filter.fill('')
  await expect(page.locator('[data-orbitpm-aris-details]')).toHaveAttribute(
    'data-orbitpm-aris-details-occurrence',
    occurrenceId
  )
}

/** How many captions in one model's layer read exactly `text`. */
async function captionCount(page: Page, modelId: string, text: string): Promise<number> {
  return page.evaluate(
    ({ modelId: id, text: wanted }) => {
      const layer = document.querySelector(
        `[data-orbitpm-aris-canvas] g[data-element-id="model:${id}"]`
      )
      if (!layer) return -1
      return Array.from(layer.querySelectorAll('text[data-aris-caption]')).filter(
        (node) => (node.textContent ?? '') === wanted
      ).length
    },
    { modelId, text }
  )
}

function detailsTab(page: Page, tabId: string): Locator {
  return page.locator(`[data-orbitpm-aris-details-tab="${tabId}"]`)
}

async function openDetailsTab(page: Page, tabId: string): Promise<void> {
  await detailsTab(page, tabId).click()
  await expect(page.locator(`[data-orbitpm-aris-details-panel="${tabId}"]`)).toBeVisible()
}

/** Type a value into a rail field and commit it with Enter, as a person would. */
async function editField(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector)
  await field.click()
  await field.fill(value)
  await field.press('Enter')
}

test('a bilingual name edit reaches every occurrence of the definition and undoes one step at a time', async ({
  page
}) => {
  test.setTimeout(180_000)
  await openReferenceExport(page)
  await selectModel(page, SHARED_MODEL_ID)
  await selectOccurrence(page, OCCURRENCE_A)

  // The rail names the definition behind the selected shape (§8.2).
  await expect(page.locator('[data-orbitpm-aris-details]')).toHaveAttribute(
    'data-orbitpm-aris-details-definition',
    SHARED_DEFINITION_ID
  )
  expect(await captionCount(page, SHARED_MODEL_ID, SHARED_NAME)).toBe(SHARED_OCCURRENCE_COUNT)

  await openDetailsTab(page, 'names')
  const english = page.locator('[data-orbitpm-aris-name-input="definition:en"]')
  const arabic = page.locator('[data-orbitpm-aris-name-input="definition:ar"]')
  await expect(english).toHaveValue(SHARED_NAME)
  await expect(arabic).toHaveValue(SHARED_NAME)

  // The scope note states the blast radius before the edit is made, and counts
  // every occurrence in the document — not only the ones drawn right now.
  const scope = page.locator('[data-orbitpm-aris-scope="definition"]').first()
  await expect(scope).toBeVisible()
  expect(Number(await scope.getAttribute('data-orbitpm-aris-scope-count'))).toBeGreaterThanOrEqual(
    SHARED_OCCURRENCE_COUNT
  )

  const renamedEn = 'Smart Hub (renamed in rail)'
  const renamedAr = 'مركز التواصل الذكي'

  await editField(page, '[data-orbitpm-aris-name-input="definition:en"]', renamedEn)
  await expect
    .poll(async () => captionCount(page, SHARED_MODEL_ID, renamedEn), { timeout: 20_000 })
    .toBe(SHARED_OCCURRENCE_COUNT)
  expect(await captionCount(page, SHARED_MODEL_ID, SHARED_NAME)).toBe(0)

  await editField(page, '[data-orbitpm-aris-name-input="definition:ar"]', renamedAr)
  await expect(arabic).toHaveValue(renamedAr)
  // The Arabic name is a separate locale value: the canvas label, which reads
  // the English locale, is untouched by it.
  expect(await captionCount(page, SHARED_MODEL_ID, renamedEn)).toBe(SHARED_OCCURRENCE_COUNT)

  // Each edit is exactly one step on the product's own undo stack.
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await undo.click()
  await expect(arabic).toHaveValue(SHARED_NAME)
  await expect(english).toHaveValue(renamedEn)

  await undo.click()
  await expect(english).toHaveValue(SHARED_NAME)
  await expect
    .poll(async () => captionCount(page, SHARED_MODEL_ID, SHARED_NAME), { timeout: 20_000 })
    .toBe(SHARED_OCCURRENCE_COUNT)
  expect(await captionCount(page, SHARED_MODEL_ID, renamedEn)).toBe(0)
})

test('an occurrence-scoped edit changes only that shape and undoes in one step', async ({
  page
}) => {
  test.setTimeout(180_000)
  await openReferenceExport(page)
  await selectModel(page, SHARED_MODEL_ID)
  await selectOccurrence(page, OCCURRENCE_A)
  await openDetailsTab(page, 'general')

  // The style group says, in words, that it is scoped to this shape alone.
  const styleEditor = page.locator('[data-orbitpm-aris-style-editor]')
  await expect(styleEditor).toBeVisible()
  await expect(styleEditor.locator('[data-orbitpm-aris-scope="occurrence"]')).toBeVisible()
  await expect(styleEditor.locator('[data-orbitpm-aris-scope-badge="occurrence"]')).toBeVisible()

  const fill = page.locator('[data-orbitpm-aris-style-input="fillColor"]')
  await expect(fill).toHaveValue('')
  await editField(page, '[data-orbitpm-aris-style-input="fillColor"]', '#123456')
  await expect(fill).toHaveValue('#123456')

  // A sibling occurrence of the SAME definition is untouched…
  await selectOccurrence(page, OCCURRENCE_B)
  await openDetailsTab(page, 'general')
  await expect(page.locator('[data-orbitpm-aris-details]')).toHaveAttribute(
    'data-orbitpm-aris-details-definition',
    SHARED_DEFINITION_ID
  )
  await expect(page.locator('[data-orbitpm-aris-style-input="fillColor"]')).toHaveValue('')

  // …while the edited occurrence kept its own value.
  await selectOccurrence(page, OCCURRENCE_A)
  await openDetailsTab(page, 'general')
  await expect(page.locator('[data-orbitpm-aris-style-input="fillColor"]')).toHaveValue('#123456')

  await page.locator('[data-orbitpm-aris-undo]').click()
  await expect(page.locator('[data-orbitpm-aris-style-input="fillColor"]')).toHaveValue('')
  await expect(page.locator('[data-orbitpm-aris-undo]')).toBeDisabled()
})

/**
 * Walk backwards with Shift+Tab from a control that sits after the rail until
 * focus lands on a details tab. Proves the tab strip is reachable by keyboard
 * alone rather than assuming it and calling `focus()`.
 */
async function tabBackwardsIntoDetails(page: Page): Promise<void> {
  await page.locator('[data-orbitpm-aris-accounting] input[type="search"]').click()
  for (let step = 0; step < 60; step += 1) {
    const onTab = await page.evaluate(() =>
      document.activeElement?.hasAttribute('data-orbitpm-aris-details-tab')
    )
    if (onTab === true) return
    await page.keyboard.press('Shift+Tab')
  }
  throw new Error('the details tab strip was never reached with Shift+Tab')
}

async function selectedTabId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document
        .querySelector('[data-orbitpm-aris-details-tab][aria-selected="true"]')
        ?.getAttribute('data-orbitpm-aris-details-tab') ?? null
  )
}

test('the details rail is fully keyboard operable, and its arrow keys follow the reading direction', async ({
  page
}) => {
  test.setTimeout(180_000)
  await openReferenceExport(page)
  await selectModel(page, SHARED_MODEL_ID)
  await selectOccurrence(page, OCCURRENCE_A)

  // --- LTR ------------------------------------------------------------------
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await tabBackwardsIntoDetails(page)
  // The tab strip is one tab stop: only the selected tab is reachable by Tab.
  expect(
    await page
      .locator('[data-orbitpm-aris-details-tab]')
      .evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).tabIndex === 0).length)
  ).toBe(1)

  // Land on the first tab, then walk the strip with the arrow keys.
  await page.keyboard.press('Home')
  expect(await selectedTabId(page)).toBe('general')
  await page.keyboard.press('ArrowRight')
  expect(await selectedTabId(page)).toBe('names')
  await page.keyboard.press('ArrowLeft')
  expect(await selectedTabId(page)).toBe('general')
  await page.keyboard.press('End')
  expect(await selectedTabId(page)).toBe('history')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  expect(await selectedTabId(page)).toBe('names')

  // From the strip, Tab reaches the panel and then the first editable field —
  // no pointer anywhere in this sequence.
  const english = page.locator('[data-orbitpm-aris-name-input="definition:en"]')
  await expect(english).toBeVisible()
  for (let step = 0; step < 8; step += 1) {
    const onField = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-orbitpm-aris-name-input')
    )
    if (onField === 'definition:en') break
    await page.keyboard.press('Tab')
  }
  await expect(english).toBeFocused()

  // The field is announced with its own label and its group's §8.2 scope note.
  const describedBy = (await english.getAttribute('aria-describedby')) ?? ''
  expect(describedBy.length).toBeGreaterThan(0)
  const fieldId = (await english.getAttribute('id')) ?? ''
  await expect(page.locator(`label[for="${fieldId}"]`)).toBeVisible()

  // Editing and committing with the keyboard alone changes the document.
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Keyboard rename')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => captionCount(page, SHARED_MODEL_ID, 'Keyboard rename'), { timeout: 20_000 })
    .toBe(SHARED_OCCURRENCE_COUNT)

  // Escape discards a draft instead of writing it.
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Discarded draft')
  await page.keyboard.press('Escape')
  await expect(english).toHaveValue('Keyboard rename')

  await page.locator('[data-orbitpm-aris-undo]').click()
  await expect(english).toHaveValue(SHARED_NAME)

  // --- RTL ------------------------------------------------------------------
  await page.getByRole('button', { name: /^Interface:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await tabBackwardsIntoDetails(page)
  await page.keyboard.press('Home')
  expect(await selectedTabId(page)).toBe('general')
  // Mirrored layout, mirrored keys: ArrowLeft advances, ArrowRight retreats.
  await page.keyboard.press('ArrowLeft')
  expect(await selectedTabId(page)).toBe('names')
  await page.keyboard.press('ArrowRight')
  expect(await selectedTabId(page)).toBe('general')

  // The Arabic name field is still reachable and editable with the keyboard.
  await page.keyboard.press('ArrowLeft')
  const arabic = page.locator('[data-orbitpm-aris-name-input="definition:ar"]')
  await expect(arabic).toBeVisible()
  for (let step = 0; step < 10; step += 1) {
    const onField = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-orbitpm-aris-name-input')
    )
    if (onField === 'definition:ar') break
    await page.keyboard.press('Tab')
  }
  await expect(arabic).toBeFocused()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('مركز ذكي')
  await page.keyboard.press('Enter')
  await expect(arabic).toHaveValue('مركز ذكي')
})
