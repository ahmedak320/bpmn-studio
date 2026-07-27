import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'

import { CANONICAL_FIELDS_BY_SHEET } from '../src/spreadsheet/aliases'
import { columnNumberToLetters } from '../src/spreadsheet/cellAddress'
import type { CellPrimitive } from '../src/spreadsheet/contracts'
import { createOfficialWorkbookTemplate } from '../src/spreadsheet/template'
import {
  REQUIRED_WORKER_INTERACTIONS,
  evaluateWorkerInteractionGate,
  type WorkerInteractionGate,
  type WorkerInteractionName,
  type WorkerInteractionReceipt
} from './browserPerformanceEvidence'
import {
  collectPerformanceSourceBinding,
  evaluatePerformanceHardwareProfile,
  expectedPerformanceCandidateSha,
  observePerformanceRuntime,
  performanceArgumentValue,
  selectedPerformanceHardwareProfile
} from './performanceEvidence'

const LIMITS_MS = Object.freeze({
  spreadsheetWorkerPreviewNodes500: 3_000,
  spreadsheetWorkerPreviewNodes1000: 10_000
})
const HEARTBEAT_INTERVAL_MS = 16
const PERFORMANCE_TRIALS = 3
const MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS = 250
const MAX_WORKER_INTERACTION_LATENCY_MS = 1_000

interface HeartbeatStatistics {
  maxGapMs: number
  p95GapMs: number
  samples: number
}

interface BrowserMeasurement {
  name: keyof typeof LIMITS_MS
  trial: number
  nodes: number
  flows: number
  workbookBytes: number
  interactionProbeParses: number
  interactionProbeElapsedMs: number
  timedPreviewParseOrdinal: number
  workerUiRoundTripMs: number
  reviewToReadyMs: number
  totalPreviewMs: number
  limitMs: number
  heartbeatLimitMs: number
  heartbeat: {
    overall: HeartbeatStatistics
    parse: HeartbeatStatistics
    review: HeartbeatStatistics
  }
  interactions: readonly WorkerInteractionReceipt[]
  interactionGate: WorkerInteractionGate
  spreadsheetWorkers: number
  withinSingleRunLimits: boolean
  error?: string
}

interface BrowserGate {
  name: keyof typeof LIMITS_MS
  nodes: number
  trials: number
  medianTotalPreviewMs: number
  totalPreviewLimitMs: number
  medianMaxParseHeartbeatGapMs: number
  parseHeartbeatLimitMs: number
  interactionLatencyLimitMs: number
  interactionCoverageComplete: boolean
  passed: boolean
}

interface WorkerRequestProbe {
  readonly requestId: string
  readonly requestType: 'parse' | 'review'
  readonly startedAt: number
  completedAt: number | null
}

interface InteractionEventProbe {
  readonly name: WorkerInteractionName
  readonly at: number
  readonly trusted: boolean
}

