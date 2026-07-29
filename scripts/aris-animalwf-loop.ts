/**
 * Phase 16 — the AnimalWF full-data and natural-layout loop (plan §19).
 *
 * This is the *repeatable* form of §19.2: it drives the built artifact
 * (`dist/index.html`) through a real browser, imports the private AnimalWF
 * reference export, and measures what the **mounted product actually renders**
 * — not what any lane's algorithm returns in isolation.
 *
 *   1. Import AnimalWF.                                        (§19.2 step 1)
 *   2. Compare the lexical census, the semantic index and the accounting.
 *      A raw byte-level tag count of the export is computed here, completely
 *      independently of `src/aris/source`, so the three views can genuinely
 *      disagree.                                               (§19.2 step 2)
 *   3. Fail on divergence.                                     (§19.2 step 3)
 *   4. Render all eight source layouts.                        (§19.2 step 4)
 *   5. Render all eight clean layouts.                         (§19.2 step 5)
 *   6. Capture fixed-viewport screenshots.                     (§19.2 step 6)
 *   7. Measure shape overlaps, label/satellite overlaps, edge/shape
 *      crossings, edge/edge crossings, bend counts, route lengths, canvas
 *      area and detached endpoints — through `src/aris/layout`'s own
 *      `analyzeLayout`, never a re-implementation.             (§19.2 step 7)
 *   8. Inspect every XOR and return loop.                      (§19.2 step 8)
 *   9. Report the §19.4 acceptance verdict per model, per layout mode.
 *
 * Geometry is read back out of the rendered SVG (element transforms, hit
 * rectangles and connection path data), which is why the numbers describe the
 * product rather than the algorithm. Topology and identity come from the same
 * importer the product runs, so the two can be joined by element id.
 *
 * ## Privacy
 *
 * The AnimalWF export is private org data. The JSON report carries aggregate
 * numbers only — never element ids, never label text — and both it and the
 * screenshots default to `local-evidence/`, which `.gitignore` excludes. The
 * script refuses to write anywhere `git check-ignore` does not cover.
 *
 * ## Usage
 *
 * ```sh
 * npx vite-node scripts/aris-animalwf-loop.ts
 * npx vite-node scripts/aris-animalwf-loop.ts -- --report-only
 * ```
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, type Browser, type Page } from '@playwright/test'

import { buildAdjacency, findStronglyConnectedComponents } from '../src/aris/layout/graph'
import { analyzeLayout } from '../src/aris/layout/metrics'
import { evaluateLayoutAcceptance } from '../src/aris/layout/rejection'
import type {
  ArisLayoutEdgeInput,
  ArisLayoutEdgeRoute,
  ArisLayoutNodeInput,
  ArisLayoutNodePlacement,
  ArisLayoutPoint,
  ArisLayoutRect
} from '../src/aris/layout/types'
import { isSatelliteObjectType, ruleOperatorOfSymbol } from '../src/aris/canvas/vocabulary'
import { buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'
import type { ArisModel, ArisObjectOccurrence } from '../src/aris/model/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** The one fixed viewport every screenshot and every layout is measured at. */
const VIEWPORT = Object.freeze({ width: 1600, height: 1000 })
const DEVICE_SCALE_FACTOR = 1

/** Endpoint attachment tolerance, in AML units. */
const ATTACH_TOLERANCE = 0.75

/** §19.1 baseline the census must independently agree with. */
const BASELINE = Object.freeze({
  models: 8,
  eepcModels: 7,
  valueAddedChainModels: 1,
  objectDefinitions: 279,
  objectOccurrences: 494,
  attributeDefinitions: 516,
  attributeOccurrences: 774,
  freeTextRecords: 69,
  lanes: 16,
  oleRecords: 14,
  blobs: 28,
  fontStyleSheets: 6
})

interface CliOptions {
  readonly fixture: string
  readonly dist: string
  readonly outJson: string
  readonly screensDir: string
  readonly reportOnly: boolean
}

function parseArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>()
  let reportOnly = false
  for (const arg of argv) {
    if (arg === '--report-only') {
      reportOnly = true
      continue
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (match) values.set(match[1] as string, match[2] as string)
  }
  const abs = (value: string): string => (isAbsolute(value) ? value : resolve(REPO, value))
  return {
    fixture: abs(values.get('fixture') ?? '../reference/AnimalWF/ARISAMLExport.xml'),
    dist: abs(values.get('dist') ?? 'dist/index.html'),
    outJson: abs(values.get('out') ?? 'local-evidence/aris-animalwf-loop.json'),
    screensDir: abs(values.get('screens') ?? 'local-evidence/aris-animalwf-screens'),
    reportOnly
  }
}

/**
 * Refuse to write anywhere git would track. The AnimalWF export is private and
 * a screenshot of it is just as private as the export itself.
 */
function assertGitIgnored(path: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO, stdio: 'ignore' })
  } catch {
    throw new Error(
      `Refusing to write ${path}: it is not git-ignored. Phase 16 output derives from the ` +
        'private AnimalWF export and must never enter the repository.'
    )
  }
}

// ---------------------------------------------------------------------------
// Step 2a — an independent, byte-level census of the raw export
// ---------------------------------------------------------------------------

interface RawCensus {
  readonly bytes: number
  readonly elementCounts: Readonly<Record<string, number>>
}

/**
 * Count start tags directly in the file text. This shares no code with
 * `src/aris/source` or `src/aris/accounting`, which is the whole point: it is
 * the third, independent opinion §19.2 step 2 asks for.
 */
function rawCensus(text: string): RawCensus {
  const counts: Record<string, number> = {}
  const pattern = /<([A-Za-z_][\w.-]*)(\s[^>]*?)?(\/)?>/g
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    const name = match[1] as string
    counts[name] = (counts[name] ?? 0) + 1
    match = pattern.exec(text)
  }
  return { bytes: Buffer.byteLength(text, 'utf8'), elementCounts: Object.freeze(counts) }
}

// ---------------------------------------------------------------------------
// Rendered-geometry extraction (runs inside the page)
// ---------------------------------------------------------------------------

