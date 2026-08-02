import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'

import { buildMinimalValidDraft } from '../../src/aris/ai/testFixtures'
import { revealOccurrencePoint, selectOccurrenceOnCanvas } from './helpers/canvasOverlay'
import { disableAutoTranslate } from './helpers/prefs'

// Retargeted from the pre-ARIS BPMN Lite shell (plan §5.3 removed the
// folder-workspace "Process catalog" UI, the "Details…"/"Source" dialogs, and
// the bpmn-js canvas + `__ORBITPM_LITE__` test hook this spec used to drive).
// The ARIS shell has a fundamentally different bilingual model: every ARIS
// name/attribute is a per-locale value (`ArisLocalizedValue`), not a single
// BPMN element carrying parallel `orbitpm:nameEn`/`orbitpm:nameAr`
// attributes, and there is no per-diagram "active language" toggle — the
// canvas always prefers the English-tagged value when one exists
// (`src/aris/canvas/localization.ts`'s `readLocalized`) and falls through to
// whatever is actually present otherwise.
//
// What this file found still real, and what it found dead, after reading
// every reachable ARIS shell module (see the per-test comments for exact
// file/line grounding):
//
//   STILL REAL (retargeted onto):
//   - Bilingual field import fidelity + wrong-language/mixed/neutral/missing
//     handling: `src/aris/canvas/localization.ts` (`readLocalized`) and
//     `src/aris/shell/arisDetailsEditing.ts` (`detectScriptLang`,
//     `scriptMismatch`, per-locale slots). The details rail's
//     `ArisBilingualEditor`/`ArisAttributesEditor`
//     (`src/aris/shell/ArisDetailsEditors.tsx`) is a REAL, always-mounted
//     editing surface (`ArisStudioTab.tsx`'s `detailsEditing` is
//     unconditional) — this is the modern explicit-repair mechanism; there is
//     no more "Complete bilingual XML review" import-time wizard.
//   - AI generation (`ArisGenerationPanel`/`arisAiGeneration.ts`): a real
//     Description tab (with optional local-only DOCX extraction and native
//     PDF attachment) AND a real "PDF / Picture" document tab (PDF or
//     PNG/JPEG/WebP/GIF, `data-orbitpm-aris-create-document-tab`) both exist
//     today — this is broader than earlier ARIS-era specs' comments describe;
//     verified directly against the current `src/ArisGenerationPanel.tsx`.
//     `ArisAiDraftV1` names are `{ en?, ar? }` pairs and
//     `ArisAiUncertainty` has a `missing-translation` kind (§16.5).
//   - Excel (no AI): the official ARIS template
//     (`src/aris/excel/templateWriter.ts`) is a genuinely bilingual example
//     workbook (`name_en`/`name_ar` columns).
//   - Provider transport resilience: `src/ai/retry.ts`'s bounded retry (429
//     is transient, 3 attempts for a text-only request, 1 for an
//     attachment-bearing one — attachments are never resent on a retry) and
//     `ArisGenerationPanel`'s explicit cancel button / truthful
//     transport-failure status are real and exercised directly.
//   - The deterministic chat gap-scanner (`src/aris/chat/gapScanner.ts`) has
//     dedicated `missingEnglishName`/`missingArabicName` gap kinds (first in
//     its fixed priority order), surfaced through the chat drawer's
//     "Complete this process" interview (`ArisChatDrawer`,
//     `[data-orbitpm-aris-chat]`) and applied as one atomic, one-undo batch —
//     see `tests/e2e/aris-authoring.spec.ts`'s "one undo reverts the whole
//     batch" precedent, reproduced independently below for the translation
//     angle.
//   - Undo/redo (`[data-orbitpm-aris-undo]`/`[data-orbitpm-aris-redo]`) and
//     the derived-AML export (`[data-orbitpm-aris-export-derived]`) are real
//     and are this shell's closest equivalent of "save/reopen" and "restore a
//     backup" — there is no folder-workspace save button or backup zip
//     feature reachable in the ARIS shell any more (see GAP note below).
//
//   STILL REAL (translation surface added after the initial retarget):
//   - Per-diagram translation review: `TranslationReviewDialog`
//     (`src/localization/TranslationReviewDialog.tsx`) is mounted by
//     `ArisTranslateController` (`src/aris/shell/ArisTranslateController.tsx`)
//     and opened from the toolbar's "Translate…" button
//     (`[data-orbitpm-aris-translate]`). The free chain uses
//     `makeFreeTranslateTexts` (`src/ai/freeTranslate.ts`) which calls Google
//     Translate first and falls back to MyMemory per text; the AI provider is
//     offered only when a key is stored. Reviewed proposals apply as one
//     undoable step.
//   - Universal auto-translate: `ArisTranslateController` auto-fills missing
//     labels for every opened/imported/generated tab via the free chain,
//     honours the `arisAutoTranslate` opt-out preference, and reports the
//     result through a toolbar state attribute, the exact review-row badge,
//     and visible outcome toasts.
//   - Diagram content-language toggle: `ArisStudioTab`'s
//     `[data-orbitpm-aris-content-lang]` switches canvas labels between
//     English and Arabic without editing the document; `[data-orbitpm-aris-undo]`
//     stays disabled because the toggle is view-only.
//   - Deterministic fix dialog: `[data-orbitpm-aris-fix-issues]` opens
//     `ArisFixMissingDialog` (`src/aris/shell/ArisFixMissingDialog.tsx`) with
//     auto-fill, confirmation, and interview tiers; confirmed delete proposals
//     apply as one undoable gesture.
//
//   CONFIRMED DEAD (grep against every reachable import from `ArisApp.tsx`,
//   not assumption):
//   - `ReviewedXmlIngestionDialog` ("Complete bilingual XML review") — not
//     imported anywhere reachable.
//   - The folder-workspace "Process catalog" shell, its "Export/Import
//     workspace backup" buttons, and the "Details…"/"Source" (BPMN XML)
//     dialogs — all deleted with the BPMN UI.
//   - The old spreadsheet wizard (`src/spreadsheet/**`, the
//     "Prepare BPMN files"/bilingual-review-required flow) — only ever
//     imported by the dead `src/ai/AiPanelLite.tsx`, not by the ARIS shell,
//     which has its own, simpler `src/aris/excel/**` (no per-cell bilingual
//     audit wizard).
//
// Boot pattern follows `tests/e2e/lite-providers.spec.ts` and
// `tests/e2e/aris-i18n-rtl.spec.ts` (both passing on Chromium/Firefox/WebKit):
// the BUILT `dist/index.html` over `file://`, forced fallback mode, a real
// `input[type="file"]` import — no folder workspace, no source-level mocking
// of the app itself. There is no `__ORBITPM_LITE__`-style JS test hook in the
// ARIS shell (confirmed absent), so every assertion below is DOM-only, the
// same convention every other ARIS-era spec uses.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')
const TINY_PDF = resolve(HERE, 'fixtures/tiny.pdf')

/**
 * A small, hand-written but schema-faithful AML fixture. Its shape (the
 * `<Header-Info>`/`<Group>`/`<Model>`/`<ObjOcc>`/`<ObjDef>` structure, direct
 * `<AttrValue LocaleId="…">text</AttrValue>` text content rather than nested
 * `<PlainText>`, and numeric-LCID locale ids) is copied from
 * `src/aris/model/testFixture.ts`'s `SYNTHETIC_AML` — the exact fixture the
 * ARIS model-layer unit suite parses through the real `buildFromSource`
 * pipeline — so this is grounded in a proven-parseable shape, not a guess.
 * Locale ids 1033 (en-US) / 14337 (ar-AE) are real Windows LCIDs
 * (`src/library/amlParse.ts`'s `localeLang` classifies them directly).
 */
