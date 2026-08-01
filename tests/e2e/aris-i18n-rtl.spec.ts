import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { selectOccurrenceOnCanvas } from './helpers/canvasOverlay'
import { disableAutoTranslate } from './helpers/prefs'

// English/Arabic dialog characterization against the ARIS shell.
//
// This replaces the deleted tests/e2e/lite-i18n-rtl.spec.ts, which drove the
// removed bpmn-js canvas (plan §5.3). It is the spec
// scripts/aris-phase1-characterization.mjs waits for at
// tests/e2e/aris-i18n-rtl.spec.ts, and it is what unblocks
// `npm run test:aris:phase1` past its deliberate "NOT YET RETARGETED" abort.
//
// Same harness convention as the surviving specs: BUILT single file over
// file://, forced fallback mode (no directory-picker/OPFS), programmatic
// setup through the real DOM the app renders — no source-level mocking.
//
// The reference fixture is the real customer export used throughout this
// project (see aris_checkpoint.md, scripts/aris-file-smoke.mjs,
// scripts/aris-phase0-baseline.ts, src/aris/*/animalWf*.test.ts): a sibling
// directory to the repo, not inside it, so it is looked up with three `..`
// segments from tests/e2e/.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')

// Verified against the source XML (see the task record for this spec): of the
// 279 ObjDef records in the AnimalWF export, only two — both OT_APPL_SYS,
// ObjDef.-6n37IkhqS5m-p-L and ObjDef.USMsDKh5WI-p-L — carry a genuinely
// Arabic-script AT_NAME ("الهوية الرقمية", i.e. "Digital Identity"; their
// English AT_NAME is "UAE Pass"). 249 of the 279 ObjDef records have no
// Arabic name at all. Every occurrence id below is a real ObjOcc of one of
// those two definitions, so this list — not an arbitrary/first canvas
// element — is what the Details-rail test below selects: it is the one place
// in this fixture guaranteed to carry real Arabic prose, not translated UI
// chrome.
const UAE_PASS_OCCURRENCE_IDS = [
  'ObjOcc.3xqe8yXO9Z7-u-L--7NM2g3bbH6M-x-L-33-c',
  'ObjOcc.-B9Yj_LmLS8-u-L--1a7rDOHpCIn-x-L-33-c',
  'ObjOcc.-6EnWVw61nNF-u-L-7hRin-2bBRX-x-L-33-c',
  'ObjOcc.3xqe8yXO9Z7-u-L-4l0PU4MwRGa-x-L-33-c',
  'ObjOcc.3xqe8yXO9Z7-u-L-7HT95v592G-x-L-33-c',
  'ObjOcc.3xqe8yXO9Z7-u-L-1__71mc2SbA-x-L-33-c',
  'ObjOcc.3xqe8yXO9Z7-u-L-2uEU1VWdSFi-x-L-33-c',
  'ObjOcc.-B9Yj_LmLS8-u-L-6fpgT5ZPLDF-x-L-33-c',
  'ObjOcc.-6EnWVw61nNF-u-L-1I60jhPgh1Z-x-L-33-c',
  'ObjOcc.-6EnWVw61nNF-u-L-68q16eDaKYt-x-L-33-c',
  'ObjOcc.-6EnWVw61nNF-u-L--oqUHfki3_3-x-L-33-c',
  'ObjOcc.-6EnWVw61nNF-u-L--4IyPkg8Mvvh-x-L-33-c'
]

// The owning model of `UAE_PASS_OCCURRENCE_IDS[0]`, verified against the source
// XML (the occurrence sits inside `<Model Model.ID="Model.3xqe8yXO9Z7-u-L" …>`).
// A canvas click — unlike the retired Accounting rail's reveal — does not switch
// models, so the helper below must make this model active before clicking.
const UAE_PASS_MODEL_ID = 'Model.3xqe8yXO9Z7-u-L'

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
  expect(statSync(REFERENCE_AML).isFile(), `reference fixture missing at ${REFERENCE_AML}`).toBe(
    true
  )
})

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await disableAutoTranslate(page)
}

/** Opens the built shell in English/LTR fallback mode and imports the real reference export. */
async function openReferenceExport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 })
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8)
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached' })
}

function occurrenceLocator(page: Page): Locator {
  return page.locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
}

