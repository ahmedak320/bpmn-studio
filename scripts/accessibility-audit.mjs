import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import AxeBuilder from '@axe-core/playwright'
import { chromium, firefox, webkit } from '@playwright/test'

const APP_VERSION = '0.4.5'
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const REQUIRED_SURFACES = [
  'landing',
  'editor',
  'details',
  'outline',
  'assistant',
  'import',
  'dialog'
]
const MAX_DIAGNOSTICS = 100
const MAX_VIOLATIONS = 100
const MAX_VIOLATION_NODES = 10
const MAX_EVIDENCE_TEXT = 2_000

/**
 * This is not native browser zoom. Widths are effective CSS reflow viewports
 * and deviceScaleFactor records the matching physical-pixel ratio, so
 * (320 CSS px, 400%) represents the reflow endpoint of a 1280-physical-pixel
 * viewport at 400%. This remains portable across Playwright browser engines.
 */
const VIEWPORTS = [
  { id: 'width-320', name: 'compact-phone', width: 320, height: 720 },
  { id: 'width-375', name: 'phone', width: 375, height: 812 },
  { id: 'width-768', name: 'tablet', width: 768, height: 1024 },
  { id: 'width-1280', name: 'desktop', width: 1280, height: 800 }
]
const ZOOMS = [
  { id: 'zoom-100', percent: 100, factor: 1 },
  { id: 'zoom-200', percent: 200, factor: 2 },
  { id: 'zoom-400', percent: 400, factor: 4 }
]
const COLOR_SCHEMES = [
  { id: 'color-light', value: 'light' },
  { id: 'color-dark', value: 'dark' }
]
const MOTIONS = [
  { id: 'motion-normal', value: 'no-preference', reduced: false },
  { id: 'motion-reduced', value: 'reduce', reduced: true }
]
const LANGUAGES = [
  { id: 'language-en', value: 'en', locale: 'en-US', direction: 'ltr' },
  { id: 'language-ar', value: 'ar', locale: 'ar-AE', direction: 'rtl' }
]

const DIMENSIONS = [
  { name: 'viewportWidth', values: VIEWPORTS },
  { name: 'zoom', values: ZOOMS },
  { name: 'colorScheme', values: COLOR_SCHEMES },
  { name: 'reducedMotion', values: MOTIONS },
  { name: 'language', values: LANGUAGES }
]

const LABELS = {
  en: {
    blank: 'New blank diagram',
    settings: '⚙ Settings',
    settingsDialog: 'Settings — AI keys',
    close: 'Close',
    details: 'Details',
    assistantOpen: 'Ask the process assistant',
    assistantTitle: 'Process assistant',
    assistantClose: 'Close assistant',
    sidebar: 'Toggle side panel',
    ai: '✨ Generate with AI',
    spreadsheetTab: 'Excel / CSV',
    spreadsheetTitle: 'Import Excel or CSV',
    outline: /Process outline|Outline/i,
    outlineClose: 'Close process outline'
  },
  ar: {
    blank: 'مخطط فارغ جديد',
    settings: '⚙ الإعدادات',
    settingsDialog: 'الإعدادات — مفاتيح الذكاء الاصطناعي',
    close: 'إغلاق',
    details: 'التفاصيل',
    assistantOpen: 'اسأل مساعد العمليات',
    assistantTitle: 'مساعد العمليات',
    assistantClose: 'إغلاق المساعد',
    sidebar: 'إظهار/إخفاء اللوحة الجانبية',
    ai: '✨ إنشاء بالذكاء الاصطناعي',
    spreadsheetTab: 'Excel / CSV',
    spreadsheetTitle: 'استيراد Excel أو CSV',
    outline: /مخطط العملية|المخطط التفصيلي|هيكل العملية/,
    outlineClose: 'إغلاق المخطط التفصيلي للعملية'
  }
}

function argumentValue(name) {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
}

const browserName = argumentValue('browser') ?? 'chromium'
const profile = process.argv.includes('--smoke') ? 'smoke' : (argumentValue('profile') ?? 'full')
const outputPath = resolve(argumentValue('output') ?? `accessibility-results-${browserName}.json`)
const artifactPath = resolve(argumentValue('artifact') ?? 'dist/index.html')
const browsers = { chromium, firefox, webkit }
const browserType = browsers[browserName]

