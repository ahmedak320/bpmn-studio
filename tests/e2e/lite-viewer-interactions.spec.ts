import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Viewer-surface interactions added by the UI-interactions wave: selecting an
// activity paints all and only its connected edges in an upper SVG layer,
// routing changes repaint that layer, invalid/click-away selections clear it,
// and the canvas legend + semantic tooltips are directly usable.
//
// This intentionally drives the BUILT single-file app through its public
// automation hook, matching the other lite e2e specs. Do not run this source
// against Vite dev mode: file:// fallback behavior is part of the fixture.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

const HIGHLIGHT_LAYER = 'g.layer-orbitpm-connected-edge-highlights'
const HIGHLIGHT = '[data-org-connected-edge-highlight="true"]'

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
})

interface HookWindow {
  __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
}

async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function newProcess(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /New process/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const hook = (window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } })
      .__ORBITPM_LITE__
    return !!hook?.modeler
  })
}

async function createShape(
  page: Page,
  type: string,
  position: { x: number; y: number },
  extra?: Record<string, unknown>
): Promise<string> {
  return page.evaluate(
    ({ type, position, extra }) => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      const modeling = modeler.get('modeling') as {
        createShape(shape: unknown, at: { x: number; y: number }, parent: unknown): { id: string }
      }
      const elementFactory = modeler.get('elementFactory') as {
        createShape(attrs: Record<string, unknown>): unknown
      }
      const canvas = modeler.get('canvas') as {
        getRootElement(): unknown
        zoom(mode: 'fit-viewport'): void
      }
      const shape = elementFactory.createShape({ type, ...(extra ?? {}) })
      const placed = modeling.createShape(shape, position, canvas.getRootElement())
      canvas.zoom('fit-viewport')
      return placed.id
    },
    { type, position, extra }
  )
}

async function createRoutedConnection(
  page: Page,
  sourceId: string,
  targetId: string,
  waypoints: Array<{ x: number; y: number }>
): Promise<string> {
  return page.evaluate(
    ({ sourceId, targetId, waypoints }) => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const modeling = modeler.get('modeling') as {
        connect(
          source: unknown,
          target: unknown,
          attrs: { type: 'bpmn:SequenceFlow' }
        ): { id: string }
        updateWaypoints(connection: unknown, nextWaypoints: Array<{ x: number; y: number }>): void
      }
      const connection = modeling.connect(registry.get(sourceId), registry.get(targetId), {
        type: 'bpmn:SequenceFlow'
      })
      modeling.updateWaypoints(connection, waypoints)
      return connection.id
    },
    { sourceId, targetId, waypoints }
  )
}

async function rerouteConnection(
  page: Page,
  connectionId: string,
  waypoints: Array<{ x: number; y: number }>
): Promise<void> {
  await page.evaluate(
    ({ connectionId, waypoints }) => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const modeling = modeler.get('modeling') as {
        updateWaypoints(connection: unknown, nextWaypoints: Array<{ x: number; y: number }>): void
      }
      modeling.updateWaypoints(registry.get(connectionId), waypoints)
    },
    { connectionId, waypoints }
  )
}

async function updateOrgProperties(
  page: Page,
  elementId: string,
  properties: Record<string, unknown>
): Promise<void> {
  await page.evaluate(
    ({ elementId, properties }) => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const modeling = modeler.get('modeling') as {
        updateProperties(element: unknown, next: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(elementId), properties)
    },
    { elementId, properties }
  )
}

function shapeHit(page: Page, elementId: string): Locator {
  return page.locator(`.djs-element[data-element-id="${elementId}"] .djs-hit`).first()
}

async function highlightedEdgeIds(page: Page): Promise<string[]> {
  return page.locator(`${HIGHLIGHT_LAYER} > ${HIGHLIGHT}`).evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('data-edge-id') ?? '')
      .filter(Boolean)
      .sort()
  )
}