/** Makes one model active via the explorer and waits for its layer to draw. */
async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  await expect
    .poll(
      async () =>
        page
          .locator(
            `[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"] g.djs-element[data-element-id^="ObjOcc."]`
          )
          .count(),
      { timeout: 120_000 }
    )
    .toBeGreaterThan(0)
}

/**
 * Selects one occurrence by fitting the active model into the viewport and
 * clicking its gfx — the same `element.click` path a user takes. `fitLabel` is
 * the localized "Zoom Fit" button caption, so the same helper works while the
 * interface is English or Arabic. Replaces the retired Accounting rail's
 * "Select {id} on the canvas" reveal; because a canvas click does not switch
 * models, the caller selects the owning model first. On a large real EPC a gfx
 * centre can be covered by an overlapping caption, so this falls back to the
 * element's own transparent `.djs-hit` area (a real mouse event, never a
 * synthesized `dispatchEvent`, which diagram-js ignores).
 */
async function selectOccurrence(page: Page, occurrenceId: string, fitLabel: string): Promise<void> {
  // After Zoom Fit a real occurrence can land under the minimap; wheel-pan it
  // clear of canvas overlays (as a user would) before clicking it.
  await selectOccurrenceOnCanvas(page, occurrenceId, { fitLabel })
}

/**
 * Selects the genuinely bilingual "UAE Pass" / "الهوية الرقمية" occurrence on
 * the canvas. It lives on `UAE_PASS_MODEL_ID`, far outside the initial viewport
 * on a large real EPC, so this makes that model active, fits it, then clicks the
 * shape — the same selection pipeline a user drives, without depending on the
 * removed Accounting rail. `fitLabel` defaults to the English caption.
 */
async function selectBilingualAppSystemOccurrence(
  page: Page,
  fitLabel = 'Zoom Fit'
): Promise<void> {
  await selectModel(page, UAE_PASS_MODEL_ID)
  await selectOccurrence(page, UAE_PASS_OCCURRENCE_IDS[0], fitLabel)
}

test('language toggle switches dir/lang and mirrors header, settings, and assistant chrome, then reverts to English', async ({
  page
}) => {
  await openReferenceExport(page)

  const banner = page.getByRole('banner')

  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(banner.getByRole('button', { name: 'Assistant', exact: true })).toBeVisible()
  await expect(banner.getByRole('button', { name: '⚙ Settings', exact: true })).toBeVisible()

  const languageToggle = banner.getByRole('button', { name: /^(Interface|الواجهة):/ })
  await expect(languageToggle).toHaveText('Interface: العربية')

  await languageToggle.click()

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(banner.getByRole('button', { name: 'المساعد', exact: true })).toBeVisible()
  await expect(banner.getByRole('button', { name: '⚙ الإعدادات', exact: true })).toBeVisible()
  await expect(languageToggle).toHaveText('الواجهة: EN')

  await banner.getByRole('button', { name: '⚙ الإعدادات', exact: true }).click()
  const arSettingsDialog = page.getByRole('dialog', {
    name: 'الإعدادات — مفاتيح الذكاء الاصطناعي',
    exact: true
  })
  await expect(arSettingsDialog).toBeVisible()
  // `getByLabel` targets the `aria-label` specifically: the dialog also has a
  // second, textual "إغلاق" footer button (settings.close, distinct from the
  // icon close button's settings.close.aria), so a name-based role query is
  // ambiguous here — matches the convention in scripts/aris-file-smoke.mjs.
  await arSettingsDialog.getByLabel('إغلاق', { exact: true }).click()

  await banner.getByRole('button', { name: 'المساعد', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'مساعد العمليات', exact: true })).toBeVisible()
  await page.getByLabel('إغلاق المساعد', { exact: true }).click()

  await languageToggle.click()

  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(banner.getByRole('button', { name: 'Assistant', exact: true })).toBeVisible()
  await expect(banner.getByRole('button', { name: '⚙ Settings', exact: true })).toBeVisible()
})