interface RenderedShape {
  readonly id: string
  readonly classes: string
  readonly kind: string | null
  readonly symbol: string | null
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface RenderedConnection {
  readonly id: string
  readonly connectionType: string | null
  readonly points: readonly ArisLayoutPoint[]
}

interface RenderedModel {
  readonly rootId: string | null
  /** Scale factor the viewport transform applies, i.e. CSS px per AML unit. */
  readonly zoom: number
  /** Size of the canvas element itself, in CSS pixels. */
  readonly viewportPx: { readonly width: number; readonly height: number }
  readonly shapes: readonly RenderedShape[]
  readonly connections: readonly RenderedConnection[]
  readonly fidelityMarks: number
}

/**
 * Read every rendered element out of the live SVG.
 *
 * Coordinates are diagram coordinates, not screen pixels: a shape's group
 * carries `matrix(1 0 0 1 x y)` and its `.djs-hit` rectangle carries the
 * element's width/height, while the zoom/scroll transform lives on an
 * ancestor. The measurement is therefore independent of the current zoom.
 */
function extractRenderedModel(modelId: string): RenderedModel {
  const canvasEl = document.querySelector('[data-orbitpm-aris-canvas]')
  if (!canvasEl) throw new Error('No ARIS canvas is mounted.')
  const svg = canvasEl.querySelector('svg')
  if (!svg) throw new Error('The ARIS canvas has no SVG root.')

  const roots = Array.from(svg.querySelectorAll('g[data-element-id^="model:"]'))
  const root = roots.find((node) => node.getAttribute('data-element-id') === `model:${modelId}`)
  if (!root) throw new Error(`Model ${modelId} has no root layer.`)

  const viewport = svg.querySelector('.viewport')
  const transform = viewport?.getAttribute('transform') ?? ''
  const zoomMatch = /matrix\(\s*([-\d.eE+]+)/.exec(transform)
  const zoom = zoomMatch ? Number(zoomMatch[1]) : 1

  const numbersIn = (value: string): number[] => {
    const found = value.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)
    return found ? found.map(Number) : []
  }

  const shapes: RenderedShape[] = []
  const connections: RenderedConnection[] = []

  for (const group of Array.from(root.querySelectorAll('g.djs-element[data-element-id]'))) {
    const id = group.getAttribute('data-element-id')
    if (!id) continue
    const classes = group.getAttribute('class') ?? ''
    const kindHost = group.querySelector('[data-aris-kind]')
    const kind = kindHost?.getAttribute('data-aris-kind') ?? null
    const symbol = kindHost?.getAttribute('data-aris-symbol') ?? null

    if (classes.includes('djs-connection')) {
      const path = group.querySelector('.djs-visual path')
      const d = path?.getAttribute('d') ?? ''
      const flat = numbersIn(d)
      const points: ArisLayoutPoint[] = []
      for (let index = 0; index + 1 < flat.length; index += 2) {
        points.push({ x: flat[index] as number, y: flat[index + 1] as number })
      }
      connections.push({
        id,
        connectionType: path?.getAttribute('data-aris-connection-type') ?? null,
        points
      })
      continue
    }

    const matrix = numbersIn(group.getAttribute('transform') ?? '')
    const x = matrix.length >= 6 ? (matrix[4] as number) : 0
    const y = matrix.length >= 6 ? (matrix[5] as number) : 0
    const hit = group.querySelector('.djs-hit')
    let width = Number(hit?.getAttribute('width') ?? Number.NaN)
    let height = Number(hit?.getAttribute('height') ?? Number.NaN)
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      const box = (group as SVGGraphicsElement).getBBox()
      width = box.width
      height = box.height
    }
    shapes.push({ id, classes, kind, symbol, x, y, width, height })
  }

