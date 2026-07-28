/**
 * The clean-layout algorithm — plan §14.4, steps 1-13, in order.
 *
 * | Step | Requirement                                   | Implementation |
 * |------|-----------------------------------------------|----------------|
 * | 1    | Separate control flow from satellites          | `separateGraphs` |
 * | 2    | Connected components                           | `findConnectedComponents` |
 * | 3    | Strongly connected components                  | `findStronglyConnectedComponents` |
 * | 4    | Classify forward and back edges                | `classifyEdges` |
 * | 5    | Preserve source orientation                    | `detectSourceOrientation` |
 * | 6    | Primary flow on a stable spine                 | `placeControlFlow` -> `walkChain` |
 * | 7    | AND/OR/XOR branches symmetric                  | `placeControlFlow` -> `layoutParallel` |
 * | 8    | Pair split and merge rules                     | `placeControlFlow` -> `findMerge` |
 * | 9    | Returns in the nearest outside channel         | `planReturnChannels` + `routeReturnEdge` |
 * | 10   | Satellites after the core flow                 | `placeSatellites` |
 * | 11   | Reserve labels minimally                       | `occupiedBoxOf` |
 * | 12   | Resolve collisions iteratively                 | `separateRanks` + the repair loop below |
 * | 13   | Remain deterministic                           | no clock, no RNG, every traversal ordered |
 *
 * Determinism (step 13) is structural, not incidental: there is no
 * `Math.random` and no clock anywhere in the package, every traversal walks
 * the input arrays in their given order, and every `Map` or `Set` whose
 * contents reach an output is drained through an explicit sort. Laying the
 * same graph out twice produces byte-identical JSON.
 */

import type {
  ArisLayoutEdgeClass,
  ArisLayoutEdgeInput,
  ArisLayoutEdgeRoute,
  ArisLayoutGraphInput,
  ArisLayoutLaneBand,
  ArisLayoutNodePlacement,
  ArisLayoutOptions,
  ArisLayoutOrientation,
  ArisLayoutRect,
  ArisLayoutResult,
  ArisLayoutSplitMergePair
} from './types'
import {
  buildAdjacency,
  classifyEdges,
  detectSourceOrientation,
  findConnectedComponents,
  findStronglyConnectedComponents,
  separateGraphs
} from './graph'
import { placeControlFlow, resolveSpacing, type ResolvedSpacing } from './placement'
import { pointFromFlow, rectFromFlow, type OccupiedBox } from './axis'
import {
  GapSlotAllocator,
  buildFlowGeometry,
  planReturnChannels,
  routeForwardEdge,
  routeReturnEdge,
  type FlowPoint
} from './routing'
import { placeSatellites } from './satellites'
import { analyzeLayout, type LayoutAnalysis } from './metrics'
import { DEFAULT_MAX_EMPTY_BAND_RATIO, evaluateLayoutAcceptance } from './rejection'
import { boundsOfPoints, unionRect } from './geometry'

/** Findings that a wider grid can plausibly fix. */
const REPAIRABLE_CODES = new Set([
  'shape-overlap',
  'label-satellite-overlap',
  'edge-through-unrelated-shape',
  'duplicate-edge'
])

interface LayoutDraft {
  readonly nodes: readonly ArisLayoutNodePlacement[]
  readonly edges: readonly ArisLayoutEdgeRoute[]
  readonly lanes: readonly ArisLayoutLaneBand[]
  readonly canvas: ArisLayoutRect
  readonly splitMergePairs: readonly ArisLayoutSplitMergePair[]
  readonly orientation: ArisLayoutOrientation
  readonly expectedEdgeIds: readonly string[]
  readonly coverageAllowance: number
  /** Deliberate separators between two disconnected components. */
  readonly explainedBandsX: readonly { min: number; max: number }[]
  readonly explainedBandsY: readonly { min: number; max: number }[]
}

/**
 * The empty strip between two disconnected components is not "unexplained"
 * whitespace — the models genuinely are separate. Report those strips so the
 * whitespace scan can discount them.
 */
function componentSeparators(
  nodes: readonly ArisLayoutNodePlacement[],
  orientation: ArisLayoutOrientation
): { min: number; max: number }[] {
  const spans = new Map<number, { min: number; max: number }>()
  for (const node of nodes) {
    if (node.kind !== 'control-flow') continue
    const min = orientation === 'top-to-bottom' ? node.rect.x : node.rect.y
    const max =
      orientation === 'top-to-bottom' ? node.rect.x + node.rect.width : node.rect.y + node.rect.height
    const current = spans.get(node.componentIndex)
    if (!current) spans.set(node.componentIndex, { min, max })
    else spans.set(node.componentIndex, { min: Math.min(current.min, min), max: Math.max(current.max, max) })
  }
  const ordered = [...spans.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1])
    .sort((left, right) => left.min - right.min)
  const separators: { min: number; max: number }[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1] as { min: number; max: number }
    const current = ordered[index] as { min: number; max: number }
    if (current.min > previous.max) separators.push({ min: previous.max, max: current.min })
  }
  return separators
}