interface BrowserPerformanceProbe {
  workers: number
  requests: WorkerRequestProbe[]
  interactionEvents: InteractionEventProbe[]
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function worksheetXml(rows: readonly (readonly CellPrimitive[])[]): string {
  let xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>'
  for (const [rowIndex, row] of rows.entries()) {
    const rowNumber = rowIndex + 1
    xml += `<row r="${rowNumber}">`
    for (const [columnIndex, value] of row.entries()) {
      if (value === null || value === '') continue
      const reference = `${columnNumberToLetters(columnIndex + 1)}${rowNumber}`
      if (typeof value === 'number') {
        xml += `<c r="${reference}"><v>${String(value)}</v></c>`
      } else if (typeof value === 'boolean') {
        xml += `<c r="${reference}" t="b"><v>${value ? '1' : '0'}</v></c>`
      } else {
        const text = value instanceof Date ? value.toISOString() : String(value)
        xml += `<c r="${reference}" t="inlineStr"><is><t>` + `${xmlEscape(text)}</t></is></c>`
      }
    }
    xml += '</row>'
  }
  return `${xml}</sheetData></worksheet>`
}

function canonicalRow(
  headers: readonly string[],
  values: Readonly<Record<string, CellPrimitive>>
): readonly CellPrimitive[] {
  return headers.map((header) => values[header] ?? null)
}

function performanceWorkbook(nodeCount: number): Uint8Array {
  const processHeaders = CANONICAL_FIELDS_BY_SHEET.processes
  const stepHeaders = CANONICAL_FIELDS_BY_SHEET.steps
  const processRows: readonly (readonly CellPrimitive[])[] = [
    processHeaders,
    canonicalRow(processHeaders, {
      process_id: 'performance_process',
      name_en: 'Performance process',
      name_ar: 'عملية الأداء',
      active_language: 'en'
    })
  ]
  const stepRows: Array<readonly CellPrimitive[]> = [stepHeaders]
  const ordinaryDescription =
    'Review the request, supporting records, policy checks, owner notes, and expected outcome.'
  for (let index = 0; index < nodeCount; index += 1) {
    const first = index === 0
    const last = index === nodeCount - 1
    stepRows.push(
      canonicalRow(stepHeaders, {
        process_id: 'performance_process',
        step_id: `Step_${index + 1}`,
        order: index + 1,
        type: first ? 'startEvent' : last ? 'endEvent' : 'userTask',
        name_en: first ? 'Start' : last ? 'End' : `Review item ${index}`,
        name_ar: first ? 'البداية' : last ? 'النهاية' : `مراجعة البند ${index}`,
        description_en: ordinaryDescription,
        description_ar:
          'مراجعة الطلب والسجلات الداعمة وضوابط السياسة وملاحظات المالك والنتيجة المتوقعة.',
        inputs: 'Request record; supporting evidence; policy context',
        outputs: 'Reviewed decision; audit note'
      })
    )
  }

  const archive = unzipSync(createOfficialWorkbookTemplate('blank'))
  archive['xl/worksheets/sheet1.xml'] = strToU8(worksheetXml(processRows))
  archive['xl/worksheets/sheet3.xml'] = strToU8(worksheetXml(stepRows))
  return zipSync(archive, {
    level: 0,
    mtime: new Date('1980-01-01T00:00:00.000Z')
  })
}

async function openSpreadsheetPanel(page: Page) {
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await page.locator('.djs-container svg').first().waitFor({
    state: 'visible',
    timeout: 20_000
  })
  const aside = page.locator('aside')
  if (!(await aside.isVisible())) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
  }
  const aiHeader = page.getByRole('button', { name: /Generate with AI/i })
  if ((await aiHeader.getAttribute('aria-expanded')) === 'false') {
    await aiHeader.click()
  }
  await page.getByRole('tab', { name: 'Excel / CSV' }).click()
  const panel = page.getByRole('region', { name: 'Import Excel or CSV' })
  await panel.waitFor({ state: 'visible' })
  return panel
}

async function openOutlineProbe(page: Page): Promise<{
  labelInput: Locator
  startItem: Locator
  pane: Locator
  paneToggle: Locator
}> {
  const editor = page.locator('.orbitpm-editor:visible')
  let outlineToggle = editor.getByRole('button', { name: 'Process outline', exact: true })
  if (!(await outlineToggle.isVisible().catch(() => false))) {
    const actions = editor.getByRole('button', {
      name: 'More editor actions',
      exact: true
    })
    await actions.click()
    outlineToggle = editor
      .getByRole('menu', { name: 'More editor actions', exact: true })
      .getByRole('menuitem', { name: 'Process outline', exact: true })
  }
  const controlledId = await outlineToggle.getAttribute('aria-controls')
  if (!controlledId) throw new Error('Process outline performance control has no target.')
  await outlineToggle.click()
  const outline = page.locator(`[id="${controlledId}"]`)
  await outline.waitFor({ state: 'visible' })
  const labelInput = outline.getByLabel('Node label', { exact: true })
  const startItem = outline.getByRole('treeitem', { name: /Start event:/u }).first()
  await labelInput.fill('')
  await startItem.waitFor({ state: 'visible' })
  const paneToggle = editor.getByRole('button', { name: 'Details', exact: true })
  const paneId = await paneToggle.getAttribute('aria-controls')
  if (!paneId) throw new Error('Details pane performance control has no target.')
  const pane = page.locator(`[id="${paneId}"]`)
  return { labelInput, startItem, pane, paneToggle }
}