const BILINGUAL_MATRIX_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Translation matrix" CreateDate="2026-07-28" CreateTime="09:00:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.Matrix" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Translation matrix</AttrValue>
        <AttrValue LocaleId="14337">مصفوفة الترجمة</AttrValue>
      </AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Spacer" ObjDef.IdRef="ObjDef.Spacer" SymbolNum="ST_EV" Zorder="0">
        <Position Pos.X="-400" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="20" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.WrongAr" ObjDef.IdRef="ObjDef.WrongAr" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="140" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Mixed" ObjDef.IdRef="ObjDef.Mixed" SymbolNum="ST_FUNC" Zorder="3">
        <Position Pos.X="330" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.EnOnly" ObjDef.IdRef="ObjDef.EnOnly" SymbolNum="ST_FUNC" Zorder="4">
        <Position Pos.X="520" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.ArOnly" ObjDef.IdRef="ObjDef.ArOnly" SymbolNum="ST_FUNC" Zorder="5">
        <Position Pos.X="710" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Rule" ObjDef.IdRef="ObjDef.Rule" SymbolNum="ST_RULE_XOR" Zorder="6">
        <Position Pos.X="900" Pos.Y="195"/>
        <Size Size.dX="70" Size.dY="70"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Neutral" ObjDef.IdRef="ObjDef.Neutral" SymbolNum="ST_FUNC" Zorder="7">
        <Position Pos.X="1030" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.End" ObjDef.IdRef="ObjDef.End" SymbolNum="ST_EV" Zorder="8">
        <Position Pos.X="1220" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="ObjDef.Spacer" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Spacer</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Request received</AttrValue>
        <AttrValue LocaleId="14337">تم استلام الطلب</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.WrongAr" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request</AttrValue>
        <AttrValue LocaleId="14337">Review request</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Mixed" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request two</AttrValue>
        <AttrValue LocaleId="14337">Review طلب</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.EnOnly" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Record decision</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.ArOnly" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="14337">تسجيل نتيجة المراجعة</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Rule" TypeNum="OT_RULE" SymbolNum="ST_RULE_XOR">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Approved?</AttrValue>
        <AttrValue LocaleId="14337">هل تمت الموافقة؟</AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_DESC">
        <AttrValue LocaleId="1033">Case team decision on the request</AttrValue>
        <AttrValue LocaleId="14337">قرار فريق الحالات بشأن الطلب</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Neutral" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">API</AttrValue>
        <AttrValue LocaleId="14337">API</AttrValue>
      </AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.End" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Process complete</AttrValue>
        <AttrValue LocaleId="14337">اكتملت العملية</AttrValue>
      </AttrDef>
    </ObjDef>
  </Group>
