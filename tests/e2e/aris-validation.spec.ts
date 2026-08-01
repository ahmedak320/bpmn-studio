import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

/**
 * Issue 5 (validation rail) + issue 6 (per-element canvas warning markers), in a
 * real browser against the built artifact.
 *
 * The right rail no longer carries the Accounting/Source sections; it shows
 * Details + a single validation section (`data-orbitpm-aris-validation`) that
 * lists the EPC findings AND the missing-info gap rows. Every row, and every
 * canvas warning marker, runs the SAME reveal-and-highlight gesture: it selects
 * the offending element, scrolls it into view, opens the details rail on the
 * field that fixes the finding, and flashes that field. When the field is a
 * not-yet-recorded attribute, the details rail renders a pending-attribute row
 * so the value can actually be typed.
 *
 * What this file proves that no unit test can:
 *
 *  - a rail validation row and a canvas marker both reveal the element, select
 *    it (highlight marker on the gfx) and open the details rail on the flashed
 *    field, in the built single file;
 *  - a marker's native `title` carries the localized, plain-language explanation
 *    (the hover tooltip the browser renders);
 *  - fixing a missing attribute through the rail's pending row is one undoable
 *    command that removes the finding from BOTH the rail and the marker count;
 *  - the whole validation flow is fully local — not a single network request.
 *
 * Harness convention matches the surviving ARIS specs: the BUILT single file
 * over file://, forced fallback storage, a buffer import of an inline AML
 * fixture, real user gestures, no source-level mocking.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

/**
 * A small, schema-faithful EPC fixture whose shape (Header-Info / Group / Model
 * / ObjOcc / ObjDef with direct `<AttrValue LocaleId="…">` text and numeric-LCID
 * locale ids) is copied from the proven-parseable `BILINGUAL_MATRIX_AML` in
 * `tests/e2e/lite-mandatory-translation.spec.ts` and `src/aris/model/testFixture.ts`.
 *
 * The control flow uses the convention-legal EPC connection types — an event
 * ACTIVATES a function (`CT_ACTIV_1`) and a function CREATES an event
 * (`CT_CRT_1`); `CT_IS_PREDEC_OF_1` is function→function only — so the sequence
 * is well-formed and raises no illegal-connection or disconnected-flow finding.
 *
 * Every name is English-only, so `missingArabicName` fires on the model and all
 * three definitions. The single bare function `ObjOcc.Check` therefore carries
 * exactly four findings: the convention `missingIdentifier` and `noExecutor`
 * findings (no `AT_ID`, no responsible-role connection — both warnings emitted
 * ahead of the gaps, so `missingIdentifier` is the marker's first-finding
 * tooltip), plus the `missingArabicName` and `missingInputsOutputsSystems` gaps.
 * The gated `missingProcessCode`/`missingOwner` attribute gaps do NOT fire (no
 * function in the document uses those attributes — see `gapScanner`'s
 * deployment-vocabulary gate). There IS a start event (`ObjOcc.Start`) and an
 * end event (`ObjOcc.Done`), so no EPC start/end error is raised. Verified
 * against the real findings pipeline in the built artifact.
 */
const VALIDATION_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Validation fixture" CreateDate="2026-07-29" CreateTime="09:00:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.Val" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review process</AttrValue>
      </AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="40" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.S2C" CxnDef.IdRef="CxnDef.S2C" ToObjOcc.IdRef="ObjOcc.Check" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="100" Pos.Y="230"/>
          <Position Pos.X="220" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="220" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.C2D" CxnDef.IdRef="CxnDef.C2D" ToObjOcc.IdRef="ObjOcc.Done" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="350" Pos.Y="230"/>
          <Position Pos.X="470" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="3">
        <Position Pos.X="470" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Request received</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.S2C" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.C2D" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Process complete</AttrValue>
      </AttrDef>
    </ObjDef>
  </Group>