  const box = canvasEl.getBoundingClientRect()
  return {
    rootId: root.getAttribute('data-element-id'),
    zoom,
    viewportPx: { width: box.width, height: box.height },
    shapes,
    connections,
    fidelityMarks: root.querySelectorAll('[data-aris-fidelity]').length
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

type NodeSetName = 'occurrences' | 'rendered'

interface MeasuredSet {
  readonly nodeSet: NodeSetName
  readonly nodeCount: number
  readonly edgeCount: number
  readonly metrics: Record<string, number>
  readonly accepted: boolean
  readonly findings: readonly { code: string; subjectCount: number }[]
}

interface ModeMeasurement {
  readonly mode: 'source' | 'clean'
  readonly renderedShapes: number
  readonly renderedOccurrences: number
  readonly renderedLanes: number
  readonly renderedFreeText: number
  readonly renderedExternalLabels: number
  readonly renderedConnections: number
  readonly missingOccurrences: number
  readonly missingConnections: number
  readonly laneBands: readonly ArisLayoutRect[]
  readonly sets: readonly MeasuredSet[]
  readonly screenshot: string
  readonly toast: string | null
}

function placementOf(
  id: string,
  rect: ArisLayoutRect,
  kind: 'control-flow' | 'satellite',
  role: ArisLayoutNodePlacement['role'],
  labelRect: ArisLayoutRect | null
): ArisLayoutNodePlacement {
  return {
    id,
    kind,
    role,
    rect,
    labelRect,
    componentIndex: 0,
    stronglyConnectedIndex: -1,
    rank: -1,
    laneId: null
  }
}

function roleOf(objectType: string): ArisLayoutNodePlacement['role'] {
  if (objectType === 'OT_FUNC') return 'function'
  if (objectType === 'OT_EVT') return 'event'
  if (objectType === 'OT_RULE') return 'rule'
  return isSatelliteObjectType(objectType) ? 'satellite' : 'other'
}

function roundMetrics(values: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = Number.isFinite(value) ? Number(value.toFixed(4)) : value
  }
  return out
}

interface ModelTopology {
  readonly model: ArisModel
  readonly objectTypeOf: ReadonlyMap<string, string>
  readonly controlFlowEdgeIds: ReadonlySet<string>
}

function topologyOf(model: ArisModel, objectTypeOf: ReadonlyMap<string, string>): ModelTopology {
  const controlFlow = new Set<string>()
  for (const connection of model.connectionOccurrences) {
    const sourceRole = roleOf(objectTypeOf.get(connection.sourceOccurrenceId) ?? 'OT_UNKNOWN')
    const targetRole = roleOf(objectTypeOf.get(connection.targetOccurrenceId) ?? 'OT_UNKNOWN')
    const flow =
      sourceRole !== 'satellite' &&
      sourceRole !== 'other' &&
      targetRole !== 'satellite' &&
      targetRole !== 'other'
    if (flow) controlFlow.add(connection.id)
  }
  return { model, objectTypeOf, controlFlowEdgeIds: controlFlow }
}

function measure(
  topology: ModelTopology,
  rendered: RenderedModel,
  nodeSet: NodeSetName
): MeasuredSet {
  const { model, objectTypeOf, controlFlowEdgeIds } = topology
  const shapeById = new Map(rendered.shapes.map((shape) => [shape.id, shape]))

  const labelRects = new Map<string, ArisLayoutRect>()
  for (const shape of rendered.shapes) {
    if (shape.kind !== 'label') continue
    const owner = shape.id.replace(/^label:/, '')
    labelRects.set(owner, { x: shape.x, y: shape.y, width: shape.width, height: shape.height })
  }

  const nodes: ArisLayoutNodePlacement[] = []
  for (const occurrence of model.occurrences) {
    const shape = shapeById.get(occurrence.id)
    if (!shape) continue
    const objectType = objectTypeOf.get(occurrence.id) ?? 'OT_UNKNOWN'
    const role = roleOf(objectType)
    nodes.push(
      placementOf(
        occurrence.id,
        { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
        role === 'satellite' ? 'satellite' : 'control-flow',
        role,
        labelRects.get(occurrence.id) ?? null
      )
    )
  }
  if (nodeSet === 'rendered') {
    for (const shape of rendered.shapes) {
      if (shape.kind !== 'freeText') continue
      nodes.push(
        placementOf(
          shape.id,
          { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
          'satellite',
          'satellite',
          null
        )
      )
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: ArisLayoutEdgeRoute[] = []
  for (const connection of model.connectionOccurrences) {
    const drawn = rendered.connections.find((entry) => entry.id === connection.id)
    if (!drawn) continue
    if (!nodeIds.has(connection.sourceOccurrenceId) || !nodeIds.has(connection.targetOccurrenceId))
      continue
    edges.push({
      id: connection.id,
      source: connection.sourceOccurrenceId,
      target: connection.targetOccurrenceId,
      kind: controlFlowEdgeIds.has(connection.id) ? 'control-flow' : 'satellite',
      classification: 'forward',
      points: drawn.points
    })
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const node of nodes) {
    grow(node.rect.x, node.rect.y)
    grow(node.rect.x + node.rect.width, node.rect.y + node.rect.height)
    if (node.labelRect) {
      grow(node.labelRect.x, node.labelRect.y)
      grow(node.labelRect.x + node.labelRect.width, node.labelRect.y + node.labelRect.height)
    }
  }
  for (const edge of edges) for (const point of edge.points) grow(point.x, point.y)
  const canvas: ArisLayoutRect = Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 }

  const expectedEdgeIds = model.connectionOccurrences
    .filter(
      (connection) =>
        nodeIds.has(connection.sourceOccurrenceId) && nodeIds.has(connection.targetOccurrenceId)
    )
    .map((connection) => connection.id)

  const analysis = analyzeLayout({
    nodes,
    edges,
    canvas,
    expectedEdgeIds,
    attachTolerance: ATTACH_TOLERANCE
  })
  const acceptance = evaluateLayoutAcceptance(analysis.metrics, analysis.defects)

  return {
    nodeSet,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    metrics: roundMetrics(analysis.metrics as unknown as Record<string, number>),
    accepted: acceptance.accepted,
    findings: acceptance.findings.map((entry) => ({
      code: entry.code,
      subjectCount: entry.subjects.length
    }))
  }
}

// ---------------------------------------------------------------------------
// Readability at the fixed viewport (§19.5 "readable in source and clean layout")
// ---------------------------------------------------------------------------

/**
 * A shape drawn smaller than this cannot carry a legible caption at the fixed
 * viewport, so a model whose median shape falls below it is not "readable" in
 * any useful sense. It is a floor, not a tuning knob: the raw pixel numbers are
 * reported alongside so the verdict can be re-judged without re-running.
 */
const MIN_READABLE_SHAPE_PX = 6

interface ReadabilityReport {
  readonly zoomAfterFit: number
  readonly viewportPx: { readonly width: number; readonly height: number }
  readonly contentWidthPx: number
  readonly contentHeightPx: number
  readonly contentFillRatio: number
  readonly medianShapeHeightPx: number
  readonly smallestShapeHeightPx: number
  /**
   * How much larger the fitted extent is than the actual content, because
   * non-content frames (lane bands) sit outside the content box. 1 means the
   * fit is driven by the content itself.
   */
  readonly frameInflationFactor: number
  /**
   * The scale a fit-to-viewport would reach if only the content were fitted.
   * Together with `medianShapeHeightPxIfFitToContent` this separates "the
   * layout is too dense to read" from "something outside the content is
   * driving the fit".
   */
  readonly projectedZoomIfFitToContent: number
  readonly medianShapeHeightPxIfFitToContent: number
  /** Content shapes rendered with a zero width or height — invisible on screen. */
  readonly zeroSizedShapes: number
  readonly readable: boolean
}

function measureReadability(rendered: RenderedModel): ReadabilityReport {
  const content = rendered.shapes.filter(
    (shape) => shape.kind === 'occurrence' || shape.kind === 'freeText' || shape.kind === 'label'
  )
  const scale = rendered.zoom
  const extentOf = (shapes: readonly RenderedShape[]): { width: number; height: number } | null => {
    if (shapes.length === 0) return null
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const shape of shapes) {
      minX = Math.min(minX, shape.x)
      minY = Math.min(minY, shape.y)
      maxX = Math.max(maxX, shape.x + shape.width)
      maxY = Math.max(maxY, shape.y + shape.height)
    }
    return { width: maxX - minX, height: maxY - minY }
  }

  const contentExtent = extentOf(content) ?? { width: 0, height: 0 }
  const fullExtent = extentOf(rendered.shapes) ?? contentExtent
  const heights = content.map((shape) => shape.height * scale).sort((left, right) => left - right)
  const median = heights.length === 0 ? 0 : (heights[Math.floor(heights.length / 2)] as number)
  const smallest = heights.length === 0 ? 0 : (heights[0] as number)
  const contentWidthPx = contentExtent.width * scale
  const contentHeightPx = contentExtent.height * scale
  const viewportArea = rendered.viewportPx.width * rendered.viewportPx.height
  const inflation = Math.max(
    contentExtent.width > 0 ? fullExtent.width / contentExtent.width : 1,
    contentExtent.height > 0 ? fullExtent.height / contentExtent.height : 1
  )

  const projectedZoom =
    contentExtent.width > 0 && contentExtent.height > 0
      ? Math.min(
          rendered.viewportPx.width / contentExtent.width,
          rendered.viewportPx.height / contentExtent.height
        )
      : scale
  const medianHeightUnits = scale > 0 ? median / scale : 0

  return {
    zoomAfterFit: Number(scale.toFixed(6)),
    viewportPx: rendered.viewportPx,
    contentWidthPx: Number(contentWidthPx.toFixed(2)),
    contentHeightPx: Number(contentHeightPx.toFixed(2)),
    contentFillRatio:
      viewportArea > 0 ? Number(((contentWidthPx * contentHeightPx) / viewportArea).toFixed(5)) : 0,
    medianShapeHeightPx: Number(median.toFixed(2)),
    smallestShapeHeightPx: Number(smallest.toFixed(2)),
    frameInflationFactor: Number(inflation.toFixed(2)),
    projectedZoomIfFitToContent: Number(projectedZoom.toFixed(6)),
    medianShapeHeightPxIfFitToContent: Number((medianHeightUnits * projectedZoom).toFixed(2)),
    zeroSizedShapes: content.filter((shape) => shape.width <= 0 || shape.height <= 0).length,
    readable: median >= MIN_READABLE_SHAPE_PX
  }
}

// ---------------------------------------------------------------------------
// Lane bands (§12.4 — derived bands, never shapes)
// ---------------------------------------------------------------------------

interface LaneBandReport {
  readonly sourceLanes: number
  readonly renderedBands: number
  readonly horizontalInSource: number
  readonly verticalInSource: number
  readonly duplicateBands: number
  readonly bandsDisjointFromContent: number
  readonly widestBandOverContentWidth: number
  readonly tallestBandOverContentHeight: number
}

function inspectLaneBands(model: ArisModel, rendered: RenderedModel): LaneBandReport {
  const bands = rendered.shapes.filter((shape) => shape.kind === 'lane')
  const content = rendered.shapes.filter((shape) => shape.kind === 'occurrence')
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of content) {
    minX = Math.min(minX, shape.x)
    minY = Math.min(minY, shape.y)
    maxX = Math.max(maxX, shape.x + shape.width)
    maxY = Math.max(maxY, shape.y + shape.height)
  }
  const contentWidth = Number.isFinite(minX) ? maxX - minX : 0
  const contentHeight = Number.isFinite(minY) ? maxY - minY : 0

  const seen = new Set<string>()
  let duplicates = 0
  let disjoint = 0
  let widest = 0
  let tallest = 0
  for (const band of bands) {
    const key = `${band.x}:${band.y}:${band.width}:${band.height}`
    if (seen.has(key)) duplicates += 1
    seen.add(key)
    const overlapsContent =
      Number.isFinite(minX) &&
      band.x < maxX &&
      minX < band.x + band.width &&
      band.y < maxY &&
      minY < band.y + band.height
    if (!overlapsContent) disjoint += 1
    if (contentWidth > 0) widest = Math.max(widest, band.width / contentWidth)
    if (contentHeight > 0) tallest = Math.max(tallest, band.height / contentHeight)
  }

  let horizontal = 0
  let vertical = 0
  for (const lane of model.lanes) {
    if ((lane.orientation ?? '').toUpperCase() === 'VERTICAL') vertical += 1
    else horizontal += 1
  }

  return {
    sourceLanes: model.lanes.length,
    renderedBands: bands.length,
    horizontalInSource: horizontal,
    verticalInSource: vertical,
    duplicateBands: duplicates,
    bandsDisjointFromContent: disjoint,
    widestBandOverContentWidth: Number(widest.toFixed(2)),
    tallestBandOverContentHeight: Number(tallest.toFixed(2))
  }
}

// ---------------------------------------------------------------------------
// Return-loop / XOR inspection (§19.2 step 8, §19.3)
// ---------------------------------------------------------------------------

interface ReturnLoopReport {
  readonly xorRules: number
  readonly xorSplits: number
  readonly xorMerges: number
  readonly andRules: number
  readonly orRules: number
  readonly controlFlowEdges: number
  readonly cycles: readonly {
    size: number
    throughXorMerge: boolean
    internalEdges: number
    drawnEdges: number
  }[]
  readonly selfLoops: number
  readonly largestCycle: number
}

function inspectReturnLoops(topology: ModelTopology, rendered: RenderedModel): ReturnLoopReport {
  const { model, objectTypeOf, controlFlowEdgeIds } = topology
  const drawnIds = new Set(rendered.connections.map((entry) => entry.id))

  const controlOccurrences = model.occurrences.filter(
    (occurrence) => roleOf(objectTypeOf.get(occurrence.id) ?? 'OT_UNKNOWN') !== 'satellite'
  )
  const nodeInputs: ArisLayoutNodeInput[] = controlOccurrences.map((occurrence) => ({
    id: occurrence.id,
    role: roleOf(objectTypeOf.get(occurrence.id) ?? 'OT_UNKNOWN'),
    size: { width: occurrence.bounds.width, height: occurrence.bounds.height }
  }))
  const edgeInputs: ArisLayoutEdgeInput[] = model.connectionOccurrences
    .filter((connection) => controlFlowEdgeIds.has(connection.id))
    .map((connection) => ({
      id: connection.id,
      source: connection.sourceOccurrenceId,
      target: connection.targetOccurrenceId,
      kind: 'control-flow' as const
    }))

  const adjacency = buildAdjacency(nodeInputs, edgeInputs)
  const scc = findStronglyConnectedComponents(adjacency)

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const edge of edgeInputs) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  let xorRules = 0
  let xorSplits = 0
  let xorMerges = 0
  let andRules = 0
  let orRules = 0
  const xorIds = new Set<string>()
  for (const occurrence of controlOccurrences) {
    if ((objectTypeOf.get(occurrence.id) ?? '') !== 'OT_RULE') continue
    const operator = ruleOperatorOfSymbol(occurrence.symbol)
    if (operator === 'XOR') {
      xorRules += 1
      xorIds.add(occurrence.id)
      if ((outDegree.get(occurrence.id) ?? 0) > 1) xorSplits += 1
      if ((inDegree.get(occurrence.id) ?? 0) > 1) xorMerges += 1
    } else if (operator === 'AND') andRules += 1
    else if (operator === 'OR') orRules += 1
  }

  const cycles: {
    size: number
    throughXorMerge: boolean
    internalEdges: number
    drawnEdges: number
  }[] = []
  let selfLoops = 0
  for (const component of scc.components) {
    const memberIds = component.map((index) => adjacency.ids[index] as string)
    const selfLoop =
      memberIds.length === 1 &&
      edgeInputs.some((edge) => edge.source === edge.target && edge.source === memberIds[0])
    if (memberIds.length === 1 && !selfLoop) continue
    if (selfLoop) selfLoops += 1
    const memberSet = new Set(memberIds)
    const inside = edgeInputs.filter(
      (edge) => memberSet.has(edge.source) && memberSet.has(edge.target)
    )
    cycles.push({
      size: memberIds.length,
      throughXorMerge: memberIds.some(
        (id) => xorIds.has(id) && (inDegree.get(id) ?? 0) > 1 && memberSet.has(id)
      ),
      internalEdges: inside.length,
      drawnEdges: inside.filter((edge) => drawnIds.has(edge.id)).length
    })
  }
  cycles.sort((left, right) => right.size - left.size)

  return {
    xorRules,
    xorSplits,
    xorMerges,
    andRules,
    orRules,
    controlFlowEdges: edgeInputs.length,
    cycles,
    selfLoops,
    largestCycle: cycles.reduce((highest, entry) => Math.max(highest, entry.size), 0)
  }
}

// ---------------------------------------------------------------------------
// Browser driving
// ---------------------------------------------------------------------------

async function openProduct(browser: Browser, options: CliOptions): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: DEVICE_SCALE_FACTOR
  })
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
  })
  await page.goto(pathToFileURL(options.dist).toString(), { waitUntil: 'load' })
  await page
    .getByRole('heading', { name: 'OrbitPM ARIS Studio Lite' })
    .waitFor({ state: 'visible' })
  await page.locator('input[type="file"]').first().setInputFiles(options.fixture)
  await page
    .locator('[data-orbitpm-aris-model]')
    .first()
    .waitFor({ state: 'attached', timeout: 300_000 })
  await page
    .locator('[data-orbitpm-aris-canvas] [data-element-id^="ObjOcc."]')
    .first()
    .waitFor({ state: 'attached', timeout: 300_000 })
  return page
}