test('Arabic mirrors the explorer to the trailing edge while the ARIS canvas geometry stays unmirrored', async ({
  page
}) => {
  await openReferenceExport(page)

  const explorer = page.locator('#orbitpm-aris-explorer')
  const canvas = page.locator('[data-orbitpm-aris-canvas]').first()

  const ltrExplorerBox = await explorer.boundingBox()
  const ltrCanvasBox = await canvas.boundingBox()
  expect(ltrExplorerBox).not.toBeNull()
  expect(ltrCanvasBox).not.toBeNull()
  // English/LTR: the explorer is the leading (left) pane, the canvas trails it.
  expect(ltrExplorerBox!.x).toBeLessThan(ltrCanvasBox!.x)

  // Capture the on-canvas element geometry *relative to the canvas box*
  // before switching languages, so a later comparison is not confused by the
  // whole layout shifting sides.
  const occurrences = occurrenceLocator(page)
  const sampleCount = Math.min(5, await occurrences.count())
  expect(sampleCount).toBeGreaterThan(0)
  const before: Array<{ id: string | null; relX: number; relY: number }> = []
  for (let index = 0; index < sampleCount; index += 1) {
    const el = occurrences.nth(index)
    const id = await el.getAttribute('data-element-id')
    const box = await el.boundingBox()
    expect(box).not.toBeNull()
    before.push({ id, relX: box!.x - ltrCanvasBox!.x, relY: box!.y - ltrCanvasBox!.y })
  }

  const tools = page.locator('[data-orbitpm-aris-rail] [data-orbitpm-aris-tools]')
  await expect(tools).toBeVisible()
  expect(await tools.evaluate((node) => getComputedStyle(node).direction)).toBe('ltr')
  await expect(page.locator('[data-orbitpm-aris-canvas] .djs-palette')).toHaveCount(0)

  await page.getByRole('button', { name: /^Interface:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  const rtlExplorerBox = await explorer.boundingBox()
  const rtlCanvasBox = await canvas.boundingBox()
  expect(rtlExplorerBox).not.toBeNull()
  expect(rtlCanvasBox).not.toBeNull()
  // Arabic/RTL: the explorer pane physically moves to the trailing (right) edge.
  expect(rtlExplorerBox!.x).toBeGreaterThan(rtlCanvasBox!.x)

  // The graph itself is not rebuilt or mirrored by a language toggle: the
  // same occurrences, at the same offsets inside the (possibly relocated)
  // canvas box, in the same left-to-right reading order as the source.
  for (let index = 0; index < sampleCount; index += 1) {
    const el = occurrences.nth(index)
    const id = await el.getAttribute('data-element-id')
    const box = await el.boundingBox()
    expect(box).not.toBeNull()
    expect(id).toBe(before[index].id)
    expect(box!.x - rtlCanvasBox!.x).toBeCloseTo(before[index].relX, 0)
    expect(box!.y - rtlCanvasBox!.y).toBeCloseTo(before[index].relY, 0)
  }

  expect(await tools.evaluate((node) => getComputedStyle(node).direction)).toBe('rtl')
  await expect(
    tools.locator('button[data-aris-catalog-id="epc.event"] .aris-palette-entry__label')
  ).toHaveText('حدث')

  // While the geometry stays unmirrored, the caption *content* follows the
  // interface language (view-only, off the undo stack — `contentLang ?? lang`
  // drives `setContentLanguage` in ArisStudioTab). Select a genuinely bilingual
  // occurrence (UAE Pass / الهوية الرقمية) by fitting its model and clicking it on
  // the canvas — the Accounting rail that used to select it is gone. The Zoom Fit
  // button caption is localized, so pass its Arabic form while the app is Arabic.
  await selectBilingualAppSystemOccurrence(page, 'ملاءمة التكبير')
  await expect(canvas.getByText('الهوية الرقمية').first()).toBeVisible()

  // Flip the interface back to English: the SAME occurrence's caption re-renders
  // in English — the text changed, the geometry did not.
  await page.getByRole('button', { name: /^الواجهة:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(canvas.getByText('UAE Pass').first()).toBeVisible()
})

test('Details rail selection surfaces genuine Arabic source content, and its tabs localize in both languages', async ({
  page
}) => {
  await openReferenceExport(page)

  await selectBilingualAppSystemOccurrence(page)

  // The selected occurrence's accessible region label is the canvas business-object name
  // (`ArisStudioTab.tsx`'s `businessObjectLabel`, sourced from `canvasSync.ts`'s
  // `readLocalized(definition?.names)`, which always resolves the DEFAULT_LOCALE_ID='en-US'
  // name and is not reactive to the interface-language toggle — a separate concern from the
  // bilingual Names-tab row asserted below). For this object that is the genuine English
  // AT_NAME "UAE Pass" from the source, not a placeholder or a stale ARabic fallback: before
  // `src/aris/canvas/localization.ts`'s `readLocalized` was fixed to classify the raw,
  // unexpanded `&LocaleId.USen;`/`&LocaleId.AEar;` entity references AML actually uses, its
  // exact-match lookup against 'en-US' always missed for imported content and silently fell
  // through to `fallback` — the first `AttrValue` encountered in source order, which for this
  // one record is the Arabic AttrValue (it precedes the English one in the AML), so this label
  // used to incorrectly read "Details for الهوية الرقمية" even in the English interface.
  await expect(
    page.getByRole('region', { name: 'Details for UAE Pass', exact: true })
  ).toBeVisible()

  await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Names', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Attributes', exact: true })).toBeVisible()

  // The Names tab's bilingual row (`ArisDetailsRail`'s `DetailRows` renders every
  // `bilingual` row as an English `<span lang="en">` beside an Arabic `<span lang="ar">`)
  // must show the source's genuine English and Arabic AT_NAME side by side, not "Not set" on
  // one side — this is the ObjDef.-6n37IkhqS5m-p-L / ObjDef.USMsDKh5WI-p-L pair whose raw AML
  // locale ids are the unexpanded `&LocaleId.USen;` / `&LocaleId.AEar;` entity references
  // (see src/aris/details/tabs.ts's `classifyLocale`), the exact form a naive locale-id
  // allow-list misses.
  await page.getByRole('tab', { name: 'Names', exact: true }).click()
  const inheritedNameRow = page.locator('.orbitpm-aris-defs > div', { hasText: 'Inherited name' })
  await expect(inheritedNameRow.locator('span[lang="en"]')).toHaveText('UAE Pass')
  await expect(inheritedNameRow.locator('span[lang="ar"]')).toHaveText('الهوية الرقمية')

  await page.getByRole('button', { name: /^Interface:/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await expect(page.getByRole('tab', { name: 'عام', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'الأسماء', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'السمات', exact: true })).toBeVisible()

  // The bilingual row itself is not re-derived per interface language — the same English/Arabic
  // pair from the source still renders together after the UI language toggle.
  await page.getByRole('tab', { name: 'الأسماء', exact: true }).click()
  const inheritedNameRowAr = page.locator('.orbitpm-aris-defs > div', { hasText: 'الاسم الموروث' })
  await expect(inheritedNameRowAr.locator('span[lang="en"]')).toHaveText('UAE Pass')
  await expect(inheritedNameRowAr.locator('span[lang="ar"]')).toHaveText('الهوية الرقمية')
})

test('focus order and keyboard operability hold in both LTR and RTL: header controls are reachable and activatable via Tab and Enter alone', async ({
  page
}) => {
  await openReferenceExport(page)

  const banner = page.getByRole('banner')

  for (const toggleFirst of [false, true]) {
    if (toggleFirst) {
      await banner.getByRole('button', { name: /^Interface:/ }).click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    }

    const assistantLabel = toggleFirst ? 'المساعد' : 'Assistant'
    const settingsLabel = toggleFirst ? '⚙ الإعدادات' : '⚙ Settings'

    const assistantButton = banner.getByRole('button', { name: assistantLabel, exact: true })
    await assistantButton.focus()
    await expect(assistantButton).toBeFocused()

    // Tab order is DOM order, unaffected by visual mirroring: Assistant is
    // immediately followed by Settings in both directions.
    await page.keyboard.press('Tab')
    const settingsButton = banner.getByRole('button', { name: settingsLabel, exact: true })
    await expect(settingsButton).toBeFocused()

    // Keyboard activation (Enter), not a pointer click, opens the dialog.
    await page.keyboard.press('Enter')
    const settingsTitle = toggleFirst ? 'الإعدادات — مفاتيح الذكاء الاصطناعي' : 'Settings — AI keys'
    await expect(page.getByRole('dialog', { name: settingsTitle, exact: true })).toBeVisible()

    // Escape closes it and returns focus to the trigger, in both directions.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: settingsTitle, exact: true })).toBeHidden()
    await expect(settingsButton).toBeFocused()
  }
})