</AML>
`

// ---------------------------------------------------------------------------
// Shared boot / interaction helpers (same convention as lite-providers.spec.ts
// and aris-i18n-rtl.spec.ts).
// ---------------------------------------------------------------------------

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be the built production single file').toBeGreaterThan(
    500_000
  )
})

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
}

async function openArisSource(
  page: Page,
  xml: string,
  fileName: string,
  expectedModelCount: number,
  autoTranslate = true
): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 })
  await forceFallbackMode(page)
  if (!autoTranslate) await disableAutoTranslate(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: fileName,
      mimeType: 'application/xml',
      buffer: Buffer.from(xml, 'utf8')
    })
  if (expectedModelCount > 1) {
    await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(expectedModelCount, {
      timeout: 30_000
    })
  } else {
    // A single-model source renders no model picker: `ArisExplorerPane` shows the
    // model-explorer list only for sources with more than one model (Wave 2), so
    // the lone model opens directly as its own studio tab. Wait on that tab
    // instead of a model-explorer button that never renders.
    await expect(page.getByRole('tab', { name: fileName })).toBeVisible({ timeout: 30_000 })
  }
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
}

async function openBilingualMatrix(page: Page, autoTranslate = true): Promise<void> {
  await openArisSource(page, BILINGUAL_MATRIX_AML, 'bilingual-matrix.aml', 1, autoTranslate)
}

/** Boots into the real 279-record customer export, same as every other ARIS-era spec. */
async function openReferenceExport(page: Page, autoTranslate = true): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 })
  await forceFallbackMode(page)
  if (!autoTranslate) await disableAutoTranslate(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  // The real export is 4.3 MB / 279 records; parsing it can comfortably
  // exceed the default 5s assertion timeout under load, so this needs an
  // explicit budget the way the other ARIS-era specs' own imports do.
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 60_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
}

function occurrenceNode(page: Page, occurrenceId: string): Locator {
  return page.locator(`[data-orbitpm-aris-canvas] g.djs-element[data-element-id="${occurrenceId}"]`)
}

async function selectOccurrence(page: Page, occurrenceId: string): Promise<void> {
  // The DMT-symbol-library palette is a ~360px rail over the canvas's leading
  // edge, so after Zoom Fit a shape can land under it; wheel-pan it clear (as a
  // user would) before clicking.
  await selectOccurrenceOnCanvas(page, occurrenceId)
}

/**
 * Asserts a shape's caption contains `phrase`, tolerant of word-wrap: a label
 * wider than its shape wraps into one `<tspan>` per line (authorized
 * typography), including glyph-level breaks inside a word. Compare the exact
 * character sequence without render-only whitespace between tspans.
 */
async function expectOccurrenceCaption(
  page: Page,
  occurrenceId: string,
  phrase: string
): Promise<void> {
  const caption = occurrenceNode(page, occurrenceId).locator('text[data-aris-caption]').first()
  await expect
    .poll(
      async () =>
        caption.evaluate((node) => {
          const tspans = node.querySelectorAll('tspan')
          const value =
            tspans.length > 0
              ? Array.from(tspans, (tspan) => tspan.textContent ?? '').join(' ')
              : (node.textContent ?? '')
          return value.replace(/\s+/gu, '')
        }),
      { timeout: 10_000 }
    )
    .toContain(phrase.replace(/\s+/gu, ''))
}

/**
 * Asserts some shape caption on the visible canvas reads exactly `phrase`,
 * tolerant of the authorized word-wrap that splits a wide label across
 * `<tspan>` lines (a `<text>` node's `textContent` then loses the inter-word
 * spaces). Scoped to `text[data-aris-caption]`, so the print frame's identical
 * Process-Name row-value is never a false match.
 */
async function expectCanvasCaption(page: Page, phrase: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((wanted) => {
          const canvas =
            [...document.querySelectorAll<HTMLElement>('[data-orbitpm-aris-canvas]')].find(
              (node) => node.getBoundingClientRect().width > 0
            ) ?? document.querySelector('[data-orbitpm-aris-canvas]')
          if (!canvas) return false
          const normalize = (value: string): string => value.replace(/\s+/gu, '')
          return [...canvas.querySelectorAll('text[data-aris-caption]')].some((node) => {
            const tspans = node.querySelectorAll('tspan')
            const value =
              tspans.length > 0
                ? Array.from(tspans, (tspan) => tspan.textContent ?? '').join(' ')
                : (node.textContent ?? '')
            return normalize(value) === normalize(wanted)
          })
        }, phrase),
      { timeout: 10_000 }
    )
    .toBe(true)
}

/**
 * Selects a generated shape by its caption text and returns its element id,
 * panning it clear of the palette first. The caption may word-wrap into one
 * `<tspan>` per line (authorized typography) — a `<text>` node's `textContent`
 * then concatenates the words with no separator — so the shape is matched with a
 * whitespace-flexible pattern rather than the literal spaced phrase.
 */
async function selectShapeByCaption(page: Page, phrase: string): Promise<string> {
  const pattern = new RegExp(
    phrase
      .split(/\s+/u)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('\\s*')
  )
  const shape = page
    .locator('[data-orbitpm-aris-canvas]:visible g.djs-element', { hasText: pattern })
    .first()
  await expect(shape).toBeVisible()
  const id = await shape.getAttribute('data-element-id')
  expect(id, `shape "${phrase}" has no data-element-id`).not.toBeNull()
  // Pan the shape clear of the leading-edge palette and click a point verified
  // to be on its own gfx (its centre can be crossed by an attached connection's
  // hit-stroke, so the reveal helper picks an uncovered spot on the shape).
  const point = await revealOccurrencePoint(page, id as string, { fit: false })
  await page.mouse.click(point.x, point.y)
  return id as string
}

async function openDetailsTab(
  page: Page,
  tabLabel: 'General' | 'Names' | 'Attributes'
): Promise<void> {
  await page.getByRole('tab', { name: tabLabel, exact: true }).click()
}

function nameField(page: Page, dataKind: 'definition' | 'model', lang: 'en' | 'ar'): Locator {
  return page.locator(`[data-orbitpm-aris-name-input="${dataKind}:${lang}"]`)
}

function attributeField(page: Page, attributeType: string, lang: 'en' | 'ar'): Locator {
  return page.locator(`[data-orbitpm-aris-attribute-input="${attributeType}:${lang}"]`)
}

/** `ArisTextEditor` commits on blur or Enter — never on keystroke (see ArisDetailsEditors.tsx). */
async function commitField(field: Locator, value: string): Promise<void> {
  await field.fill(value)
  await field.press('Enter')
}

async function undoButton(page: Page): Promise<Locator> {
  return page.locator('[data-orbitpm-aris-undo]')
}

async function exportDerivedAml(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-orbitpm-aris-export-derived]').click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('Playwright did not retain the derived AML download')
  return readFileSync(path)
}

async function configureOpenRouterKey(page: Page, apiKey: string): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: '⚙ Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings — AI keys', exact: true })
  await expect(settings).toBeVisible()
  await settings.getByLabel('OpenRouter API key').fill(apiKey)
  await settings.getByRole('button', { name: 'Save keys' }).click()
  await expect(settings.getByText('Saved.', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(settings).toBeHidden()
}

function recordOffendingRequests(page: Page): string[] {
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    offending.push(`${req.method()} ${url}`)
  })
  return offending
}

async function openGenerationPanel(page: Page): Promise<Locator> {
  const railTab = page.locator('[data-orbitpm-aris-rail-tab="generate"]:visible')
  if ((await railTab.count()) > 0) await railTab.click()
  const panel = page.locator('[data-orbitpm-aris-create]:visible')
  await expect(panel).toBeVisible()
  return panel
}

async function fillDescriptionRequest(
  page: Page,
  name: string,
  description: string
): Promise<void> {
  const createPanel = await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-description-tab]').click()
  await createPanel.locator('[data-orbitpm-aris-create-provider]').selectOption('openrouter')
  await createPanel.getByLabel('Draft name', { exact: true }).fill(name)
  // Not `getByLabel('Process description')`: once the textarea already holds
  // leftover text from a prior attempt (e.g. after a transport failure, which
  // does not clear it), Chromium folds that text into the wrapping <label>'s
  // computed accessible name, so an exact-match label lookup stops matching.
  // The description tab has exactly one <textarea>, so targeting it directly
  // is unambiguous and immune to that quirk.
  await createPanel.locator('textarea').fill(description)
}

async function submitGeneration(page: Page): Promise<void> {
  const createPanel = await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-submit]').click()
}

/** Routes OpenRouter credits/chat endpoints so AI generation succeeds offline. */
async function stubOpenRouter(
  page: Page,
  chatRequests?: Array<Record<string, unknown>>
): Promise<void> {
  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const cors = corsHeaders(request)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/credits') {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 100, total_usage: 1 } })
      })
      return
    }
    if (pathname === '/api/v1/chat/completions' && request.method() === 'POST') {
      chatRequests?.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: successBody()
      })
      return
    }
    await route.abort()
  })
}

type FreeTranslateStubValue = string | { readonly en: string; readonly ar: string }

/** Routes Google Translate and MyMemory so every source text gets a valid target script. */
async function stubFreeTranslate(page: Page, value: FreeTranslateStubValue): Promise<void> {
  const translatedValue = (url: string): string => {
    if (typeof value === 'string') return value
    const parsed = new URL(url)
    const target =
      parsed.searchParams.get('tl') ?? parsed.searchParams.get('langpair')?.split('|')[1]
    return target === 'en' ? value.en : value.ar
  }
  await page.route('https://translate.googleapis.com/**', async (route) => {
    const request = route.request()
    const cors = corsHeaders(request)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify([[[translatedValue(request.url()), 'source', null, null, null]]])
    })
  })
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    const request = route.request()
    const cors = corsHeaders(request)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        responseStatus: 200,
        responseData: { translatedText: translatedValue(request.url()) }
      })
    })
  })
}

function corsHeaders(request: { headers(): Record<string, string> }): Record<string, string> {
  const headers = request.headers()
  return {
    'access-control-allow-origin': headers.origin ?? '*',
    'access-control-allow-headers':
      headers['access-control-request-headers'] ??
      'authorization, content-type, http-referer, x-title',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  }
}

function successBody(): string {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(buildMinimalValidDraft()) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
  })
}

function createDocxFixture(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Review the attached permit request</w:t></w:r></w:p></w:body>
</w:document>`
  return Buffer.from(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
        ),
        'word/document.xml': strToU8(documentXml)
      },
      { level: 0 }
    )
  )
}

// ---------------------------------------------------------------------------
// TR-01 / TR-02 / TR-03
// ---------------------------------------------------------------------------