interface ProductFacts {
  readonly facts: Readonly<Record<string, string>>
  readonly accountingSummary: string
  readonly fidelityCounts: number
  readonly modelButtons: readonly { id: string; label: string }[]
}

async function readProductFacts(page: Page): Promise<ProductFacts> {
  return page.evaluate(() => {
    const facts: Record<string, string> = {}
    for (const list of Array.from(document.querySelectorAll('dl'))) {
      for (const term of Array.from(list.querySelectorAll('dt'))) {
        const value = term.nextElementSibling?.textContent ?? ''
        facts[term.textContent ?? ''] = value
      }
    }
    return {
      facts,
      accountingSummary:
        document.querySelector('[data-orbitpm-aris-accounting] p')?.textContent ?? '',
      fidelityCounts: document.querySelectorAll('[data-orbitpm-aris-fidelity] dt').length,
      modelButtons: Array.from(document.querySelectorAll('[data-orbitpm-aris-model]')).map(
        (button) => ({
          id: button.getAttribute('data-orbitpm-aris-model') ?? '',
          label: button.textContent ?? ''
        })
      )
    }
  })
}

async function selectModel(page: Page, modelId: string, occurrences: number): Promise<void> {
  await page.locator(`[data-orbitpm-aris-model="${modelId}"]`).click()
  await page.waitForFunction(
    ([id, expected]) => {
      const root = document.querySelector(
        `[data-orbitpm-aris-canvas] g[data-element-id="model:${id}"]`
      )
      if (!root) return false
      return root.querySelectorAll('g.djs-element[data-element-id^="ObjOcc."]').length === expected
    },
    [modelId, occurrences] as [string, number],
    { timeout: 120_000 }
  )
}

async function zoomToViewport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zoom Fit', exact: true }).click()
  await page.waitForTimeout(120)
}

