import { test, expect, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Canvas-surface UX of the feature wave: missing-info badges (+ the delegated
// tooltip), the sub-process chip marker swap, start/end event restyle, the
// disabled edge auto-pan, direct-label -> orbitpm:nameEn mirroring, and the
// keyless free-translate chain (stubbed endpoints).
//
// Follows the house pattern (lite-org.spec.ts / lite-smoke.spec.ts): BUILT
// single file over file://, forced fallback mode, programmatic modeling via
// the window.__ORBITPM_LITE__ automation hook. The free-translate tests serve
// the same dist over http://127.0.0.1 (lite-live-cors pattern) so the page has
// a real Origin while Playwright routing stubs the two translation hosts.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

/** Force the single-file fallback path (the folder picker opens a native
 *  dialog that can't be automated). */
async function forceFallbackMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional global for the test
    delete window.showDirectoryPicker
    // @ts-expect-error deleting an optional global for the test
    delete window.showOpenFilePicker
  })
}

/** Create a new process via the New-process modal and wait for the modeler. */
async function newProcess(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /New process/i }).first().click()
  const dialog = page.getByRole('dialog', { name: /New Process/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const w = window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }
    return !!w.__ORBITPM_LITE__?.modeler
  })
}

interface HookWindow {
  __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
}

/** Create a shape via the automation hook, refit the viewport so it is on
 *  screen, and return its element id. */
async function createShape(
  page: Page,
  type: string,
  pos: { x: number; y: number },
  extra?: Record<string, unknown>
): Promise<string> {
  return page.evaluate(
    ({ type, pos, extra }) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const modeling = m.get('modeling') as {
        createShape(shape: unknown, pos: { x: number; y: number }, parent: unknown): { id: string }
      }
      const elementFactory = m.get('elementFactory') as {
        createShape(attrs: Record<string, unknown>): unknown
      }
      const canvas = m.get('canvas') as {
        getRootElement(): unknown
        zoom(mode: 'fit-viewport'): void
      }
      const shape = elementFactory.createShape({ type, ...(extra ?? {}) })
      const placed = modeling.createShape(shape, pos, canvas.getRootElement())
      canvas.zoom('fit-viewport')
      return placed.id
    },
    { type, pos, extra }
  )
}

/** Connect two existing shapes, then replace the auto-route with a known
 * orthogonal polyline. The explicit waypoints make edge-visual assertions
 * independent of bpmn-js layouter changes. */
