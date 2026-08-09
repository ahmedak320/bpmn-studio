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
 * | 10   | Satellites after the core flow                 | `placeSatellites`, `placeAnnotations` |
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
  ArisLayoutAnnotationPlacement,
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
import { placeSatellites, satelliteVerticalLoad } from './satellites'
import { placeAnnotations } from './annotations'
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
  readonly annotations: readonly ArisLayoutAnnotationPlacement[]
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
      orientation === 'top-to-bottom'
        ? node.rect.x + node.rect.width
        : node.rect.y + node.rect.height
    const current = spans.get(node.componentIndex)
    if (!current) spans.set(node.componentIndex, { min, max })
    else
      spans.set(node.componentIndex, {
        min: Math.min(current.min, min),
        max: Math.max(current.max, max)
      })
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

  // Density-aware rank-gap expansion (satellite cascade fix): the band-sizing
  // stage needs to know each owner's satellite-stack height BEFORE it fixes the
  // spine, so satellites can never push a spine node sideways but a dense owner
  // CAN grow the vertical gap to the next step. Computed from the same
  // satellite input `placeSatellites` consumes, so the two passes agree.
  const satelliteLoad = satelliteVerticalLoad(
    separated.satelliteNodes,
    separated.satelliteEdges,
    adjacency.indexOf,
    orientation,
    spacing
  )
  const placement = placeControlFlow(
    separated.controlNodes,
    adjacency,
    classification,
    components,
    orientation,
    spacing,
    satelliteLoad
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
  const controlRoutes: {
    edge: ArisLayoutEdgeInput
    points: FlowPoint[]
    kind: ArisLayoutEdgeClass
  }[] = []
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
  let routeCrossMin = channels.minSideCross
  for (const route of controlRoutes) {
    for (const point of route.points) {
      routeCrossMax = Math.max(routeCrossMax, point.cross)
      routeCrossMin = Math.min(routeCrossMin, point.cross)
    }
  }

  // --- step 10 -------------------------------------------------------------
  // Satellites hang off BOTH sides of the spine now: `reservedCrossMax`/`Min`
  // bracket the reserved routing band, and `placeSatellites` decides per owner
  // which OUTER side each cluster sits on from the control adjacency alone.
  const satellites = placeSatellites(
    separated.satelliteNodes,
    separated.satelliteEdges,
    adjacency.indexOf,
    geometry,
    routeCrossMax + spacing.channelGap,
    routeCrossMin - spacing.channelGap,
    adjacency.out,
    adjacency.in,
    controlRoutes.map((route) => route.points)
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

  // --- normalize the canvas: anchor the SPINE, hang satellites off it ------
  // `base` is the FULL content bbox (used only to size the canvas). The shift
  // that positions every shape is anchored on the CONTROL-FLOW bbox alone, so a
  // left-side satellite can never drag the spine right (and a right-side one can
  // never drag it left): the backbone lands at the same absolute coordinates
  // whether the model carries 0 or 50 satellites (§13.2). Satellites simply
  // extend the canvas outward on whichever side they sit, and the canvas origin
  // (below) moves to include them without translating the spine.
  let canvas: ArisLayoutRect | null = null
  let controlAnchor: ArisLayoutRect | null = null
  for (const node of nodes) {
    canvas = canvas ? unionRect(canvas, node.rect) : node.rect
    if (node.labelRect) canvas = unionRect(canvas, node.labelRect)
    if (node.kind === 'control-flow') {
      controlAnchor = controlAnchor ? unionRect(controlAnchor, node.rect) : node.rect
      if (node.labelRect) controlAnchor = unionRect(controlAnchor, node.labelRect)
    }
  }
  for (const edge of edges) {
    const bounds = boundsOfPoints(edge.points)
    if (bounds) canvas = canvas ? unionRect(canvas, bounds) : bounds
    if (edge.kind === 'control-flow' && bounds) {
      controlAnchor = controlAnchor ? unionRect(controlAnchor, bounds) : bounds
    }
  }
  const base = canvas ?? { x: 0, y: 0, width: 0, height: 0 }
  const anchor = controlAnchor ?? base
  const shiftX = spacing.margin - anchor.x
  const shiftY = spacing.margin - anchor.y
  // Where the full content lands after the spine-anchored shift. When no
  // satellite sits outside the control-flow bbox (the historical all-right
  // case where control is the leftmost/topmost content) this is exactly
  // `spacing.margin`, so `originX`/`originY` are 0 and the canvas is unchanged.
  const originX = base.x + shiftX - spacing.margin
  const originY = base.y + shiftY - spacing.margin
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
  // --- step 10 (free-text notes) + step 12 ---------------------------------
  // Notes are placed against the *finished* layout, so they cannot influence
  // it. They are not in `graph.nodes`, so §13.2 holds structurally: the spine
  // is identical whether the model carries 0 notes or 50.
  const sourceRects = new Map<string, ArisLayoutRect>()
  const captionObstacles: ArisLayoutRect[] = []
  const translatedById = new Map(translatedNodes.map((node) => [node.id, node.rect]))
  for (const node of graph.nodes) {
    if (!sourceRects.has(node.id) && node.sourcePosition) {
      sourceRects.set(node.id, {
        x: node.sourcePosition.x,
        y: node.sourcePosition.y,
        width: node.size.width,
        height: node.size.height
      })
    }
    const caption = node.externalCaption
    const placedRect = translatedById.get(node.id)
    if (caption && placedRect) {
      captionObstacles.push({
        x: placedRect.x + caption.offsetX,
        y: placedRect.y + caption.offsetY,
        width: caption.width,
        height: caption.height
      })
    }
  }
  const annotations = placeAnnotations({
    annotations: graph.annotations ?? [],
    sourceRects,
    placed: translatedNodes,
    obstacles: captionObstacles,
    edges: translatedEdges,
    gap: spacing.labelGap * 2,
    step: spacing.crossGap
  })

  let annotationBounds: ArisLayoutRect | null = null
  for (const annotation of annotations) {
    annotationBounds = annotationBounds
      ? unionRect(annotationBounds, annotation.rect)
      : annotation.rect
  }
  const finalCanvas: ArisLayoutRect = {
    x: originX,
    y: originY,
    width: Math.max(
      base.width + spacing.margin * 2,
      annotationBounds ? annotationBounds.x + annotationBounds.width + spacing.margin - originX : 0
    ),
    height: Math.max(
      base.height + spacing.margin * 2,
      annotationBounds ? annotationBounds.y + annotationBounds.height + spacing.margin - originY : 0
    )
  }

  const separators = componentSeparators(translatedNodes, orientation)
  return {
    nodes: translatedNodes,
    edges: translatedEdges,
    lanes: buildLaneBands(graph.lanes ?? [], translatedNodes, finalCanvas),
    annotations,
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

/**
 * Free-text notes are measured exactly like any other drawn rectangle: they
 * are handed to the metric suite as satellite nodes so the §14.4 gate sees
 * them, even though they are not part of the graph. That is what makes "no
 * shape overlap" mean *nothing drawn overlaps anything drawn*.
 */
function annotationNodes(draft: LayoutDraft): ArisLayoutNodePlacement[] {
  return draft.annotations.map((annotation) => ({
    id: annotation.id,
    kind: 'satellite' as const,
    role: 'satellite' as const,
    rect: annotation.rect,
    labelRect: null,
    componentIndex: -1,
    stronglyConnectedIndex: -1,
    rank: -1,
    laneId: null
  }))
}

function analyzeDraft(draft: LayoutDraft): LayoutAnalysis {
  return analyzeLayout({
    nodes: [...draft.nodes, ...annotationNodes(draft)],
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
    const acceptance = evaluateLayoutAcceptance(
      analysis.metrics,
      analysis.defects,
      acceptanceOptions
    )
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
    annotations: resolved.draft.annotations,
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