test('TR1/TR2/TR3: AML import surfaces wrong-language and missing bilingual fields, explicitly repaired through the details rail', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openBilingualMatrix(page, false)

  // TR-01: a value genuinely filed under the Arabic locale but written in
  // Latin script (`ObjDef.WrongAr`'s LocaleId=14337 AttrValue is literally
  // "Review request") is real, faithfully-imported content — the canvas still
  // shows the correctly-tagged English value by default (`readLocalized`'s
  // same-language match beats the mismatched Arabic one), but selecting the
  // object surfaces the mismatch explicitly and lets it be repaired in place.
  await selectOccurrence(page, 'ObjOcc.WrongAr')
  await expect(
    page.getByRole('region', { name: 'Details for Review request', exact: true })
  ).toBeVisible()
  await openDetailsTab(page, 'Names')
  const wrongArField = nameField(page, 'definition', 'ar')
  await expect(wrongArField).toHaveValue('Review request')
  await expect(page.locator('[data-orbitpm-aris-bilingual-editor="definition"]')).toContainText(
    'The stored text is written in English even though the locale id says Arabic.'
  )
  await commitField(wrongArField, 'مراجعة الطلب')
  await expect(wrongArField).toHaveValue('مراجعة الطلب')
  // The canvas caption is unaffected (it was always reading the English slot),
  // proving the repair landed on the Arabic slot alone.
  await expectOccurrenceCaption(page, 'ObjOcc.WrongAr', 'Review request')

  // TR-02: an English-only definition (`ObjDef.EnOnly`) has an explicit, empty
  // Arabic slot — never a silently blank or fabricated value.
  await selectOccurrence(page, 'ObjOcc.EnOnly')
  await openDetailsTab(page, 'Names')
  const enOnlyAr = nameField(page, 'definition', 'ar')
  await expect(enOnlyAr).toHaveValue('')
  await expect(page.locator('[data-orbitpm-aris-bilingual-editor="definition"]')).toContainText(
    'Not set yet'
  )
  await commitField(enOnlyAr, 'تسجيل القرار')
  await expect(enOnlyAr).toHaveValue('تسجيل القرار')

  // TR-02 / TR-03 / TR-08: an Arabic-only definition (`ObjDef.ArOnly`, an
  // "Arabic-first" source record with no English counterpart at all) has no
  // fabricated English value, and — because there is nothing else to fall
  // back to — the canvas caption for it is ACTUAL Arabic script glyphs, not a
  // placeholder, mojibake, or blank shape.
  await expectOccurrenceCaption(page, 'ObjOcc.ArOnly', 'تسجيل نتيجة المراجعة')
  await selectOccurrence(page, 'ObjOcc.ArOnly')
  await openDetailsTab(page, 'Names')
  const arOnlyEn = nameField(page, 'definition', 'en')
  await expect(arOnlyEn).toHaveValue('')
  await expect(page.locator('[data-orbitpm-aris-bilingual-editor="definition"]')).toContainText(
    'Not set yet'
  )
  await commitField(arOnlyEn, 'Record review outcome')
  // Once an English value exists, the canvas prefers it (same fallback chain
  // as every other definition in this shell) — this is the explicit,
  // human-driven repair, not an automatic translation.
  await expectOccurrenceCaption(page, 'ObjOcc.ArOnly', 'Record review outcome')
})

// ---------------------------------------------------------------------------
// TR-04 / TR-08 / TR-10
// ---------------------------------------------------------------------------

test('TR4/TR8/TR10: mixed values, neutral terms, branch labels and attribute details survive undo and a save/reopen round trip', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openBilingualMatrix(page, false)

  // TR-04 mixed values: `ObjDef.Mixed`'s Arabic slot ("Review طلب") mixes
  // Latin and Arabic script. `detectScriptLang` classifies ANY Arabic-bearing
  // text as Arabic, so this is deliberately NOT auto-flagged as a
  // wrong-language mismatch the way `ObjDef.WrongAr`'s pure-Latin value is —
  // a genuinely mixed value is real content a human reviews and rewrites
  // explicitly, through the same editor.
  await selectOccurrence(page, 'ObjOcc.Mixed')
  await openDetailsTab(page, 'Names')
  const mixedAr = nameField(page, 'definition', 'ar')
  await expect(mixedAr).toHaveValue('Review طلب')
  await expect(page.locator('[data-orbitpm-aris-bilingual-editor="definition"]')).not.toContainText(
    'written in'
  )
  await commitField(mixedAr, 'مراجعة الطلب الثانية')
  await expect(mixedAr).toHaveValue('مراجعة الطلب الثانية')
  await expectOccurrenceCaption(page, 'ObjOcc.Mixed', 'Review request two')

  // TR-04 neutral term: an identical value on both sides (`ObjDef.Neutral`,
  // "API"/"API") is real content, not a missing-Arabic gap, and is left
  // exactly as imported.
  await selectOccurrence(page, 'ObjOcc.Neutral')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'en')).toHaveValue('API')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('API')

  // TR-04 branch label + attribute-level details: an EPC rule connector
  // (`ObjDef.Rule`, the closest ARIS analogue of a BPMN gateway's branch
  // condition) carries its own bilingual name AND a bilingual AT_DESC
  // attribute, both editable through the Names and Attributes tabs.
  await selectOccurrence(page, 'ObjOcc.Rule')
  await expect(
    page.getByRole('region', { name: 'Details for Approved?', exact: true })
  ).toBeVisible()
  await openDetailsTab(page, 'Attributes')
  const descAr = attributeField(page, 'AT_DESC', 'ar')
  await expect(descAr).toHaveValue('قرار فريق الحالات بشأن الطلب')
  await commitField(descAr, 'قرار فريق الحالات النهائي بشأن الطلب')
  await expect(descAr).toHaveValue('قرار فريق الحالات النهائي بشأن الطلب')

  // TR-10 undo: the mixed-value repair is one command-stack step, and undo
  // reverts exactly it without touching the neutral term or the attribute
  // edit made afterwards in a different gesture.
  const undo = await undoButton(page)
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(descAr).toHaveValue('قرار فريق الحالات بشأن الطلب')
  await undo.click()
  await selectOccurrence(page, 'ObjOcc.Mixed')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('Review طلب')

  // Reapply both, then round-trip through the derived AML export (this
  // shell's "save"/portability mechanism — there is no folder-workspace save
  // button any more) and a fresh reopen.
  await commitField(nameField(page, 'definition', 'ar'), 'مراجعة الطلب الثانية')
  await selectOccurrence(page, 'ObjOcc.Rule')
  await openDetailsTab(page, 'Attributes')
  await commitField(attributeField(page, 'AT_DESC', 'ar'), 'قرار فريق الحالات النهائي بشأن الطلب')

  const derivedBytes = await exportDerivedAml(page)
  const reopened = await test.step('reopen the exported AML in a fresh load', async () => {
    await openArisSource(
      page,
      derivedBytes.toString('utf8'),
      'bilingual-matrix.derived.aml',
      1,
      false
    )
    return true
  })
  expect(reopened).toBe(true)

  await selectOccurrence(page, 'ObjOcc.Mixed')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('مراجعة الطلب الثانية')
  await selectOccurrence(page, 'ObjOcc.Rule')
  await openDetailsTab(page, 'Attributes')
  await expect(attributeField(page, 'AT_DESC', 'ar')).toHaveValue(
    'قرار فريق الحالات النهائي بشأن الطلب'
  )
})

// ---------------------------------------------------------------------------
// TR-05 (ARIS / backup analogue)
// ---------------------------------------------------------------------------

test('TR5: native ARIS import preserves an explicit Arabic repair through derived export and reimport', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openBilingualMatrix(page, false)

  // An untouched import round-trips through the derived export: the same
  // bilingual content reopens unchanged. This is the ARIS shell's closest
  // equivalent of "restoring a backup" — there is no workspace backup zip
  // feature reachable in this shell (see file header GAP note).
  const untouchedBytes = await exportDerivedAml(page)
  await openArisSource(
    page,
    untouchedBytes.toString('utf8'),
    'bilingual-matrix.roundtrip.aml',
    1,
    false
  )
  await expectOccurrenceCaption(page, 'ObjOcc.Start', 'Request received')
  await selectOccurrence(page, 'ObjOcc.ArOnly')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('تسجيل نتيجة المراجعة')

  // Now make the explicit wrong-language repair (TR-01) and prove the
  // corrected Arabic bytes — not the original mismatched pairing — are what
  // gets exported and what a fresh reopen renders.
  await selectOccurrence(page, 'ObjOcc.WrongAr')
  await openDetailsTab(page, 'Names')
  await commitField(nameField(page, 'definition', 'ar'), 'مراجعة الطلب')

  const repairedBytes = await exportDerivedAml(page)
  const repairedXml = repairedBytes.toString('utf8')
  expect(repairedXml).toContain('مراجعة الطلب')

  await openArisSource(page, repairedXml, 'bilingual-matrix.repaired.aml', 1, false)
  await selectOccurrence(page, 'ObjOcc.WrongAr')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('مراجعة الطلب')
  await expect(nameField(page, 'definition', 'en')).toHaveValue('Review request')
})

