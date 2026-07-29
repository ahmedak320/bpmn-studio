/**
 * ARIS browser performance gate — plan §21.4, measured against the mounted
 * product.
 *
 * Every number here comes from driving the BUILT single-file artifact over
 * `file://` in headless Chromium with real input events, importing the real
 * `../reference/AnimalWF/ARISAMLExport.xml`. Nothing is stubbed, no application
 * API is called directly, and no timing is taken from a Playwright round trip
 * where an in-page timestamp was available.
 *
 * The eight §21.4 gates map to the measurements below:
 *
 *   1. Parse/account/show the first model within 5 s   → `firstModelReadyMs`
 *   2. Switch between parsed models within 500 ms      → `modelSwitchP95Ms`
 *   3. Selection/drag/edit within 100 ms at p95        → `interactionP95Ms`
 *   4. Export a 4.4 MB source package within 5 s       → `derivedExportMs`
 *   5. Remain stable through 50 model switches         → `modelSwitchEndurance`
 *   6. Remain stable through 20 import/close cycles    → `importCloseEndurance`
 *   7. Keep full-folder assistant retrieval responsive → `assistantAnswerP95Ms`
 *   8. No unbounded growth after repeated AI cancels   → `aiCancelHeapGrowth`
 *
 * ## How an interaction is timed
 *
 * `window.__ORBITPM_ARIS_PERF__` installs a capture-phase `mousedown` listener
 * and a `requestAnimationFrame` loop. Before each gesture the harness *arms* the
 * loop with the value it expects to change; the loop records the delta between
 * the trusted browser event and the first frame on which the product had
 * actually changed. The reported latency therefore includes one frame of paint
 * scheduling, which is honest — the user cannot see a response sooner than the
 * next frame — and `event.isTrusted` is carried into the evidence so a
 * synthetic event can never be mistaken for a real one.
 *
 * ## Privacy
 *
 * The AnimalWF export is private customer data. The evidence file records
 * counts, ids of *models* the product already exposes as DOM attributes, and
 * timings — never label text and never occurrence contents.
 *
 * ## Usage
 *
 * ```sh
 * npm run test:performance:browser
 * npm run test:performance:browser -- --output=performance-browser-results.json
 * npm run test:performance:browser -- --artifact=release/OrbitPM-ARIS-Studio-Lite.html
 * ```
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, type Browser, type CDPSession, type Page } from '@playwright/test'

import {
  evaluateArisInteractionGate,
  evaluateEndurance,
  percentile,
  type ArisInteractionGate,
  type ArisInteractionSample,
  type EnduranceEvidence
} from './browserPerformanceEvidence'
import {
  collectPerformanceSourceBinding,
  evaluatePerformanceHardwareProfile,
  expectedPerformanceCandidateSha,
  observePerformanceRuntime,
  performanceArgumentValue,
  selectedPerformanceHardwareProfile
} from './performanceEvidence'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** The fixed viewport every measurement is taken at, matching Phase 16. */
const VIEWPORT = Object.freeze({ width: 1600, height: 1000 })

/** §21.4's own numbers. */
const LIMITS_MS = Object.freeze({
  firstModelReady: 5_000,
  modelSwitchP95: 500,
  interactionP95: 100,
  derivedExport: 5_000,
  /**
   * Declared here: §21.4 says only "responsive". The assistant answers with the
   * UI already on screen, so it inherits the model-switch budget rather than an
   * invented one.
   */
  assistantAnswerP95: 500
})

const MODEL_SWITCH_CYCLES = 50
const IMPORT_CLOSE_CYCLES = 20
const AI_CANCEL_CYCLES = 30
const INTERACTION_ROUNDS = 20
const ENDURANCE_DRIFT_LIMIT = 2
const HEAP_GROWTH_LIMIT = 2

/** The English §17.4 question shapes the deterministic router answers with no key. */
const ASSISTANT_QUESTIONS: readonly string[] = Object.freeze([
  'Which processes are available?',
  'What comes next after animal registration?',
  'What comes before operator registration?',
  'Who is responsible for animal profile closure?',
  'What inputs and outputs apply to renewal?',
  'Which system is used for registration?',
  'What XOR outcomes exist in operator registration?',
  'Where does the return branch go?',
  'Which information is missing?',
  'Which process matches animal registration?'
])

type ObservationKind = 'elementClass' | 'elementTransform' | 'dragGroupTransform'
type ProbeEventType = 'mousedown' | 'mousemove'

/**
 * Installed once per page, before any script runs. Everything it reads is a DOM
 * attribute the product already publishes.
 *
 * The event that starts the clock is chosen per interaction, because "response"
 * means different things for different gestures. A click is answered by the
 * selection outline, so its clock starts at `mousedown`. A drag is answered by
 * the move preview following the pointer, so its clock starts at the
 * `mousemove` that asked for the movement — measuring a drag from its initial
 * `mousedown` would time the whole gesture, including how long the harness took
 * to synthesise it, and would say nothing about responsiveness.
 */