async function createRoutedConnection(
  page: Page,
  sourceId: string,
  targetId: string,
  waypoints: Array<{ x: number; y: number }>
): Promise<string> {
  return page.evaluate(
    ({ sourceId, targetId, waypoints }) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const registry = m.get('elementRegistry') as { get(id: string): unknown }
      const modeling = m.get('modeling') as {
        connect(
          source: unknown,
          target: unknown,
          attrs: { type: 'bpmn:SequenceFlow' }
        ): { id: string }
        updateWaypoints(
          connection: unknown,
          nextWaypoints: Array<{ x: number; y: number }>
        ): void
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

/**
 * Pin a visual-analysis fixture after the production router has completed.
 * This deliberately bypasses the command stack: ordinary modeling commands
 * should remove avoidable crossings, while this test needs one remaining
 * crossing to verify the bridge renderer itself.
 */
async function pinVisualRoutes(
  page: Page,
  routes: Array<{
    id: string
    waypoints: Array<{ x: number; y: number }>
  }>
): Promise<void> {
  await page.evaluate((fixtures) => {
    const modeler = (window as unknown as HookWindow).__ORBITPM_LITE__.modeler
    type Connection = {
      waypoints: Array<{ x: number; y: number }>
    }
    const registry = modeler.get('elementRegistry') as {
      get(id: string): Connection
      getGraphics(element: Connection): SVGElement
    }
    const graphicsFactory = modeler.get('graphicsFactory') as {
      update(kind: 'connection', element: Connection, gfx: SVGElement): void
    }
    const eventBus = modeler.get('eventBus') as {
      fire(event: string): void
    }
    for (const fixture of fixtures) {
      const connection = registry.get(fixture.id)
      connection.waypoints = fixture.waypoints.map((point) => ({ ...point }))
      graphicsFactory.update(
        'connection',
        connection,
        registry.getGraphics(connection)
      )
    }
    eventBus.fire('commandStack.changed')
  }, routes)
}

/** Write moddle-backed org attributes through the command stack so both the
 * org decoration and edge-visual refresh listeners see the mutation. */
async function updateOrgProperties(
  page: Page,
  elementId: string,
  properties: Record<string, unknown>
): Promise<void> {
  await page.evaluate(
    ({ elementId, properties }) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const registry = m.get('elementRegistry') as { get(id: string): unknown }
      const modeling = m.get('modeling') as {
        updateProperties(element: unknown, nextProperties: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(elementId), properties)
    },
    { elementId, properties }
  )
}

/** Read the fallback-mode SVG download as text. */
async function exportSvg(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export SVG' }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** name / orbitpm:nameEn / orbitpm:nameAr of an element's business object. */
async function readNames(
  page: Page,
  id: string
): Promise<{ name: string | null; nameEn: string | null; nameAr: string | null }> {
  return page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const m = w.__ORBITPM_LITE__.modeler
    const registry = m.get('elementRegistry') as {
      get(id: string): { businessObject?: Record<string, unknown> } | undefined
    }
    const bo = registry.get(elementId)?.businessObject as
      | {
          name?: unknown
          get?(key: string): unknown
          $attrs?: Record<string, unknown>
        }
      | undefined
    const attr = (key: string): string | null => {
      const viaGet = typeof bo?.get === 'function' ? bo.get(key) : undefined
      const value = viaGet ?? bo?.$attrs?.[key]
      return typeof value === 'string' ? value : null
    }
    return {
      name: typeof bo?.name === 'string' ? bo.name : null,
      nameEn: attr('orbitpm:nameEn'),
      nameAr: attr('orbitpm:nameAr')
    }
  }, id)
}

/** Activate bpmn-js direct editing through its service. Step-block
 *  double-click is reserved for opening the Details pane. */
async function activateDirectEditing(page: Page, id: string): Promise<void> {
  const activated = await page.evaluate((elementId) => {
    const w = window as unknown as HookWindow
    const modeler = w.__ORBITPM_LITE__.modeler
    const registry = modeler.get('elementRegistry') as { get(id: string): unknown }
    const directEditing = modeler.get('directEditing') as {
      activate(element: unknown): boolean
    }
    return directEditing.activate(registry.get(elementId))
  }, id)
  expect(activated, `direct editing should activate for ${id}`).toBe(true)
}

// ---------------------------------------------------------------------------
// Missing-info badge + start/end restyle
// ---------------------------------------------------------------------------

test('missing-info badges carry tooltip/missing data (no native <title>); start/end events are restyled', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Badge Demo')

  // The template's start event is missing its trigger -> it gets a badge.
  const startId = await page.evaluate(() => {
    const w = window as unknown as HookWindow
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      getAll(): Array<{ type?: string; id: string; labelTarget?: unknown }>
    }
    return registry.getAll().find((e) => e.type === 'bpmn:StartEvent' && !e.labelTarget)?.id ?? ''
  })
  expect(startId).not.toBe('')
  const startGfx = page.locator(`.djs-element[data-element-id="${startId}"]`)
  const startBadge = startGfx.locator('g.orbitpm-missing-badge')
  await expect(startBadge).toBeVisible()
  await expect(startBadge).toHaveAttribute('data-org-missing', 'trigger')

  // A fresh task is missing owner/inputs/outputs -> "!3" badge with the full
  // localized tooltip text (incl. the click-to-complete action line), a
  // pointer cursor, and NO native <title> child (the delegated tooltip
  // replaced it).
  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const taskGfx = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  const badge = taskGfx.locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-org-missing', 'owner,inputs,outputs')
  // tiny-svg maps `cursor` onto the inline STYLE (CSS_PROPERTIES table), so
  // assert the computed style rather than an attribute.
  await expect(badge).toHaveCSS('cursor', 'pointer')
  await expect(badge).toHaveAttribute(
    'data-org-tooltip',
    /Missing: responsible party, inputs, outputs/
  )
  await expect(badge).toHaveAttribute('data-org-tooltip', /Click to complete these details/)
  await expect(badge.locator('title')).toHaveCount(0)
  await expect(badge.locator('text')).toHaveText('!3')

  // Start/end restyle (org renderer eventStyle): green go / red stop.
  // tiny-svg writes fill/stroke as inline styles (CSS_PROPERTIES), so assert
  // computed CSS: #1e9e62/#e3f4ea and #c0504d/#fdeaea in rgb() form.
  const startCircle = startGfx.locator('.djs-visual circle').first()
  await expect(startCircle).toHaveCSS('stroke', 'rgb(30, 158, 98)')
  await expect(startCircle).toHaveCSS('fill', 'rgb(227, 244, 234)')

  const endId = await createShape(page, 'bpmn:EndEvent', { x: 620, y: 220 })
  const endCircle = page
    .locator(`.djs-element[data-element-id="${endId}"]`)
    .locator('.djs-visual circle')
    .first()
  await expect(endCircle).toHaveCSS('stroke', 'rgb(192, 80, 77)')
  await expect(endCircle).toHaveCSS('fill', 'rgb(253, 234, 234)')
})