</AML>
`

/**
 * A second, slightly larger EPC whose deployment DOES use the optional function
 * vocabulary, so the gated `missingProcessCode`/`missingOwner` checks go live
 * (`src/aris/chat/gapScanner.ts`'s `isFuncAttributeVocabularyInUse`). It has two
 * functions in a legal event/function alternation:
 *
 *   • `ObjOcc.Prov` (`ObjDef.Prov`) records both `AT_PROC_CODE` and
 *     `AT_PERS_RESP` — that is what flips the deployment-vocabulary gate on, and
 *     it therefore raises NEITHER attribute gap itself.
 *   • `ObjOcc.Check` (`ObjDef.Check`) records neither, so with the gate live it
 *     raises BOTH `missingProcessCode` and `missingOwner`.
 *
 * That restores e2e coverage of the attribute-pending-row fix path
 * (`data-orbitpm-aris-pending-attribute` / `-attribute-input`), which the
 * minimal `VALIDATION_AML` no longer exercises now that the checks are gated.
 * Every name is English-only and no function carries `AT_ID` or an executor, so
 * `missingArabicName`/`missingIdentifier`/`noExecutor`/`missingInputsOutputsSystems`
 * also stack — the marker count is read live rather than hand-counted, and only
 * the exact +/-1 effect of the single attribute fix is asserted.
 */
const ATTRIBUTE_FIX_AML = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Attribute fixture" CreateDate="2026-07-29" CreateTime="09:00:00" UserName="tester" ArisExeVersion="0.1.0"/>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.Attr" Model.Type="MT_EEPC" GridSize="10" Scale="100" PrintScale="100" BackColor="16777215">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Provisioning process</AttrValue>
      </AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" Zorder="1">
        <Position Pos.X="40" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.S2C" CxnDef.IdRef="CxnDef.S2C" ToObjOcc.IdRef="ObjOcc.Check" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="100" Pos.Y="230"/>
          <Position Pos.X="220" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Check" ObjDef.IdRef="ObjDef.Check" SymbolNum="ST_FUNC" Zorder="2">
        <Position Pos.X="220" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.C2M" CxnDef.IdRef="CxnDef.C2M" ToObjOcc.IdRef="ObjOcc.Mid" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="350" Pos.Y="230"/>
          <Position Pos.X="470" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Mid" ObjDef.IdRef="ObjDef.Mid" SymbolNum="ST_EV" Zorder="3">
        <Position Pos.X="470" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
        <CxnOcc CxnOcc.ID="CxnOcc.M2P" CxnDef.IdRef="CxnDef.M2P" ToObjOcc.IdRef="ObjOcc.Prov" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="530" Pos.Y="230"/>
          <Position Pos.X="650" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Prov" ObjDef.IdRef="ObjDef.Prov" SymbolNum="ST_FUNC" Zorder="4">
        <Position Pos.X="650" Pos.Y="190"/>
        <Size Size.dX="130" Size.dY="80"/>
        <CxnOcc CxnOcc.ID="CxnOcc.P2D" CxnDef.IdRef="CxnDef.P2D" ToObjOcc.IdRef="ObjOcc.Done" SrcArrow="0" TgtArrow="1">
          <Position Pos.X="780" Pos.Y="230"/>
          <Position Pos.X="900" Pos.Y="230"/>
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.Done" ObjDef.IdRef="ObjDef.Done" SymbolNum="ST_EV" Zorder="5">
        <Position Pos.X="900" Pos.Y="200"/>
        <Size Size.dX="60" Size.dY="60"/>
      </ObjOcc>
    </Model>
    <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Request received</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.S2C" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Check"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.C2M" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Mid"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Mid" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Request reviewed</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.M2P" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.Prov"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Prov" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Provision access</AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_PROC_CODE">
        <AttrValue LocaleId="1033">PC-100</AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_PERS_RESP">
        <AttrValue LocaleId="1033">Access management team</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.P2D" CxnDef.Type="CT_CRT_1" ToObjDef.IdRef="ObjDef.Done"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Done" TypeNum="OT_EVT" SymbolNum="ST_EV">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Process complete</AttrValue>
      </AttrDef>
    </ObjDef>
  </Group>
</AML>
`

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
  await disableAutoTranslate(page)
}