// ---------------------------------------------------------------------------
// TR-05 / TR-07 (AI text/DOCX/PDF/PNG/Excel, consent-gated network)
// ---------------------------------------------------------------------------

test('TR5/TR7: AI text, DOCX, PDF, PNG and Excel use their real generation/import surfaces with EN/AR output and consent-gated network', async ({
  page
}) => {
  test.setTimeout(240_000)
  const apiKey = 'mandatory-translation-openrouter-key'
  const modelId = 'google/gemini-3.6-flash' // reviewed for BOTH pdf and images on OpenRouter (providersLite.ts)
  const chatRequests: Array<Record<string, unknown>> = []

  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const cors = corsHeaders(request)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/credits') {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 100, total_usage: 1 } })
      })
      return
    }
    if (pathname === '/api/v1/chat/completions' && request.method() === 'POST') {
      chatRequests.push(request.postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: successBody()
      })
      return
    }
    await route.abort()
  })

  const offending = recordOffendingRequests(page)
  await openReferenceExport(page, false)
  await configureOpenRouterKey(page, apiKey)
  const createPanel = await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-provider]').selectOption('openrouter')
  await createPanel.locator('[data-orbitpm-aris-create-model]').fill(modelId)

  // --- AI text (Description tab, no attachment) -----------------------------
  await fillDescriptionRequest(
    page,
    'AI boundary',
    'Review a permit request and record the decision.'
  )
  expect(chatRequests).toHaveLength(0) // TR-07: no network before consent
  await submitGeneration(page)
  await expect.poll(() => chatRequests.length, { timeout: 30_000 }).toBe(1)
  await expect(
    page
      .locator('[data-orbitpm-aris-create] [role="status"]')
      .filter({ hasText: 'Created 2 models, 4 objects, 3 relations' })
      .last()
  ).toContainText('Created 2 models, 4 objects, 3 relations', { timeout: 30_000 })
  // The generated bilingual content actually reached the new tab's canvas as a
  // shape. Scope to the shape (`g.djs-element`) rather than a bare text query:
  // the authorized print frame renders the model's Process Name row-value with
  // the same text, so an unscoped `getByText` would match two nodes. The shape
  // can sit under the leading-edge palette, so pan it clear before selecting.
  await selectShapeByCaption(page, 'Approve request')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('الموافقة على الطلب')

  // --- AI text + local DOCX extraction --------------------------------------
  await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-description-tab]').click()
  await createPanel.getByLabel('Draft name', { exact: true }).fill('DOCX boundary')
  await createPanel.locator('textarea').fill('Use the attached brief')
  const docxOffending = recordOffendingRequests(page)
  await createPanel.locator('input[type="file"][accept*=".docx"]').setInputFiles({
    name: 'mandatory-translation.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: createDocxFixture()
  })
  await expect(page.getByText(/characters were extracted on this device/i)).toBeVisible({
    timeout: 30_000
  })
  // Local extraction made no network request of its own.
  expect(docxOffending).toEqual([])
  const beforeDocx = chatRequests.length
  await submitGeneration(page)
  await expect.poll(() => chatRequests.length, { timeout: 30_000 }).toBe(beforeDocx + 1)
  expect(JSON.stringify(chatRequests[beforeDocx])).toContain('Review the attached permit request')

  // --- AI PDF via the Description tab's own attachment ----------------------
  await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-description-tab]').click()
  await createPanel.getByLabel('Draft name', { exact: true }).fill('PDF description boundary')
  await createPanel.locator('textarea').fill('Model the process in the attached PDF')
  await createPanel
    .locator('input[type="file"][accept*="application/pdf"]')
    .first()
    .setInputFiles({
      name: 'mandatory-translation.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync(TINY_PDF)
    })
  const beforePdf = chatRequests.length
  await submitGeneration(page)
  await expect.poll(() => chatRequests.length, { timeout: 30_000 }).toBe(beforePdf + 1)
  expect(JSON.stringify(chatRequests[beforePdf])).toContain('data:application/pdf;base64,')

  // --- AI PDF/Picture tab: a PNG picture of a process drawing ---------------
  await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-document-tab]').click()
  await createPanel.getByLabel('Draft name', { exact: true }).fill('PNG boundary')
  // Image attachments are only verified for the reviewed Claude/Gemini routes
  // on OpenRouter (`getLiteModelCapabilities`); re-select the model explicitly
  // — a prior `[data-orbitpm-aris-create-provider]` re-selection above reset it
  // back to the curated default (`z-ai/glm-5.2`, PDF-only).
  await createPanel.locator('[data-orbitpm-aris-create-model]').fill(modelId)
  await createPanel.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: 'mandatory-translation.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nC8AAAAASUVORK5CYII=',
      'base64'
    )
  })
  await createPanel
    .locator('[data-orbitpm-aris-create-hint]')
    .fill('Model the photographed process')
  const beforePng = chatRequests.length
  await submitGeneration(page)
  await expect.poll(() => chatRequests.length, { timeout: 30_000 }).toBe(beforePng + 1)
  expect(JSON.stringify(chatRequests[beforePng])).toContain('data:image/png;base64,')
  expect(chatRequests).toHaveLength(beforePng + 1)

  // --- Excel (no AI, no network): the official bilingual template -----------
  await openGenerationPanel(page)
  await createPanel.locator('[data-orbitpm-aris-create-excel-tab]').click()
  const excelOffending = recordOffendingRequests(page)
  const templateDownload = page.waitForEvent('download')
  await createPanel.locator('[data-orbitpm-aris-template-example]').click()
  const template = await templateDownload
  const templatePath = await template.path()
  if (!templatePath) throw new Error('Playwright did not retain the official Excel example')
  const tabsBeforeExcel = await page.getByRole('tab').count()
  await createPanel.locator('input[accept=".xlsx"]').setInputFiles({
    name: template.suggestedFilename(),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(templatePath)
  })
  await expect
    .poll(async () => page.getByRole('tab').count(), { timeout: 60_000 })
    .toBe(tabsBeforeExcel + 1)
  await expect(page.locator('[data-orbitpm-aris-excel-issues]')).toHaveCount(0)
  // The Excel content reached the new tab's canvas as a shape whose caption reads
  // the imported English name (`selectShapeByCaption` scopes to `g.djs-element`,
  // so the print frame's identical Process-Name row-value is not a false match).
  const submittedId = await selectShapeByCaption(page, 'Leave request submitted')
  await expectOccurrenceCaption(page, submittedId, 'Leave request submitted')
  await openDetailsTab(page, 'Names')
  await expect(nameField(page, 'definition', 'ar')).toHaveValue('تم تقديم طلب الإجازة')
  expect(excelOffending).toEqual([])

  // Nothing in this whole test reached the network before its own explicit
  // consent checkbox was ticked (the reference-export boot and Settings save
  // are the only non-generation requests; both stayed local).
  expect(offending.filter((entry) => entry.includes('openrouter.ai'))).toHaveLength(
    chatRequests.length
  )
})

// ---------------------------------------------------------------------------
// TR-06 / TR-09 (provider transport resilience)
// ---------------------------------------------------------------------------