// ---------------------------------------------------------------------------
// Delegated hover tooltip
// ---------------------------------------------------------------------------

test('delegated tooltip shows on badge pointerover and hides on wheel/pointerdown (synthetic events)', async ({
  page
}) => {
  // NOTE: this test drives canvasDecor's delegated listeners by dispatching
  // events WITH THE BADGE AS TARGET. Real-pointer delivery is covered (and
  // currently red) in the next test — see the pointer-events finding there.
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Tooltip Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()

  const hoverBadge = () =>
    badge.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
  const dispatchOnCanvasSvg = (kind: 'wheel' | 'pointerdown') =>
    page.evaluate((eventKind) => {
      const svg = document.querySelector('.djs-container svg')
      if (!svg) return
      svg.dispatchEvent(
        eventKind === 'wheel'
          ? new WheelEvent('wheel', { bubbles: true, deltaY: 120 })
          : new PointerEvent('pointerdown', { bubbles: true })
      )
    }, kind)

  // pointerover on the badge -> the floating tooltip div appears inside the
  // editor root: role=tooltip, fixed positioning, the badge's full text.
  await hoverBadge()
  const tooltip = page.locator('.orbitpm-editor .orbitpm-canvas-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveAttribute('role', 'tooltip')
  await expect(tooltip).toHaveCSS('position', 'fixed')
  await expect(tooltip).toContainText('Missing: responsible party, inputs, outputs')
  await expect(tooltip).toContainText('Click to complete these details')

  // Wheel (pan/zoom would invalidate the fixed position) -> hidden.
  await dispatchOnCanvasSvg('wheel')
  await expect(tooltip).toBeHidden()

  // Shown again on re-hover; any pointerdown hides it immediately.
  await hoverBadge()
  await expect(tooltip).toBeVisible()
  await dispatchOnCanvasSvg('pointerdown')
  await expect(tooltip).toBeHidden()
})

test('badge is reachable by a REAL pointer and hovering it shows the tooltip', async ({ page }) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Tooltip Hit Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const badge = page
    .locator(`.djs-element[data-element-id="${taskId}"]`)
    .locator('g.orbitpm-missing-badge')
  await expect(badge).toBeVisible()

  // Hit-test at the badge center: a real pointer event must target the badge
  // subtree, otherwise the delegated tooltip/click can never fire for users.
  // KNOWN GAP as of this wave: diagram-js.css sets
  // `.djs-visual, .djs-outline { pointer-events: none; }` and the badge is
  // appended INSIDE .djs-visual, so it inherits pointer-events:none and
  // document.elementFromPoint() falls through to the root <svg>.
  const hit = await badge.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      pointerEvents: getComputedStyle(el).pointerEvents,
      hitTag: target ? target.tagName.toLowerCase() : null,
      insideBadge: !!(target && target.closest('.orbitpm-missing-badge'))
    }
  })
  expect(
    hit.insideBadge,
    `badge center must hit-test to the badge itself, got <${hit.hitTag}> ` +
      `(badge computed pointer-events: ${hit.pointerEvents} — inherited from .djs-visual)`
  ).toBe(true)

  // With hit-testing intact a plain hover must produce the tooltip.
  await badge.hover()
  await expect(page.locator('.orbitpm-editor .orbitpm-canvas-tooltip')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Sub-process chip (stock '+' marker swap)
// ---------------------------------------------------------------------------

test('collapsed sub-process and call activity get the org chip instead of the stock "+" marker', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Sub Chip Demo')

  // A CallActivity (no calledElement yet) -> generic tooltip chip.
  const callId = await createShape(page, 'bpmn:CallActivity', { x: 420, y: 220 })
  const callGfx = page.locator(`.djs-element[data-element-id="${callId}"]`)
  const callChip = callGfx.locator('g.orbitpm-sub-chip')
  await expect(callChip).toBeVisible()
  await expect(callChip).toHaveAttribute(
    'data-org-tooltip',
    /collapsed or linked sub-process/
  )
  await expect(callGfx.locator('path[data-marker="sub-process"]')).toHaveCount(0)

  // A collapsed SubProcess -> same swap.
  const subId = await createShape(
    page,
    'bpmn:SubProcess',
    { x: 640, y: 220 },
    { isExpanded: false }
  )
  const subGfx = page.locator(`.djs-element[data-element-id="${subId}"]`)
  await expect(subGfx.locator('g.orbitpm-sub-chip')).toBeVisible()
  await expect(subGfx.locator('g.orbitpm-sub-chip')).toHaveAttribute('data-org-tooltip', /.+/)
  await expect(subGfx.locator('path[data-marker="sub-process"]')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Directional input/output geometry + connection crossings/junctions
// ---------------------------------------------------------------------------

test('right-flow output box is the first after-side block with distinct output styling', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Directed Decorations Demo')

  const sourceId = await createShape(page, 'bpmn:Task', { x: 220, y: 220 })
  const taskId = await createShape(
    page,
    'bpmn:Task',
    { x: 460, y: 220 },
    { width: 100, height: 72 }
  )
  const targetId = await createShape(page, 'bpmn:Task', { x: 700, y: 220 })
  await createRoutedConnection(page, sourceId, taskId, [
    { x: 270, y: 220 },
    { x: 410, y: 220 }
  ])
  await createRoutedConnection(page, taskId, targetId, [
    { x: 510, y: 220 },
    { x: 650, y: 220 }
  ])
  await updateOrgProperties(page, taskId, {
    'orbitpm:inputs': 'Source dossier',
    'orbitpm:outputs': 'Approval memo\nAudit trail',
    'orbitpm:owner': 'Process owner'
  })

  const taskGfx = page.locator(`.djs-element[data-element-id="${taskId}"]`)
  const inputs = taskGfx.locator('[data-org-decoration="inputs"]')
  const outputs = taskGfx.locator('[data-org-decoration="outputs"]')
  await expect(inputs).toHaveCount(1)
  await expect(outputs).toHaveCount(1)

  await expect(outputs).toContainText('Outputs')
  await expect(outputs).toContainText('Approval memo')
  await expect(outputs).toContainText('Audit trail')

  const inputRect = inputs.locator('rect').first()
  const outputRect = outputs.locator('rect').first()
  await expect(inputRect).toHaveCSS('fill', 'rgb(211, 236, 242)')
  await expect(outputRect).toHaveCSS('fill', 'rgb(230, 224, 248)')
  await expect(outputRect).toHaveCSS('stroke', 'rgb(103, 80, 164)')
  await expect(
    outputs.locator('text').filter({ hasText: /^Approval memo$/ })
  ).toHaveCSS('fill', 'rgb(68, 51, 122)')

  // Exact shape-local geometry for the explicit 100x72 fixture. Right-flow maps the
  // before-side input above the shape and the after-side output below it.
  // Output is first in that stack, so the owner starts one 12px gap later.
  const geometry = await taskGfx.evaluate((gfx) => {
    const semanticRect = (kind: string): SVGRectElement => {
      const found = gfx.querySelector(
        `[data-org-decoration="${kind}"] rect`
      ) as SVGRectElement | null
      if (!found) throw new Error(`missing ${kind} decoration rect`)
      return found
    }
    const ownerRect = Array.from(gfx.querySelectorAll('rect')).find(
      (rect) => getComputedStyle(rect).fill === 'rgb(217, 203, 168)'
    ) as SVGRectElement | undefined
    if (!ownerRect) throw new Error('missing owner decoration rect')
    const read = (el: SVGRectElement) => ({
      x: Number(el.getAttribute('x')),
      y: Number(el.getAttribute('y')),
      w: Number(el.getAttribute('width')),
      h: Number(el.getAttribute('height'))
    })
    return {
      inputs: read(semanticRect('inputs')),
      outputs: read(semanticRect('outputs')),
      owner: read(ownerRect)
    }
  })
  expect(geometry.inputs).toEqual({ x: 0, y: -65, w: 100, h: 35 })
  expect(geometry.outputs).toEqual({ x: 0, y: 84, w: 94, h: 48 })
  expect(geometry.owner.y).toBe(144)
})

test('edge overlay paints one hop per strict crossing and one dot per split/merge junction', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Edge Visuals Demo')

  // One unrelated strict crossing at (440, 180).
  const crossLeft = await createShape(page, 'bpmn:Task', { x: 180, y: 180 })
  const crossRight = await createShape(page, 'bpmn:Task', { x: 700, y: 180 })
  const crossTop = await createShape(page, 'bpmn:Task', { x: 440, y: 60 })
  const crossBottom = await createShape(page, 'bpmn:Task', { x: 440, y: 300 })
  const crossHorizontalWaypoints = [
    { x: 230, y: 180 },
    { x: 650, y: 180 }
  ]
  const crossHorizontal = await createRoutedConnection(
    page,
    crossLeft,
    crossRight,
    crossHorizontalWaypoints
  )
  const crossVerticalWaypoints = [
    { x: 440, y: 100 },
    { x: 440, y: 260 }
  ]
  const crossVertical = await createRoutedConnection(
    page,
    crossTop,
    crossBottom,
    crossVerticalWaypoints
  )

  // A two-edge source prefix ending at (330, 700), and a two-edge target
  // suffix starting at (630, 700). Shared endpoint stubs must yield one dot
  // at each actual junction, not one dot per participating connection.
  const splitSource = await createShape(page, 'bpmn:Task', { x: 180, y: 700 })
  const upper = await createShape(page, 'bpmn:Task', { x: 480, y: 590 })
  const lower = await createShape(page, 'bpmn:Task', { x: 480, y: 810 })
  const mergeTarget = await createShape(page, 'bpmn:Task', { x: 780, y: 700 })
  const splitUpperWaypoints = [
    { x: 230, y: 700 },
    { x: 330, y: 700 },
    { x: 330, y: 590 },
    { x: 430, y: 590 }
  ]
  const splitUpper = await createRoutedConnection(
    page,
    splitSource,
    upper,
    splitUpperWaypoints
  )
  const splitLowerWaypoints = [
    { x: 230, y: 700 },
    { x: 330, y: 700 },
    { x: 330, y: 810 },
    { x: 430, y: 810 }
  ]
  const splitLower = await createRoutedConnection(
    page,
    splitSource,
    lower,
    splitLowerWaypoints
  )
  const mergeUpperWaypoints = [
    { x: 530, y: 590 },
    { x: 630, y: 590 },
    { x: 630, y: 700 },
    { x: 730, y: 700 }
  ]
  const mergeUpper = await createRoutedConnection(
    page,
    upper,
    mergeTarget,
    mergeUpperWaypoints
  )
  const mergeLowerWaypoints = [
    { x: 530, y: 810 },
    { x: 630, y: 810 },
    { x: 630, y: 700 },
    { x: 730, y: 700 }
  ]
  const mergeLower = await createRoutedConnection(
    page,
    lower,
    mergeTarget,
    mergeLowerWaypoints
  )

  await pinVisualRoutes(page, [
    { id: crossHorizontal, waypoints: crossHorizontalWaypoints },
    { id: crossVertical, waypoints: crossVerticalWaypoints },
    { id: splitUpper, waypoints: splitUpperWaypoints },
    { id: splitLower, waypoints: splitLowerWaypoints },
    { id: mergeUpper, waypoints: mergeUpperWaypoints },
    { id: mergeLower, waypoints: mergeLowerWaypoints }
  ])

  const overlay = page.locator('g.orbitpm-connection-visuals')
  await expect(overlay).toHaveCount(1)
  await expect(overlay).toHaveAttribute('aria-hidden', 'true')
  await expect(overlay).toHaveAttribute('pointer-events', 'none')
  await expect(overlay).toHaveCSS('pointer-events', 'none')

  const hops = overlay.locator('[data-org-edge-visual="hop"]')
  const junctions = overlay.locator('[data-org-edge-visual="junction"]')
  await expect(hops).toHaveCount(1)
  await expect(junctions).toHaveCount(2)
  await expect(
    overlay.locator('[data-org-edge-visual="junction"][data-junction-kind="split"]')
  ).toHaveCount(1)
  await expect(
    overlay.locator('[data-org-edge-visual="junction"][data-junction-kind="merge"]')
  ).toHaveCount(1)

  // The SVG geometry itself pins the requested 5px hop and 3.5px dots.
  await expect(hops).toHaveAttribute('data-radius', '5')
  for (const dot of await junctions.all()) {
    await expect(dot).toHaveAttribute('r', '3.5')
  }

  // saveSVG must serialize overlays along with the ordinary BPMN graphics.
  const svg = await exportSvg(page)
  expect(svg).toContain('class="orbitpm-connection-visuals"')
  expect(svg.match(/data-org-edge-visual="hop"/g)).toHaveLength(1)
  expect(svg.match(/data-org-edge-visual="junction"/g)).toHaveLength(2)
  expect(svg).toContain('aria-hidden="true"')
  expect(svg).toContain('pointer-events="none"')
})

// ---------------------------------------------------------------------------
// Edge auto-pan stays disabled
// ---------------------------------------------------------------------------

test('holding a dragged shape at the canvas edge does not auto-pan the viewbox', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'AutoPan Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
  const gfxBox = await page.locator(`.djs-element[data-element-id="${taskId}"]`).boundingBox()
  expect(gfxBox).not.toBeNull()
  if (!gfxBox) return
  const canvasBox = await page.locator('.orbitpm-editor__canvas').boundingBox()
  expect(canvasBox).not.toBeNull()
  if (!canvasBox) return

  const readViewbox = () =>
    page.evaluate(() => {
      const w = window as unknown as HookWindow
      const canvas = w.__ORBITPM_LITE__.modeler.get('canvas') as {
        viewbox(): { x: number; y: number; scale?: number }
      }
      const vb = canvas.viewbox()
      const round = (n: number) => Math.round(n * 1000) / 1000
      return { x: round(vb.x), y: round(vb.y), scale: round(vb.scale ?? 1) }
    })

  const before = await readViewbox()

  // Grab the task and drag it to ~5px from the canvas's right edge, then HOLD.
  const startX = gfxBox.x + gfxBox.width / 2
  const startY = gfxBox.y + gfxBox.height / 2
  const edgeX = canvasBox.x + canvasBox.width - 5
  const holdY = Math.min(Math.max(startY, canvasBox.y + 200), canvasBox.y + canvasBox.height - 40)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 20, startY, { steps: 4 }) // pass the drag threshold
  await page.mouse.move(edgeX, holdY, { steps: 12 })

  const atEdge = await readViewbox()
  await page.waitForTimeout(700) // the old AutoScroll would pan repeatedly during this hold
  const afterHold = await readViewbox()
  await page.mouse.up()

  expect(afterHold, 'viewbox must not move while holding at the edge').toEqual(atEdge)
  expect(afterHold, 'viewbox must be exactly the pre-drag one').toEqual(before)

  // Sanity: the drag itself was real — the element actually moved right.
  const movedX = await page.evaluate((id) => {
    const w = window as unknown as HookWindow
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { x?: number } | undefined
    }
    return registry.get(id)?.x ?? 0
  }, taskId)
  expect(movedX).toBeGreaterThan(420)
})