/** Boots the built shell in English/LTR fallback mode and imports the fixture as a buffer. */
async function openValidationSource(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 })
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'validation.aml',
      mimeType: 'application/xml',
      buffer: Buffer.from(VALIDATION_AML, 'utf8')
    })
  // A single-model source renders no model picker: `ArisExplorerPane` shows the
  // model-explorer list only for sources with more than one model (Wave 2), so
  // the lone model opens directly as its own studio tab. Wait on that tab and
  // its drawn canvas rather than on a model-explorer button that never renders.
  await expect(page.getByRole('tab', { name: 'validation.aml' })).toBeVisible({ timeout: 30_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
  // Fit the (tiny) model so every shape and its warning marker sits in view.
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  // The rail boots on the docked Tools tab (issue #2); Details only auto-opens
  // on a selection or a finding reveal. Open the Details tab the way a user
  // reviewing findings does, so the validation section is on screen.
  await page.locator('[data-orbitpm-aris-rail-tab="details"]').click()
}

const validationRail = '[data-orbitpm-aris-validation]'

/** Check's row for one finding kind (the finding targets the definition, but the
 *  rail row selects the occurrence). */
function checkRow(page: Page, kind: string): Locator {
  return page
    .locator(validationRail)
    .locator(
      `[data-orbitpm-aris-validation-issue="${kind}"][aria-label="Select ObjOcc.Check on the canvas"]`
    )
}

/**
 * The reveal-and-highlight outcome for a finding whose fix is not a rail field
 * (the convention `missingIdentifier`/`noExecutor` findings resolve by adding an
 * identifier attribute or an executor connection, so the rail highlights by
 * selection alone): clicking it selects ObjOcc.Check and paints its highlight
 * marker, without flashing a specific field.
 */
async function expectCheckSelected(page: Page): Promise<void> {
  await expect(page.locator('[data-orbitpm-aris-details]')).toHaveAttribute(
    'data-orbitpm-aris-details-occurrence',
    'ObjOcc.Check'
  )
  await expect(
    page.locator('[data-orbitpm-aris-canvas] g.djs-element[data-element-id="ObjOcc.Check"]')
  ).toHaveClass(/aris-highlight-owner/)
}

/** Asserts the shared reveal-and-highlight outcome for the `missingArabicName` finding. */
async function expectCheckNameHighlight(page: Page): Promise<void> {
  const details = page.locator('[data-orbitpm-aris-details]')
  await expect(details).toHaveAttribute('data-orbitpm-aris-details-occurrence', 'ObjOcc.Check')
  // The reveal is a real selection: the canvas paints its highlight marker.
  await expect(
    page.locator('[data-orbitpm-aris-canvas] g.djs-element[data-element-id="ObjOcc.Check"]')
  ).toHaveClass(/aris-highlight-owner/)
  await expect(page.locator('[data-orbitpm-aris-details-tab="names"]')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.locator('[data-orbitpm-aris-details-panel="names"]')).toHaveAttribute(
    'data-orbitpm-aris-highlight-field',
    'name:ar'
  )
  await expect(page.locator('[data-orbitpm-aris-name-input="definition:ar"]')).toBeVisible()
}

test('a validation rail row reveals its element and opens the details rail on the missing field', async ({
  page
}) => {
  await openValidationSource(page)

  const rail = page.locator(validationRail)
  await expect(rail).toBeVisible()

  await rail
    .locator(
      '[data-orbitpm-aris-validation-issue="missingArabicName"][aria-label="Select ObjOcc.Check on the canvas"]'
    )
    .click()

  await expectCheckNameHighlight(page)
})

test('a canvas warning marker shows a localized plain-language tooltip on hover', async ({
  page
}) => {
  await openValidationSource(page)

  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await expect(marker).toBeVisible()
  // The count badge reflects the several findings stacked on this one function.
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', /[1-9]/)

  await marker.hover()
  // The native `title` IS the hover tooltip — browsers do not expose the rendered
  // bubble, so asserting the attribute after a real hover is the assertable
  // contract. Its text is the localized first (most severe) finding message: for
  // this bare function the convention missing-identifier finding
  // (`aris.conv.finding.missingIdentifier.body`).
  await expect(marker).toHaveAttribute('title', /This function has no identifier\./)
})

test('a canvas warning marker runs the same reveal-and-highlight, and the missing-name row fixes it in one undoable step', async ({
  page
}) => {
  await openValidationSource(page)

  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await expect(marker).toBeVisible()
  // Four findings stack on this bare function: the convention missing-identifier
  // and no-executor findings, plus the missing Arabic name and the missing
  // inputs/outputs/systems gaps.
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '4')

  // Clicking the marker runs the reveal-and-highlight for its first (most severe)
  // finding — the convention missing-identifier finding, whose fix is not a
  // single rail field — so it selects and highlights the element by itself.
  await marker.click()
  await expectCheckSelected(page)

  // The missing Arabic name row opens the Names tab on the `ar` field and flashes
  // it; committing a value is one undoable command that drops the finding from
  // the rail AND the marker's count.
  await checkRow(page, 'missingArabicName').click()
  await expectCheckNameHighlight(page)
  const arabic = page.locator('[data-orbitpm-aris-name-input="definition:ar"]')
  await arabic.click()
  await arabic.fill('مراجعة الطلب')
  await arabic.press('Enter')

  await expect(checkRow(page, 'missingArabicName')).toHaveCount(0)
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '3')
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()

  // One Undo restores the finding and the marker count.
  await undo.click()
  await expect(checkRow(page, 'missingArabicName')).toHaveCount(1)
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '4')
})