async function waitForActiveWorkerRequest(
  page: Page,
  requestType: 'parse' | 'review'
): Promise<void> {
  await page.waitForFunction(
    (expectedType) => {
      const state = (
        window as unknown as {
          __ORBITPM_PERFORMANCE_WORKERS__: BrowserPerformanceProbe
        }
      ).__ORBITPM_PERFORMANCE_WORKERS__
      return state.requests.some(
        (request) => request.requestType === expectedType && request.completedAt === null
      )
    },
    requestType,
    { timeout: 10_000 }
  )
}

async function waitForWorkerRequestCompletion(
  page: Page,
  requestType: 'parse' | 'review'
): Promise<void> {
  await page.waitForFunction(
    (expectedType) => {
      const state = (
        window as unknown as {
          __ORBITPM_PERFORMANCE_WORKERS__: BrowserPerformanceProbe
        }
      ).__ORBITPM_PERFORMANCE_WORKERS__
      return (
        state.requests.some((request) => request.requestType === expectedType) &&
        state.requests.every(
          (request) => request.requestType !== expectedType || request.completedAt !== null
        )
      )
    },
    requestType,
    { timeout: 10_000 }
  )
}

async function performWorkerInteraction(options: {
  page: Page
  name: WorkerInteractionName
  requestType: 'parse' | 'review'
  target: Locator
  eventType: 'input' | 'keydown' | 'click'
  action: () => Promise<void>
  observed: () => Promise<string>
}): Promise<WorkerInteractionReceipt> {
  const { page, name, requestType, target, eventType, action, observed } = options
  await target.evaluate(
    (node, armed) => {
      node.addEventListener(
        armed.eventType,
        (event) => {
          const state = (
            window as unknown as {
              __ORBITPM_PERFORMANCE_WORKERS__: BrowserPerformanceProbe
            }
          ).__ORBITPM_PERFORMANCE_WORKERS__
          state.interactionEvents.push({
            name: armed.name,
            at: performance.now(),
            trusted: event.isTrusted
          })
        },
        { once: true }
      )
    },
    { name, eventType }
  )
  await waitForActiveWorkerRequest(page, requestType)
  await action()
  const observedValue = await observed()
  const timing = await page.evaluate(
    ({ interactionName, expectedRequestType }) => {
      const state = (
        window as unknown as {
          __ORBITPM_PERFORMANCE_WORKERS__: BrowserPerformanceProbe
        }
      ).__ORBITPM_PERFORMANCE_WORKERS__
      const event = [...state.interactionEvents]
        .reverse()
        .find((candidate) => candidate.name === interactionName)
      if (!event) throw new Error(`${interactionName} did not dispatch its browser event.`)
      const request = state.requests.find(
        (candidate) =>
          candidate.requestType === expectedRequestType &&
          candidate.startedAt <= event.at &&
          (candidate.completedAt === null || candidate.completedAt >= event.at)
      )
      const observedAt = performance.now()
      return {
        trustedEvent: event.trusted,
        workerOverlapMs: request
          ? Math.max(
              0,
              Math.min(request.completedAt ?? observedAt, observedAt) -
                Math.max(request.startedAt, event.at)
            )
          : 0,
        responseLatencyMs: Math.max(0, observedAt - event.at)
      }
    },
    { interactionName: name, expectedRequestType: requestType }
  )
  return {
    name,
    requestType,
    trustedEvent: timing.trustedEvent,
    workerOverlapMs: Number(timing.workerOverlapMs.toFixed(3)),
    responseLatencyMs: Number(timing.responseLatencyMs.toFixed(3)),
    observed: observedValue
  }
}