if (!browserType) throw new Error(`Unsupported browser: ${browserName}`)
if (!['full', 'smoke'].includes(profile)) {
  throw new Error(`Unsupported accessibility profile: ${profile}`)
}
if (outputPath === artifactPath) {
  throw new Error('Accessibility evidence output must not overwrite the audited artifact.')
}

const artifactBytes = readFileSync(artifactPath)
const artifactText = artifactBytes.toString('utf8')
const artifactStats = statSync(artifactPath)
const artifactSourceUrl = pathToFileURL(artifactPath).toString()
const artifactSnapshotDirectory = mkdtempSync(join(tmpdir(), 'orbitpm-a11y-'))
process.once('exit', () => {
  try {
    rmSync(artifactSnapshotDirectory, { recursive: true, force: true })
  } catch {
    // Process exit must preserve the audit result even if temp cleanup is unavailable.
  }
})
const artifactSnapshotPath = join(artifactSnapshotDirectory, 'index.html')
writeFileSync(artifactSnapshotPath, artifactBytes, { mode: 0o600 })
const artifactUrl = pathToFileURL(artifactSnapshotPath).toString()
const artifact = {
  path: artifactPath,
  sourceUrl: artifactSourceUrl,
  sizeBytes: artifactBytes.length,
  sha256: createHash('sha256').update(artifactBytes).digest('hex'),
  modifiedAtMs: artifactStats.mtimeMs,
  executionSnapshot: {
    kind: 'immutable-temporary-copy',
    sizeBytes: artifactBytes.length,
    sha256: createHash('sha256').update(artifactBytes).digest('hex')
  },
  outlineDeclared:
    artifactText.includes('orbitpm-process-outline') || artifactText.includes('Process outline')
}

function cartesianCases() {
  const rows = []
  const visit = (index, current) => {
    if (index === DIMENSIONS.length) {
      rows.push(current)
      return
    }
    const dimension = DIMENSIONS[index]
    for (const value of dimension.values) {
      visit(index + 1, { ...current, [dimension.name]: value })
    }
  }
  visit(0, {})
  return rows
}

function pairTokens(row) {
  const tokens = []
  for (let left = 0; left < DIMENSIONS.length; left += 1) {
    for (let right = left + 1; right < DIMENSIONS.length; right += 1) {
      const leftDimension = DIMENSIONS[left]
      const rightDimension = DIMENSIONS[right]
      tokens.push(
        `${leftDimension.name}=${row[leftDimension.name].id}|` +
          `${rightDimension.name}=${row[rightDimension.name].id}`
      )
    }
  }
  return tokens
}

function valueTokens(row) {
  return DIMENSIONS.map((dimension) => `${dimension.name}=${row[dimension.name].id}`)
}

function greedyCover(candidates, tokenBuilder, expectedTokens) {
  const remaining = [...candidates]
  const uncovered = new Set(expectedTokens)
  const selected = []
  while (uncovered.size > 0) {
    let bestIndex = -1
    let bestScore = -1
    for (let index = 0; index < remaining.length; index += 1) {
      const score = tokenBuilder(remaining[index]).filter((token) => uncovered.has(token)).length
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
      }
    }
    if (bestIndex < 0 || bestScore <= 0) {
      throw new Error(`Could not cover ${uncovered.size} matrix requirements.`)
    }
    const [chosen] = remaining.splice(bestIndex, 1)
    selected.push(chosen)
    for (const token of tokenBuilder(chosen)) uncovered.delete(token)
  }
  return selected
}

function coverageFor(cases, tokenBuilder, expectedTokens) {
  const covered = new Set(cases.flatMap(tokenBuilder))
  const missing = [...expectedTokens].filter((token) => !covered.has(token))
  return {
    expected: expectedTokens.size,
    covered: [...expectedTokens].filter((token) => covered.has(token)).length,
    complete: missing.length === 0,
    missing
  }
}

