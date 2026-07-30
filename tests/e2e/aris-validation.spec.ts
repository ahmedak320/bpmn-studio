import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
 * Every name is English-only, so `missingArabicName` fires on the model and all
 * three definitions; the single function `ObjDef.Check` also fires
 * `missingProcessCode` and `missingOwner` (both are absent attributes). There IS
 * a start event (`ObjOcc.Start`) and an end event (`ObjOcc.Done`), so no EPC
 * start/end error is raised. `missingArabicName` is an error, so it sorts to the
 * front of `ObjOcc.Check`'s findings — making it the marker's first-finding
 * tooltip (verified against the real findings pipeline while authoring this).
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
      <CxnDef CxnDef.ID="CxnDef.S2C" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Check"/>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Check" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">Review request</AttrValue>
      </AttrDef>
      <CxnDef CxnDef.ID="CxnDef.C2D" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Done"/>
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
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(1, { timeout: 30_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
  // Fit the (tiny) model so every shape and its warning marker sits in view.
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
}

const validationRail = '[data-orbitpm-aris-validation]'

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
  // contract. Its text is the localized first (most severe) finding message.
  await expect(marker).toHaveAttribute('title', /No Arabic name is recorded\./)
})

test('a canvas warning marker runs the same reveal-and-highlight, and the missing-attribute row fixes it in one undoable step', async ({
  page
}) => {
  await openValidationSource(page)

  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await expect(marker).toBeVisible()
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '5')

  // Clicking the marker runs the SAME gesture as the rail row (its first finding
  // is the missing Arabic name).
  await marker.click()
  await expectCheckNameHighlight(page)

  const rail = page.locator(validationRail)

  // The missing-attribute flow: the owner row opens the attributes tab with a
  // pending row for the not-yet-recorded AT_PERS_RESP attribute.
  await rail.locator('[data-orbitpm-aris-validation-issue="missingOwner"]').first().click()
  await expect(page.locator('[data-orbitpm-aris-details-tab="attributes"]')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const pending = page.locator('[data-orbitpm-aris-pending-attribute="AT_PERS_RESP"]')
  await expect(pending).toBeVisible()

  // Typing a value and committing it creates the attribute — one undoable command
  // that drops the finding from the rail AND the marker's count.
  const ownerInput = page.locator('[data-orbitpm-aris-attribute-input="AT_PERS_RESP:en"]')
  await ownerInput.click()
  await ownerInput.fill('Intake team')
  await ownerInput.press('Enter')

  await expect(rail.locator('[data-orbitpm-aris-validation-issue="missingOwner"]')).toHaveCount(0)
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '4')
  const undo = page.locator('[data-orbitpm-aris-undo]')
  await expect(undo).toBeEnabled()

  // One Undo restores the finding and the marker count.
  await undo.click()
  await expect(rail.locator('[data-orbitpm-aris-validation-issue="missingOwner"]')).toHaveCount(1)
  await expect(marker).toHaveAttribute('data-orbitpm-aris-warning-count', '5')
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

  // Drive the marker hover + click, a rail row, and the attribute fix — every
  // validation affordance is fully local. The marker is exercised FIRST, while
  // nothing is selected: selecting an element opens diagram-js's context pad,
  // which floats over the element's top-right corner and would intercept pointer
  // events aimed at the marker there.
  const marker = page.locator('[data-orbitpm-aris-warning="ObjOcc.Check"]')
  await marker.hover()
  await marker.click()
  await expectCheckNameHighlight(page)

  const rail = page.locator(validationRail)
  await rail.locator('[data-orbitpm-aris-validation-issue="missingOwner"]').first().click()
  const ownerInput = page.locator('[data-orbitpm-aris-attribute-input="AT_PERS_RESP:en"]')
  await ownerInput.click()
  await ownerInput.fill('Intake team')
  await ownerInput.press('Enter')
  await expect(rail.locator('[data-orbitpm-aris-validation-issue="missingOwner"]')).toHaveCount(0)

  expect(offending).toEqual([])
})