function scaleSpacing(spacing: ResolvedSpacing, factor: number): ResolvedSpacing {
  return {
    rankGap: spacing.rankGap * factor,
    crossGap: spacing.crossGap * factor,
    componentGap: spacing.componentGap * factor,
    channelGap: spacing.channelGap * factor,
    corridorGap: spacing.corridorGap * factor,
    margin: spacing.margin,
    labelGap: spacing.labelGap
  }
}

function buildDraft(
  graph: ArisLayoutGraphInput,
  spacing: ResolvedSpacing,
  orientation: ArisLayoutOrientation
): LayoutDraft {
  const separated = separateGraphs(graph)
  const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
  const components = findConnectedComponents(adjacency)
  const strongComponents = findStronglyConnectedComponents(adjacency)
  const classification = classifyEdges(adjacency)

  const placement = placeControlFlow(
    separated.controlNodes,
    adjacency,
    classification,
    components,
    orientation,
    spacing
  )
  const geometry = buildFlowGeometry(
    placement,
    separated.controlNodes.map((node) => node.size)
  )

  // --- step 9 + forward routing -------------------------------------------
  const channels = planReturnChannels(
    geometry,
    separated.controlEdges,
    classification.classOf,
    adjacency.indexOf
  )
  const slots = new GapSlotAllocator(placement.gapStart, placement.gapEnd)
  const fallbackChannelCross = channels.maxSideCross + spacing.channelGap
  const parallelCounter = new Map<string, number>()
  const controlRoutes: { edge: ArisLayoutEdgeInput; points: FlowPoint[]; kind: ArisLayoutEdgeClass }[] =
    []
  separated.controlEdges.forEach((edge, edgeIndex) => {
    const source = adjacency.indexOf.get(edge.source)
    const target = adjacency.indexOf.get(edge.target)
    if (source === undefined || target === undefined) return
    const edgeClass = classification.classOf[edgeIndex] as ArisLayoutEdgeClass
    if (edgeClass === 'forward') {
      const key = `${source}>${target}`
      const ordinal = parallelCounter.get(key) ?? 0
      parallelCounter.set(key, ordinal + 1)
      controlRoutes.push({
        edge,
        kind: edgeClass,
        points: routeForwardEdge(geometry, source, target, slots, fallbackChannelCross, ordinal)
      })
      return
    }
    const channelCross = channels.channelOf.get(edgeIndex) ?? fallbackChannelCross
    controlRoutes.push({
      edge,
      kind: edgeClass,
      points: routeReturnEdge(geometry, source, target, channelCross, slots)
    })
  })

  let routeCrossMax = channels.maxSideCross
  for (const route of controlRoutes) {
    for (const point of route.points) routeCrossMax = Math.max(routeCrossMax, point.cross)
  }

  // --- step 10 -------------------------------------------------------------
  const satellites = placeSatellites(
    separated.satelliteNodes,
    separated.satelliteEdges,
    adjacency.indexOf,
    geometry,
    routeCrossMax + spacing.channelGap
  )

  // --- flow space -> screen space -----------------------------------------
  const nodes: ArisLayoutNodePlacement[] = []
  separated.controlNodes.forEach((node, index) => {
    const box = placement.boxes[index] as OccupiedBox
    nodes.push({
      id: node.id,
      kind: 'control-flow',
      role: node.role,
      rect: rectFromFlow(
        geometry.nodeAlong[index] as number,
        geometry.nodeCross[index] as number,
        geometry.shapeAlong[index] as number,
        geometry.shapeCross[index] as number,
        orientation
      ),
      labelRect:
        box.labelAlongOffset === null
          ? null
          : rectFromFlow(
              (placement.alongOf[index] as number) + box.labelAlongOffset,
              (placement.crossOf[index] as number) + (box.labelCrossOffset as number),
              box.labelAlong,
              box.labelCross,
              orientation
            ),
      componentIndex: components.componentOf[index] as number,
      stronglyConnectedIndex: strongComponents.componentOf[index] as number,
      rank: placement.rankOf[index] as number,
      laneId: node.laneId ?? null
    })
  })
  separated.satelliteNodes.forEach((node, index) => {
    const box = satellites.boxes[index] as OccupiedBox
    const shapeAlong = orientation === 'top-to-bottom' ? node.size.height : node.size.width
    const shapeCross = orientation === 'top-to-bottom' ? node.size.width : node.size.height
    nodes.push({
      id: node.id,
      kind: 'satellite',
      role: node.role,
      rect: rectFromFlow(
        (satellites.alongOf[index] as number) + box.nodeAlongOffset,
        (satellites.crossOf[index] as number) + box.nodeCrossOffset,
        shapeAlong,
        shapeCross,
        orientation
      ),
      labelRect:
        box.labelAlongOffset === null
          ? null
          : rectFromFlow(
              (satellites.alongOf[index] as number) + box.labelAlongOffset,
              (satellites.crossOf[index] as number) + (box.labelCrossOffset as number),
              box.labelAlong,
              box.labelCross,
              orientation
            ),
      componentIndex: -1,
      stronglyConnectedIndex: -1,
      rank: -1,
      laneId: node.laneId ?? null
    })
  })

  const edges: ArisLayoutEdgeRoute[] = []
  for (const route of controlRoutes) {
    edges.push({
      id: route.edge.id,
      source: route.edge.source,
      target: route.edge.target,
      kind: 'control-flow',
      classification: route.kind,
      points: route.points.map((point) => pointFromFlow(point.along, point.cross, orientation))
    })
  }
  separated.satelliteEdges.forEach((edge, edgeIndex) => {
    const points = satellites.routes[edgeIndex] as readonly FlowPoint[]
    if (!points || points.length < 2) return
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: 'satellite',
      classification: 'satellite',
      points: points.map((point) => pointFromFlow(point.along, point.cross, orientation))
    })
  })

  // --- normalize to the origin --------------------------------------------
  let canvas: ArisLayoutRect | null = null
  for (const node of nodes) {
    canvas = canvas ? unionRect(canvas, node.rect) : node.rect
    if (node.labelRect) canvas = unionRect(canvas, node.labelRect)
  }
  for (const edge of edges) {
    const bounds = boundsOfPoints(edge.points)
    if (bounds) canvas = canvas ? unionRect(canvas, bounds) : bounds
  }
  const base = canvas ?? { x: 0, y: 0, width: 0, height: 0 }
  const shiftX = spacing.margin - base.x
  const shiftY = spacing.margin - base.y
  const translateRect = (rect: ArisLayoutRect): ArisLayoutRect => ({
    x: rect.x + shiftX,
    y: rect.y + shiftY,
    width: rect.width,
    height: rect.height
  })
  const translatedNodes = nodes.map((node) => ({
    ...node,
    rect: translateRect(node.rect),
    labelRect: node.labelRect ? translateRect(node.labelRect) : null
  }))
  const translatedEdges: ArisLayoutEdgeRoute[] = edges.map((edge) => ({
    ...edge,
    points: edge.points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }))
  }))
  const finalCanvas: ArisLayoutRect = {
    x: 0,
    y: 0,
    width: base.width + spacing.margin * 2,
    height: base.height + spacing.margin * 2
  }

  const separators = componentSeparators(translatedNodes, orientation)
  return {
    nodes: translatedNodes,
    edges: translatedEdges,
    lanes: buildLaneBands(graph.lanes ?? [], translatedNodes, finalCanvas),
    canvas: finalCanvas,
    splitMergePairs: placement.splitMergePairs,
    orientation,
    expectedEdgeIds: graph.edges.map((edge) => edge.id),
    coverageAllowance: Math.max(spacing.corridorGap, spacing.crossGap * 0.5),
    explainedBandsX: orientation === 'top-to-bottom' ? separators : [],
    explainedBandsY: orientation === 'top-to-bottom' ? [] : separators
  }
}