const cartesian = cartesianCases()
const expectedPairTokens = new Set(cartesian.flatMap(pairTokens))
const pairwiseCases = greedyCover(cartesian, pairTokens, expectedPairTokens)
const expectedValueTokens = new Set(cartesian.flatMap(valueTokens))
const smokeCases = greedyCover(pairwiseCases, valueTokens, expectedValueTokens)
const selectedCases = (profile === 'full' ? pairwiseCases : smokeCases).map((row, index) => ({
  ...row,
  id: `case-${String(index + 1).padStart(2, '0')}`
}))
const pairwiseCoverage = coverageFor(selectedCases, pairTokens, expectedPairTokens)
const valueCoverage = coverageFor(selectedCases, valueTokens, expectedValueTokens)
const expectedWidthZoomPairs = new Set(
  cartesian.map((row) => `${row.viewportWidth.id}|${row.zoom.id}`)
)
const coveredWidthZoomPairs = new Set(
  selectedCases.map((row) => `${row.viewportWidth.id}|${row.zoom.id}`)
)
const widthZoomCoverage = {
  expected: expectedWidthZoomPairs.size,
  covered: [...expectedWidthZoomPairs].filter((token) => coveredWidthZoomPairs.has(token)).length,
  complete: [...expectedWidthZoomPairs].every((token) => coveredWidthZoomPairs.has(token)),
  missing: [...expectedWidthZoomPairs].filter((token) => !coveredWidthZoomPairs.has(token))
}

if (profile === 'full' && (!pairwiseCoverage.complete || !widthZoomCoverage.complete)) {
  throw new Error('The generated full accessibility matrix is incomplete.')
}
if (!valueCoverage.complete) {
  throw new Error('The accessibility matrix omits a required dimension value.')
}

function matrixEvidence(matrix) {
  return {
    id: matrix.id,
    effectiveViewport: {
      name: matrix.viewportWidth.name,
      width: matrix.viewportWidth.width,
      height: matrix.viewportWidth.height
    },
    zoom: {
      percent: matrix.zoom.percent,
      factor: matrix.zoom.factor,
      physicalEquivalentWidth: matrix.viewportWidth.width * matrix.zoom.factor,
      physicalEquivalentHeight: matrix.viewportWidth.height * matrix.zoom.factor
    },
    colorScheme: matrix.colorScheme.value,
    reducedMotion: matrix.reducedMotion.value,
    language: matrix.language.value,
    direction: matrix.language.direction,
    locale: matrix.language.locale
  }
}

function errorRecord(error) {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: boundedText(error instanceof Error ? error.message : String(error)),
    ...(error instanceof Error && error.stack ? { stack: boundedText(error.stack) } : {})
  }
}