async function clickCanvasBackground(page: Page): Promise<void> {
  const point = await page.locator('.djs-container').evaluate((container) => {
    const canvasSvg = container.querySelector(':scope > svg')
    if (!(canvasSvg instanceof SVGSVGElement)) {
      throw new Error('main bpmn-js SVG not found')
    }
    const bounds = canvasSvg.getBoundingClientRect()
    const candidates: Array<[number, number]> = []
    for (const yRatio of [0.92, 0.08, 0.8, 0.2, 0.65, 0.35, 0.5]) {
      for (const xRatio of [0.5, 0.75, 0.25, 0.9, 0.1, 0.65, 0.35]) {
        candidates.push([xRatio, yRatio])
      }
    }
    for (const [xRatio, yRatio] of candidates) {
      const x = bounds.left + bounds.width * xRatio
      const y = bounds.top + bounds.height * yRatio
      const target = document.elementFromPoint(x, y)
      if (
        target instanceof Element &&
        target.closest('svg') === canvasSvg &&
        !target.closest('.djs-element')
      ) {
        return { x, y }
      }
    }
    throw new Error('no unobstructed canvas-background point found')
  })
  await page.mouse.click(point.x, point.y)
}

async function expectDelegatedTooltip(page: Page, anchor: Locator): Promise<void> {
  const copy = await anchor.getAttribute('data-org-tooltip')
  expect(copy, 'semantic decoration should carry localized tooltip copy').toBeTruthy()
  const bounds = await anchor.boundingBox()
  expect(bounds, 'semantic decoration should have visible SVG bounds').not.toBeNull()
  await page.mouse.move(1, 1)
  await page.mouse.move(
    (bounds as { x: number; width: number }).x + (bounds as { width: number }).width / 2,
    (bounds as { y: number; height: number }).y + (bounds as { height: number }).height / 2
  )
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText(copy!)
  await expect(anchor.locator('title')).toHaveCount(0)
}