test('TR6/TR9: AI provider 429 retry, transport exhaustion, cancellation and manual recovery remain truthful', async ({
  page
}) => {
  test.setTimeout(180_000)
  const apiKey = 'mandatory-translation-retry-key'
  const attempts = { retry: 0, exhaust: 0 }
  let cancelStarted!: () => void
  const cancelRequestStarted = new Promise<void>((resolveStarted) => {
    cancelStarted = resolveStarted
  })
  let releaseCancel!: () => void
  const cancelGate = new Promise<void>((resolveGate) => {
    releaseCancel = resolveGate
  })

  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const cors = corsHeaders(request)
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/credits') {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 100, total_usage: 1 } })
      })
      return
    }
    if (pathname !== '/api/v1/chat/completions' || request.method() !== 'POST') {
      await route.abort()
      return
    }
    const body = request.postDataJSON() as { messages: Array<{ role: string; content: string }> }
    const userContent = body.messages[1]?.content ?? ''
    const rateLimited = (): Promise<void> =>
      route.fulfill({
        status: 429,
        headers: { ...cors, 'content-type': 'application/json', 'retry-after': '0' },
        body: JSON.stringify({ error: 'rate limited' })
      })

    if (userContent.includes('RETRY_MARKER')) {
      attempts.retry += 1
      if (attempts.retry < 3) {
        await rateLimited()
        return
      }
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: successBody()
      })
      return
    }
    if (userContent.includes('EXHAUST_MARKER')) {
      attempts.exhaust += 1
      await rateLimited()
      return
    }
    if (userContent.includes('CANCEL_MARKER')) {
      cancelStarted()
      await cancelGate
      // A cancelled fetch aborts client-side; a late fulfillment attempt must
      // not corrupt anything even if Playwright lets it settle.
      try {
        await route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'application/json' },
          body: successBody()
        })
      } catch {
        // Expected once the client has already aborted the request.
      }
      return
    }
    await route.abort()
  })

  await openReferenceExport(page, false)
  await configureOpenRouterKey(page, apiKey)

  // --- 429 retried automatically, then succeeds (text-only: 3 attempts) -----
  await fillDescriptionRequest(page, 'Retry draft', 'RETRY_MARKER review a permit request.')
  const tabsBeforeRetry = await page.getByRole('tab').count()
  await submitGeneration(page)
  await expect.poll(() => attempts.retry, { timeout: 30_000 }).toBe(3)
  await expect(
    page
      .locator('[data-orbitpm-aris-create] [role="status"]')
      .filter({ hasText: 'Created 2 models, 4 objects, 3 relations' })
      .last()
  ).toContainText('Created 2 models, 4 objects, 3 relations', { timeout: 30_000 })
  await expect.poll(async () => page.getByRole('tab').count()).toBe(tabsBeforeRetry + 1)

  // --- transport exhaustion: truthful failure, no false completion (TR-09) --
  await fillDescriptionRequest(page, 'Exhaust draft', 'EXHAUST_MARKER review a permit request.')
  const tabsBeforeExhaust = await page.getByRole('tab').count()
  await submitGeneration(page)
  await expect.poll(() => attempts.exhaust, { timeout: 30_000 }).toBe(3)
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'The provider request failed before any draft came back' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('status').filter({ hasText: /^Created/ })).toHaveCount(0)
  expect(await page.getByRole('tab').count()).toBe(tabsBeforeExhaust)

  // --- explicit cancellation mid-flight --------------------------------------
  await fillDescriptionRequest(page, 'Cancel draft', 'CANCEL_MARKER review a permit request.')
  const tabsBeforeCancel = await page.getByRole('tab').count()
  await submitGeneration(page)
  await cancelRequestStarted
  await page.locator('[data-orbitpm-aris-create-cancel]').click()
  await expect(
    page.getByRole('status').filter({ hasText: 'The request was cancelled; nothing was created.' })
  ).toBeVisible()
  await expect(page.locator('[data-orbitpm-aris-create-cancel]')).toHaveCount(0)
  expect(await page.getByRole('tab').count()).toBe(tabsBeforeCancel)
  releaseCancel()
  // The late, post-abort fulfillment attempt (if it settled at all) did not
  // retroactively create a tab or flip the status to a false completion.
  await page.waitForTimeout(200)
  expect(await page.getByRole('tab').count()).toBe(tabsBeforeCancel)
  await expect(
    page.getByRole('status').filter({ hasText: 'The request was cancelled; nothing was created.' })
  ).toBeVisible()

  // --- manual edit: independent of any provider outcome, a human can always
  // repair a bilingual field directly through the details rail -------------
  await selectShapeByCaption(page, 'Approve request')
  await openDetailsTab(page, 'Names')
  const arField = nameField(page, 'definition', 'ar')
  await expect(arField).toHaveValue('الموافقة على الطلب')
  await commitField(arField, 'الموافقة النهائية على الطلب')
  await expect(arField).toHaveValue('الموافقة النهائية على الطلب')
})

// ---------------------------------------------------------------------------
// TR-02 / TR-06 / TR-09 / TR-10 (chat gap-completion batch)
// ---------------------------------------------------------------------------

test('TR6/TR9/TR10: the chat drawer completion batch fills missing English/Arabic names atomically and reverts as one undo', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openReferenceExport(page, false)

  // The interview now lives in the chat drawer: open the assistant and switch
  // to the 'Complete this process' tab so the interview surface is mounted.
  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()
  const assistant = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await expect(assistant).toBeVisible()
  await assistant.getByRole('tab', { name: 'Complete this process', exact: true }).click()

  const rail = assistant.locator('[data-orbitpm-aris-chat]')
  await expect(rail).toBeVisible()
  // §18.1: the deterministic gap scanner runs on the live document, no AI, no
  // network, and the label is truthful — it is not a stale placeholder.
  await expect
    .poll(async () => rail.locator('[data-orbitpm-aris-chat-gaps] li').count(), { timeout: 60_000 })
    .toBeGreaterThan(0)
  const gapCountLabel = async (): Promise<string> =>
    (await rail.getByText(/found \d+ gap\(s\)/u).innerText()).trim()
  const gapsBefore = await gapCountLabel()

  await rail.locator('[data-orbitpm-aris-chat-start]').click()
  const questions = rail.locator('[data-orbitpm-aris-chat-question]')
  await expect.poll(async () => questions.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  expect(await questions.count()).toBeLessThanOrEqual(3)

  // TR-02: `missingEnglishName`/`missingArabicName` are the two
  // highest-priority gap kinds in `ARIS_CHAT_GAP_KIND_ORDER`
  // (`src/aris/chat/gapScanner.ts`), and the real reference export is missing
  // an Arabic name on 249 of its 279 object definitions
  // (`tests/e2e/aris-i18n-rtl.spec.ts`'s documented count) — so this batch is
  // expected to include a genuine bilingual-name completion, not just
  // unrelated structural gaps.
  const questionKinds = await questions.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-orbitpm-aris-chat-question'))
  )
  expect(
    questionKinds.some((kind) => kind === 'missingEnglishName' || kind === 'missingArabicName')
  ).toBe(true)

  const textInputs = questions.locator('input:not([type="checkbox"])')
  const answered = await textInputs.count()
  expect(answered).toBeGreaterThan(0)
  for (let index = 0; index < answered; index += 1) {
    await textInputs.nth(index).fill(`Reviewed value ${index + 1}`)
  }
  await rail.locator('[data-orbitpm-aris-chat-submit]').click()

  // §18.5: the safe batch applied atomically, one receipt per answered field.
  await expect
    .poll(async () => rail.locator('[data-orbitpm-aris-chat-receipts] li').count(), {
      timeout: 30_000
    })
    .toBe(answered)

  // TR-09: the gap count changed only once the batch actually landed on the
  // live document — not before, and not to a stale value.
  await expect.poll(gapCountLabel, { timeout: 30_000 }).not.toBe(gapsBefore)

  // TR-10: the whole batch is one undo step, and a reverted batch is
  // redoable.
  const railUndo = rail.locator('[data-orbitpm-aris-chat-undo]')
  await expect(railUndo).toBeEnabled()
  await railUndo.click()
  await expect.poll(gapCountLabel, { timeout: 30_000 }).toBe(gapsBefore)
  // The assistant dialog is still open; close it so the main toolbar is reachable.
  await assistant.press('Escape')
  await expect(assistant).toBeHidden()
  const redo = page.locator('[data-orbitpm-aris-redo]')
  await expect(redo).toBeEnabled()
  await redo.click()

  // Redo re-applied the batch; reopen the assistant to read the updated gap count.
  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()
  await expect(assistant).toBeVisible()
  await assistant.getByRole('tab', { name: 'Complete this process', exact: true }).click()
  await expect.poll(gapCountLabel, { timeout: 30_000 }).not.toBe(gapsBefore)
})