test('the whole validation flow runs without a single network request', async ({ page }) => {
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

  await openValidationSource(page)

  // Drive the marker hover + click, a rail row, and a field fix — every
  // validation affordance is fully local. The marker is exercised FIRST, while
  // nothing is selected: selecting an element opens diagram-js's context pad,
  // which floats over the element's top-right corner and would intercept pointer
  // events aimed at the marker there.
  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await marker.hover()
  await marker.click()
  await expectCheckSelected(page)

  await checkRow(page, 'missingArabicName').click()
  await expectCheckNameHighlight(page)
  const arabic = page.locator('[data-orbitpm-aris-name-input="definition:ar"]')
  await arabic.click()
  await arabic.fill('مراجعة الطلب')
  await arabic.press('Enter')
  await expect(checkRow(page, 'missingArabicName')).toHaveCount(0)

  expect(offending).toEqual([])
})

/** Boots the built shell and imports the deployment-vocabulary fixture. */
async function openAttributeFixSource(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 })
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'attribute-fix.aml',
      mimeType: 'application/xml',
      buffer: Buffer.from(ATTRIBUTE_FIX_AML, 'utf8')
    })
  await expect(page.getByRole('tab', { name: 'attribute-fix.aml' })).toBeVisible({
    timeout: 30_000
  })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  // The rail boots on the docked Tools tab (issue #2); Details only auto-opens
  // on a selection or a finding reveal. Open the Details tab the way a user
  // reviewing findings does, so the validation section is on screen.
  await page.locator('[data-orbitpm-aris-rail-tab="details"]').click()
}

test('a missing-attribute validation row fixes through the details pending-attribute editor in one undoable step', async ({
  page
}) => {
  await openAttributeFixSource(page)

  const rail = page.locator(validationRail)
  await expect(rail).toBeVisible()

  // The deployment vocabulary is live (ObjDef.Prov records AT_PROC_CODE), so the
  // bare ObjDef.Check function raises the gated `missingProcessCode` gap — its
  // rail row selects the occurrence ObjOcc.Check.
  await expect(checkRow(page, 'missingProcessCode')).toHaveCount(1)

  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await expect(marker).toBeVisible()
  const markerCount = async (): Promise<number> =>
    Number(await marker.getAttribute('data-orbitpm-aris-warning-count'))
  const countBefore = await markerCount()
  expect(countBefore).toBeGreaterThanOrEqual(1)

  // Clicking the row reveals the element and opens the Attributes tab. AT_PROC_CODE
  // is not recorded on ObjDef.Check, so the rail renders the pending-attribute
  // editor (`data-orbitpm-aris-pending-attribute`) rather than an existing field.
  await checkRow(page, 'missingProcessCode').click()
  await expect(page.locator('[data-orbitpm-aris-details]')).toHaveAttribute(
    'data-orbitpm-aris-details-occurrence',
    'ObjOcc.Check'
  )
  await expect(
    page.locator('[data-orbitpm-aris-canvas] g.djs-element[data-element-id="ObjOcc.Check"]')
  ).toHaveClass(/aris-highlight-owner/)
  await expect(page.locator('[data-orbitpm-aris-details-tab="attributes"]')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const pending = page.locator('[data-orbitpm-aris-pending-attribute="AT_PROC_CODE"]')
  await expect(pending).toBeVisible()

  // Typing a value into the pending row's English input and committing is one
  // undoable command that records the attribute and clears the finding from both
  // the rail row and the marker's stacked count.
  const input = pending.locator('[data-orbitpm-aris-attribute-input="AT_PROC_CODE:en"]')
  await input.click()
  await input.fill('PC-200')
  await input.press('Enter')

  await expect(checkRow(page, 'missingProcessCode')).toHaveCount(0)
  await expect.poll(markerCount).toBe(countBefore - 1)

  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(checkRow(page, 'missingProcessCode')).toHaveCount(1)
  await expect.poll(markerCount).toBe(countBefore)
})
