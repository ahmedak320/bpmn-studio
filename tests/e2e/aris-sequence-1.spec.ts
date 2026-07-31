import { expect, test, webkit, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  inkStructureSimilarity,
  rasterizePdfToPng,
  readPng,
  type InkStructureReport
} from './helpers/arisPdfRaster'

// Wave 7 — Test Sequence 1: import the AnimalWF AML, export each iterate model
// to PDF through the new toolbar action, rasterize and compare against ARIS's
// own reference exports, then re-export the AML and prove the round-trip keeps
// the model structurally identical (the same 0-diff budget the
// `*.animalwf.test.ts` baselines enforce).
//
// The built single file is served over a loopback HTTP origin so the real OPFS
// path is exercised, exactly like `aris-fidelity-screenshots.spec.ts`.
//
// Reference rasters: the brief's comparison targets are
// `…/tmp/pdfimg/<Model>-1.png`, which are byte-identical to
// `pdftoppm -png -r 150` of the ARIS exports in `../reference/AnimalWF/pdf/`
// (verified: `cmp` reports no difference). This spec rasterizes those PDFs
// itself, so both sides of the diff pass through the SAME rasterizer at the
// SAME dpi and the fixture path follows the repo's private-fixture convention
// instead of a job-temporary directory.
//
// Similarity metric (see helpers/arisPdfRaster.ts for the full rationale): a
// pixel diff is meaningless across two different PDF pipelines — the ARIS page
// is A3 with the department's OLE logo decoded, ours is content-fitted with a
// framed logo placeholder and a different font rasterizer. What must match is
// the ink STRUCTURE (frame bands, lane columns, gates, connection web), so the
// comparison is per-cell ink coverage on a 32×32 grid over the ink bounding
// box. THRESHOLD justification: both pages carry the same diagram geometry
// (the Wave-6 GEOM baselines hold the model at 0 structural diffs) and the
// same print-frame layout, so the score must sit far above chance; the known
// legitimate deltas (logo image vs empty placeholder frame, legend symbol
// rendering, anti-aliasing) each move only a cell or two of coverage. 0.75
// sits far below the measured 0.95–0.97 agreement (chromium, both models) and
// far above the <0.6 a broken export produces (a missing lane or a collapsed
// diagram displaces whole cell columns/rows), so it fails on structural
// regressions and never on renderer noise. The measured scores are printed
// for every run.

test.describe.configure({ mode: 'serial' })

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const REFERENCE_AML = resolve(HERE, '../../../reference/AnimalWF/ARISAMLExport.xml')
const REFERENCE_PDF_DIR = resolve(HERE, '../../../reference/AnimalWF/pdf')
const SCRATCH = '/home/ahmed/.claude/jobs/501f0ce4/tmp/pdf/seq1'

const SIMILARITY_THRESHOLD = 0.75
/** A real export is mostly white page; below this the export is blank/broken. */
const MIN_INK_FRACTION = 0.005
/** Frame + diagram crops must agree on shape; 12% absorbs the A3-vs-fitted page delta. */
const MAX_ASPECT_DRIFT = 0.12

const ITERATE_MODELS = [
  {
    key: 'register-owner',
    modelId: 'Model.3xqe8yXO9Z7-u-L',
    occurrenceCount: 94,
    referencePdf: 'Register_Animal_Owner_Profile_Draft03.pdf'
  },
  {
    key: 'renew-profile',
    modelId: 'Model.-1rUudxIp-wP-u-L',
    occurrenceCount: 46,
    referencePdf: 'Renew_an_Animals_profile_Draft02.pdf'
  }
] as const