// ---------------------------------------------------------------------------
// Direct label edit mirrors into orbitpm:nameEn (one undo reverts both)
// ---------------------------------------------------------------------------

test('typing a label mirrors into orbitpm:nameEn and a single undo reverts both', async ({
  page
}) => {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await newProcess(page, 'Mirror Demo')

  const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })

  // Direct editing remains available through bpmn-js even though step-block
  // double-click now opens Details instead of renaming.
  await activateDirectEditing(page, taskId)
  await expect(page.locator('.djs-direct-editing-content')).toBeVisible()
  await page.keyboard.type('Review Invoice')
  await page.keyboard.press('Enter')
  await expect(page.locator('.djs-direct-editing-content')).toHaveCount(0)

  await page.waitForFunction((id) => {
    const w = window as unknown as { __ORBITPM_LITE__: { modeler: { get(n: string): unknown } } }
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: { name?: unknown } } | undefined
    }
    return registry.get(id)?.businessObject?.name === 'Review Invoice'
  }, taskId)

  const afterEdit = await readNames(page, taskId)
  expect(afterEdit.name).toBe('Review Invoice')
  // Default diagram language is 'en' -> the visible name mirrors into nameEn.
  expect(afterEdit.nameEn).toBe('Review Invoice')

  // ONE Ctrl+Z reverts the visible name AND the mirrored attribute together
  // (the mirror write joins the same undo action as the label edit).
  await page.locator('.djs-container svg').first().focus()
  await page.keyboard.press('Control+z')
  await page.waitForFunction((id) => {
    const w = window as unknown as { __ORBITPM_LITE__: { modeler: { get(n: string): unknown } } }
    const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
      get(id: string): { businessObject?: { name?: unknown } } | undefined
    }
    const name = registry.get(id)?.businessObject?.name
    return name === undefined || name === null || name === ''
  }, taskId)
  const afterUndo = await readNames(page, taskId)
  // bpmn-js's UpdateLabelHandler restores the pre-edit label as '' (not
  // undefined) — either way the typed name must be gone from BOTH places.
  expect(afterUndo.name ?? '').toBe('')
  expect(afterUndo.nameEn ?? '').toBe('')
  // The visible label text is gone from the diagram SVG too.
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.djs-container svg text')).map((el) => el.textContent ?? '')
  )
  expect(texts.some((s) => s.includes('Review Invoice'))).toBe(false)
})