function installProbe(): void {
  const read = (kind: string, selector: string): string => {
    if (kind === 'dragGroupTransform') {
      return document.querySelector('.djs-drag-group')?.getAttribute('transform') ?? ''
    }
    const node = selector === '' ? null : document.querySelector(selector)
    if (kind === 'elementClass') return node?.getAttribute('class') ?? ''
    if (kind === 'elementTransform') return node?.getAttribute('transform') ?? ''
    return ''
  }

  const probe = {
    lastByType: {} as Record<string, { at: number; trusted: boolean } | undefined>,
    armed: null as {
      name: string
      kind: string
      eventType: string
      selector: string
      before: string
      armedAt: number
    } | null,
    samples: [] as {
      name: string
      trustedEvent: boolean
      responseMs: number
      observed: string
    }[],
    read
  }
  ;(window as unknown as { __ORBITPM_ARIS_PERF__: typeof probe }).__ORBITPM_ARIS_PERF__ = probe

  for (const type of ['mousedown', 'mousemove']) {
    document.addEventListener(
      type,
      (event) => {
        probe.lastByType[type] = { at: performance.now(), trusted: event.isTrusted }
      },
      true
    )
  }

  const tick = (): void => {
    const armed = probe.armed
    const event = armed ? probe.lastByType[armed.eventType] : undefined
    if (armed && event && event.at >= armed.armedAt) {
      const observed = probe.read(armed.kind, armed.selector)
      if (observed !== armed.before && observed.trim() !== '') {
        probe.samples.push({
          name: armed.name,
          trustedEvent: event.trusted,
          responseMs: performance.now() - event.at,
          observed
        })
        probe.armed = null
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

interface CliOptions {
  readonly artifact: string
  readonly fixture: string
  readonly output: string
}

function parseOptions(): CliOptions {
  const abs = (value: string): string => (isAbsolute(value) ? value : resolve(REPO, value))
  return {
    artifact: abs(performanceArgumentValue('artifact') ?? 'dist/index.html'),
    fixture: abs(performanceArgumentValue('fixture') ?? '../reference/AnimalWF/ARISAMLExport.xml'),
    output: abs(performanceArgumentValue('output') ?? 'performance-browser-results.json')
  }
}

const options = parseOptions()

for (const [label, path] of [
  ['built artifact', options.artifact],
  ['AnimalWF reference export', options.fixture]
] as const) {
  if (!existsSync(path)) {
    console.error(
      `Missing ${label} at ${path}. The §21.4 browser gates measure the real product against ` +
        'the real customer export; there is no substitute.'
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function armProbe(
  page: Page,
  name: ArisInteractionSample['name'],
  kind: ObservationKind,
  selector: string,
  eventType: ProbeEventType = 'mousedown'
): Promise<void> {
  await page.evaluate(
    (armed) => {
      const probe = (
        window as unknown as {
          __ORBITPM_ARIS_PERF__: {
            lastByType: Record<string, unknown>
            armed: unknown
            read: (kind: string, selector: string) => string
          }
        }
      ).__ORBITPM_ARIS_PERF__
      probe.lastByType = {}
      probe.armed = {
        name: armed.name,
        kind: armed.kind,
        eventType: armed.eventType,
        selector: armed.selector,
        before: probe.read(armed.kind, armed.selector),
        armedAt: performance.now()
      }
    },
    { name, kind, selector, eventType }
  )
}

async function waitForProbe(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ORBITPM_ARIS_PERF__: { armed: unknown } }).__ORBITPM_ARIS_PERF__
        .armed === null,
    undefined,
    { timeout: timeoutMs }
  )
}

async function collectSamples(page: Page): Promise<ArisInteractionSample[]> {
  const raw = await page.evaluate(() => {
    const probe = (
      window as unknown as {
        __ORBITPM_ARIS_PERF__: { samples: unknown[] }
      }
    ).__ORBITPM_ARIS_PERF__
    const taken = probe.samples
    probe.samples = []
    return taken
  })
  return raw as ArisInteractionSample[]
}

/** In-page timestamp, so no Playwright round trip enters a measurement. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

async function openArtifact(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { ...VIEWPORT },
    locale: 'en-US',
    acceptDownloads: true
  })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await page.addInitScript(installProbe)
  await page.goto(pathToFileURL(options.artifact).toString(), { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  return page
}

/** Import the reference export through the real file input, timed in-page. */
async function importReference(page: Page): Promise<number> {
  await page.evaluate(() => {
    ;(
      window as unknown as { __ORBITPM_ARIS_IMPORT_READY__: number | null }
    ).__ORBITPM_ARIS_IMPORT_READY__ = null
  })
  const startedAt = await pageNow(page)
  await page.locator('input[type="file"]').first().setInputFiles(options.fixture)
  const readyAt = (await page.waitForFunction(
    () => {
      const canvas = document.querySelector('[data-orbitpm-aris-canvas]')
      const drawn = canvas?.querySelector('[data-element-id^="ObjOcc."]') ?? null
      const accounting = document.querySelector('[data-orbitpm-aris-accounting] p')
      const models = document.querySelectorAll('[data-orbitpm-aris-model]').length
      if (!drawn || !accounting || models === 0) return null
      const holder = window as unknown as { __ORBITPM_ARIS_IMPORT_READY__: number | null }
      holder.__ORBITPM_ARIS_IMPORT_READY__ ??= performance.now()
      return holder.__ORBITPM_ARIS_IMPORT_READY__
    },
    undefined,
    { timeout: 300_000 }
  )) as unknown as { jsonValue: () => Promise<number> }
  return (await readyAt.jsonValue()) - startedAt
}

async function listModelIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-orbitpm-aris-model]')).map(
      (node) => node.getAttribute('data-orbitpm-aris-model') ?? ''
    )
  )
}