// Fail loudly at module load when the private fixture is absent — this suite
// never skips and never passes vacuously. It reads the fixture directly rather
// than probing with `existsSync` (matching every other AnimalWF-dependent e2e
// spec, e.g. aris-fidelity-screenshots.spec.ts): `statSync` throws ENOENT here
// the same way `readFileSync`/`setInputFiles` would later, only with a message
// that names the missing path.
try {
  statSync(REFERENCE_AML)
} catch (cause) {
  throw new Error(
    `AnimalWF fixture not found at ${REFERENCE_AML}. Sequence 1 only runs with the private ` +
      'reference export present locally; it never skips and never passes vacuously.',
    { cause }
  )
}

let loopbackServer: Server
let HTTP_URL = ''

test.beforeAll(() => {
  mkdirSync(SCRATCH, { recursive: true })
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
  loopbackServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html)
    })
    response.end(html)
  })
  return new Promise<void>((resolveListen, rejectListen) => {
    loopbackServer.once('error', rejectListen)
    loopbackServer.listen(0, '127.0.0.1', () => {
      loopbackServer.off('error', rejectListen)
      const address = loopbackServer.address() as AddressInfo
      HTTP_URL = `http://127.0.0.1:${address.port}/index.html`
      resolveListen()
    })
  })
})

test.afterAll(
  () =>
    new Promise<void>((resolveClose, rejectClose) => {
      loopbackServer.close((error) => (error ? rejectClose(error) : resolveClose()))
    })
)

async function gotoLanding(page: Page): Promise<void> {
  await page.goto(HTTP_URL, { waitUntil: 'load' })
  await expect(page.getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })).toBeVisible({
    timeout: 20_000
  })
}