// ---------------------------------------------------------------------------
// Lane X3 — new translation surface coverage (TR-content / TR-translate /
// TR-auto-translate / TR-fix).
// ---------------------------------------------------------------------------

test('TR-content-toggle: toolbar content-language switch flips canvas labels and follows app language', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openBilingualMatrix(page, false)

  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  await expect(canvas).toBeVisible()
  const langButton = page.locator('[data-orbitpm-aris-content-lang]')
  await expect(langButton).toBeVisible()

  // A view-only toggle never mutates the document, so undo stays disabled.
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeDisabled()

  // Default: English labels are drawn.
  await expectCanvasCaption(page, 'Request received')

  // Switch canvas labels to Arabic.
  await langButton.click()
  await expectCanvasCaption(page, 'تم استلام الطلب')

  // The English-only element keeps its English fallback — it is never blank.
  await expectCanvasCaption(page, 'Record decision')

  // Toggle back restores English.
  await langButton.click()
  await expectCanvasCaption(page, 'Request received')

  // Switch the app header language to Arabic: the content-language toggle
  // follows by default (it only overrides when the toolbar is clicked).
  await page.getByRole('button', { name: /Interface:/u }).click()
  await expect(page.locator('html[lang="ar"]')).toBeAttached()
  await expect(langButton).toBeVisible()
})

test('TR-translate-review: free Google → MyMemory chain applies as one undoable step', async ({
  page
}) => {
  test.setTimeout(120_000)
  const STUB = 'مترجم'
  await openBilingualMatrix(page, false)
  await stubFreeTranslate(page, STUB)

  const translateFetches: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (
      url.startsWith('https://translate.googleapis.com/') ||
      url.startsWith('https://api.mymemory.translated.net/')
    ) {
      translateFetches.push(url)
    }
  })

  await page.locator('[data-orbitpm-aris-translate]').click()
  const dialog = page.getByRole('dialog', { name: 'Review translation', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox')).toContainText('Google Translate → MyMemory')

  await dialog.getByRole('button', { name: 'Translate now', exact: true }).click()
  await expect(dialog.getByText(/proposal\(s\) returned/u)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText('Provider proposal').first()).toBeVisible({ timeout: 30_000 })
  const acceptOne = dialog
    .getByRole('button', { name: 'Accept this proposal', exact: true })
    .first()
  await expect(acceptOne).toBeVisible()
  await acceptOne.click()
  await dialog.getByRole('button', { name: 'Accept all proposals', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply completed language view', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(translateFetches.length).toBeGreaterThan(0)

  // Toggling the canvas to Arabic now shows the stubbed value.
  await page.locator('[data-orbitpm-aris-content-lang]').click()
  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  await expect(canvas.getByText(STUB, { exact: true }).first()).toBeVisible()

  // One undo reverts the whole translation batch.
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(canvas.getByText(STUB, { exact: true })).toHaveCount(0)
})

test('TR-auto-import: imported AML fills both languages automatically as one undoable step', async ({
  page
}) => {
  test.setTimeout(120_000)
  const AUTO_EN = 'Automatically translated'
  const AUTO_AR = 'مترجم تلقائيا'
  await stubFreeTranslate(page, { en: AUTO_EN, ar: AUTO_AR })
  await openBilingualMatrix(page)

  await expect(page.locator('[data-orbitpm-aris-auto-translate="done"]')).toBeVisible({
    timeout: 60_000
  })
  await expect(
    page.getByRole('status').filter({ hasText: /Translated .* labels automatically/u })
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-orbitpm-aris-translate-missing]')).toHaveCount(0)

  await page.locator('[data-orbitpm-aris-content-lang]').click()
  const canvas = page.locator('[data-orbitpm-aris-canvas]')
  await expect(canvas.getByText(AUTO_AR, { exact: true }).first()).toBeVisible()

  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(canvas.getByText(AUTO_AR, { exact: true })).toHaveCount(0)
})

test('TR-auto-generated: generated models fill missing labels automatically unless opted out', async ({
  page,
  context
}) => {
  test.setTimeout(240_000)

  // --- Preference ON: auto-translate runs after AI generation. ---
  await stubOpenRouter(page)
  await stubFreeTranslate(page, 'ترجمة آلية')

  const translateFetches: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (
      url.startsWith('https://translate.googleapis.com/') ||
      url.startsWith('https://api.mymemory.translated.net/')
    ) {
      translateFetches.push(url)
    }
  })

  await openBilingualMatrix(page)
  await configureOpenRouterKey(page, 'auto-translate-key')

  await fillDescriptionRequest(
    page,
    'Auto-translate draft',
    'Review a permit request and record the decision.'
  )
  await submitGeneration(page)
  const createdStatus = page
    .locator('[data-orbitpm-aris-create] [role="status"]')
    .filter({ hasText: /^Created/u })
    .last()
  await expect(createdStatus).toContainText(/^Created/u, {
    timeout: 30_000
  })
  const sourceTab = page.getByRole('tab', { name: 'bilingual-matrix.aml', exact: true })
  const generatedTab = page.getByRole('tab', { name: 'Auto-translate draft', exact: true })
  await sourceTab.click()
  const completedPanel = await openGenerationPanel(page)
  await expect(completedPanel.getByRole('status').filter({ hasText: /^Created/u })).toBeVisible()
  await generatedTab.click()
  // Confirm the free chain was actually invoked.
  await expect.poll(() => translateFetches.length, { timeout: 30_000 }).toBeGreaterThan(0)

  // The imported matrix and the generated draft are both eligible, so one or
  // two completed auto-translation toasts may coexist depending on dismissal.
  const autoToasts = page
    .getByRole('status')
    .filter({ hasText: /Translated .* labels automatically/u })
  await expect(autoToasts.first()).toBeVisible({ timeout: 30_000 })
  expect(await autoToasts.count()).toBeLessThanOrEqual(2)

  // No review dialog was opened; the fill happened silently.
  await expect(page.getByRole('dialog', { name: 'Review translation', exact: true })).toHaveCount(0)
  await expect(
    page.locator('[role="tabpanel"]:not([hidden]) [data-orbitpm-aris-undo]')
  ).toBeEnabled()
  expect(translateFetches.length).toBeGreaterThan(0)

  // --- Preference OFF: fresh page with opt-out set before load. ---
  const offPage = await context.newPage()
  await forceFallbackMode(offPage)
  await disableAutoTranslate(offPage)
  await stubOpenRouter(offPage)
  await stubFreeTranslate(offPage, 'ترجمة آلية')

  const offTranslateFetches: string[] = []
  offPage.on('request', (req) => {
    const url = req.url()
    if (
      url.startsWith('https://translate.googleapis.com/') ||
      url.startsWith('https://api.mymemory.translated.net/')
    ) {
      offTranslateFetches.push(url)
    }
  })

  await offPage.setViewportSize({ width: 1500, height: 950 })
  await offPage.goto(FILE_URL, { waitUntil: 'load' })
  await offPage
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await offPage
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'bilingual-matrix.aml',
      mimeType: 'application/xml',
      buffer: Buffer.from(BILINGUAL_MATRIX_AML, 'utf8')
    })
  // A single-model source renders no model picker (Wave 2: `ArisExplorerPane`
  // shows it only for >1 models), so wait on the imported source's studio tab.
  await expect(offPage.getByRole('tab', { name: 'bilingual-matrix.aml' })).toBeVisible({
    timeout: 30_000
  })
  await offPage
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
  await configureOpenRouterKey(offPage, 'auto-translate-key')

  await fillDescriptionRequest(offPage, 'No auto-translate', 'Another permit review.')
  await submitGeneration(offPage)
  const offCreatedStatus = offPage
    .locator('[data-orbitpm-aris-create] [role="status"]')
    .filter({ hasText: /^Created/u })
    .last()
  await expect(offCreatedStatus).toContainText(/^Created/u, {
    timeout: 30_000
  })
  const offSourceTab = offPage.getByRole('tab', { name: 'bilingual-matrix.aml', exact: true })
  const offGeneratedTab = offPage.getByRole('tab', { name: 'No auto-translate', exact: true })
  await offSourceTab.click()
  const offCompletedPanel = await openGenerationPanel(offPage)
  await expect(offCompletedPanel.getByRole('status').filter({ hasText: /^Created/u })).toBeVisible()
  await offGeneratedTab.click()
  await offPage.waitForTimeout(1500)

  // Zero outbound translation requests; the missing-translation badge is the
  // entry point instead.
  expect(offTranslateFetches.length).toBe(0)
  await expect(
    offPage.locator('[role="tabpanel"]:not([hidden]) [data-orbitpm-aris-translate-missing]')
  ).toBeVisible()
})