/**
 * Lanes are *derived* bands, never shapes: the clean layout does not constrain
 * placement to lanes, it reports where each imported lane's members ended up
 * so the renderer can still draw the swim-lane. They therefore take no part in
 * overlap metrics.
 */
function buildLaneBands(
  lanes: readonly { id: string; orientation: 'horizontal' | 'vertical'; order?: number }[],
  nodes: readonly ArisLayoutNodePlacement[],
  canvas: ArisLayoutRect
): ArisLayoutLaneBand[] {
  const ordered = lanes
    .map((lane, index) => ({ lane, index }))
    .sort(
      (left, right) =>
        (left.lane.order ?? left.index) - (right.lane.order ?? right.index) ||
        left.index - right.index
    )
  const bands: ArisLayoutLaneBand[] = []
  for (const entry of ordered) {
    let bounds: ArisLayoutRect | null = null
    for (const node of nodes) {
      if (node.laneId !== entry.lane.id) continue
      bounds = bounds ? unionRect(bounds, node.rect) : node.rect
    }
    if (!bounds) continue
    bands.push({
      id: entry.lane.id,
      orientation: entry.lane.orientation,
      rect:
        entry.lane.orientation === 'horizontal'
          ? { x: canvas.x, y: bounds.y, width: canvas.width, height: bounds.height }
          : { x: bounds.x, y: canvas.y, width: bounds.width, height: canvas.height }
    })
  }
  return bands
}