test('an activity highlights every unique incoming/outgoing edge and no unrelated edge, including one self-loop', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Connected Edge Union')

  const incomingTop = await createShape(page, 'bpmn:Task', { x: 180, y: 140 })
  const incomingBottom = await createShape(page, 'bpmn:Task', { x: 180, y: 340 })
  const selected = await createShape(page, 'bpmn:Task', { x: 480, y: 240 })
  const outgoingTop = await createShape(page, 'bpmn:Task', { x: 780, y: 140 })
  const outgoingBottom = await createShape(page, 'bpmn:Task', { x: 780, y: 340 })
  const unrelatedSource = await createShape(page, 'bpmn:Task', { x: 480, y: 500 })
  const unrelatedTarget = await createShape(page, 'bpmn:Task', { x: 780, y: 500 })

  const connectedIds = [
    await createRoutedConnection(page, incomingTop, selected, [
      { x: 230, y: 140 },
      { x: 330, y: 140 },
      { x: 330, y: 220 },
      { x: 430, y: 220 }
    ]),
    await createRoutedConnection(page, incomingBottom, selected, [
      { x: 230, y: 340 },
      { x: 330, y: 340 },
      { x: 330, y: 260 },
      { x: 430, y: 260 }
    ]),
    await createRoutedConnection(page, selected, outgoingTop, [
      { x: 530, y: 240 },
      { x: 630, y: 240 },
      { x: 630, y: 140 },
      { x: 730, y: 140 }
    ]),
    await createRoutedConnection(page, selected, outgoingBottom, [
      { x: 530, y: 240 },
      { x: 630, y: 240 },
      { x: 630, y: 340 },
      { x: 730, y: 340 }
    ]),
    await createRoutedConnection(page, selected, selected, [
      { x: 530, y: 240 },
      { x: 590, y: 240 },
      { x: 590, y: 160 },
      { x: 480, y: 160 },
      { x: 480, y: 200 }
    ])
  ]
  const unrelatedId = await createRoutedConnection(page, unrelatedSource, unrelatedTarget, [
    { x: 530, y: 500 },
    { x: 730, y: 500 }
  ])

  await shapeHit(page, selected).click()

  const layer = page.locator(HIGHLIGHT_LAYER)
  await expect(layer).toHaveCount(1)
  await expect(layer).toHaveAttribute('data-org-connected-edge-highlights', 'true')
  await expect(layer).toHaveAttribute('aria-hidden', 'true')
  await expect(layer).toHaveCSS('pointer-events', 'none')
  await expect.poll(() => highlightedEdgeIds(page)).toEqual([...connectedIds].sort())
  expect(await highlightedEdgeIds(page)).not.toContain(unrelatedId)
  await expect(
    page.locator(`${HIGHLIGHT}[data-edge-id="${connectedIds[connectedIds.length - 1]}"]`)
  ).toHaveCount(1)

  const wrappers = page.locator(`${HIGHLIGHT_LAYER} > ${HIGHLIGHT}`)
  await expect(wrappers).toHaveCount(connectedIds.length)
  const highlightColors = await wrappers.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-highlight-color'))
  )
  expect(new Set(highlightColors).size).toBe(connectedIds.length)
  const identityBeads = wrappers.locator('[data-org-highlight-identity="true"]')
  await expect(identityBeads).toHaveCount(connectedIds.length)
  const beadPositions = await identityBeads.evaluateAll((nodes) =>
    nodes.map((node) => `${node.getAttribute('cx')},${node.getAttribute('cy')}`)
  )
  expect(new Set(beadPositions).size).toBe(connectedIds.length)
  for (const wrapper of await wrappers.all()) {
    await expect(wrapper).toHaveAttribute('aria-hidden', 'true')
    await expect(wrapper).toHaveCSS('pointer-events', 'none')
    const path = wrapper.locator('[data-org-highlight-route="true"]')
    await expect(path).toHaveCount(1)
    await expect(path).toHaveCSS('stroke', /rgb/)
    await expect(path).toHaveCSS('stroke-width', '4px')
    await expect(path).toHaveAttribute('marker-end', /url\(#.+\)/)

    // graphicsFactory receives the highlight stroke, so its arrow marker must
    // use that same color rather than the original connection's marker.
    const colors = await path.evaluate((paintedPath) => {
      const stroke = getComputedStyle(paintedPath).stroke
      const match = paintedPath.getAttribute('marker-end')?.match(/^url\(#(.+)\)$/)
      const marker = match ? document.getElementById(match[1]) : null
      const markerPath = marker?.querySelector('path')
      const markerStyle = markerPath ? getComputedStyle(markerPath) : null
      return {
        stroke,
        markerStroke: markerStyle?.stroke ?? '',
        markerFill: markerStyle?.fill ?? ''
      }
    })
    expect([colors.markerStroke, colors.markerFill]).toContain(colors.stroke)
  }
})

test('highlight layer wins shared-segment paint order, repaints on reroute, switches, and clears on click-away', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Connected Edge Repaint')

  const selectedSource = await createShape(page, 'bpmn:Task', { x: 180, y: 180 })
  const selectedTarget = await createShape(page, 'bpmn:Task', { x: 700, y: 180 })
  const otherSource = await createShape(page, 'bpmn:Task', { x: 180, y: 360 })
  const otherTarget = await createShape(page, 'bpmn:Task', { x: 700, y: 360 })
  const nonActivity = await createShape(page, 'bpmn:ExclusiveGateway', { x: 450, y: 500 })
  const sharedSegment = [
    { x: 230, y: 260 },
    { x: 650, y: 260 }
  ]
  const selectedFlow = await createRoutedConnection(
    page,
    selectedSource,
    selectedTarget,
    sharedSegment
  )
  const otherFlow = await createRoutedConnection(page, otherSource, otherTarget, sharedSegment)

  // fit-viewport does not account for the open palette; with different font
  // metrics a left-edge shape can land underneath it. Scroll the target into
  // the clear viewport area before every click instead of forcing anything.
  const clickShape = async (elementId: string): Promise<void> => {
    await page.evaluate((id) => {
      const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
      const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
      const canvas = modeler.get('canvas') as { scrollToElement(element: unknown): void }
      canvas.scrollToElement(registry.get(id))
    }, elementId)
    await shapeHit(page, elementId).click()
  }

  await clickShape(selectedSource)
  await expect.poll(() => highlightedEdgeIds(page)).toEqual([selectedFlow])

  const highlightedPath = page.locator(
    `${HIGHLIGHT}[data-edge-id="${selectedFlow}"] [data-org-highlight-route="true"]`
  )
  const obscuringOriginal = page
    .locator(`.djs-element[data-element-id="${otherFlow}"] .djs-visual > path`)
    .first()
  await expect(highlightedPath).toHaveAttribute(
    'd',
    (await obscuringOriginal.getAttribute('d')) as string
  )
  expect(
    await obscuringOriginal.evaluate((original, highlightSelector) => {
      const highlight = document.querySelector(highlightSelector)
      return !!(
        highlight && original.compareDocumentPosition(highlight) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    }, `${HIGHLIGHT}[data-edge-id="${selectedFlow}"] [data-org-highlight-route="true"]`)
  ).toBe(true)
  expect(
    await highlightedPath.evaluate((path) => Number.parseFloat(getComputedStyle(path).strokeWidth))
  ).toBeGreaterThan(
    await obscuringOriginal.evaluate((path) =>
      Number.parseFloat(getComputedStyle(path).strokeWidth)
    )
  )

  const before = await highlightedPath.getAttribute('d')
  await rerouteConnection(page, selectedFlow, [
    { x: 230, y: 180 },
    { x: 400, y: 180 },
    { x: 400, y: 100 },
    { x: 650, y: 100 }
  ])
  await expect.poll(() => highlightedPath.getAttribute('d')).not.toBe(before)
  await expect.poll(() => highlightedEdgeIds(page)).toEqual([selectedFlow])

  // Switching to another activity removes the stale wrapper before painting
  // that activity's edge. Switching to a gateway is an invalid selection and
  // clears the layer entirely.
  await clickShape(otherSource)
  await expect.poll(() => highlightedEdgeIds(page)).toEqual([otherFlow])
  await clickShape(nonActivity)
  await expect(page.locator(`${HIGHLIGHT_LAYER} > ${HIGHLIGHT}`)).toHaveCount(0)

  await clickShape(selectedSource)
  await expect.poll(() => highlightedEdgeIds(page)).toEqual([selectedFlow])
  await clickCanvasBackground(page)
  await expect(page.locator(`${HIGHLIGHT_LAYER} > ${HIGHLIGHT}`)).toHaveCount(0)
})

test('shape legend is default-closed, accessible, swatched, and closable from inside its region', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Shape Legend')

  const toggle = page.getByTestId('shape-legend-toggle')
  const panel = page.getByTestId('shape-legend-panel')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const panelId = await toggle.getAttribute('aria-controls')
  expect(panelId).toMatch(/^orbitpm-shape-legend-/)
  await expect(panel).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('id', panelId!)
  await expect(panel).toHaveAttribute('role', 'region')
  await expect(panel).toHaveAttribute('aria-labelledby', `${panelId}-title`)
  await expect(panel).toHaveAttribute('dir', 'ltr')

  const items = panel.locator('.orbitpm-shape-legend__item[data-legend-kind]')
  await expect(items).toHaveCount(21)
  for (const kind of [
    'event-start',
    'event-intermediate',
    'event-end',
    'step',
    'subprocess',
    'gateway-exclusive',
    'gateway-inclusive',
    'gateway-parallel',
    'gateway-event-based',
    'gateway-complex',
    'participant',
    'lane',
    'annotation',
    'data-object',
    'data-store',
    'owner',
    'input',
    'output',
    'cc',
    'basis',
    'subprocess-chip'
  ]) {
    await expect(
      panel.locator(`.orbitpm-shape-legend__item[data-legend-kind="${kind}"]`)
    ).toHaveCount(1)
  }
  for (const icon of [
    'start-circle',
    'intermediate-circle',
    'end-circle',
    'rounded-rect',
    'exclusive-diamond',
    'event-based-diamond',
    'participant',
    'annotation',
    'data-object',
    'data-store',
    'chip'
  ]) {
    expect(await panel.locator(`[data-icon="${icon}"]`).count()).toBeGreaterThan(0)
  }

  // Representative palette-backed swatches. The wrapper records the source
  // token while its child SVG primitive paints the corresponding hex.
  const inputIcon = panel.locator(
    '.orbitpm-shape-legend__item[data-legend-kind="input"] .orbitpm-shape-legend__icon'
  )
  await expect(inputIcon).toHaveAttribute('data-swatch-fill', 'inputFill')
  await expect(inputIcon.locator('svg > *').first()).toHaveCSS('fill', 'rgb(211, 236, 242)')
  const outputIcon = panel.locator(
    '.orbitpm-shape-legend__item[data-legend-kind="output"] .orbitpm-shape-legend__icon'
  )
  await expect(outputIcon).toHaveAttribute('data-swatch-fill', 'outputFill')
  await expect(outputIcon).toHaveAttribute('data-swatch-stroke', 'outputBorder')
  await expect(outputIcon.locator('svg > *').first()).toHaveCSS('fill', 'rgb(230, 224, 248)')
  const basisIcon = panel.locator(
    '.orbitpm-shape-legend__item[data-legend-kind="basis"] .orbitpm-shape-legend__icon'
  )
  await expect(basisIcon).toHaveAttribute('data-swatch-fill', 'basisFill')
  await expect(basisIcon.locator('svg > *').first()).toHaveCSS('fill', 'rgb(252, 227, 189)')

  await page.getByTestId('shape-legend-close').click()
  await expect(panel).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
})

test('node fallback and every semantic decoration expose delegated tooltips, including outputs', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Semantic Tooltips')

  const taskId = await createShape(page, 'bpmn:Task', { x: 380, y: 260 })
  await updateOrgProperties(page, taskId, {
    'orbitpm:owner': 'Process owner',
    'orbitpm:inputs': 'Signed application',
    'orbitpm:outputs': 'Approval notice',
    'orbitpm:respList': 'Case worker',
    'orbitpm:ccList': 'Legal reviewer'
  })
  const ruleId = await createShape(page, 'bpmn:BusinessRuleTask', { x: 650, y: 260 })
  await updateOrgProperties(page, ruleId, {
    'orbitpm:owner': 'Rules team',
    'orbitpm:inputs': 'Policy facts',
    'orbitpm:outputs': 'Eligibility result',
    'orbitpm:decisionBasis': 'Eligibility policy'
  })
  const subprocessId = await createShape(
    page,
    'bpmn:SubProcess',
    { x: 650, y: 470 },
    { isExpanded: false }
  )
  const gatewayId = await createShape(page, 'bpmn:ExclusiveGateway', { x: 380, y: 470 })

  const task = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  const taskHit = shapeHit(page, taskId)
  await expect(taskHit).not.toHaveAttribute('data-org-tooltip')
  await taskHit.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText('Performs one unit of work in the process.')

  // Gateways resolve from SEMANTIC_NAMING through the same element-ID
  // fallback, including when their visible default label is presentation-only.
  await shapeHit(page, gatewayId).hover()
  await expect(tooltip).toHaveText(
    'Selects exactly one outgoing path, or merges alternative paths.'
  )

  const decorationAnchors = [
    task.locator('[data-org-decoration="owner"]'),
    task.locator('[data-org-decoration="owner-role"]'),
    task.locator('[data-org-decoration="inputs"]'),
    task.locator('[data-org-decoration="outputs"]'),
    task.locator('[data-org-decoration="responsible"]'),
    task.locator('[data-org-decoration="cc"]'),
    page.locator(`.djs-element[data-element-id="${ruleId}"] [data-org-semantic="basis"]`),
    page.locator(
      `.djs-element[data-element-id="${subprocessId}"] [data-org-semantic="subprocess-chip"]`
    )
  ]

  for (const anchor of decorationAnchors) {
    await expect(anchor).toHaveCount(1)
    await expect(anchor).toHaveCSS('pointer-events', 'all')
    await expectDelegatedTooltip(page, anchor)
  }

  // The output contract from the layout lane stays intact while becoming
  // tooltip-capable; it is not replaced with a differently named wrapper.
  const outputs = task.locator('[data-org-decoration="outputs"]')
  await expect(outputs).toContainText('Approval notice')
  await expect(outputs).toHaveAttribute('data-org-semantic', 'output')
  await expect(task.locator('title')).toHaveCount(0)
})