async function latestToast(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
    const last = nodes[nodes.length - 1]
    return last?.textContent ?? null
  })
  return text && text.trim() !== '' ? text.trim() : null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Failure {
  readonly area: string
  readonly detail: string
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const failures: Failure[] = []
  const observations: Failure[] = []
  const record = (area: string, detail: string): void => {
    failures.push({ area, detail })
  }
  /**
   * Something worth reporting that is not a §19.5 gate failure — most often a
   * property of the *source* rather than of the product. Source Layout is
   * contractually an exact replay of the imported coordinates (§12.4), so the
   * §19.4 natural-layout criteria cannot be gated against it.
   */
  const observe = (area: string, detail: string): void => {
    observations.push({ area, detail })
  }

  if (!existsSync(options.fixture)) {
    throw new Error(
      `The AnimalWF reference export is missing at ${options.fixture}. Phase 16 cannot run ` +
        'without it; pass --fixture=<path>.'
    )
  }
  if (!existsSync(options.dist)) {
    throw new Error(`Missing built artifact at ${options.dist}. Run \`npm run build:aris\` first.`)
  }

  assertGitIgnored(options.outJson)
  assertGitIgnored(options.screensDir)
  mkdirSync(dirname(options.outJson), { recursive: true })
  rmSync(options.screensDir, { recursive: true, force: true })
  mkdirSync(options.screensDir, { recursive: true })

  // -- Step 2a: three independent views of the same source ------------------
  const bytes = new Uint8Array(readFileSync(options.fixture))
  const pkg = await createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: 'ARISAMLExport.xml',
    bytes
  })
  const studio = buildArisStudioDocument(pkg)
  const raw = rawCensus(pkg.text)
  const rawCount = (name: string): number => raw.elementCounts[name] ?? 0

  const objectTypeOf = new Map<string, string>()
  for (const model of studio.source.models.values()) {
    for (const occurrence of model.occurrences) {
      const definition = studio.source.objectDefinitions.get(occurrence.definitionId)
      objectTypeOf.set(occurrence.id, definition?.type ?? 'OT_UNKNOWN')
    }
  }

  const indexCounts = {
    models: pkg.index.models.size,
    objectDefinitions: pkg.index.objectDefinitions.size,
    objectOccurrences: pkg.index.objectOccurrences.size,
    connectionDefinitions: pkg.index.connectionDefinitions.size,
    connectionOccurrences: pkg.index.connectionOccurrences.size,
    attributes: pkg.index.attributes.length,
    diagnostics: pkg.diagnostics.length,
    unknownRecords: pkg.index.unknownRecords.length
  }
  const rawCounts = {
    models: rawCount('Model'),
    objectDefinitions: rawCount('ObjDef'),
    objectOccurrences: rawCount('ObjOcc'),
    connectionDefinitions: rawCount('CxnDef'),
    connectionOccurrences: rawCount('CxnOcc'),
    attributeDefinitions: rawCount('AttrDef'),
    attributeOccurrences: rawCount('AttrOcc'),
    freeTextDefinitions: rawCount('FFTextDef'),
    freeTextOccurrences: rawCount('FFTextOcc'),
    lanes: rawCount('Lane'),
    oleDefinitions: rawCount('OLEDef'),
    oleOccurrences: rawCount('OLEOcc'),
    blobs: rawCount('Blob'),
    fontStyleSheets: rawCount('FontStyleSheet')
  }

  const compare = (label: string, left: number, right: number): void => {
    if (left !== right) record('census', `${label}: ${left} !== ${right}`)
  }
  compare('raw Model vs index.models', rawCounts.models, indexCounts.models)
  compare(
    'raw ObjDef vs index.objectDefinitions',
    rawCounts.objectDefinitions,
    indexCounts.objectDefinitions
  )
  compare(
    'raw ObjOcc vs index.objectOccurrences',
    rawCounts.objectOccurrences,
    indexCounts.objectOccurrences
  )
  compare(
    'raw CxnDef vs index.connectionDefinitions',
    rawCounts.connectionDefinitions,
    indexCounts.connectionDefinitions
  )
  compare(
    'raw CxnOcc vs index.connectionOccurrences',
    rawCounts.connectionOccurrences,
    indexCounts.connectionOccurrences
  )
  compare('baseline models', BASELINE.models, indexCounts.models)
  compare('baseline objectDefinitions', BASELINE.objectDefinitions, indexCounts.objectDefinitions)
  compare('baseline objectOccurrences', BASELINE.objectOccurrences, indexCounts.objectOccurrences)
  compare(
    'baseline attributeDefinitions',
    BASELINE.attributeDefinitions,
    rawCounts.attributeDefinitions
  )
  compare(
    'baseline attributeOccurrences',
    BASELINE.attributeOccurrences,
    rawCounts.attributeOccurrences
  )
  compare('baseline lanes', BASELINE.lanes, rawCounts.lanes)
  compare('baseline blobs', BASELINE.blobs, rawCounts.blobs)
  compare('baseline fontStyleSheets', BASELINE.fontStyleSheets, rawCounts.fontStyleSheets)

  const accounting = {
    totalSourceRecords: studio.accounting.totalSourceRecords,
    totalAccounted: studio.accounting.totalAccounted,
    unaccountedCount: studio.accounting.unaccountedCount,
    issues: studio.accounting.issues.length
  }
  if (accounting.unaccountedCount !== 0) {
    record('accounting', `${accounting.unaccountedCount} unaccounted source record(s)`)
  }
  if (accounting.issues !== 0) {
    record('accounting', `${accounting.issues} reconciliation issue(s)`)
  }

  // The working-model projection must not silently drop records the census
  // counted. Accounting cannot catch this: a dropped record is still an
  // accounted *source* record, it simply never reaches a model.
  const projectedFreeText = [...studio.source.models.values()].reduce(
    (total, model) => total + model.freeText.length,
    0
  )
  const projectedLanes = [...studio.source.models.values()].reduce(
    (total, model) => total + model.lanes.length,
    0
  )
  if (projectedFreeText !== pkg.index.freeTextOccurrences.length) {
    record(
      'mapping',
      `free-text occurrences: ${pkg.index.freeTextOccurrences.length} indexed, ${projectedFreeText} reached a model`
    )
  }
  if (projectedLanes !== rawCounts.lanes) {
    record('mapping', `lanes: ${rawCounts.lanes} in source, ${projectedLanes} reached a model`)
  }

  const modelTypes: Record<string, number> = {}
  for (const model of studio.source.models.values()) {
    modelTypes[model.type] = (modelTypes[model.type] ?? 0) + 1
  }
  if ((modelTypes.MT_EEPC ?? 0) !== BASELINE.eepcModels) {
    record('census', `MT_EEPC models: ${modelTypes.MT_EEPC ?? 0} !== ${BASELINE.eepcModels}`)
  }
  if ((modelTypes.MT_VAL_ADD_CHN_DGM ?? 0) !== BASELINE.valueAddedChainModels) {
    record(
      'census',
      `MT_VAL_ADD_CHN_DGM models: ${modelTypes.MT_VAL_ADD_CHN_DGM ?? 0} !== ${BASELINE.valueAddedChainModels}`
    )
  }

  // -- Steps 1, 4-8: drive the mounted product ------------------------------
  const browser = await chromium.launch({ headless: true })
  const modelReports: Record<string, unknown>[] = []
  const returnLoopByModel = new Map<string, ReturnLoopReport>()
  try {
    const page = await openProduct(browser, options)
    const product = await readProductFacts(page)
    const factNumber = (label: string): number => Number(product.facts[label] ?? Number.NaN)

    const productFacts = {
      models: factNumber('Models'),
      objectDefinitions: factNumber('Object definitions'),
      objectOccurrences: factNumber('Object occurrences'),
      connectionDefinitions: factNumber('Connection definitions'),
      connectionOccurrences: factNumber('Connection occurrences'),
      attributeDefinitions: factNumber('Attribute definitions'),
      xmlTokens: factNumber('XML tokens'),
      syntaxNodes: factNumber('Syntax nodes'),
      semanticDiagnostics: factNumber('Semantic diagnostics'),
      unknownRecords: factNumber('Unknown records')
    }
    compare('product Models vs index', productFacts.models, indexCounts.models)
    compare(
      'product Object definitions vs index',
      productFacts.objectDefinitions,
      indexCounts.objectDefinitions
    )
    compare(
      'product Object occurrences vs index',
      productFacts.objectOccurrences,
      indexCounts.objectOccurrences
    )
    compare(
      'product Connection occurrences vs index',
      productFacts.connectionOccurrences,
      indexCounts.connectionOccurrences
    )
    if (product.modelButtons.length !== BASELINE.models) {
      record('census', `model explorer lists ${product.modelButtons.length} models`)
    }

    const summaryNumbers = product.accountingSummary.match(/\d[\d,]*/g) ?? []
    const productUnaccounted = Number((summaryNumbers[2] ?? '').replace(/,/g, ''))
    if (Number.isFinite(productUnaccounted) && productUnaccounted !== accounting.unaccountedCount) {
      record(
        'accounting',
        `product rail reports ${productUnaccounted} unaccounted, harness computed ${accounting.unaccountedCount}`
      )
    }

    const orderedModels = product.modelButtons.map((button) => button.id)
    for (const modelId of orderedModels) {
      const model = studio.source.models.get(modelId)
      if (!model) {
        record('model', `${modelId} is listed by the explorer but absent from the document`)
        continue
      }
      const topology = topologyOf(model, objectTypeOf)
      const index = orderedModels.indexOf(modelId)
      const slug = `model-${String(index + 1).padStart(2, '0')}`

      await selectModel(page, modelId, model.occurrences.length)
      await zoomToViewport(page)

      // -- Source layout ---------------------------------------------------
      const sourceRendered = await page.evaluate(extractRenderedModel, modelId)
      const sourceShot = resolve(options.screensDir, `${slug}-source.png`)
      await page.locator('[data-orbitpm-aris-canvas]').screenshot({ path: sourceShot })

      // §12.4: Source Layout must reproduce the imported coordinates exactly.
      const renderedById = new Map(sourceRendered.shapes.map((shape) => [shape.id, shape]))
      let sourceGeometryMismatches = 0
      for (const occurrence of model.occurrences) {
        const shape = renderedById.get(occurrence.id)
        if (!shape) continue
        if (
          shape.x !== occurrence.bounds.x ||
          shape.y !== occurrence.bounds.y ||
          shape.width !== occurrence.bounds.width ||
          shape.height !== occurrence.bounds.height
        ) {
          sourceGeometryMismatches += 1
        }
      }
      if (sourceGeometryMismatches > 0) {
        record(
          'source-layout',
          `${slug}: ${sourceGeometryMismatches} occurrence(s) do not render at their imported coordinates`
        )
      }

      const sourceSets = [
        measure(topology, sourceRendered, 'occurrences'),
        measure(topology, sourceRendered, 'rendered')
      ]

      // -- Clean layout ----------------------------------------------------
      await page.locator('[data-orbitpm-aris-clean-layout]').click()
      await page
        .locator('[data-orbitpm-aris-layout-mode="clean"]')
        .waitFor({ state: 'attached', timeout: 180_000 })
      await zoomToViewport(page)
      const cleanToast = await latestToast(page)
      const cleanRendered = await page.evaluate(extractRenderedModel, modelId)
      const cleanShot = resolve(options.screensDir, `${slug}-clean.png`)
      await page.locator('[data-orbitpm-aris-canvas]').screenshot({ path: cleanShot })
      const cleanSets = [
        measure(topology, cleanRendered, 'occurrences'),
        measure(topology, cleanRendered, 'rendered')
      ]

      let movedByClean = 0
      const cleanById = new Map(cleanRendered.shapes.map((shape) => [shape.id, shape]))
      for (const occurrence of model.occurrences) {
        const before = renderedById.get(occurrence.id)
        const after = cleanById.get(occurrence.id)
        if (!before || !after) continue
        if (before.x !== after.x || before.y !== after.y) movedByClean += 1
      }

      // -- Reset to Source Layout -----------------------------------------
      await page.locator('[data-orbitpm-aris-reset-layout]').click()
      await page
        .locator('[data-orbitpm-aris-layout-mode="source"]')
        .waitFor({ state: 'attached', timeout: 180_000 })
      const resetRendered = await page.evaluate(extractRenderedModel, modelId)
      const resetById = new Map(resetRendered.shapes.map((shape) => [shape.id, shape]))
      let resetMismatches = 0
      for (const occurrence of model.occurrences) {
        const shape = resetById.get(occurrence.id)
        if (!shape) {
          resetMismatches += 1
          continue
        }
        if (shape.x !== occurrence.bounds.x || shape.y !== occurrence.bounds.y) resetMismatches += 1
      }
      if (resetMismatches > 0) {
        record(
          'layout-independence',
          `${slug}: ${resetMismatches} occurrence(s) did not return to the imported coordinates after Reset to Source Layout`
        )
      }

      const returnLoops = inspectReturnLoops(topology, sourceRendered)
      returnLoopByModel.set(modelId, returnLoops)

      const counted = (rendered: RenderedModel): Record<string, number> => ({
        shapes: rendered.shapes.length,
        occurrences: rendered.shapes.filter((shape) => shape.kind === 'occurrence').length,
        lanes: rendered.shapes.filter((shape) => shape.kind === 'lane').length,
        freeText: rendered.shapes.filter((shape) => shape.kind === 'freeText').length,
        externalLabels: rendered.shapes.filter((shape) => shape.kind === 'label').length,
        connections: rendered.connections.length
      })

      const sourceCounts = counted(sourceRendered)
      const cleanCounts = counted(cleanRendered)
      if (sourceCounts.occurrences !== model.occurrences.length) {
        record(
          'render',
          `${slug}: ${sourceCounts.occurrences} occurrence shapes drawn for ${model.occurrences.length} occurrences`
        )
      }
      if (sourceCounts.connections !== model.connectionOccurrences.length) {
        record(
          'render',
          `${slug}: ${sourceCounts.connections} connections drawn for ${model.connectionOccurrences.length} connection occurrences`
        )
      }
      if (sourceCounts.freeText !== model.freeText.length) {
        record(
          'render',
          `${slug}: ${sourceCounts.freeText} free-text shapes drawn for ${model.freeText.length} free-text records`
        )
      }

      const laneBands = sourceRendered.shapes
        .filter((shape) => shape.kind === 'lane')
        .map((shape) => ({ x: shape.x, y: shape.y, width: shape.width, height: shape.height }))

      const sourceMode: ModeMeasurement = {
        mode: 'source',
        renderedShapes: sourceCounts.shapes as number,
        renderedOccurrences: sourceCounts.occurrences as number,
        renderedLanes: sourceCounts.lanes as number,
        renderedFreeText: sourceCounts.freeText as number,
        renderedExternalLabels: sourceCounts.externalLabels as number,
        renderedConnections: sourceCounts.connections as number,
        missingOccurrences: model.occurrences.length - (sourceCounts.occurrences as number),
        missingConnections:
          model.connectionOccurrences.length - (sourceCounts.connections as number),
        laneBands,
        sets: sourceSets,
        screenshot: sourceShot,
        toast: null
      }
      const cleanMode: ModeMeasurement = {
        mode: 'clean',
        renderedShapes: cleanCounts.shapes as number,
        renderedOccurrences: cleanCounts.occurrences as number,
        renderedLanes: cleanCounts.lanes as number,
        renderedFreeText: cleanCounts.freeText as number,
        renderedExternalLabels: cleanCounts.externalLabels as number,
        renderedConnections: cleanCounts.connections as number,
        missingOccurrences: model.occurrences.length - (cleanCounts.occurrences as number),
        missingConnections:
          model.connectionOccurrences.length - (cleanCounts.connections as number),
        laneBands: [],
        sets: cleanSets,
        screenshot: cleanShot,
        toast: cleanToast
      }

      // §19.4 gates the *natural* (clean) layout. Source Layout is an exact
      // replay of the imported coordinates, so a §19.4 miss there describes the
      // export, not the product, and is reported as an observation.
      for (const set of sourceMode.sets) {
        if (!set.accepted) {
          observe(
            'source-geometry',
            `${slug} source [${set.nodeSet}]: ${set.findings.map((entry) => entry.code).join(', ')}`
          )
        }
      }
      for (const set of cleanMode.sets) {
        if (!set.accepted) {
          record(
            'acceptance',
            `${slug} clean [${set.nodeSet}]: ${set.findings.map((entry) => entry.code).join(', ')}`
          )
        }
      }

      const sourceReadability = measureReadability(sourceRendered)
      const cleanReadability = measureReadability(cleanRendered)
      if (!sourceReadability.readable) {
        record(
          'readability',
          `${slug} source: median shape is ${sourceReadability.medianShapeHeightPx}px tall after Zoom Fit ` +
            `(frame inflation ${sourceReadability.frameInflationFactor}x, content fills ` +
            `${(sourceReadability.contentFillRatio * 100).toFixed(2)}% of the viewport)`
        )
      }
      if (!cleanReadability.readable) {
        record(
          'readability',
          `${slug} clean: median shape is ${cleanReadability.medianShapeHeightPx}px tall after Zoom Fit ` +
            `(frame inflation ${cleanReadability.frameInflationFactor}x, content fills ` +
            `${(cleanReadability.contentFillRatio * 100).toFixed(2)}% of the viewport)`
        )
      }

      if (sourceReadability.zeroSizedShapes > 0) {
        record(
          'render',
          `${slug}: ${sourceReadability.zeroSizedShapes} content shape(s) render with a zero width or height`
        )
      }

      const laneReport = inspectLaneBands(model, sourceRendered)
      if (laneReport.renderedBands !== laneReport.sourceLanes) {
        record(
          'lanes',
          `${slug}: ${laneReport.renderedBands} lane bands drawn for ${laneReport.sourceLanes} source lanes`
        )
      }
      if (laneReport.duplicateBands > 0) {
        record(
          'lanes',
          `${slug}: ${laneReport.duplicateBands} lane band(s) share identical geometry, so the ` +
            `source ${laneReport.horizontalInSource} horizontal / ${laneReport.verticalInSource} vertical split is lost`
        )
      }
      if (
        laneReport.tallestBandOverContentHeight > 2 ||
        laneReport.widestBandOverContentWidth > 2
      ) {
        record(
          'lanes',
          `${slug}: lane band extends ${laneReport.widestBandOverContentWidth}x the content width and ` +
            `${laneReport.tallestBandOverContentHeight}x the content height`
        )
      }

      for (const cycle of returnLoops.cycles) {
        if (cycle.drawnEdges !== cycle.internalEdges) {
          record(
            'return-flow',
            `${slug}: a ${cycle.size}-node cycle draws ${cycle.drawnEdges} of its ${cycle.internalEdges} edges`
          )
        }
      }

      const sourceCrossings = sourceSets[0]?.metrics.edgeEdgeCrossings ?? 0
      const cleanCrossings = cleanSets[0]?.metrics.edgeEdgeCrossings ?? 0
      const sourceLength = sourceSets[0]?.metrics.routeLengthTotal ?? 0
      const cleanLength = cleanSets[0]?.metrics.routeLengthTotal ?? 0
      if (cleanCrossings > sourceCrossings) {
        observe(
          'clean-layout-quality',
          `${slug}: clean layout has ${cleanCrossings} edge/edge crossings vs ${sourceCrossings} in source ` +
            `and ${(sourceLength > 0 ? cleanLength / sourceLength : 0).toFixed(1)}x the total route length`
        )
      }

      modelReports.push({
        index: index + 1,
        slug,
        id: modelId,
        name: (product.modelButtons[index]?.label ?? '').replace(/\d+ objects.*$/, '').trim(),
        type: model.type,
        occurrences: model.occurrences.length,
        connectionOccurrences: model.connectionOccurrences.length,
        lanes: model.lanes.length,
        freeText: model.freeText.length,
        source: sourceMode,
        clean: cleanMode,
        movedByCleanLayout: movedByClean,
        resetMismatches,
        sourceGeometryMismatches,
        readability: { source: sourceReadability, clean: cleanReadability },
        laneBandReport: laneReport,
        returnLoops
      })
    }

    // §11.5 spot check: selecting an object must reveal its connected lines.
    const highlight = await checkSelectionHighlight(page, studio, objectTypeOf)
    if (highlight.checked === 0) {
      record('selection', 'no occurrence could be selected through the accounting rail')
    } else if (highlight.mismatches > 0) {
      record(
        'selection',
        `${highlight.mismatches} of ${highlight.checked} selection highlight checks did not mark every incident connection`
      )
    }

    const report = {
      format: 'orbitpm-aris-animalwf-loop',
      version: 1,
      viewport: { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR, headless: true },
      fixtureBytes: raw.bytes,
      fixtureSha256: pkg.sha256,
      census: {
        baseline: BASELINE,
        raw: rawCounts,
        semanticIndex: indexCounts,
        product: productFacts
      },
      accounting,
      modelTypes,
      models: modelReports,
      selectionHighlight: highlight,
      minReadableShapePx: MIN_READABLE_SHAPE_PX,
      failures,
      observations
    }
    writeFileSync(options.outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } finally {
    await browser.close()
  }

  // -- Console summary ------------------------------------------------------
  console.log('')
  console.log(
    `Phase 16 AnimalWF loop — viewport ${VIEWPORT.width}x${VIEWPORT.height}, headless chromium`
  )
  console.log(`fixture sha256 ${pkg.sha256}`)
  console.log(
    `census: models=${indexCounts.models} objDef=${indexCounts.objectDefinitions} ` +
      `objOcc=${indexCounts.objectOccurrences} cxnDef=${indexCounts.connectionDefinitions} ` +
      `cxnOcc=${indexCounts.connectionOccurrences} attrDef=${rawCounts.attributeDefinitions} ` +
      `attrOcc=${rawCounts.attributeOccurrences} lanes=${rawCounts.lanes} blobs=${rawCounts.blobs}`
  )
  console.log(
    `accounting: ${accounting.totalAccounted} accounted / ${accounting.totalSourceRecords} source records, ` +
      `${accounting.unaccountedCount} unaccounted, ${accounting.issues} issues`
  )
  console.log('')
  const header = [
    'model',
    'mode',
    'set',
    'nodes',
    'edges',
    'shpOvl',
    'lblOvl',
    'edgShp',
    'edgEdg',
    'bends',
    'maxBend',
    'lenTot',
    'lenMax',
    'area',
    'w',
    'h',
    'detach',
    'miss',
    'dup',
    'zero',
    'bandX',
    'bandY',
    'ok'
  ]
  console.log(header.join('\t'))
  for (const entry of modelReports) {
    for (const mode of ['source', 'clean'] as const) {
      const measurement = entry[mode] as ModeMeasurement
      for (const set of measurement.sets) {
        const m = set.metrics
        console.log(
          [
            entry.slug,
            mode,
            set.nodeSet,
            set.nodeCount,
            set.edgeCount,
            m.shapeOverlaps,
            m.labelSatelliteOverlaps,
            m.edgeShapeCrossings,
            m.edgeEdgeCrossings,
            m.bendCount,
            m.maxBendsPerEdge,
            Math.round(m.routeLengthTotal as number),
            Math.round(m.routeLengthMax as number),
            Math.round(m.canvasArea as number),
            Math.round(m.canvasWidth as number),
            Math.round(m.canvasHeight as number),
            m.detachedEndpoints,
            m.missingEdges,
            m.duplicateEdges,
            m.zeroLengthEdges,
            m.largestEmptyBandXRatio,
            m.largestEmptyBandYRatio,
            set.accepted ? 'PASS' : 'FAIL'
          ].join('\t')
        )
      }
    }
  }
  console.log('')
  console.log('readability at the fixed viewport, after Zoom Fit:')
  console.log(
    [
      'model',
      'mode',
      'zoom',
      'medianShapePx',
      'smallestShapePx',
      'contentFill%',
      'frameInflation',
      'medianPxIfContentFitted',
      'readable'
    ].join('\t')
  )
  for (const entry of modelReports) {
    const readability = entry.readability as { source: ReadabilityReport; clean: ReadabilityReport }
    for (const mode of ['source', 'clean'] as const) {
      const value = readability[mode]
      console.log(
        [
          entry.slug,
          mode,
          value.zoomAfterFit,
          value.medianShapeHeightPx,
          value.smallestShapeHeightPx,
          (value.contentFillRatio * 100).toFixed(2),
          value.frameInflationFactor,
          value.medianShapeHeightPxIfFitToContent,
          value.readable ? 'YES' : 'NO'
        ].join('\t')
      )
    }
  }
  console.log('')
  console.log('lane bands (source layout):')
  console.log(
    [
      'model',
      'sourceLanes',
      'bands',
      'srcHoriz',
      'srcVert',
      'dupBands',
      'disjoint',
      'bandW/content',
      'bandH/content'
    ].join('\t')
  )
  for (const entry of modelReports) {
    const lanes = entry.laneBandReport as LaneBandReport
    console.log(
      [
        entry.slug,
        lanes.sourceLanes,
        lanes.renderedBands,
        lanes.horizontalInSource,
        lanes.verticalInSource,
        lanes.duplicateBands,
        lanes.bandsDisjointFromContent,
        lanes.widestBandOverContentWidth,
        lanes.tallestBandOverContentHeight
      ].join('\t')
    )
  }
  console.log('')
  console.log('return loops (source layout, control flow only):')
  for (const entry of modelReports) {
    const loops = returnLoopByModel.get(entry.id as string)
    if (!loops) continue
    console.log(
      `${entry.slug}\txor=${loops.xorRules} (splits=${loops.xorSplits}, merges=${loops.xorMerges})\t` +
        `and=${loops.andRules}\tor=${loops.orRules}\tcfEdges=${loops.controlFlowEdges}\t` +
        `cycles=${loops.cycles.length}\tlargestCycle=${loops.largestCycle}\t` +
        `throughXorMerge=${loops.cycles.filter((cycle) => cycle.throughXorMerge).length}`
    )
  }
  console.log('')
  console.log(`screenshots: ${options.screensDir} (git-ignored)`)
  console.log(`report: ${options.outJson} (git-ignored)`)
  console.log('')
  console.log(`observations (${observations.length}):`)
  for (const entry of observations) console.log(`  [${entry.area}] ${entry.detail}`)
  console.log('')
  if (failures.length === 0) {
    console.log('Phase 16 exit gate (§19.5): PASS')
    return
  }
  console.log(`Phase 16 exit gate (§19.5): FAIL — ${failures.length} finding(s)`)
  for (const failure of failures) console.log(`  [${failure.area}] ${failure.detail}`)
  if (!options.reportOnly) process.exitCode = 1
}

