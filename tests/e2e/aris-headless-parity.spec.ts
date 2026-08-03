import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { disableAutoTranslate } from './helpers/prefs'

// Lane L-PARITY (Wave 21) — browser-vs-headless parity (deliverable 3).
//
// One canonical process, two renderers, one geometry. The headless library
// path (`renderCanonicalProcess`, exercised through
// `helpers/arisHeadlessRender.ts` under vite-node) and the studio browser app
// share the SAME engine: same projection, same AML, same `cleanLayout`. This
// suite proves they land on the SAME diagram — every anchored EPC node sits at
// the same model-space position in the browser as in the headless SVG.
//
// The two sides are wired together by the helper's own artifacts: it writes
// `parity.aml.xml` (the `debugAml` from its render — the AML BEFORE clean
// layout) and this spec imports that exact AML into the browser, then runs
// Clean Layout via the toolbar. Because both sides start from one identical
// model and apply the one deterministic `cleanLayout` (studio
// `handleCleanLayout` and headless `applyCleanLayout` both call
// `cleanLayout(graph)`), the object-occurrence positions must agree.
//
// Why a spawned vite-node helper and not a direct import: the render entry
// pulls in `canvas/renderer`, whose extensionless `diagram-js` ESM imports only
// Vite's resolver understands — Playwright's own loader cannot import them (see
// `helpers/arisRoundtripCompare.ts:1-30` for the same constraint). So this spec
// imports NO engine module; it spawns the helper and reads one JSON line +
// two files.
//
// Coordinate space (one, consistent): both sides read the shape group's OWN
// transform translate — model coordinates, because the diagram-js viewport
// group (which carries the zoom matrix) is a separate ancestor and the headless
// capture leaves it identity. Width/height come from each shape's diagram-js
// hit rect (`rect.djs-hit`), whose attributes are local model geometry and do
// not scale with zoom. No screen-space measurement, no viewport-matrix
// conversion. Tolerance ±2 model units absorbs any float rounding; the same
// deterministic layout on the same model makes the expected delta 0.
//
// Boots the built single file over file:// (the shipped artifact, retries 0),
// in fallback storage mode, exactly like aris-validation.spec.ts.

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const FIXTURE = resolve(HERE, 'fixtures/epc-parity-canonical.json')
const HELPER = resolve(HERE, 'helpers/arisHeadlessRender.ts')

/** ±2 model units — same-layout expected delta is 0; this only absorbs rounding. */
const POSITION_TOLERANCE = 2

interface AnchorBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface HeadlessPayload {
  readonly anchors: Record<string, AnchorBox>
  readonly svgSha256: string
  readonly metadata: {
    readonly engineVersion: string
    readonly schemaVersion: number
    readonly projectionVersion: number
    readonly inputSha256: string
    readonly modelId: string
  }
}

test.beforeAll(() => {
  expect(
    readFileSync(DIST, 'utf8').length,
    'dist/index.html should be a built single file'
  ).toBeGreaterThan(500_000)
})

/**
 * Run the headless render helper under vite-node into `outDir`, returning its
 * one-line JSON verdict. It cannot run inside this spec's own process (the
 * render entry's `diagram-js` ESM imports need Vite's resolver — see the file
 * header), so it goes through the repo's own vite-node toolchain, exactly like
 * `aris-sequence-1.spec.ts` runs `arisRoundtripCompare.ts`.
 */
function runHeadlessRender(outDir: string): HeadlessPayload {
  const stdout = execFileSync('npx', ['vite-node', HELPER, FIXTURE, outDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const jsonLine = stdout.trim().split('\n').at(-1) ?? ''
  return JSON.parse(jsonLine) as HeadlessPayload
}

/** Boot the built shell over file:// in fallback mode and import the given AML buffer. */
async function bootAndImport(page: Page, amlPath: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => {
    localStorage.clear()
    // Force the picker/OPFS fallback so file:// boots straight into an in-memory
    // single-file workspace (the aris-validation.spec.ts harness).
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await disableAutoTranslate(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })

  // The lone EPC model opens directly as its own studio tab (no model picker for
  // a single-model source), so wait on the drawn canvas, not a picker button.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'parity.aml',
      mimeType: 'application/xml',
      buffer: readFileSync(amlPath)
    })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
}

/**
 * Read every object-occurrence's model-space geometry from the MAIN diagram svg
 * (`.djs-container > svg`), which excludes the diagram-js minimap's copies (the
 * minimap lives in a sibling `.djs-minimap`, not a direct `> svg` child). The
 * group's own consolidated transform gives model coordinates; the hit rect
 * gives model width/height.
 */