// ---------------------------------------------------------------------------
// Keyless free translate (stubbed Google gtx / MyMemory endpoints)
// ---------------------------------------------------------------------------

test.describe('free translate without a provider key (stubbed endpoints)', () => {
  // Serve the dist over http so the page has a real Origin (file:// sends
  // `Origin: null`, which makes CORS-fulfilled routing needlessly flaky);
  // Playwright routing then stubs the two translation hosts beneath the CSP
  // allowlist that ships in the page.
  let server: Server
  let baseURL = ''

  test.beforeAll(async () => {
    const html = readFileSync(DIST, 'utf8')
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    baseURL = `http://127.0.0.1:${port}/`
  })

  test.afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  /** Boot a fallback-mode diagram with one named task; returns its id. */
  async function bootTranslateDiagram(page: Page): Promise<string> {
    await forceFallbackMode(page)
    await page.goto(baseURL, { waitUntil: 'load' })
    await newProcess(page, 'Translate Demo')
    const taskId = await createShape(page, 'bpmn:Task', { x: 420, y: 220 })
    await page.evaluate((id) => {
      const w = window as unknown as HookWindow
      const m = w.__ORBITPM_LITE__.modeler
      const registry = m.get('elementRegistry') as { get(id: string): unknown }
      const modeling = m.get('modeling') as {
        updateProperties(el: unknown, props: Record<string, unknown>): void
      }
      modeling.updateProperties(registry.get(id), { name: 'Review order' })
    }, taskId)
    return taskId
  }

  test('✨ Translate falls back to the free service and stores orbitpm:nameAr', async ({
    page
  }) => {
    const googleCalls: string[] = []
    const myMemoryCalls: string[] = []
    // Canned gtx payload: segments array whose [i][0] parts join to 'ترجمة'
    // (see ai/freeTranslate.ts parseGoogleResponse).
    await page.route('https://translate.googleapis.com/**', async (route) => {
      googleCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify([[['ترجمة', 'src', null, null]], null, 'en'])
      })
    })
    // Safety net only — with Google answering, MyMemory must never be called.
    await page.route('https://api.mymemory.translated.net/**', async (route) => {
      myMemoryCalls.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*'
        },
        body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'ترجمة' } })
      })
    })

    const taskId = await bootTranslateDiagram(page)
    await page.getByRole('button', { name: /Translate/ }).click()

    // The keyless run announces the free service (i18n translate.free.using).
    await expect(
      page.getByRole('status').filter({ hasText: 'free translation service' })
    ).toBeVisible()

    // The missing Arabic side lands on the business object and the whole
    // drawing is projected to Arabic immediately.
    await page.waitForFunction(
      (id) => {
        const w = window as unknown as {
          __ORBITPM_LITE__: { modeler: { get(n: string): unknown } }
        }
        const registry = w.__ORBITPM_LITE__.modeler.get('elementRegistry') as {
          get(id: string): { businessObject?: { get?(k: string): unknown } } | undefined
        }
        return registry.get(id)?.businessObject?.get?.('orbitpm:nameAr') === 'ترجمة'
      },
      taskId,
      { timeout: 20_000 }
    )
    const names = await readNames(page, taskId)
    expect(names.name).toBe('ترجمة')
    expect(names.nameAr).toBe('ترجمة')

    // Completion toast, then verify the network shape: one gtx GET per label
    // (process name + "Start" + the task), Google only.
    await expect(page.getByRole('status').filter({ hasText: /Translated 3 labels/ })).toBeVisible({
      timeout: 15_000
    })
    expect(googleCalls.length).toBe(3)
    for (const url of googleCalls) {
      expect(url).toContain('client=gtx')
      expect(url).toContain('sl=en')
      expect(url).toContain('tl=ar')
    }
    expect(myMemoryCalls.length).toBe(0)
  })

  test('free-service 429s surface the rate-limit toast and write nothing', async ({ page }) => {
    // Both hops rate-limited -> the whole chain classifies as 'rate'.
    // ACAO must be present even on the 429 or the browser could not READ the
    // status (an opaque CORS failure would classify as 'service' instead).
    for (const host of [
      'https://translate.googleapis.com/**',
      'https://api.mymemory.translated.net/**'
    ]) {
      await page.route(host, (route) =>
        route.fulfill({
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*'
          },
          body: '{}'
        })
      )
    }

    const taskId = await bootTranslateDiagram(page)
    await page.getByRole('button', { name: /Translate/ }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'free translation service' })
    ).toBeVisible()
    // i18n translate.free.rate
    await expect(page.getByRole('status').filter({ hasText: /daily limit/ })).toBeVisible({
      timeout: 20_000
    })

    // The chain threw before the apply step — nothing was written.
    const names = await readNames(page, taskId)
    expect(names.nameAr).toBeNull()
    expect(names.name).toBe('Review order')
  })
})