function boundedText(value, limit = MAX_EVIDENCE_TEXT) {
  const text = String(value)
  return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated ${text.length - limit}]`
}

function summarizeViolations(violations) {
  return violations.slice(0, MAX_VIOLATIONS).map((violation) => ({
    id: boundedText(violation.id, 200),
    impact: violation.impact,
    tags: violation.tags.slice(0, 50).map((tag) => boundedText(tag, 200)),
    description: boundedText(violation.description),
    help: boundedText(violation.help),
    helpUrl: boundedText(violation.helpUrl),
    nodeCount: violation.nodes.length,
    nodesTruncated: Math.max(0, violation.nodes.length - MAX_VIOLATION_NODES),
    nodes: violation.nodes.slice(0, MAX_VIOLATION_NODES).map((node) => ({
      target: node.target.slice(0, 10).map((selector) => boundedText(selector, 500)),
      failureSummary: boundedText(node.failureSummary),
      html: boundedText(node.html)
    }))
  }))
}

function diagnosticsFor(page) {
  const state = {
    pageErrors: [],
    consoleErrors: [],
    unexpectedRequests: [],
    truncated: 0,
    cursors: { pageErrors: 0, consoleErrors: 0, unexpectedRequests: 0 }
  }
  const record = (target, message) => {
    if (target.length < MAX_DIAGNOSTICS) target.push(boundedText(message))
    else state.truncated += 1
  }
  page.on('pageerror', (error) => record(state.pageErrors, error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') record(state.consoleErrors, message.text())
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url === artifactUrl || url.startsWith('data:') || url.startsWith('blob:')) {
      return
    }
    record(state.unexpectedRequests, `${request.method()} ${url}`)
  })
  return {
    consume() {
      const consumed = {
        pageErrors: state.pageErrors.slice(state.cursors.pageErrors),
        consoleErrors: state.consoleErrors.slice(state.cursors.consoleErrors),
        unexpectedRequests: state.unexpectedRequests.slice(state.cursors.unexpectedRequests),
        diagnosticsTruncated: state.truncated
      }
      state.cursors.pageErrors = state.pageErrors.length
      state.cursors.consoleErrors = state.consoleErrors.length
      state.cursors.unexpectedRequests = state.unexpectedRequests.length
      return consumed
    },
    snapshot() {
      return {
        pageErrors: [...state.pageErrors],
        consoleErrors: [...state.consoleErrors],
        unexpectedRequests: [...state.unexpectedRequests],
        diagnosticsTruncated: state.truncated
      }
    }
  }
}

async function environmentEvidence(page, matrix) {
  const actual = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    language: document.documentElement.lang,
    direction: document.documentElement.dir,
    darkScheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }))
  const mismatches = []
  if (actual.innerWidth !== matrix.viewportWidth.width) {
    mismatches.push(`innerWidth ${actual.innerWidth} != ${matrix.viewportWidth.width}`)
  }
  if (Math.abs(actual.devicePixelRatio - matrix.zoom.factor) > 0.1) {
    mismatches.push(`devicePixelRatio ${actual.devicePixelRatio} != ${matrix.zoom.factor}`)
  }
  if (actual.language !== matrix.language.value) {
    mismatches.push(`language ${actual.language} != ${matrix.language.value}`)
  }
  if (actual.direction !== matrix.language.direction) {
    mismatches.push(`direction ${actual.direction} != ${matrix.language.direction}`)
  }
  if (actual.darkScheme !== (matrix.colorScheme.value === 'dark')) {
    mismatches.push('color-scheme media query did not match')
  }
  if (actual.reducedMotion !== matrix.reducedMotion.reduced) {
    mismatches.push('reduced-motion media query did not match')
  }
  return {
    expected: matrixEvidence(matrix),
    actual,
    passed: mismatches.length === 0,
    mismatches
  }
}

async function firstVisible(locator) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function surfaceGeometry(target) {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: Number(rect.left.toFixed(2)),
      right: Number(rect.right.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      bottom: Number(rect.bottom.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clippedHorizontally: rect.left < -1 || rect.right > window.innerWidth + 1,
      contentOverflowsHorizontally: element.scrollWidth > element.clientWidth + 1
    }
  })
}

async function scanSurface({
  page,
  matrix,
  surface,
  target,
  required,
  diagnostics,
  environment,
  navigation
}) {
  await target.scrollIntoViewIfNeeded().catch(() => undefined)
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  const [layout, geometry] = await Promise.all([
    page.evaluate(() => {
      const root = document.documentElement
      return {
        documentClientWidth: root.clientWidth,
        documentScrollWidth: root.scrollWidth,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1
      }
    }),
    surfaceGeometry(target)
  ])
  const diagnosticDelta = diagnostics.consume()
  const violations = summarizeViolations(axe.violations)
  const failureReasons = []
  if (violations.length > 0) {
    failureReasons.push(`${violations.length} axe violation(s)`)
  }
  if (layout.horizontalOverflow) {
    failureReasons.push('document horizontal overflow')
  }
  if (geometry.clippedHorizontally) {
    failureReasons.push('surface clipped horizontally')
  }
  if (!environment.passed) {
    failureReasons.push(...environment.mismatches)
  }
  if (diagnosticDelta.pageErrors.length > 0) {
    failureReasons.push(`${diagnosticDelta.pageErrors.length} page error(s)`)
  }
  if (diagnosticDelta.consoleErrors.length > 0) {
    failureReasons.push(`${diagnosticDelta.consoleErrors.length} console error(s)`)
  }
  if (diagnosticDelta.unexpectedRequests.length > 0) {
    failureReasons.push(`${diagnosticDelta.unexpectedRequests.length} unexpected request(s)`)
  }
  return {
    browser: browserName,
    matrixCaseId: matrix.id,
    dimensions: matrixEvidence(matrix),
    environment,
    surface,
    required,
    scanStatus: 'scanned',
    available: true,
    navigation,
    axeScope: 'full-document-after-surface-navigation',
    failed: failureReasons.length > 0,
    failureReasons,
    violations,
    layout,
    surfaceGeometry: geometry,
    diagnostics: diagnosticDelta
  }
}

function unavailableSurface({ matrix, surface, required, reason, diagnostics, environment }) {
  return {
    browser: browserName,
    matrixCaseId: matrix.id,
    dimensions: matrixEvidence(matrix),
    environment,
    surface,
    required,
    scanStatus: 'unavailable',
    available: false,
    reason,
    failed: required,
    failureReasons: required ? [reason] : [],
    violations: [],
    diagnostics: diagnostics.consume()
  }
}

function failedSurface({ matrix, surface, required, error, diagnostics, environment }) {
  const failure = errorRecord(error)
  return {
    browser: browserName,
    matrixCaseId: matrix.id,
    dimensions: matrixEvidence(matrix),
    environment,
    surface,
    required,
    scanStatus: 'navigation-error',
    available: false,
    failed: true,
    failureReasons: [failure.message],
    error: failure,
    violations: [],
    diagnostics: diagnostics.consume()
  }
}

async function runMatrixCase(browser, matrix, reports) {
  const context = await browser.newContext({
    colorScheme: matrix.colorScheme.value,
    locale: matrix.language.locale,
    reducedMotion: matrix.reducedMotion.value,
    deviceScaleFactor: matrix.zoom.factor,
    viewport: {
      width: matrix.viewportWidth.width,
      height: matrix.viewportWidth.height
    }
  })
  const page = await context.newPage()
  const diagnostics = diagnosticsFor(page)
  const labels = LABELS[matrix.language.value]
  const recordedSurfaces = new Set()
  let caseAbortError = null
  let environment = {
    expected: matrixEvidence(matrix),
    actual: null,
    passed: false,
    mismatches: ['context setup did not complete']
  }
  const append = (entry) => {
    if (REQUIRED_SURFACES.includes(entry.surface)) {
      if (recordedSurfaces.has(entry.surface)) {
        throw new Error(`Duplicate ${entry.surface} evidence for ${matrix.id}.`)
      }
      recordedSurfaces.add(entry.surface)
    }
    reports.push(entry)
    if (entry.failed) {
      console.error(
        `${browserName}/${matrix.id}/${entry.surface}: ${entry.failureReasons.join('; ')}`
      )
      for (const violation of entry.violations ?? []) {
        console.error(
          `- ${violation.id} (${violation.impact ?? 'impact unknown'}): ` +
            `${violation.help} — ${violation.helpUrl}`
        )
      }
    }
  }

  try {
    await page.addInitScript((language) => {
      localStorage.setItem('orbitpm.lite.lang', language)
      localStorage.setItem('orbitpm.lite.preferences.v1.details.open', 'false')
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: undefined
      })
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: undefined
      })
    }, matrix.language.value)
    await page.goto(artifactUrl, { waitUntil: 'load', timeout: 30_000 })
    await page
      .getByRole('heading', { name: 'OrbitPM Process Studio Lite' })
      .waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForFunction(
      ({ language, direction }) =>
        document.documentElement.lang === language && document.documentElement.dir === direction,
      {
        language: matrix.language.value,
        direction: matrix.language.direction
      }
    )
    environment = await environmentEvidence(page, matrix)

    try {
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'landing',
          target: page.locator('body'),
          required: true,
          diagnostics,
          environment,
          navigation: 'initial self-contained landing screen'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'landing',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    }

    try {
      await page.getByRole('button', { name: labels.blank, exact: true }).click()
      await page
        .locator('.djs-container svg')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'editor',
          target: page.locator('.orbitpm-editor'),
          required: true,
          diagnostics,
          environment,
          navigation: 'landing → New blank diagram'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'editor',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    }

    let settingsDialog = null
    try {
      await page.getByRole('button', { name: labels.settings, exact: true }).click()
      settingsDialog = page.getByRole('dialog', {
        name: labels.settingsDialog,
        exact: true
      })
      await settingsDialog.waitFor({ state: 'visible', timeout: 10_000 })
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'dialog',
          target: settingsDialog,
          required: true,
          diagnostics,
          environment,
          navigation: 'editor header → Settings dialog'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'dialog',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    } finally {
      if (settingsDialog && (await settingsDialog.isVisible().catch(() => false))) {
        await settingsDialog
          .getByRole('button', { name: labels.close, exact: true })
          .first()
          .click()
          .catch(() => undefined)
        if (await settingsDialog.isVisible().catch(() => false)) {
          await page.keyboard.press('Escape').catch(() => undefined)
        }
        await settingsDialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
      }
    }

    let detailsControl = null
    try {
      detailsControl = page.getByRole('button', {
        name: labels.details,
        exact: true
      })
      if ((await detailsControl.getAttribute('aria-expanded')) !== 'true') {
        await detailsControl.click()
      }
      const detailsId = await detailsControl.getAttribute('aria-controls')
      if (!detailsId) throw new Error('Details toggle has no aria-controls.')
      const details = page.locator(`[id="${detailsId}"]`)
      await details.waitFor({ state: 'visible', timeout: 10_000 })
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'details',
          target: details,
          required: true,
          diagnostics,
          environment,
          navigation: 'editor rail → Details pane'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'details',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    }

    if (
      detailsControl &&
      (await detailsControl.getAttribute('aria-expanded').catch(() => null)) === 'true'
    ) {
      await detailsControl.press('Enter').catch(() => undefined)
    }

    let outlineControl = null
    try {
      let outline = await firstVisible(page.locator('.orbitpm-process-outline'))
      outlineControl = await firstVisible(page.getByRole('button', { name: labels.outline }))
      if (!outline) {
        if (outlineControl) {
          await outlineControl.press('Enter', { timeout: 10_000 })
          const outlineId = await outlineControl.getAttribute('aria-controls')
          const controlledOutline = outlineId ? page.locator(`[id="${outlineId}"]`) : null
          if (controlledOutline) {
            await controlledOutline.waitFor({ state: 'visible', timeout: 10_000 })
            outline = controlledOutline
          } else {
            outline = await firstVisible(page.locator('.orbitpm-process-outline'))
          }
        }
      }
      if (!outline) {
        append(
          unavailableSurface({
            matrix,
            surface: 'outline',
            required: artifact.outlineDeclared,
            reason: artifact.outlineDeclared
              ? 'Candidate declares a process outline, but no reachable outline surface was visible.'
              : 'This candidate does not declare a reachable process-outline surface.',
            diagnostics,
            environment
          })
        )
      } else {
        append(
          await scanSurface({
            page,
            matrix,
            surface: 'outline',
            target: outline,
            required: true,
            diagnostics,
            environment,
            navigation: 'visible .orbitpm-process-outline or its accessible toggle'
          })
        )
      }
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'outline',
          required: artifact.outlineDeclared,
          error,
          diagnostics,
          environment
        })
      )
    } finally {
      const outlineClose = await firstVisible(
        page.getByRole('button', { name: labels.outlineClose, exact: true })
      )
      if (outlineClose) {
        await outlineClose.click().catch(() => undefined)
      } else if (
        outlineControl &&
        (await outlineControl.getAttribute('aria-expanded').catch(() => null)) === 'true'
      ) {
        await outlineControl.press('Enter').catch(() => undefined)
      }
      const outlinePane = page.locator('.orbitpm-process-outline-pane')
      if (await outlinePane.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => undefined)
      }
      await outlinePane.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
    }

    let assistant = null
    try {
      await page
        .getByRole('button', {
          name: labels.assistantOpen,
          exact: true
        })
        .click()
      assistant = page.locator(`aside[aria-label="${labels.assistantTitle}"]`)
      await assistant.waitFor({ state: 'visible', timeout: 10_000 })
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'assistant',
          target: assistant,
          required: true,
          diagnostics,
          environment,
          navigation: 'assistant floating action button → assistant drawer'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'assistant',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    } finally {
      if (assistant && (await assistant.isVisible().catch(() => false))) {
        await assistant
          .getByRole('button', {
            name: labels.assistantClose,
            exact: true
          })
          .click()
          .catch(() => undefined)
        if (await assistant.isVisible().catch(() => false)) {
          await page.keyboard.press('Escape').catch(() => undefined)
        }
        await assistant.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
      }
    }

    try {
      const sidebarToggle = page.getByRole('button', {
        name: labels.sidebar,
        exact: true
      })
      if ((await sidebarToggle.getAttribute('aria-expanded')) !== 'true') {
        await sidebarToggle.click()
      }
      const aiToggle = page.getByRole('button', {
        name: labels.ai,
        exact: true
      })
      await aiToggle.waitFor({ state: 'visible', timeout: 10_000 })
      await aiToggle.scrollIntoViewIfNeeded()
      if ((await aiToggle.getAttribute('aria-expanded')) !== 'true') {
        await aiToggle.click()
      }
      const spreadsheetTab = page.getByRole('tab', {
        name: labels.spreadsheetTab,
        exact: true
      })
      await spreadsheetTab.waitFor({ state: 'visible', timeout: 10_000 })
      await spreadsheetTab.click()
      const importSurface = page.locator('section[aria-labelledby="spreadsheet-import-title"]')
      await importSurface.waitFor({ state: 'visible', timeout: 10_000 })
      await page
        .getByRole('heading', {
          name: labels.spreadsheetTitle,
          exact: true
        })
        .waitFor({ state: 'visible', timeout: 10_000 })
      append(
        await scanSurface({
          page,
          matrix,
          surface: 'import',
          target: importSurface,
          required: true,
          diagnostics,
          environment,
          navigation: 'side-panel rail → AI section → Excel / CSV import tab'
        })
      )
    } catch (error) {
      append(
        failedSurface({
          matrix,
          surface: 'import',
          required: true,
          error,
          diagnostics,
          environment
        })
      )
    }
  } catch (error) {
    caseAbortError = error
  } finally {
    for (const surface of REQUIRED_SURFACES) {
      if (recordedSurfaces.has(surface)) continue
      append(
        failedSurface({
          matrix,
          surface,
          required: true,
          error:
            caseAbortError ??
            new Error(
              `The ${surface} surface was not audited because the matrix case ended early.`
            ),
          diagnostics,
          environment
        })
      )
    }
    await context.close()
  }
}

function writeEvidenceAtomic(path, evidence) {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  renameSync(temporaryPath, path)
}

function artifactIntegrityEvidence() {
  try {
    const completedBytes = readFileSync(artifactPath)
    const completedStats = statSync(artifactPath)
    const completedSha256 = createHash('sha256').update(completedBytes).digest('hex')
    const passed =
      completedBytes.length === artifact.sizeBytes && completedSha256 === artifact.sha256
    return {
      passed,
      sourceUnchangedDuringAudit: passed,
      completedSizeBytes: completedBytes.length,
      completedSha256,
      completedModifiedAtMs: completedStats.mtimeMs,
      failureReason: passed
        ? null
        : 'The source artifact changed after the immutable audit snapshot was created.'
    }
  } catch (error) {
    return {
      passed: false,
      sourceUnchangedDuringAudit: false,
      completedSizeBytes: null,
      completedSha256: null,
      completedModifiedAtMs: null,
      failureReason: 'The source artifact could not be read after the accessibility audit.',
      error: errorRecord(error)
    }
  }
}

const reports = []
let fatalError = null
let browser = null
let browserVersion = null
const startedAt = new Date().toISOString()

try {
  browser = await browserType.launch({ headless: true })
  browserVersion = browser.version()
  for (const matrix of selectedCases) {
    await runMatrixCase(browser, matrix, reports)
    const caseFailures = reports.filter(
      (report) => report.matrixCaseId === matrix.id && report.failed
    ).length
    console.log(
      `${browserName}/${matrix.id}: ${caseFailures === 0 ? 'passed' : `${caseFailures} failure(s)`}`
    )
  }
} catch (error) {
  fatalError = errorRecord(error)
  console.error(`Accessibility audit fatal error: ${fatalError.message}`)
} finally {
  await browser?.close().catch((error) => {
    fatalError ??= errorRecord(error)
  })
}

const failedReports = reports.filter(({ failed }) => failed)
const surfaceCoverage = Object.fromEntries(
  REQUIRED_SURFACES.map((surface) => {
    const entries = reports.filter((report) => report.surface === surface)
    return [
      surface,
      {
        expectedCases: selectedCases.length,
        evidenceEntries: entries.length,
        scanned: entries.filter(({ scanStatus }) => scanStatus === 'scanned').length,
        unavailable: entries.filter(({ scanStatus }) => scanStatus === 'unavailable').length,
        failed: entries.filter(({ failed }) => failed).length
      }
    ]
  })
)
const completedAt = new Date().toISOString()
const artifactIntegrity = artifactIntegrityEvidence()
const failureCount =
  failedReports.length + (fatalError ? 1 : 0) + (artifactIntegrity.passed ? 0 : 1)
const fullCoverageEligible =
  profile === 'full' &&
  pairwiseCoverage.complete &&
  widthZoomCoverage.complete &&
  valueCoverage.complete

const evidence = {
  schemaVersion: 2,
  gate: 'orbitpm-lite-accessibility-matrix',
  appVersion: APP_VERSION,
  status: failureCount === 0 ? 'passed' : 'failed',
  passed: failureCount === 0,
  releaseCoverageEligible: fullCoverageEligible,
  startedAt,
  completedAt,
  artifact: {
    ...artifact,
    integrity: artifactIntegrity
  },
  browser: {
    name: browserName,
    version: browserVersion
  },
  profile,
  matrixStrategy: {
    name: 'deterministic-greedy-pairwise-covering-array',
    description:
      'The full profile covers every pair across width, zoom, color scheme, reduced motion, and language. Because width and zoom are dimensions in the same covering array, all 12 width×zoom combinations are present.',
    zoomEmulation:
      'Portable zoom equivalence, not native browser zoom: each required width is the effective CSS reflow viewport and deviceScaleFactor records the requested physical-pixel ratio and corresponding physical-equivalent dimensions.',
    fullCartesianCases: cartesian.length,
    pairwiseCases: pairwiseCases.length,
    selectedCases: selectedCases.length,
    smokeProfile:
      'Smoke selects a deterministic value-covering subset and is never release-coverage eligible.'
  },
  evidenceContract: {
    atomicWrite: 'same-directory temporary file followed by rename',
    immutableArtifactSnapshot: true,
    axeScope: 'full-document-after-surface-navigation',
    bounds: {
      maximumReports: selectedCases.length * REQUIRED_SURFACES.length,
      maximumDiagnosticsPerTypeAndCase: MAX_DIAGNOSTICS,
      maximumViolationsPerReport: MAX_VIOLATIONS,
      maximumNodesPerViolation: MAX_VIOLATION_NODES,
      maximumStoredTextCharacters: MAX_EVIDENCE_TEXT
    }
  },
  requiredDimensions: {
    effectiveViewportWidths: VIEWPORTS.map(({ width }) => width),
    zoomPercents: ZOOMS.map(({ percent }) => percent),
    colorSchemes: COLOR_SCHEMES.map(({ value }) => value),
    reducedMotion: MOTIONS.map(({ value }) => value),
    languages: LANGUAGES.map(({ value }) => value)
  },
  coverage: {
    pairwise: pairwiseCoverage,
    widthByZoomFullMatrix: widthZoomCoverage,
    allDimensionValues: valueCoverage
  },
  requiredSurfaces: REQUIRED_SURFACES,
  outlineReachabilityPolicy: {
    declaredByCandidate: artifact.outlineDeclared,
    requiredWhenDeclared: true,
    unavailableWhenUndeclaredIsFailure: false
  },
  matrix: selectedCases.map(matrixEvidence),
  matrixCaseCount: selectedCases.length,
  reportCount: reports.length,
  failureCount,
  fatalError,
  surfaceCoverage,
  reports
}

writeEvidenceAtomic(outputPath, evidence)

if (failureCount > 0) {
  if (!artifactIntegrity.passed) {
    console.error(`Artifact integrity: ${artifactIntegrity.failureReason}`)
  }
  console.error(
    `Accessibility matrix failed in ${failureCount} check(s) across ${reports.length} surface reports (${outputPath}).`
  )
  process.exitCode = 1
} else {
  console.log(
    `Accessibility matrix passed ${reports.length} surface reports across ${selectedCases.length} cases (${outputPath}).`
  )
}
