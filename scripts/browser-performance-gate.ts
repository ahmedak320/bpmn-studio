import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Browser, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'

import { CANONICAL_FIELDS_BY_SHEET } from '../src/spreadsheet/aliases'
import { columnNumberToLetters } from '../src/spreadsheet/cellAddress'
import type { CellPrimitive } from '../src/spreadsheet/contracts'
import { createOfficialWorkbookTemplate } from '../src/spreadsheet/template'

const LIMITS_MS = Object.freeze({
  spreadsheetWorkerPreviewNodes500: 3_000,
  spreadsheetWorkerPreviewNodes1000: 10_000
})
const HEARTBEAT_INTERVAL_MS = 16
const PERFORMANCE_TRIALS = 3
const MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS = 250

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
  passed: boolean
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
        name_ar: first ? 'البداية' : last ? 'النهاية' : `مراجعة البند ${index}`
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
  trial: number
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
      const state = { workers: 0 }
      ;(
        window as unknown as {
          __ORBITPM_PERFORMANCE_WORKERS__: typeof state
        }
      ).__ORBITPM_PERFORMANCE_WORKERS__ = state
      const NativeWorker = window.Worker
      const InstrumentedWorker = new Proxy(NativeWorker, {
        construct(target, argumentsList, newTarget) {
          state.workers += 1
          return Reflect.construct(target, argumentsList, newTarget)
        }
      })
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        writable: true,
        value: InstrumentedWorker
      })
    })
    await page.goto(pathToFileURL(resolve('dist/index.html')).toString(), {
      waitUntil: 'load'
    })
    const panel = await openSpreadsheetPanel(page)
    const workersBefore = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ORBITPM_PERFORMANCE_WORKERS__: { workers: number }
          }
        ).__ORBITPM_PERFORMANCE_WORKERS__.workers
    )
    await startHeartbeat(page)
    const uploadStart = await page.evaluate(() => performance.now())
    await panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
      name: `OrbitPM-performance-${nodeCount}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(workbook)
    })
    await panel.getByText(/Official OrbitPM template detected/i).waitFor({
      state: 'visible'
    })
    const parseReady = await page.evaluate(() => performance.now())
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
    return {
      name,
      trial,
      nodes: nodeCount,
      flows: nodeCount - 1,
      workbookBytes: workbook.byteLength,
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
      spreadsheetWorkers,
      withinSingleRunLimits:
        totalPreviewMs <= limitMs &&
        parseHeartbeat.maxGapMs <= MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS &&
        parseHeartbeat.samples > 0 &&
        reviewHeartbeat.samples > 0 &&
        spreadsheetWorkers >= 1
    }
  } catch (error) {
    return {
      name,
      trial,
      nodes: nodeCount,
      flows: nodeCount - 1,
      workbookBytes: workbook.byteLength,
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
        measurement.heartbeat.review.samples > 0
    )
  return {
    name,
    nodes,
    trials: matching.length,
    medianTotalPreviewMs,
    totalPreviewLimitMs: LIMITS_MS[name],
    medianMaxParseHeartbeatGapMs,
    parseHeartbeatLimitMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
    passed:
      structurallyComplete &&
      medianTotalPreviewMs <= LIMITS_MS[name] &&
      medianMaxParseHeartbeatGapMs <= MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS
  }
}

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
const outputPath = resolve(
  outputArgument?.slice('--output='.length) ?? 'performance-browser-results.json'
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
      measurements.push(await measureBrowserPreview(browser, nodeCount, trial))
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
const evidence = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  runner: {
    imageOs: process.env.ImageOS ?? 'local',
    imageVersion: process.env.ImageVersion ?? 'local',
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    hardwareClass: process.env.GITHUB_ACTIONS ? 'github-hosted-variable' : 'local-variable',
    platform: platform(),
    release: release(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length
  },
  browser: {
    name: 'chromium',
    version: browserVersion,
    userAgent: browserUserAgent
  },
  limitsMs: LIMITS_MS,
  performanceTrials: PERFORMANCE_TRIALS,
  medianMaxParseHeartbeatGapMs: MEDIAN_MAX_PARSE_HEARTBEAT_GAP_MS,
  measurements,
  gates,
  launchError,
  passed:
    launchError === undefined &&
    measurements.length === PERFORMANCE_TRIALS * 2 &&
    gates.every((gate) => gate.passed)
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)

for (const measurement of measurements) {
  const state = measurement.withinSingleRunLimits ? 'within' : 'outside'
  console.log(
    `SAMPLE ${measurement.name} trial ${measurement.trial}: ` +
      `${measurement.totalPreviewMs.toFixed(3)} ms; parse heartbeat p95/max ` +
      `${measurement.heartbeat.parse.p95GapMs.toFixed(3)}/` +
      `${measurement.heartbeat.parse.maxGapMs.toFixed(3)} ms ` +
      `(${state} single-run limits; ${measurement.spreadsheetWorkers} worker(s))`
  )
  if (measurement.error) console.error(measurement.error)
}
for (const gate of gates) {
  const state = gate.passed ? 'PASS' : 'FAIL'
  console.log(
    `${state} ${gate.name}: median ${gate.medianTotalPreviewMs.toFixed(3)}/` +
      `${gate.totalPreviewLimitMs} ms; median max parse heartbeat ` +
      `${gate.medianMaxParseHeartbeatGapMs.toFixed(3)}/` +
      `${gate.parseHeartbeatLimitMs} ms (${gate.trials} trials)`
  )
}
if (!evidence.passed) {
  if (launchError) console.error(launchError)
  console.error('Browser spreadsheet performance release gate failed.')
  process.exitCode = 1
}