async function startHeartbeat(page: Page): Promise<void> {
  await page.evaluate((intervalMs) => {
    const state = {
      lastMs: performance.now(),
      samples: [] as Array<{ from: number; at: number; gap: number }>,
      intervalId: 0
    }
    state.intervalId = window.setInterval(() => {
      const now = performance.now()
      state.samples.push({ from: state.lastMs, at: now, gap: now - state.lastMs })
      state.lastMs = now
    }, intervalMs)
    ;(
      window as unknown as {
        __ORBITPM_PERFORMANCE_HEARTBEAT__: typeof state
      }
    ).__ORBITPM_PERFORMANCE_HEARTBEAT__ = state
  }, HEARTBEAT_INTERVAL_MS)
}

async function stopHeartbeat(
  page: Page
): Promise<readonly { from: number; at: number; gap: number }[]> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __ORBITPM_PERFORMANCE_HEARTBEAT__: {
          intervalId: number
          samples: Array<{ from: number; at: number; gap: number }>
        }
      }
    ).__ORBITPM_PERFORMANCE_HEARTBEAT__
    window.clearInterval(state.intervalId)
    return state.samples
  })
}

function heartbeatStatistics(
  samples: readonly { from: number; at: number; gap: number }[],
  startedAt: number,
  endedAt: number
): HeartbeatStatistics {
  const gaps = samples
    .filter((sample) => sample.at >= startedAt && sample.from <= endedAt)
    .map((sample) => Math.min(sample.at, endedAt) - Math.max(sample.from, startedAt))
    .filter((gap) => gap > 0)
    .sort((left, right) => left - right)
  const p95Index = Math.max(0, Math.ceil(gaps.length * 0.95) - 1)
  return {
    maxGapMs: Number((gaps.at(-1) ?? 0).toFixed(3)),
    p95GapMs: Number((gaps[p95Index] ?? 0).toFixed(3)),
    samples: gaps.length
  }
}

