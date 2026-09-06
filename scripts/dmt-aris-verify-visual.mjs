/**
 * Cold-open visual gate for DMT supportive-blocks convention AML.
 *
 * The gate deliberately does NOT click "Clean Layout". It reads the persisted
 * source geometry from the rendered diagram, checks the convention, then uses
 * "Zoom Fit" only to frame the PNG written beside each AML file.
 *
 * Run: node_modules/.bin/vite-node scripts/dmt-aris-verify-visual.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { parseCanonicalProcess } from '../src/aris/canonical/contract'
import { computeDefaults, computeSuppressedSatelliteDraftIds } from '../src/aris/canonical/defaults'

const TOOL = 'file:///home/ahmed/Desktop/simulated%20processes/OrbitPM-ARIS-Studio-Lite.html'
const DIR = '/home/ahmed/Desktop/simulated processes/epc-samples-bpmntool'
const DEFAULT_TARGETS = [
  `${DIR}/dmt-cor-0662-dmt.declared.aml`,
  `${DIR}/dmt-cor-0662-dmt.actual.aml`
]

const DEFAULT_KINDS = ['owner', 'system', 'informationObject', 'control']
const LEGEND_ID = /^ObjOcc\.dl:(owner|system|informationObject|control):(.+)$/u
const SATELLITE_ID = /^ObjOcc\.(r|s|io|c):([^@]+)@(.+)$/u
const SATELLITE_PREFIX = /^ObjOcc\.(?:r|s|io|c):/u
const FLOW_SYMBOL = /:OT_(?:FUNC|EVT):/u
const SOURCE_SHAPE_WIDTH = 180
const SATELLITE_GAP = 28
const CLUSTER_DISTANCE_LIMIT = 1.5 * (SOURCE_SHAPE_WIDTH + SATELLITE_GAP)

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function sidecarFor(aml) {
  return aml.replace(/\.aml$/u, '.canonical.json')
}

function pngFor(aml) {
  return aml.replace(/\.aml$/u, '.aris.png')
}

function parseSidecar(aml) {
  const sidecar = sidecarFor(aml)
  if (!existsSync(sidecar)) throw new Error(`missing canonical sidecar: ${sidecar}`)
  const parsed = parseCanonicalProcess(JSON.parse(readFileSync(sidecar, 'utf8')))
  if (!parsed.ok) {
    const issues = parsed.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`invalid canonical sidecar ${sidecar}: ${issues}`)
  }
  return parsed.process
}

function expectedConvention(process) {
  const defaults = computeDefaults(process)
  const legendIds = new Map()
  for (const kind of DEFAULT_KINDS) {
    const entry = defaults[kind]
    if (entry) legendIds.set(kind, `ObjOcc.dl:${kind}:${entry.id}`)
  }
  const suppressedIds = new Set(
    [...computeSuppressedSatelliteDraftIds(process, defaults)].map(
      (logicalId) => `ObjOcc.${logicalId}`
    )
  )
  return { legendIds, suppressedIds }
}

function emptyCheck(details = '') {
  return { failures: [], details }
}

function failedResult(aml, error, consoleErrors = []) {
  const reason = messageOf(error)
  const notEvaluated = [`<file>: not evaluated (${reason})`]
  return {
    aml,
    checks: {
      defaults: { failures: [...notEvaluated], details: '' },
      suppressed: { failures: [...notEvaluated], details: '' },
      proximity: { failures: [...notEvaluated], details: '' },
      console: {
        failures:
          consoleErrors.length > 0
            ? consoleErrors.map((entry) => `<browser>: ${entry}`)
            : [...notEvaluated],
        details: ''
      }
    },
    screenshot: { path: pngFor(aml), area: 0, error: reason }
  }
}

function checkDefaults(snapshot, expected) {
  const check = emptyCheck()
  const flow = snapshot.elements.filter(
    (element) =>
      element.shape &&
      element.id.startsWith('ObjOcc.') &&
      !element.id.startsWith('ObjOcc.dl:') &&
      !SATELLITE_PREFIX.test(element.id) &&
      FLOW_SYMBOL.test(element.symbol ?? '')
  )
  const legends = snapshot.elements.filter(
    (element) => element.shape && element.id.startsWith('ObjOcc.dl:')
  )

  if (flow.length === 0) check.failures.push('<flow-nodes>: no rendered functions/events')

  for (const kind of DEFAULT_KINDS) {
    const expectedId = expected.legendIds.get(kind)
    const ofKind = legends.filter((element) => LEGEND_ID.exec(element.id)?.[1] === kind)
    if (expectedId === undefined) {
      for (const element of ofKind) {
        check.failures.push(`${element.id}: unexpected legend block for non-default kind ${kind}`)
      }
      continue
    }
    const exact = ofKind.filter((element) => element.id === expectedId)
    if (exact.length !== 1) {
      check.failures.push(
        `${expectedId}: expected exactly one rendered legend block, found ${exact.length}`
      )
    }
    for (const element of ofKind) {
      if (element.id !== expectedId) {
        check.failures.push(`${element.id}: expected legend id ${expectedId}`)
      }
    }
  }

  for (const element of legends) {
    if (!LEGEND_ID.test(element.id)) {
      check.failures.push(`${element.id}: invalid legend id`)
    }
  }

  if (flow.length > 0) {
    const maximumFlowRight = Math.max(...flow.map((element) => element.x + element.width))
    const flowTop = Math.min(...flow.map((element) => element.y))
    const flowBottom = Math.max(...flow.map((element) => element.y + element.height))
    const flowMidpoint = (flowTop + flowBottom) / 2
    for (const legend of legends) {
      if (!(legend.x > maximumFlowRight)) {
        check.failures.push(
          `${legend.id}: left x=${legend.x.toFixed(1)} is not right of flow edge ${maximumFlowRight.toFixed(1)}`
        )
      }
      const centerY = legend.y + legend.height / 2
      if (!(centerY < flowMidpoint)) {
        check.failures.push(
          `${legend.id}: center y=${centerY.toFixed(1)} is not in top band above flow midpoint ${flowMidpoint.toFixed(1)}`
        )
      }
    }
    check.details =
      `${legends.length} legend blocks; ${flow.length} flow nodes; ` +
      `flowRight=${maximumFlowRight.toFixed(1)}; flowMidY=${flowMidpoint.toFixed(1)}`
  } else {
    check.details = `${legends.length} legend blocks; 0 flow nodes`
  }
  return check
}

function checkSuppressed(snapshot, expected) {
  const check = emptyCheck(`${expected.suppressedIds.size} expected suppressed duplicates`)
  for (const id of expected.suppressedIds) {
    if (snapshot.ids.has(id)) check.failures.push(`${id}: rendered suppressed default duplicate`)
  }
  return check
}

function checkSatelliteProximity(snapshot) {
  const check = emptyCheck()
  const satellites = snapshot.elements.filter(
    (element) => element.shape && SATELLITE_ID.test(element.id)
  )
  const connectionIds = snapshot.elements
    .filter((element) => element.connection)
    .map((element) => element.id)

  for (const satellite of satellites) {
    const match = SATELLITE_ID.exec(satellite.id)
    if (!match) continue
    const ownerNodeId = match[3]
    const ownerId = `ObjOcc.n:${ownerNodeId}`
    const owner = snapshot.ids.get(ownerId)
    if (!owner || !owner.shape) {
      check.failures.push(`${satellite.id}: owning function ${ownerId} is absent`)
      continue
    }
    if (!/:OT_FUNC:/u.test(owner.symbol ?? '')) {
      check.failures.push(`${satellite.id}: encoded owner ${ownerId} is not a function`)
      continue
    }

    const satelliteLogicalId = satellite.id.slice('ObjOcc.'.length)
    const ownerLogicalId = ownerId.slice('ObjOcc.'.length)
    const forwardId = `CxnOcc.re:${satelliteLogicalId}:${ownerLogicalId}`
    const reverseId = `CxnOcc.re:${ownerLogicalId}:${satelliteLogicalId}`
    const incident = connectionIds.filter(
      (id) =>
        id.startsWith(`CxnOcc.re:${satelliteLogicalId}:`) || id.endsWith(`:${satelliteLogicalId}`)
    )
    if (incident.length === 0) {
      check.failures.push(`${satellite.id}: no rendered connection reaches ${ownerId}`)
    }
    const wrongOwners = incident.filter((id) => id !== forwardId && id !== reverseId)
    if (wrongOwners.length > 0) {
      check.failures.push(
        `${satellite.id}: connection fan-out outside ${ownerId} (${wrongOwners.join(', ')})`
      )
    }

    const dx = satellite.x + satellite.width / 2 - (owner.x + owner.width / 2)
    const dy = satellite.y + satellite.height / 2 - (owner.y + owner.height / 2)
    const distance = Math.hypot(dx, dy)
    if (!(distance < CLUSTER_DISTANCE_LIMIT)) {
      check.failures.push(
        `${satellite.id}: center distance ${distance.toFixed(1)} from ${ownerId} exceeds ${CLUSTER_DISTANCE_LIMIT.toFixed(1)}`
      )
    }
  }

  check.details = `${satellites.length} satellites; threshold=${CLUSTER_DISTANCE_LIMIT.toFixed(1)} diagram units`
  return check
}

async function readRenderedElements(page) {
  const elements = await page.evaluate(() => {
    const numberAttribute = (element, name) => {
      const raw = element?.getAttribute(name)
      const value = raw === null || raw === undefined ? Number.NaN : Number(raw)
      return Number.isFinite(value) ? value : Number.NaN
    }
    return [...globalThis.document.querySelectorAll('g.djs-element[data-element-id]')].map(
      (element) => {
        const id = element.getAttribute('data-element-id') ?? ''
        const classes = element.getAttribute('class') ?? ''
        const shape = classes.includes('djs-shape')
        const connection = classes.includes('djs-connection')
        const transform = element.transform?.baseVal?.consolidate()?.matrix
        const hit = element.querySelector('.djs-hit')
        const fallback = element.getBBox()
        const width = numberAttribute(hit, 'width')
        const height = numberAttribute(hit, 'height')
        const symbolHost = element.querySelector('[data-aris-symbol]')
        return {
          id,
          shape,
          connection,
          symbol: symbolHost?.getAttribute('data-aris-symbol') ?? null,
          x: (transform?.e ?? 0) + fallback.x,
          y: (transform?.f ?? 0) + fallback.y,
          width: Number.isFinite(width) ? width : fallback.width,
          height: Number.isFinite(height) ? height : fallback.height
        }
      }
    )
  })
  return { elements, ids: new Map(elements.map((element) => [element.id, element])) }
}

async function screenshotBiggestSvg(page, path) {
  const svgs = await page.$$('svg')
  let biggest = null
  let maximumArea = 0
  for (const svg of svgs) {
    const box = await svg.boundingBox()
    const area = box ? box.width * box.height : 0
    if (area > maximumArea) {
      biggest = svg
      maximumArea = area
    }
  }
  if (!biggest) throw new Error('no visible SVG available for screenshot')
  await biggest.screenshot({ path })
  return maximumArea
}

async function verifyAml(browser, aml) {
  const consoleErrors = []
  if (!existsSync(aml)) return failedResult(aml, new Error(`missing AML file: ${aml}`))

  let process
  let expected
  try {
    process = parseSidecar(aml)
    expected = expectedConvention(process)
  } catch (error) {
    return failedResult(aml, error)
  }

  const page = await browser.newPage({
    viewport: { width: 1700, height: 1200 },
    deviceScaleFactor: 2
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${messageOf(error)}`))

  try {
    await page.goto(TOOL, { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    await page.setInputFiles('input[type=file]', aml)
    await page.waitForTimeout(3500)
    await page.waitForSelector('g.djs-element[data-element-id]', { timeout: 15_000 })

    // All geometry assertions happen before Zoom Fit. This verifies that the
    // persisted AML opens correctly without an interactive Clean Layout pass.
    const snapshot = await readRenderedElements(page)
    const checks = {
      defaults: checkDefaults(snapshot, expected),
      suppressed: checkSuppressed(snapshot, expected),
      proximity: checkSatelliteProximity(snapshot),
      console: emptyCheck()
    }

    const zoomFit = page.getByRole('button', { name: 'Zoom Fit' }).first()
    if (await zoomFit.count()) {
      await zoomFit.click()
      await page.waitForTimeout(1500)
    }

    const outputPath = pngFor(aml)
    let screenshot
    try {
      const area = await screenshotBiggestSvg(page, outputPath)
      screenshot = { path: outputPath, area, error: null }
    } catch (error) {
      screenshot = { path: outputPath, area: 0, error: messageOf(error) }
    }

    checks.console = {
      failures: consoleErrors.map((entry) => `<browser>: ${entry}`),
      details: `${consoleErrors.length} console/page errors`
    }
    return { aml, checks, screenshot }
  } catch (error) {
    return failedResult(aml, error, consoleErrors)
  } finally {
    await page.close()
  }
}

function resultPassed(result) {
  return (
    Object.values(result.checks).every((check) => check.failures.length === 0) &&
    result.screenshot.error === null
  )
}

function printResult(result) {
  const rows = [
    ['DEFAULTS-ONCE-TOP-RIGHT', result.checks.defaults],
    ['SUPPRESSED-ABSENT', result.checks.suppressed],
    ['SATELLITE-OWNER-PROXIMITY/NO-FAN-OUT', result.checks.proximity],
    ['NO-CONSOLE-ERRORS', result.checks.console]
  ]
  console.log(`FILE ${result.aml}`)
  for (const [name, check] of rows) {
    const status = check.failures.length === 0 ? 'PASS' : 'FAIL'
    console.log(`  ${name}: ${status}${check.details ? ` (${check.details})` : ''}`)
    for (const failure of check.failures) console.log(`    - ${failure}`)
  }
  if (result.screenshot.error === null) {
    console.log(
      `  PNG: PASS (${result.screenshot.path}; svgArea=${Math.round(result.screenshot.area)})`
    )
  } else {
    console.log(`  PNG: FAIL (${result.screenshot.path})`)
    console.log(`    - <screenshot>: ${result.screenshot.error}`)
  }
  console.log(`  RESULT: ${resultPassed(result) ? 'PASS' : 'FAIL'}`)
}

async function main() {
  const targets = process.argv.slice(2)
  const amlFiles = targets.length > 0 ? targets : DEFAULT_TARGETS
  let browser
  let results
  try {
    browser = await chromium.launch()
    results = []
    for (const aml of amlFiles) results.push(await verifyAml(browser, aml))
  } catch (error) {
    results = amlFiles.map((aml) => failedResult(aml, error))
  } finally {
    if (browser) await browser.close()
  }

  for (const result of results) printResult(result)
  const exitCode = results.every(resultPassed) ? 0 : 1
  console.log(`PROCESS EXIT CODE: ${exitCode}`)
  process.exitCode = exitCode
}

await main()