interface SelectionHighlightResult {
  readonly checked: number
  readonly mismatches: number
  readonly highlightedTotal: number
  readonly expectedTotal: number
}

/**
 * §11.5 / §19.4: selecting an object must reveal its connected lines. The
 * selection is driven through the accounting rail, which is the product's own
 * "reveal this record" gesture, so nothing here depends on hit-testing pixels.
 */
async function checkSelectionHighlight(
  page: Page,
  studio: ReturnType<typeof buildArisStudioDocument>,
  objectTypeOf: ReadonlyMap<string, string>
): Promise<SelectionHighlightResult> {
  let checked = 0
  let mismatches = 0
  let highlightedTotal = 0
  let expectedTotal = 0

  for (const model of studio.source.models.values()) {
    const degree = new Map<string, number>()
    for (const connection of model.connectionOccurrences) {
      degree.set(
        connection.sourceOccurrenceId,
        (degree.get(connection.sourceOccurrenceId) ?? 0) + 1
      )
      degree.set(
        connection.targetOccurrenceId,
        (degree.get(connection.targetOccurrenceId) ?? 0) + 1
      )
    }
    let subject: ArisObjectOccurrence | null = null
    let best = -1
    for (const occurrence of model.occurrences) {
      if ((objectTypeOf.get(occurrence.id) ?? '') !== 'OT_RULE') continue
      if (ruleOperatorOfSymbol(occurrence.symbol) !== 'XOR') continue
      const value = degree.get(occurrence.id) ?? 0
      if (value > best) {
        best = value
        subject = occurrence
      }
    }
    if (!subject) continue

    const expected = model.connectionOccurrences.filter(
      (connection) =>
        connection.sourceOccurrenceId === subject?.id ||
        connection.targetOccurrenceId === subject?.id
    ).length

    const filter = page.locator('[data-orbitpm-aris-accounting] input[type="search"]')
    await filter.fill(subject.id)
    const row = page
      .locator('[data-orbitpm-aris-accounting] tbody tr')
      .filter({ hasText: subject.id })
      .first()
    if ((await row.count()) === 0) continue
    await row.getByRole('button').first().click()
    await page.waitForTimeout(150)

    const highlighted = await page.evaluate(
      () =>
        document.querySelectorAll(
          '[data-orbitpm-aris-canvas] g.djs-connection.aris-highlight[data-element-id]'
        ).length
    )
    checked += 1
    highlightedTotal += highlighted
    expectedTotal += expected
    if (highlighted !== expected) mismatches += 1
  }

  await page.locator('[data-orbitpm-aris-accounting] input[type="search"]').fill('')
  return { checked, mismatches, highlightedTotal, expectedTotal }
}

await main()