async function measureBrowserPreview(
  browser: Browser,
  nodeCount: number,
  trial: number,
  artifactPath: string
): Promise<BrowserMeasurement> {
  const name =
    nodeCount === 500 ? 'spreadsheetWorkerPreviewNodes500' : 'spreadsheetWorkerPreviewNodes1000'
  const limitMs = LIMITS_MS[name]
  const workbook = performanceWorkbook(nodeCount)
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 900 }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)

  try {
    await page.addInitScript(() => {
      delete window.showDirectoryPicker
      delete window.showOpenFilePicker
      const state: BrowserPerformanceProbe = {
        workers: 0,
        requests: [],
        interactionEvents: []
      }
      ;(
        window as unknown as {
          __ORBITPM_PERFORMANCE_WORKERS__: typeof state
        }
      ).__ORBITPM_PERFORMANCE_WORKERS__ = state
      const NativeWorker = window.Worker
      const InstrumentedWorker = new Proxy(NativeWorker, {
        construct(target, argumentsList, newTarget) {
          state.workers += 1
          const worker = Reflect.construct(target, argumentsList, newTarget) as Worker
          const ownedRequests: WorkerRequestProbe[] = []
          worker.addEventListener('message', (event) => {
            const response = event.data as {
              requestId?: unknown
              type?: unknown
            }
            if (
              typeof response?.requestId !== 'string' ||
              response.type === 'progress' ||
              (response.type !== 'result' && response.type !== 'error')
            ) {
              return
            }
            const request = [...ownedRequests]
              .reverse()
              .find(
                (candidate) =>
                  candidate.requestId === response.requestId && candidate.completedAt === null
              )
            if (request) request.completedAt = performance.now()
          })
          return new Proxy(worker, {
            get(instance, property) {
              if (property === 'postMessage') {
                return (message: unknown, ...rest: unknown[]) => {
                  if (
                    message &&
                    typeof message === 'object' &&
                    'requestId' in message &&
                    typeof message.requestId === 'string' &&
                    'type' in message &&
                    (message.type === 'parse' || message.type === 'review')
                  ) {
                    const request: WorkerRequestProbe = {
                      requestId: message.requestId,
                      requestType: message.type,
                      startedAt: performance.now(),
                      completedAt: null
                    }
                    ownedRequests.push(request)
                    state.requests.push(request)
                  }
                  const postMessage = instance.postMessage.bind(instance) as (
                    message: unknown,
                    ...arguments_: unknown[]
                  ) => void
                  postMessage(message, ...rest)
                }
              }
              if (property === 'terminate') {
                return () => {
                  const completedAt = performance.now()
                  for (const request of ownedRequests) {
                    request.completedAt ??= completedAt
                  }
                  return instance.terminate()
                }
              }
              const value = Reflect.get(instance, property, instance)
              return typeof value === 'function' ? value.bind(instance) : value
            }
          })
        }
      })
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        writable: true,
        value: InstrumentedWorker
      })
    })
    await page.goto(pathToFileURL(artifactPath).toString(), {
      waitUntil: 'load'
    })
    const panel = await openSpreadsheetPanel(page)
    const outlineProbe = await openOutlineProbe(page)
    const workersBefore = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ORBITPM_PERFORMANCE_WORKERS__: { workers: number }
          }
        ).__ORBITPM_PERFORMANCE_WORKERS__.workers
    )
    await startHeartbeat(page)
    const interactions: WorkerInteractionReceipt[] = []
    const interactionProbeStartedAt = await page.evaluate(() => performance.now())
    const uploadInput = panel.locator('input[type="file"][accept*=".xlsx"]')
    let uploadPromise = uploadInput.setInputFiles({
      name: `OrbitPM-performance-${nodeCount}-typing.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(workbook)
    })
    interactions.push(
      await performWorkerInteraction({
        page,
        name: 'typing',
        requestType: 'parse',
        target: outlineProbe.labelInput,
        eventType: 'input',
        action: () => outlineProbe.labelInput.pressSequentially('UI'),
        observed: () => outlineProbe.labelInput.inputValue()
      })
    )
    await uploadPromise
    await waitForWorkerRequestCompletion(page, 'parse')

    const uploadStart = await page.evaluate(() => performance.now())
    uploadPromise = uploadInput.setInputFiles({
      name: `OrbitPM-performance-${nodeCount}-selection.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(workbook)
    })
    interactions.push(
      await performWorkerInteraction({
        page,
        name: 'selection',
        requestType: 'parse',
        target: outlineProbe.startItem,
        eventType: 'keydown',
        action: () => outlineProbe.startItem.press('Enter'),
        observed: async () => {
          await outlineProbe.startItem.waitFor({ state: 'visible' })
          return (await outlineProbe.startItem.getAttribute('aria-selected')) ?? ''
        }
      })
    )
    await uploadPromise
    await waitForWorkerRequestCompletion(page, 'parse')

    uploadPromise = uploadInput.setInputFiles({
      name: `OrbitPM-performance-${nodeCount}-pane.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(workbook)
    })
    interactions.push(
      await performWorkerInteraction({
        page,
        name: 'pane',
        requestType: 'parse',
        target: outlineProbe.paneToggle,
        eventType: 'keydown',
        action: () => outlineProbe.paneToggle.press('Enter'),
        observed: async () => {
          await outlineProbe.pane.waitFor({ state: 'visible' })
          return (await outlineProbe.paneToggle.getAttribute('aria-expanded')) ?? ''
        }
      })
    )
    await uploadPromise
    await waitForWorkerRequestCompletion(page, 'parse')
    await panel.getByText(/Official OrbitPM template detected/i).waitFor({
      state: 'visible'
    })
    const parseReady = await page.evaluate(() => performance.now())
    const interactionProbeElapsedMs = parseReady - interactionProbeStartedAt
    const reviewStart = await page.evaluate(() => performance.now())
    await panel.getByRole('button', { name: 'Validate and preview' }).click()
    await panel.getByRole('heading', { name: 'Read-only graph preview' }).waitFor({
      state: 'visible'
    })
    await panel.getByText(`${nodeCount} nodes`, { exact: true }).waitFor({
      state: 'visible'
    })
    await panel.getByText(`${nodeCount - 1} flows`, { exact: true }).waitFor({
      state: 'visible'
    })
    const prepare = panel.getByRole('button', { name: 'Prepare BPMN files' })
    await prepare.waitFor({ state: 'visible' })
    if (!(await prepare.isEnabled())) {
      throw new Error('Spreadsheet preview reached the final phase with Prepare disabled.')
    }
    const previewReady = await page.evaluate(() => performance.now())
    await page.waitForTimeout(50)
    const heartbeatSamples = await stopHeartbeat(page)
    const workersAfter = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ORBITPM_PERFORMANCE_WORKERS__: { workers: number }
          }
        ).__ORBITPM_PERFORMANCE_WORKERS__.workers
    )
    const spreadsheetWorkers = workersAfter - workersBefore
    const overallHeartbeat = heartbeatStatistics(heartbeatSamples, uploadStart, previewReady + 50)
    const parseHeartbeat = heartbeatStatistics(heartbeatSamples, uploadStart, parseReady)
    const reviewHeartbeat = heartbeatStatistics(heartbeatSamples, reviewStart, previewReady)
    const workerUiRoundTripMs = parseReady - uploadStart
    const reviewToReadyMs = previewReady - reviewStart
    const totalPreviewMs = previewReady - uploadStart
    const interactionGate = evaluateWorkerInteractionGate(
      interactions,
      MAX_WORKER_INTERACTION_LATENCY_MS
    )
    return {
      name,
      trial,
      nodes: nodeCount,
      flows: nodeCount - 1,
      workbookBytes: workbook.byteLength,
      interactionProbeParses: REQUIRED_WORKER_INTERACTIONS.length,
      interactionProbeElapsedMs: Number(interactionProbeElapsedMs.toFixed(3)),
      timedPreviewParseOrdinal: REQUIRED_WORKER_INTERACTIONS.length,
      workerUiRoundTripMs: Number(workerUiRoundTripMs.toFixed(3)),
      reviewToReadyMs: Number(reviewToReadyMs.toFixed(3)),
      totalPreviewMs: Number(totalPreviewMs.toFixed(3)),
      limitMs,
      heartbeatLimitMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
      heartbeat: {
        overall: overallHeartbeat,
        parse: parseHeartbeat,
        review: reviewHeartbeat
      },
      interactions,
      interactionGate,
      spreadsheetWorkers,
      withinSingleRunLimits:
        totalPreviewMs <= limitMs &&
        parseHeartbeat.maxGapMs <= MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS &&
        parseHeartbeat.samples > 0 &&
        reviewHeartbeat.samples > 0 &&
        spreadsheetWorkers >= 1 &&
        interactionGate.passed
    }
  } catch (error) {
    const interactionGate = evaluateWorkerInteractionGate([], MAX_WORKER_INTERACTION_LATENCY_MS)
    return {
      name,
      trial,
      nodes: nodeCount,
      flows: nodeCount - 1,
      workbookBytes: workbook.byteLength,
      interactionProbeParses: 0,
      interactionProbeElapsedMs: 0,
      timedPreviewParseOrdinal: 0,
      workerUiRoundTripMs: 0,
      reviewToReadyMs: 0,
      totalPreviewMs: 0,
      limitMs,
      heartbeatLimitMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
      heartbeat: {
        overall: { maxGapMs: 0, p95GapMs: 0, samples: 0 },
        parse: { maxGapMs: 0, p95GapMs: 0, samples: 0 },
        review: { maxGapMs: 0, p95GapMs: 0, samples: 0 }
      },
      interactions: [],
      interactionGate,
      spreadsheetWorkers: 0,
      withinSingleRunLimits: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await context.close()
  }
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

function aggregateGate(
  name: BrowserMeasurement['name'],
  measurements: readonly BrowserMeasurement[]
): BrowserGate {
  const matching = measurements.filter((measurement) => measurement.name === name)
  const nodes = matching[0]?.nodes ?? 0
  const medianTotalPreviewMs = median(matching.map((measurement) => measurement.totalPreviewMs))
  const medianMaxParseHeartbeatGapMs = median(
    matching.map((measurement) => measurement.heartbeat.parse.maxGapMs)
  )
  const structurallyComplete =
    matching.length === PERFORMANCE_TRIALS &&
    matching.every(
      (measurement) =>
        !measurement.error &&
        measurement.spreadsheetWorkers >= 1 &&
        measurement.heartbeat.parse.samples > 0 &&
        measurement.heartbeat.review.samples > 0 &&
        measurement.interactionGate.complete &&
        measurement.interactionGate.passed
    )
  const interactionCoverageComplete = matching.every(
    (measurement) => measurement.interactionGate.complete
  )
  return {
    name,
    nodes,
    trials: matching.length,
    medianTotalPreviewMs,
    totalPreviewLimitMs: LIMITS_MS[name],
    medianMaxParseHeartbeatGapMs,
    parseHeartbeatLimitMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
    interactionLatencyLimitMs: MAX_WORKER_INTERACTION_LATENCY_MS,
    interactionCoverageComplete,
    passed:
      structurallyComplete &&
      medianTotalPreviewMs <= LIMITS_MS[name] &&
      medianMaxParseHeartbeatGapMs <= MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS
  }
}

const outputPath = resolve(performanceArgumentValue('output') ?? 'performance-browser-results.json')
const artifactPath = resolve(performanceArgumentValue('artifact') ?? 'dist/index.html')
const artifactBytesBefore = readFileSync(artifactPath)
const artifactSha256 = createHash('sha256').update(artifactBytesBefore).digest('hex')
const source = collectPerformanceSourceBinding(expectedPerformanceCandidateSha())
const hardwareProfile = evaluatePerformanceHardwareProfile(
  selectedPerformanceHardwareProfile(),
  observePerformanceRuntime()
)
const measurements: BrowserMeasurement[] = []
let browserVersion = 'unavailable'
let browserUserAgent = 'unavailable'
let launchError: string | undefined
let browser: Browser | undefined

try {
  browser = await chromium.launch({ headless: true })
  browserVersion = browser.version()
  const metadataPage = await browser.newPage()
  browserUserAgent = await metadataPage.evaluate(() => navigator.userAgent)
  await metadataPage.close()
  for (const nodeCount of [500, 1_000]) {
    for (let trial = 1; trial <= PERFORMANCE_TRIALS; trial += 1) {
      measurements.push(await measureBrowserPreview(browser, nodeCount, trial, artifactPath))
    }
  }
} catch (error) {
  launchError = error instanceof Error ? error.message : String(error)
} finally {
  await browser?.close()
}

const gates = [
  aggregateGate('spreadsheetWorkerPreviewNodes500', measurements),
  aggregateGate('spreadsheetWorkerPreviewNodes1000', measurements)
]
const artifactBytesAfter = readFileSync(artifactPath)
const artifactIntegrity = {
  path: artifactPath,
  sizeBytes: artifactBytesBefore.byteLength,
  sha256: artifactSha256,
  unchangedDuringGate:
    artifactBytesAfter.byteLength === artifactBytesBefore.byteLength &&
    createHash('sha256').update(artifactBytesAfter).digest('hex') === artifactSha256
}
const functionalPassed =
  launchError === undefined &&
  measurements.length === PERFORMANCE_TRIALS * 2 &&
  gates.every((gate) => gate.passed) &&
  artifactIntegrity.unchangedDuringGate
const measuredPassed = functionalPassed && hardwareProfile.matched
const releaseEvidenceEligible =
  measuredPassed && hardwareProfile.referenceEligible && source.releaseEligible
const releaseEvidenceRequired = process.argv.slice(2).includes('--require-release-evidence')
const passed = measuredPassed && (!releaseEvidenceRequired || releaseEvidenceEligible)
const evidence = {
  schemaVersion: 2,
  gate: 'orbitpm-lite-browser-worker-performance',
  createdAt: new Date().toISOString(),
  source,
  hardwareProfile,
  artifact: artifactIntegrity,
  browser: {
    name: 'chromium',
    version: browserVersion,
    userAgent: browserUserAgent
  },
  limitsMs: LIMITS_MS,
  performanceTrials: PERFORMANCE_TRIALS,
  medianMaxParseHeartbeatGapMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
  maximumWorkerInteractionLatencyMs: MAX_WORKER_INTERACTION_LATENCY_MS,
  measurements,
  gates,
  launchError,
  functionalPassed,
  releaseEvidenceRequired,
  passed,
  releaseEvidenceEligible
}

mkdirSync(dirname(outputPath), { recursive: true })
const temporaryOutputPath = `${outputPath}.tmp-${process.pid}`
writeFileSync(temporaryOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx'
})
renameSync(temporaryOutputPath, outputPath)

for (const measurement of measurements) {
  const state = measurement.withinSingleRunLimits ? 'within' : 'outside'
  console.log(
    `SAMPLE ${measurement.name} trial ${measurement.trial}: ` +
      `${measurement.totalPreviewMs.toFixed(3)} ms; parse heartbeat p95/max ` +
      `${measurement.heartbeat.parse.p95GapMs.toFixed(3)}/` +
      `${measurement.heartbeat.parse.maxGapMs.toFixed(3)} ms ` +
      `(${state} single-run limits; ${measurement.spreadsheetWorkers} worker(s); ` +
      `${measurement.interactions.length} trusted interaction receipt(s))`
  )
  if (measurement.error) console.error(measurement.error)
}
for (const gate of gates) {
  const state = gate.passed ? 'PASS' : 'FAIL'
  console.log(
    `${state} ${gate.name}: median ${gate.medianTotalPreviewMs.toFixed(3)}/` +
      `${gate.totalPreviewLimitMs} ms; median max parse heartbeat ` +
      `${gate.medianMaxParseHeartbeatGapMs.toFixed(3)}/` +
      `${gate.parseHeartbeatLimitMs} ms; real interactions=` +
      `${gate.interactionCoverageComplete ? 'complete' : 'incomplete'} (${gate.trials} trials)`
  )
}
console.log(
  `Hardware profile ${hardwareProfile.id}: ` +
    `${hardwareProfile.matched ? 'matched' : `mismatch (${hardwareProfile.mismatches.join('; ')})`}; ` +
    `release-reference=${hardwareProfile.referenceEligible ? 'eligible' : 'ineligible'}`
)
if (!evidence.passed) {
  if (launchError) console.error(launchError)
  console.error('Browser spreadsheet performance release gate failed.')
  process.exitCode = 1
} else {
  console.log(
    `Browser spreadsheet performance gate passed; release evidence is ${
      releaseEvidenceEligible ? 'eligible' : 'development-only'
    }.`
  )
}