/** Click a model in the explorer and wait until its own layer carries shapes. */
async function switchModel(page: Page, modelId: string): Promise<number> {
  await page.evaluate(() => {
    ;(
      window as unknown as { __ORBITPM_ARIS_SWITCH_AT__: number | null }
    ).__ORBITPM_ARIS_SWITCH_AT__ = null
  })
  const startedAt = await pageNow(page)
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  const handle = (await page.waitForFunction(
    (id) => {
      const root = document.querySelector(
        `[data-orbitpm-aris-canvas] g[data-element-id="model:${id}"]`
      )
      if (!root) return null
      if (root.querySelectorAll('g.djs-element[data-element-id]').length === 0) return null
      const holder = window as unknown as { __ORBITPM_ARIS_SWITCH_AT__: number | null }
      holder.__ORBITPM_ARIS_SWITCH_AT__ ??= performance.now()
      return holder.__ORBITPM_ARIS_SWITCH_AT__
    },
    modelId,
    { timeout: 120_000 }
  )) as unknown as { jsonValue: () => Promise<number> }
  return (await handle.jsonValue()) - startedAt
}

async function heapUsedBytes(client: CDPSession): Promise<number> {
  await client.send('HeapProfiler.collectGarbage')
  const usage = (await client.send('Runtime.getHeapUsage')) as { usedSize: number }
  return usage.usedSize
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface GateResult {
  readonly name: string
  readonly unit: 'ms' | 'ratio'
  readonly value: number
  readonly limit: number
  readonly passed: boolean
  readonly thresholdSource: 'plan-21.4' | 'declared-here'
  readonly planRequirement: string
  readonly details: Readonly<Record<string, number | string | boolean>>
}

function gate(input: Omit<GateResult, 'passed'>): GateResult {
  return { ...input, value: Number(input.value.toFixed(3)), passed: input.value <= input.limit }
}

interface Findings {
  readonly gates: GateResult[]
  readonly interactionGate: ArisInteractionGate | null
  readonly modelSwitchEndurance: EnduranceEvidence | null
  readonly importCloseEndurance: EnduranceEvidence | null
  readonly modelIds: string[]
  readonly consoleErrors: string[]
  readonly pageErrors: string[]
  readonly downloadName: string | null
  readonly heap: Record<string, number>
  readonly notes: string[]
}

async function run(browser: Browser): Promise<Findings> {
  const gates: GateResult[] = []
  const notes: string[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const heap: Record<string, number> = {}

  const page = await openArtifact(browser)
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)))
  const client = await page.context().newCDPSession(page)

  // -- §21.4 #1 ------------------------------------------------------------
  const firstModelReadyMs = await importReference(page)
  const modelIds = (await listModelIds(page)).filter((id) => id !== '')
  gates.push(
    gate({
      name: 'firstModelReadyMs',
      unit: 'ms',
      value: firstModelReadyMs,
      limit: LIMITS_MS.firstModelReady,
      thresholdSource: 'plan-21.4',
      planRequirement: 'Parse/account/show the first AnimalWF model within 5 seconds',
      details: {
        fixtureBytes: readFileSync(options.fixture).byteLength,
        modelsListed: modelIds.length,
        occurrencesDrawn: await page
          .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
          .count()
      }
    })
  )

  // -- §21.4 #2 ------------------------------------------------------------
  const tourDurations: number[] = []
  const occurrencesByModel = new Map<string, number>()
  for (const modelId of modelIds) {
    tourDurations.push(await switchModel(page, modelId))
    occurrencesByModel.set(
      modelId,
      await page
        .locator(
          `[data-orbitpm-aris-canvas] g[data-element-id="model:${modelId}"] ` +
            'g.djs-element[data-element-id^="ObjOcc."]'
        )
        .count()
    )
  }
  const modelSwitchP95 = percentile(tourDurations, 0.95)
  gates.push(
    gate({
      name: 'modelSwitchP95Ms',
      unit: 'ms',
      value: modelSwitchP95,
      limit: LIMITS_MS.modelSwitchP95,
      thresholdSource: 'plan-21.4',
      planRequirement: 'Switch between parsed models within 500 ms',
      details: {
        switches: tourDurations.length,
        medianMs: Number(percentile(tourDurations, 0.5).toFixed(3)),
        maxMs: Number(Math.max(...tourDurations).toFixed(3)),
        minMs: Number(Math.min(...tourDurations).toFixed(3))
      }
    })
  )

  // -- §21.4 #3 ------------------------------------------------------------
  // Selection, drag and edit, all through real pointer input on the canvas.
  // The product has no in-canvas text editing and a read-only details rail, so
  // "edit" is a command-stack change applied to an existing element: the
  // toolbar Undo of the drag that immediately precedes it.
  // The canvas keeps a layer per visited model in the DOM, so every selector
  // below is scoped to the ACTIVE model's own root — an occurrence belonging to
  // a hidden layer has a bounding box but is not clickable.
  const interactionModelId = [...occurrencesByModel.entries()].sort(
    (left, right) => right[1] - left[1]
  )[0]?.[0] as string
  await switchModel(page, interactionModelId)
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  const modelScope =
    `[data-orbitpm-aris-canvas] g[data-element-id="model:${interactionModelId}"] ` +
    'g.djs-element[data-element-id^="ObjOcc."]'
  // Only occurrences a person could actually click count: big enough to hit,
  // fully inside the canvas box, and not underneath the palette or the minimap,
  // both of which float above the diagram.
  const occurrenceIds = await page.evaluate((scope) => {
    const canvas = document.querySelector('[data-orbitpm-aris-canvas]')
    if (!canvas) return []
    const canvasRect = canvas.getBoundingClientRect()
    const overlays = ['.djs-palette', '.djs-minimap', '.djs-context-pad']
      .flatMap((selector) => Array.from(canvas.querySelectorAll(selector)))
      .map((node) => node.getBoundingClientRect())
    const clear = (rect: DOMRect): boolean =>
      rect.width >= 8 &&
      rect.height >= 8 &&
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
    return Array.from(document.querySelectorAll(scope))
      .filter((node) => clear(node.getBoundingClientRect()))
      .map((node) => node.getAttribute('data-element-id') ?? '')
      .filter((id) => id !== '')
  }, modelScope)
  if (occurrenceIds.length < INTERACTION_ROUNDS) {
    notes.push(
      `Only ${occurrenceIds.length} occurrences were reachable for interaction sampling on ` +
        `model ${interactionModelId}; ${INTERACTION_ROUNDS} rounds were requested.`
    )
  }

  const interactionSamples: ArisInteractionSample[] = []
  let failedInteractionRounds = 0
  for (let round = 0; round < INTERACTION_ROUNDS && occurrenceIds.length > 0; round += 1) {
    const elementId = occurrenceIds[round % occurrenceIds.length] as string
    const selector =
      `[data-orbitpm-aris-canvas] g[data-element-id="model:${interactionModelId}"] ` +
      `g[data-element-id="${cssEscape(elementId)}"]`
    const target = page.locator(selector)
    const box = await target.boundingBox()
    if (!box) {
      failedInteractionRounds += 1
      continue
    }
    const centreX = box.x + box.width / 2
    const centreY = box.y + box.height / 2

    try {
      // selection — a real click, observed through diagram-js's own `selected`
      // class on the clicked element (the details-rail label is not usable as a
      // probe: two occurrences of one definition carry the same label).
      await armProbe(page, 'selection', 'elementClass', selector)
      await page.mouse.move(centreX, centreY)
      await page.mouse.down()
      await page.mouse.up()
      await waitForProbe(page, 15_000)

      // drag — a real pointer drag. The gesture is established first (press,
      // then one move past diagram-js's drag threshold); only the NEXT move is
      // measured, against the move preview diagram-js renders, so the number is
      // the latency of the drag following the pointer rather than the duration
      // of the whole synthesised gesture.
      await page.mouse.move(centreX, centreY)
      await page.mouse.down()
      await page.mouse.move(centreX + 24, centreY + 16)
      await page.locator('.djs-drag-group').first().waitFor({ state: 'attached', timeout: 10_000 })
      await armProbe(page, 'drag', 'dragGroupTransform', '', 'mousemove')
      await page.mouse.move(centreX + 48, centreY + 32)
      await waitForProbe(page, 15_000)
      await page.mouse.up()
      await page
        .locator('[data-orbitpm-aris-undo]:not([disabled])')
        .waitFor({ state: 'attached', timeout: 15_000 })

      // edit — the toolbar Undo of that drag, observed through the element's
      // own committed transform returning to where it started.
      await armProbe(page, 'edit', 'elementTransform', selector)
      await page.locator('[data-orbitpm-aris-undo]').click()
      await waitForProbe(page, 15_000)
    } catch (error) {
      failedInteractionRounds += 1
      notes.push(
        `Interaction round ${round + 1} did not complete: ` +
          `${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
      )
      await page.evaluate(() => {
        ;(
          window as unknown as { __ORBITPM_ARIS_PERF__: { armed: unknown } }
        ).__ORBITPM_ARIS_PERF__.armed = null
      })
    }
  }
  if (failedInteractionRounds > 0) {
    notes.push(`${failedInteractionRounds} of ${INTERACTION_ROUNDS} interaction rounds failed.`)
  }
  interactionSamples.push(...(await collectSamples(page)))
  const interactionGate = evaluateArisInteractionGate(
    interactionSamples,
    LIMITS_MS.interactionP95,
    Math.min(INTERACTION_ROUNDS, 10)
  )
  gates.push(
    gate({
      name: 'interactionP95Ms',
      unit: 'ms',
      value: interactionGate.overallP95Ms,
      limit: LIMITS_MS.interactionP95,
      thresholdSource: 'plan-21.4',
      planRequirement: 'Selection/drag/edit response within 100 ms at p95',
      details: Object.fromEntries([
        ['interactionModelId', interactionModelId],
        ['reachableOccurrences', occurrenceIds.length],
        ['rounds', INTERACTION_ROUNDS],
        ['failedRounds', failedInteractionRounds],
        ...interactionGate.perInteraction.flatMap((entry) => [
          [`${entry.name}Samples`, entry.samples],
          [`${entry.name}MedianMs`, entry.medianMs],
          [`${entry.name}P95Ms`, entry.p95Ms],
          [`${entry.name}MaxMs`, entry.maxMs]
        ])
      ])
    })
  )

  // -- §21.4 #4 ------------------------------------------------------------
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  const exportStartedAt = Date.now()
  await page.locator('[data-orbitpm-aris-export-derived]').click()
  const download = await downloadPromise
  const derivedExportMs = Date.now() - exportStartedAt
  const downloadName = download.suggestedFilename()
  await download.cancel().catch(() => {})
  gates.push(
    gate({
      name: 'derivedExportMs',
      unit: 'ms',
      value: derivedExportMs,
      limit: LIMITS_MS.derivedExport,
      thresholdSource: 'plan-21.4',
      planRequirement: 'Export a 4.4 MiB source package within 5 seconds',
      details: {
        sourceBytes: readFileSync(options.fixture).byteLength,
        downloadName,
        // Wall clock across the Playwright download event, not an in-page
        // timestamp: the browser only reports a download once it has landed.
        timedFrom: 'node-wall-clock'
      }
    })
  )

  // -- §21.4 #5 ------------------------------------------------------------
  const switchDurations: number[] = []
  let failedSwitches = 0
  for (let cycle = 0; cycle < MODEL_SWITCH_CYCLES; cycle += 1) {
    const modelId = modelIds[cycle % modelIds.length] as string
    try {
      switchDurations.push(await switchModel(page, modelId))
    } catch {
      failedSwitches += 1
    }
  }
  const modelSwitchEndurance = evaluateEndurance(
    'model switches',
    switchDurations,
    MODEL_SWITCH_CYCLES,
    ENDURANCE_DRIFT_LIMIT,
    failedSwitches
  )
  gates.push(
    gate({
      name: 'modelSwitchDriftRatio',
      unit: 'ratio',
      value: modelSwitchEndurance.driftRatio,
      limit: ENDURANCE_DRIFT_LIMIT,
      thresholdSource: 'declared-here',
      planRequirement: 'Remain stable through 50 model switches',
      details: {
        cycles: modelSwitchEndurance.cycles,
        failedCycles: modelSwitchEndurance.failedCycles,
        totalMs: modelSwitchEndurance.totalMs,
        firstFifthMedianMs: modelSwitchEndurance.firstFifthMedianMs,
        lastFifthMedianMs: modelSwitchEndurance.lastFifthMedianMs
      }
    })
  )

  // -- §21.4 #7 ------------------------------------------------------------
  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click()
  const assistantDialog = page.getByRole('dialog', { name: 'Process assistant', exact: true })
  await assistantDialog.waitFor({ state: 'visible' })
  const questionInput = page.locator('[data-orbitpm-aris-assistant-question]')
  const answerDurations: number[] = []
  let unansweredQuestions = 0
  for (const question of ASSISTANT_QUESTIONS) {
    await questionInput.fill(question)
    await page.evaluate(() => {
      ;(
        window as unknown as { __ORBITPM_ARIS_ANSWER_AT__: number | null }
      ).__ORBITPM_ARIS_ANSWER_AT__ = null
    })
    const askedAt = await pageNow(page)
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    try {
      const handle = (await page.waitForFunction(
        (asked) => {
          const node = document.querySelector('[data-orbitpm-aris-assistant-answer]')
          const text = node?.textContent ?? ''
          if (text.trim() === '') return null
          const holder = window as unknown as {
            __ORBITPM_ARIS_ANSWER_AT__: number | null
            __ORBITPM_ARIS_LAST_ANSWER__?: string
          }
          if (holder.__ORBITPM_ARIS_LAST_ANSWER__ === `${asked}::${text}`) return null
          holder.__ORBITPM_ARIS_ANSWER_AT__ ??= performance.now()
          holder.__ORBITPM_ARIS_LAST_ANSWER__ = `${asked}::${text}`
          return holder.__ORBITPM_ARIS_ANSWER_AT__
        },
        question,
        { timeout: 30_000 }
      )) as unknown as { jsonValue: () => Promise<number> }
      answerDurations.push((await handle.jsonValue()) - askedAt)
    } catch {
      unansweredQuestions += 1
    }
  }
  await page.getByLabel('Close assistant', { exact: true }).click()
  const assistantP95 = percentile(answerDurations, 0.95)
  gates.push(
    gate({
      name: 'assistantAnswerP95Ms',
      unit: 'ms',
      value: assistantP95,
      limit: LIMITS_MS.assistantAnswerP95,
      thresholdSource: 'declared-here',
      planRequirement: 'Keep full-folder assistant retrieval responsive',
      details: {
        questionsAsked: ASSISTANT_QUESTIONS.length,
        questionsAnswered: answerDurations.length,
        questionsUnanswered: unansweredQuestions,
        medianMs:
          answerDurations.length > 0 ? Number(percentile(answerDurations, 0.5).toFixed(3)) : 0,
        maxMs: answerDurations.length > 0 ? Number(Math.max(...answerDurations).toFixed(3)) : 0
      }
    })
  )

  // -- §21.4 #8 ------------------------------------------------------------
  // The ARIS create panel has no DOCX/PDF/image attachment input (plan §16.3 is
  // not implemented in the mounted product), so the closest real surface is the
  // AI create request itself: start it against a route that never responds and
  // cancel it. Everything the request would allocate — prompt, controller,
  // provider closure — is what must not accumulate.
  const heldRoutes: (() => void)[] = []
  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const headers = request.headers()
    const corsHeaders = {
      'access-control-allow-origin': headers.origin ?? '*',
      'access-control-allow-headers':
        headers['access-control-request-headers'] ??
        'authorization, content-type, http-referer, x-title',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
      return
    }
    if (new URL(request.url()).pathname === '/api/v1/credits') {
      // The Settings dialog fetches this once a key looks configured; stubbing
      // it keeps the key-storing step from leaving an unmocked request open.
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 10, total_usage: 1 } })
      })
      return
    }
    // Held open and never answered: exactly the in-flight state a cancel must
    // unwind. Released only at teardown so the gate itself cannot hang.
    await new Promise<void>((release) => heldRoutes.push(release))
    await route.abort('aborted').catch(() => {})
  })

  // Store a key through the real Settings dialog — `ArisGenerationPanel` reads
  // it through `hasKey`/`getKey`, which is an in-memory session store, so there
  // is no storage back door to inject one through.
  await page.getByRole('banner').getByRole('button', { name: '⚙ Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings — AI keys', exact: true })
  await settings.waitFor({ state: 'visible' })
  await settings.getByLabel('OpenRouter API key').fill('performance-gate-key')
  await settings.getByRole('button', { name: 'Save keys' }).click()
  await settings.getByText('Saved.').waitFor({ state: 'visible' })
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
  await settings.waitFor({ state: 'hidden' })

  const createPanel = page.locator('[data-orbitpm-aris-create]')
  await createPanel.first().waitFor({ state: 'visible' })
  const descriptionBox = createPanel.first().locator('textarea')
  await descriptionBox.fill(
    'A short operator registration process used only to open and immediately cancel a request.'
  )
  await createPanel.first().locator('[data-orbitpm-aris-create-consent]').check()

  const submit = createPanel.first().locator('[data-orbitpm-aris-create-submit]')
  const cancelButton = createPanel.first().getByRole('button', { name: 'Cancel', exact: true })
  let cancelCycles = 0
  heap.beforeAiCancelCycles = await heapUsedBytes(client)
  for (let cycle = 0; cycle < AI_CANCEL_CYCLES; cycle += 1) {
    if (!(await submit.isEnabled())) break
    await submit.click()
    try {
      await cancelButton.waitFor({ state: 'visible', timeout: 10_000 })
    } catch {
      break
    }
    await cancelButton.click()
    await cancelButton.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
    cancelCycles += 1
    if (cycle === 0) heap.afterFirstAiCancel = await heapUsedBytes(client)
  }
  heap.afterAiCancelCycles = await heapUsedBytes(client)
  for (const release of heldRoutes) release()
  await page.unroute('https://openrouter.ai/**').catch(() => {})
  const heapBaseline = heap.afterFirstAiCancel ?? heap.beforeAiCancelCycles
  const aiCancelHeapGrowth = heapBaseline > 0 ? heap.afterAiCancelCycles / heapBaseline : 0
  if (cancelCycles < AI_CANCEL_CYCLES) {
    notes.push(
      `Only ${cancelCycles} of ${AI_CANCEL_CYCLES} AI cancel cycles completed; the heap ratio ` +
        'describes that shorter run.'
    )
  }
  gates.push(
    gate({
      name: 'aiCancelHeapGrowthRatio',
      unit: 'ratio',
      value: aiCancelHeapGrowth,
      limit: HEAP_GROWTH_LIMIT,
      thresholdSource: 'declared-here',
      planRequirement:
        'Avoid unbounded memory growth after repeated AI attachment cancellation ' +
        '(measured on request cancellation: the product has no attachment input)',
      details: {
        cancelCycles,
        requestedCycles: AI_CANCEL_CYCLES,
        heapAfterFirstCancelBytes: heapBaseline,
        heapAfterAllCancelsBytes: heap.afterAiCancelCycles
      }
    })
  )

  // -- §21.4 #6 ------------------------------------------------------------
  const cycleDurations: number[] = []
  let failedCycles = 0
  const closeTab = page.locator('span[title="Close source tab"]')
  for (let cycle = 0; cycle < IMPORT_CLOSE_CYCLES; cycle += 1) {
    const startedAt = Date.now()
    try {
      await importReference(page)
      await closeTab.first().click()
      await page
        .locator('[data-orbitpm-aris-canvas]')
        .first()
        .waitFor({ state: 'detached', timeout: 60_000 })
      cycleDurations.push(Date.now() - startedAt)
    } catch {
      failedCycles += 1
      cycleDurations.push(Date.now() - startedAt)
    }
  }
  heap.afterImportCloseCycles = await heapUsedBytes(client)
  const importCloseEndurance = evaluateEndurance(
    'import/close cycles',
    cycleDurations,
    IMPORT_CLOSE_CYCLES,
    ENDURANCE_DRIFT_LIMIT,
    failedCycles
  )
  gates.push(
    gate({
      name: 'importCloseDriftRatio',
      unit: 'ratio',
      value: importCloseEndurance.driftRatio,
      limit: ENDURANCE_DRIFT_LIMIT,
      thresholdSource: 'declared-here',
      planRequirement: 'Remain stable through 20 import/close cycles',
      details: {
        cycles: importCloseEndurance.cycles,
        failedCycles: importCloseEndurance.failedCycles,
        totalMs: importCloseEndurance.totalMs,
        firstFifthMedianMs: importCloseEndurance.firstFifthMedianMs,
        lastFifthMedianMs: importCloseEndurance.lastFifthMedianMs,
        heapAfterCyclesBytes: heap.afterImportCloseCycles
      }
    })
  )

  await client.detach().catch(() => {})
  await page.context().close()

  return {
    gates,
    interactionGate,
    modelSwitchEndurance,
    importCloseEndurance,
    modelIds,
    consoleErrors,
    pageErrors,
    downloadName,
    heap,
    notes
  }
}

/** Minimal CSS.escape for the ids diagram-js writes into `data-element-id`. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const artifactBytesBefore = readFileSync(options.artifact)
const artifactSha256 = createHash('sha256').update(artifactBytesBefore).digest('hex')
const source = collectPerformanceSourceBinding(expectedPerformanceCandidateSha())
const hardwareProfile = evaluatePerformanceHardwareProfile(
  selectedPerformanceHardwareProfile(),
  observePerformanceRuntime()
)

let browser: Browser | undefined
let findings: Findings | null = null
let runError: string | undefined
let browserVersion = 'unavailable'

try {
  browser = await chromium.launch({ headless: true })
  browserVersion = browser.version()
  findings = await run(browser)
} catch (error) {
  runError = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
} finally {
  await browser?.close()
}

const artifactBytesAfter = readFileSync(options.artifact)
const artifactUnchanged =
  createHash('sha256').update(artifactBytesAfter).digest('hex') === artifactSha256

const gates = findings?.gates ?? []
const structurallyComplete =
  findings !== null &&
  runError === undefined &&
  findings.modelIds.length === 8 &&
  findings.pageErrors.length === 0 &&
  (findings.interactionGate?.passed ?? false) &&
  (findings.modelSwitchEndurance?.failedCycles ?? 1) === 0 &&
  (findings.importCloseEndurance?.failedCycles ?? 1) === 0 &&
  artifactUnchanged

const functionalPassed =
  gates.length > 0 && gates.every((entry) => entry.passed) && structurallyComplete
const measuredPassed = functionalPassed && hardwareProfile.matched
const releaseEvidenceEligible =
  measuredPassed && hardwareProfile.referenceEligible && source.releaseEligible
const releaseEvidenceRequired = process.argv.slice(2).includes('--require-release-evidence')
const passed = measuredPassed && (!releaseEvidenceRequired || releaseEvidenceEligible)

const evidence = {
  schemaVersion: 3,
  gate: 'orbitpm-aris-browser-performance',
  planSection: '21.4',
  createdAt: new Date().toISOString(),
  source,
  hardwareProfile,
  artifact: {
    path: options.artifact,
    sizeBytes: artifactBytesBefore.byteLength,
    sha256: artifactSha256,
    unchangedDuringGate: artifactUnchanged
  },
  fixture: {
    path: options.fixture,
    bytes: readFileSync(options.fixture).byteLength
  },
  browser: { name: 'chromium', version: browserVersion, viewport: VIEWPORT },
  limitsMs: LIMITS_MS,
  enduranceDriftLimit: ENDURANCE_DRIFT_LIMIT,
  heapGrowthLimit: HEAP_GROWTH_LIMIT,
  gates,
  interactionGate: findings?.interactionGate ?? null,
  modelSwitchEndurance: findings?.modelSwitchEndurance ?? null,
  importCloseEndurance: findings?.importCloseEndurance ?? null,
  heap: findings?.heap ?? {},
  modelsListed: findings?.modelIds.length ?? 0,
  consoleErrors: findings?.consoleErrors ?? [],
  pageErrors: findings?.pageErrors ?? [],
  notes: findings?.notes ?? [],
  runError,
  structurallyComplete,
  functionalPassed,
  releaseEvidenceRequired,
  passed,
  releaseEvidenceEligible
}

mkdirSync(dirname(options.output), { recursive: true })
const temporaryOutputPath = `${options.output}.tmp-${process.pid}`
writeFileSync(temporaryOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx'
})
renameSync(temporaryOutputPath, options.output)

for (const entry of gates) {
  console.log(
    `${entry.passed ? 'PASS' : 'FAIL'} ${entry.name}: ${entry.value} ${entry.unit} ` +
      `(limit ${entry.limit} ${entry.unit}, ${entry.thresholdSource}) — ${entry.planRequirement}`
  )
  console.log(`     ${JSON.stringify(entry.details)}`)
}
for (const failure of findings?.interactionGate?.failures ?? []) {
  console.error(`interaction: ${failure}`)
}
for (const failure of findings?.modelSwitchEndurance?.failures ?? []) {
  console.error(`endurance: ${failure}`)
}
for (const failure of findings?.importCloseEndurance?.failures ?? []) {
  console.error(`endurance: ${failure}`)
}
for (const note of findings?.notes ?? []) console.log(`note: ${note}`)
for (const error of findings?.pageErrors ?? []) console.error(`page error: ${error}`)
console.log(
  `Artifact ${options.artifact} (${artifactBytesBefore.byteLength} bytes, sha256 ${artifactSha256}) ` +
    `${artifactUnchanged ? 'unchanged' : 'CHANGED'} during the gate.`
)
console.log(
  `Hardware profile ${hardwareProfile.id}: ` +
    `${hardwareProfile.matched ? 'matched' : `mismatch (${hardwareProfile.mismatches.join('; ')})`}; ` +
    `release-reference=${hardwareProfile.referenceEligible ? 'eligible' : 'ineligible'}`
)

if (!passed) {
  if (runError) console.error(runError)
  console.error('ARIS browser performance gate failed.')
  process.exitCode = 1
} else {
  console.log(
    `ARIS browser performance gate passed; release evidence is ${
      releaseEvidenceEligible ? 'eligible' : 'development-only'
    }.`
  )
}