test('TR-auto-animalwf: the real AnimalWF import auto-translates Arabic canvas text', async ({
  page
}) => {
  test.setTimeout(300_000)
  await stubFreeTranslate(page, {
    en: 'Automatically translated AnimalWF label',
    ar: 'تسمية سير عمل الحيوان مترجمة تلقائيا'
  })
  await openReferenceExport(page)

  await expect(page.locator('[data-orbitpm-aris-auto-translate="done"]')).toBeVisible({
    timeout: 240_000
  })
  await page.locator('[data-orbitpm-aris-content-lang]').click()
  const texts = await page.locator('[data-orbitpm-aris-canvas] svg text').allTextContents()
  expect(texts.filter((text) => /\p{Script=Arabic}/u.test(text)).length).toBeGreaterThan(20)
})

/**
 * A well-formed EPC (legal `CT_ACTIV_1`/`CT_CRT_1` control flow) plus one object
 * definition — `ObjDef.Orphan` — that is defined but never drawn, so the fix
 * scanner reports it as an `unusedDefinition` gap. Per the deterministic fix
 * tiering (`src/aris/chat/deterministicFixes.ts`, Tier B) an unused OBJECT
 * definition yields exactly one confirm-gated delete proposal
 * (`fix-delete-definition::ObjDef.Orphan`) — the structural delete this flow
 * exercises. The reference export is now structurally clean (no confirm-tier
 * proposals), so this purpose-built source provides the one the test needs.
 */
const FIX_FLOW_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Fix flow fixture" CreateDate="2026-07-29" CreateTime="09:00:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.Fix" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Fix flow</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="40" Pos.Y="200"/><Size Size.dX="60" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.S2C" CxnDef.IdRef="CxnDef.S2C" ToObjOcc.IdRef="ObjOcc.Check" SrcArrow="0" TgtArrow="1"><Position Pos.X="100" Pos.Y="230"/><Position Pos.X="220" Pos.Y="230"/></CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="220" Pos.Y="190"/><Size Size.dX="130" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.C2D" CxnDef.IdRef="CxnDef.C2D" ToObjOcc.IdRef="ObjOcc.Done" SrcArrow="0" TgtArrow="1"><Position Pos.X="350" Pos.Y="230"/><Position Pos.X="470" Pos.Y="230"/></CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="3"><Position Pos.X="470" Pos.Y="200"/><Size Size.dX="60" Size.dY="60"/></ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV"><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Request received</AttrValue></AttrDef><CxnDef CxnDef.ID="CxnDef.S2C" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/></ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC"><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Review request</AttrValue></AttrDef><CxnDef CxnDef.ID="CxnDef.C2D" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/></ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV"><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Process complete</AttrValue></AttrDef></ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Orphan" TypeNum="OT_ENT_TYPE" SymbolNum="ST_ENT_TYPE"><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Orphan entity</AttrValue></AttrDef></ObjDef>
  </Group>
</AML>`

test('TR-fix-flow: a confirmed delete proposal drops the issue count and undo restores it', async ({
  page
}) => {
  test.setTimeout(120_000)
  await openArisSource(page, FIX_FLOW_AML, 'fix-flow.aml', 1, false)

  const badge = page.locator('[data-orbitpm-aris-fix-issues]')
  await expect(badge).toBeVisible({ timeout: 60_000 })
  const countBefore = Number(await badge.getAttribute('data-orbitpm-aris-fix-issues'))
  expect(countBefore).toBeGreaterThan(0)

  await badge.click()
  const dialog = page.locator('[data-orbitpm-aris-fix-dialog]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-orbitpm-aris-fix-confirm-count]')).toBeVisible()
  await expect(dialog.locator('[data-orbitpm-aris-fix-auto-count]')).toBeVisible()
  await expect(dialog.locator('[data-orbitpm-aris-fix-interview-count]')).toBeVisible()

  // Deselect all proposals, then select exactly one unused-definition delete
  // proposal and apply it. Removing an unreferenced definition drops the gap
  // count without creating a new gap.
  const confirmCheckboxes = dialog.locator('[data-orbitpm-aris-fix-confirm]')
  for (const checkbox of await confirmCheckboxes.all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck()
  }
  // Select the first structural-delete proposal (occurrence, connection or
  // definition). The command id prefix is `fix-delete-*` for every tier-B removal.
  const deleteCheckbox = dialog.locator('[data-orbitpm-aris-fix-confirm*="fix-delete"]').first()
  await expect(deleteCheckbox).toBeVisible()
  await deleteCheckbox.check()
  const applyButton = dialog.locator('[data-orbitpm-aris-fix-apply]')
  await expect(applyButton).toBeEnabled()
  await applyButton.click()

  // The gesture applied successfully and the dialog stays open.
  await expect(
    page.getByRole('status').filter({ hasText: /Applied .* fixes as one undoable step/u })
  ).toBeVisible({ timeout: 30_000 })

  // The badge count (behind the modal) strictly dropped. It may not be exactly
  // countBefore - 1 because the deterministic plan can recombine related
  // findings, so we only assert a strict decrease and that undo restores it.
  await expect
    .poll(async () => Number(await badge.getAttribute('data-orbitpm-aris-fix-issues')), {
      timeout: 30_000
    })
    .toBeLessThan(countBefore)

  // Close the dialog, undo the gesture, and verify the count returns.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect
    .poll(async () => Number(await badge.getAttribute('data-orbitpm-aris-fix-issues')), {
      timeout: 30_000
    })
    .toBe(countBefore)
})