function analyzeDraft(draft: LayoutDraft): LayoutAnalysis {
  return analyzeLayout({
    nodes: draft.nodes,
    edges: draft.edges,
    canvas: draft.canvas,
    expectedEdgeIds: draft.expectedEdgeIds,
    coverageAllowance: draft.coverageAllowance,
    explainedBandsX: draft.explainedBandsX,
    explainedBandsY: draft.explainedBandsY
  })
}

/**
 * Run the clean-layout algorithm.
 *
 * The engine measures its own output and, when the §14.4 gate rejects it,
 * widens the grid and retries instead of emitting a rejected layout. `accepted`
 * is only `false` when every allowed round still failed, and in that case the
 * findings say exactly why.
 *
 * The input graph is never mutated: every value written into the result is
 * newly allocated. `cleanLayout(Object.freeze(graph))` is safe.
 */
export function cleanLayout(
  graph: ArisLayoutGraphInput,
  options: ArisLayoutOptions = {}
): ArisLayoutResult {
  const separated = separateGraphs(graph)
  const orientation =
    options.orientation ?? detectSourceOrientation(separated.controlNodes, separated.controlEdges)
  const baseSpacing = resolveSpacing(separated.controlNodes, orientation, options.spacing ?? {})
  const maxIterations = Math.max(1, options.maxIterations ?? 6)
  const acceptanceOptions = {
    maxEmptyBandRatio: options.maxEmptyBandRatio ?? DEFAULT_MAX_EMPTY_BAND_RATIO
  }

  let best: {
    draft: LayoutDraft
    analysis: LayoutAnalysis
    accepted: boolean
    findings: ArisLayoutResult['findings']
    score: number
  } | null = null

  let iterations = 0
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    iterations = iteration + 1
    const spacing = iteration === 0 ? baseSpacing : scaleSpacing(baseSpacing, 1 + 0.35 * iteration)
    const draft = buildDraft(graph, spacing, orientation)
    const analysis = analyzeDraft(draft)
    const acceptance = evaluateLayoutAcceptance(analysis.metrics, analysis.defects, acceptanceOptions)
    const score =
      analysis.metrics.shapeOverlaps * 1000 +
      analysis.metrics.labelSatelliteOverlaps * 1000 +
      analysis.metrics.edgeShapeCrossings * 100 +
      analysis.metrics.detachedEndpoints * 100000 +
      analysis.metrics.missingEdges * 100000 +
      analysis.metrics.duplicateEdges * 1000 +
      analysis.metrics.zeroLengthEdges * 100000 +
      acceptance.findings.length
    if (best === null || score < best.score) {
      best = {
        draft,
        analysis,
        accepted: acceptance.accepted,
        findings: acceptance.findings,
        score
      }
    }
    if (acceptance.accepted) break
    const repairable = acceptance.findings.some((entry) => REPAIRABLE_CODES.has(entry.code))
    if (!repairable) break
  }

  const resolved = best as NonNullable<typeof best>
  return {
    graphId: graph.id,
    orientation: resolved.draft.orientation,
    nodes: resolved.draft.nodes,
    edges: resolved.draft.edges,
    lanes: resolved.draft.lanes,
    canvas: resolved.draft.canvas,
    splitMergePairs: resolved.draft.splitMergePairs,
    metrics: resolved.analysis.metrics,
    accepted: resolved.accepted,
    findings: resolved.findings,
    iterations
  }
}

/** Re-measure any layout (source or clean) with the same metric suite. */
export function measureLayoutResult(
  nodes: readonly ArisLayoutNodePlacement[],
  edges: readonly ArisLayoutEdgeRoute[],
  canvas: ArisLayoutRect,
  expectedEdgeIds: readonly string[],
  coverageAllowance = 0
): LayoutAnalysis {
  return analyzeLayout({ nodes, edges, canvas, expectedEdgeIds, coverageAllowance })
}