async function readBrowserAnchors(page: Page): Promise<Record<string, AnchorBox>> {
  return page.evaluate(() => {
    const result: Record<string, { x: number; y: number; width: number; height: number }> = {}
    const groups = document.querySelectorAll(
      '[data-orbitpm-aris-canvas] .djs-container > svg g.djs-element[data-element-id^="ObjOcc."]'
    )
    groups.forEach((group) => {
      const id = group.getAttribute('data-element-id')
      if (!id) return
      const consolidated = (group as SVGGElement).transform.baseVal.consolidate()
      const matrix = consolidated ? consolidated.matrix : null
      const hit = group.querySelector('rect.djs-hit')
      result[id] = {
        x: matrix ? matrix.e : 0,
        y: matrix ? matrix.f : 0,
        width: hit ? Number(hit.getAttribute('width')) : Number.NaN,
        height: hit ? Number(hit.getAttribute('height')) : Number.NaN
      }
    })
    return result
  })
}

test('browser-vs-headless parity: identical canonical input, identical clean-layout geometry', async ({
  page
}, testInfo: TestInfo) => {
  test.setTimeout(180_000)

  // 1. Headless render into this test's output dir → JSON verdict + parity.aml.xml.
  const outDir = testInfo.outputPath()
  mkdirSync(outDir, { recursive: true })
  const headless = runHeadlessRender(outDir)

  const anchorIds = Object.keys(headless.anchors)
  expect(anchorIds.length, 'the headless render produced no anchors').toBeGreaterThan(0)

  // The headless metadata fields are present and well-formed.
  expect(headless.metadata.engineVersion).toMatch(/^\d+\.\d+\.\d+$/u)
  expect(headless.metadata.schemaVersion).toBe(1)
  expect(headless.metadata.projectionVersion).toBe(1)
  expect(headless.metadata.inputSha256).toMatch(/^[0-9a-f]{64}$/u)
  expect(headless.metadata.modelId).toMatch(/^Model\./u)
  expect(headless.svgSha256).toMatch(/^[0-9a-f]{64}$/u)

  // 2. Boot the built app over file://, import the SAME AML the helper emitted.
  await bootAndImport(page, resolve(outDir, 'parity.aml.xml'))

  // 3. Run Clean Layout via the toolbar — the same deterministic `cleanLayout`
  //    the headless side applied. The toolbar's layout-mode flips to "clean"
  //    only after the layout is applied, so it is a settled-state signal.
  await page.locator('[data-orbitpm-aris-clean-layout]').click()
  await expect(page.locator('[data-orbitpm-aris-layout-mode="clean"]')).toBeVisible({
    timeout: 30_000
  })

  // 4. Read the browser's model-space geometry for every object occurrence.
  const browser = await readBrowserAnchors(page)
  const browserIds = Object.keys(browser)

  // 5a. Two-way anchor-set equality (counts BOTH directions + exact membership):
  //     every headless anchor exists on the canvas, and every canvas occurrence
  //     is a headless anchor. Same AML ⇒ same object-occurrence id set.
  expect(browserIds.length, 'occurrence count differs between browser and headless').toBe(
    anchorIds.length
  )
  expect([...browserIds].sort()).toEqual([...anchorIds].sort())

  // 5b. Every anchored node matches position AND model-space size within ±2.
  const drift: string[] = []
  for (const id of anchorIds) {
    const h = headless.anchors[id]
    const b = browser[id]
    if (!b) {
      drift.push(`${id}: missing on canvas`)
      continue
    }
    const dx = Math.abs(b.x - h.x)
    const dy = Math.abs(b.y - h.y)
    const dw = Math.abs(b.width - h.width)
    const dh = Math.abs(b.height - h.height)
    if (
      dx > POSITION_TOLERANCE ||
      dy > POSITION_TOLERANCE ||
      dw > POSITION_TOLERANCE ||
      dh > POSITION_TOLERANCE
    ) {
      drift.push(
        `${id}: headless (${h.x},${h.y},${h.width}×${h.height}) vs ` +
          `browser (${b.x},${b.y},${b.width}×${b.height}) — ` +
          `Δx=${dx.toFixed(2)} Δy=${dy.toFixed(2)} Δw=${dw.toFixed(2)} Δh=${dh.toFixed(2)}`
      )
    }
  }
  expect(
    drift,
    `anchored geometry drifted beyond ±${POSITION_TOLERANCE}:\n${drift.join('\n')}`
  ).toEqual([])
})