/** Open the workspace, import the AnimalWF source and wait for the first canvas. */
async function importAnimalWf(page: Page): Promise<void> {
  await gotoLanding(page)
  await page.getByRole('button', { name: 'Open browser workspace' }).click({ timeout: 40_000 })
  await expect(page.getByRole('banner')).toContainText('Browser workspace', { timeout: 40_000 })
  await page.getByRole('button', { name: 'Open file…', exact: true }).click()
  await page.locator('input[type="file"]').first().setInputFiles(REFERENCE_AML)
  await expect(page.locator('[data-orbitpm-aris-model]')).toHaveCount(8, { timeout: 120_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
}

function assertSimilarity(report: InkStructureReport, key: string): void {
  // The measured score is printed on every run so threshold drift is visible
  // in CI logs (eslint allows only warn/error for console).
  console.warn(
    `[sequence-1] ${key}: score=${report.score.toFixed(4)} ` +
      `aspect ${report.aspectA.toFixed(3)} vs ${report.aspectB.toFixed(3)} ` +
      `ink ${(report.inkFractionA * 100).toFixed(2)}% vs ${(report.inkFractionB * 100).toFixed(2)}%`
  )
  expect(
    report.inkFractionA,
    `${key}: the exported PDF is blank (ink fraction ${report.inkFractionA})`
  ).toBeGreaterThan(MIN_INK_FRACTION)
  const aspectDrift = Math.abs(report.aspectA - report.aspectB) / report.aspectB
  expect(
    aspectDrift,
    `${key}: page content shape drifted ${(aspectDrift * 100).toFixed(1)}% from the reference`
  ).toBeLessThanOrEqual(MAX_ASPECT_DRIFT)
  expect(
    report.score,
    `${key}: ink-structure similarity ${report.score.toFixed(4)} is below ${SIMILARITY_THRESHOLD}`
  ).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD)
}

interface RoundTripModelVerdict {
  readonly key: string
  readonly byCategory: Record<string, number>
  readonly rows: readonly string[]
}

/**
 * Run the step-3 XML round-trip compare under `vite-node` and return the
 * per-model verdicts. It cannot run inside this spec's own process: the
 * mandated comparator (`src/aris/fidelity/compare.ts`) pulls in
 * `canvas/renderer`, whose extensionless `diagram-js` ESM imports only Vite's
 * resolver understands — Playwright's transform loads the spec with plain
 * Node resolution. `helpers/arisRoundtripCompare.ts` runs the same comparator
 * through the repo's own `vite-node` toolchain and prints one JSON verdict
 * line on its last stdout line.
 */
function runRoundTripCompare(exportedXmlPath: string): readonly RoundTripModelVerdict[] {
  const helper = resolve(HERE, 'helpers/arisRoundtripCompare.ts')
  const stdout = execFileSync('npx', ['vite-node', helper, exportedXmlPath], {
    cwd: resolve(HERE, '../..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const jsonLine = stdout.trim().split('\n').at(-1) ?? ''
  const verdict = JSON.parse(jsonLine) as { models: RoundTripModelVerdict[] }
  return verdict.models
}

test('Sequence 1: import XML → export PDF ≈ reference PDF; export XML = source model', async ({
  browserName,
  page
}) => {
  test.setTimeout(300_000)

  // The same WebKit OPFS accommodation the fidelity gate uses (see
  // aris-fidelity-screenshots.spec.ts for the full rationale).
  let webkitOpfsContext: BrowserContext | undefined
  let opfsPage = page
  if (browserName === 'webkit') {
    webkitOpfsContext = await webkit.launchPersistentContext('', {
      headless: true,
      locale: undefined,
      args: ['--features=StorageAPI,FileSystem,FileSystemWritableStream,AccessHandle']
    })
    opfsPage = webkitOpfsContext.pages()[0] ?? (await webkitOpfsContext.newPage())
    opfsPage.setDefaultTimeout(30_000)
    opfsPage.setDefaultNavigationTimeout(30_000)
  }

  try {
    await opfsPage.setViewportSize({ width: 1600, height: 1000 })
    await importAnimalWf(opfsPage)

    // --- Step 1+2: open each iterate model and export it to PDF ---------------
    for (const model of ITERATE_MODELS) {
      const modelButton = opfsPage.locator(`[data-orbitpm-aris-model="${model.modelId}"]`)
      await modelButton.click()
      await expect(modelButton).toHaveAttribute('aria-current', 'true')
      const occurrences = opfsPage.locator(
        `[data-orbitpm-aris-canvas] g[data-element-id="model:${model.modelId}"] g.djs-element[data-element-id^="ObjOcc."]`
      )
      await expect
        .poll(async () => occurrences.count(), { timeout: 120_000 })
        .toBe(model.occurrenceCount)

      const exportButton = opfsPage.locator('[data-orbitpm-aris-export-pdf]')
      await expect(exportButton).toBeEnabled()
      const [download] = await Promise.all([
        opfsPage.waitForEvent('download', { timeout: 120_000 }),
        exportButton.click()
      ])
      expect(download.suggestedFilename()).toMatch(/\.pdf$/u)
      const pdfPath = resolve(SCRATCH, `${model.key}-${browserName}.pdf`)
      await download.saveAs(pdfPath)
      expect(statSync(pdfPath).size, 'the exported PDF is empty').toBeGreaterThan(10_000)

      // Rasterize BOTH sides with the same engine at the same dpi and compare
      // ink structure (the reference path stands in for the brief's
      // byte-identical tmp/pdfimg PNG).
      const exportedPng = rasterizePdfToPng(
        pdfPath,
        resolve(SCRATCH, `${model.key}-${browserName}`)
      )
      const referencePng = rasterizePdfToPng(
        resolve(REFERENCE_PDF_DIR, model.referencePdf),
        resolve(SCRATCH, `reference-${model.key}`)
      )
      const report = inkStructureSimilarity(readPng(exportedPng), readPng(referencePng))
      assertSimilarity(report, model.key)
    }

    // --- Step 2b: the ARABIC content-language state exports too ---------------
    // Two facts about this fixture, both verified against ARISAMLExport.xml:
    // 30 of the 279 object definitions carry an Arabic-locale (14337) name,
    // and those values are Latin-script too ("TAMM", "Smart Hub") — but at
    // least one differs from its English twin ("Owner Registration" vs
    // "Animal profile renewal Service triggered" on a renew-profile object).
    // So the AR projection provably re-renders captions (the rendered text
    // changes) while the glyphs and geometry stay the same; a "captions
    // turned Arabic-script" gate would test a fact this fixture does not
    // have. The locale-resolution logic itself is unit-covered
    // (canvas/contentLanguage.test.ts). THIS leg therefore asserts, in order:
    // the toggle applies, the re-rendered caption text differs from EN, and
    // the PDF exported in that state is healthy and geometrically stable.
    const langToggle = opfsPage.locator('[data-orbitpm-aris-content-lang]')
    const canvasSvg = opfsPage.locator('[data-orbitpm-aris-canvas] .djs-container > svg').first()
    const canvasTexts = canvasSvg.locator('text')
    const readRenderedTexts = async () => (await canvasTexts.allTextContents()).join('')
    const englishTexts = await readRenderedTexts()
    await langToggle.click()
    await expect(langToggle).toHaveAttribute('data-orbitpm-aris-content-lang', 'ar')
    // The redraw lands asynchronously after the toolbar attribute flips; the
    // caption text changing IS the redraw-applied signal and the assertion.
    await expect.poll(readRenderedTexts, { timeout: 60_000 }).not.toBe(englishTexts)

    const arabicModel = ITERATE_MODELS[ITERATE_MODELS.length - 1]
    const [arabicDownload] = await Promise.all([
      opfsPage.waitForEvent('download', { timeout: 120_000 }),
      opfsPage.locator('[data-orbitpm-aris-export-pdf]').click()
    ])
    const arabicPdfPath = resolve(SCRATCH, `${arabicModel.key}-ar-${browserName}.pdf`)
    await arabicDownload.saveAs(arabicPdfPath)
    const arabicPng = rasterizePdfToPng(
      arabicPdfPath,
      resolve(SCRATCH, `${arabicModel.key}-ar-${browserName}`)
    )
    const englishPng = readPng(resolve(SCRATCH, `${arabicModel.key}-${browserName}-1.png`))
    const arabicReport = inkStructureSimilarity(readPng(arabicPng), englishPng)
    console.warn(
      `[sequence-1] ${arabicModel.key} AR-vs-EN export: score=${arabicReport.score.toFixed(4)} ` +
        `ink ${(arabicReport.inkFractionA * 100).toFixed(2)}%`
    )
    expect(arabicReport.inkFractionA, 'the Arabic-content export is blank').toBeGreaterThan(
      MIN_INK_FRACTION
    )
    expect(
      arabicReport.score,
      `the Arabic export drifted structurally from the English one (${arabicReport.score.toFixed(4)})`
    ).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD)
    await langToggle.click()
    await expect(langToggle).toHaveAttribute('data-orbitpm-aris-content-lang', 'en')

    // --- Step 3: derived AML export round-trips the model ---------------------
    const [xmlDownload] = await Promise.all([
      opfsPage.waitForEvent('download', { timeout: 120_000 }),
      opfsPage.locator('[data-orbitpm-aris-export-derived]').click()
    ])
    expect(xmlDownload.suggestedFilename()).toMatch(/\.(aml|xml)$/u)
    const exportedXmlPath = resolve(SCRATCH, `roundtrip-${browserName}.aml`)
    await xmlDownload.saveAs(exportedXmlPath)

    const verdicts = runRoundTripCompare(exportedXmlPath)

    // The same comparator and the same 0-diff budget as the
    // `*.animalwf.test.ts` baselines, now applied to the round-tripped bytes.
    for (const verdict of verdicts) {
      const structuralDiffs = Object.entries(verdict.byCategory).filter(([, count]) => count > 0)
      expect(
        structuralDiffs,
        `${verdict.key}: the round-tripped XML no longer matches the model:\n${verdict.rows.join('\n') || 'no diff rows'}`
      ).toEqual([])
    }
  } finally {
    await webkitOpfsContext?.close()
  }
})
