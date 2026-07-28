/**
 * Layout quality metrics — plan §19.2 step 7.
 *
 * | Plan metric              | Field                       |
 * |--------------------------|-----------------------------|
 * | Shape overlaps           | `shapeOverlaps`             |
 * | Label/satellite overlaps | `labelSatelliteOverlaps`    |
 * | Edge/shape crossings     | `edgeShapeCrossings`        |
 * | Edge/edge crossings      | `edgeEdgeCrossings`         |
 * | Bend counts              | `bendCount`, `maxBendsPerEdge` |
 * | Route lengths            | `routeLengthTotal`, `routeLengthMax` |
 * | Canvas area              | `canvasArea` (+ width/height) |
 * | Detached endpoints       | `detachedEndpoints`         |
 *
 * Every number is an exact geometric computation on the produced coordinates.
 * Nothing is sampled and nothing is estimated, so each metric can be checked
 * against a hand-computed answer.
 */

import type {
  ArisLayoutEdgeRoute,
  ArisLayoutMetrics,
  ArisLayoutNodePlacement,
  ArisLayoutPoint,
  ArisLayoutRect
} from './types'
import {
  LAYOUT_EPSILON,
  boundsOfPoints,
  largestInteriorGap,
  pointOnRectBoundary,
  polylineLength,
  rectArea,
  rectIntersectionArea,
  rectsOverlap,
  segmentIntersectsRectInterior,
  segmentsProperlyCross,
  type Interval
} from './geometry'

export interface LayoutMeasurementInput {
  readonly nodes: readonly ArisLayoutNodePlacement[]
  readonly edges: readonly ArisLayoutEdgeRoute[]
  readonly canvas: ArisLayoutRect
  /** Edge ids the layout was asked to draw; used for missing/duplicate. */
  readonly expectedEdgeIds: readonly string[]
  /**
   * Half-width credited to a route when projecting it onto an axis for the
   * whitespace scan. A polyline is infinitely thin but the rendered stroke is
   * not, and a corridor full of connectors is not "unexplained" whitespace.
   */
  readonly coverageAllowance?: number
  /** Endpoint attachment tolerance. Defaults to `LAYOUT_EPSILON`. */
  readonly attachTolerance?: number
  /**
   * Bands the caller can *explain* — the deliberate separator between two
   * disconnected components, for example. They are treated as covered by the
   * whitespace scan, which is what makes the `extreme-whitespace` rejection
   * mean "unexplained" rather than merely "empty".
   */
  readonly explainedBandsX?: readonly Interval[]
  readonly explainedBandsY?: readonly Interval[]
}

export interface OverlapPair {
  readonly a: string
  readonly b: string
  readonly area: number
}

export interface EdgeShapeHit {
  readonly edgeId: string
  readonly nodeId: string
}

export interface DetachedEndpoint {
  readonly edgeId: string
  readonly nodeId: string
  readonly end: 'source' | 'target'
}

export interface LayoutDefects {
  readonly shapeOverlaps: readonly OverlapPair[]
  readonly labelSatelliteOverlaps: readonly OverlapPair[]
  readonly edgeShapeHits: readonly EdgeShapeHit[]
  readonly detachedEndpoints: readonly DetachedEndpoint[]
  readonly missingEdgeIds: readonly string[]
  readonly duplicateEdgeIds: readonly string[]
  readonly zeroLengthEdgeIds: readonly string[]
}

export interface LayoutAnalysis {
  readonly metrics: ArisLayoutMetrics
  readonly defects: LayoutDefects
}

function segmentsOf(points: readonly ArisLayoutPoint[]): [ArisLayoutPoint, ArisLayoutPoint][] {
  const segments: [ArisLayoutPoint, ArisLayoutPoint][] = []
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1] as ArisLayoutPoint, points[index] as ArisLayoutPoint])
  }
  return segments
}

function boundingBoxOf(
  a: ArisLayoutPoint,
  b: ArisLayoutPoint
): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y)
  }
}

/** Measure one finished layout and collect every defect it exhibits. */
export function analyzeLayout(input: LayoutMeasurementInput): LayoutAnalysis {
  const allowance = input.coverageAllowance ?? 0
  const attachTolerance = input.attachTolerance ?? LAYOUT_EPSILON
  const nodes = input.nodes
  const edges = input.edges
  const nodeById = new Map<string, ArisLayoutNodePlacement>()
  for (const node of nodes) nodeById.set(node.id, node)

  // --- shape overlaps ------------------------------------------------------
  const shapeOverlaps: OverlapPair[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i] as ArisLayoutNodePlacement
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j] as ArisLayoutNodePlacement
      if (!rectsOverlap(left.rect, right.rect)) continue
      shapeOverlaps.push({
        a: left.id,
        b: right.id,
        area: rectIntersectionArea(left.rect, right.rect)
      })
    }
  }

  // --- label / satellite overlaps -----------------------------------------
  // A reserved caption box may not touch any other caption box or any shape
  // other than the one it belongs to, and a satellite shape may not touch any
  // other shape. Satellite-vs-shape pairs deliberately appear here *and* in
  // `shapeOverlaps`: the plan names both as metrics and the gate demands zero
  // for each, so the double count costs nothing and keeps each name honest.
  const labelSatelliteOverlaps: OverlapPair[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i] as ArisLayoutNodePlacement
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j] as ArisLayoutNodePlacement
      if (left.kind !== 'satellite' && right.kind !== 'satellite') continue
      if (!rectsOverlap(left.rect, right.rect)) continue
      labelSatelliteOverlaps.push({
        a: left.id,
        b: right.id,
        area: rectIntersectionArea(left.rect, right.rect)
      })
    }
  }
  const labelled = nodes.filter((node) => node.labelRect !== null)
  for (let i = 0; i < labelled.length; i += 1) {
    const left = labelled[i] as ArisLayoutNodePlacement
    const leftRect = left.labelRect as ArisLayoutRect
    for (const node of nodes) {
      if (node.id === left.id) continue
      if (!rectsOverlap(leftRect, node.rect)) continue
      labelSatelliteOverlaps.push({
        a: left.id,
        b: node.id,
        area: rectIntersectionArea(leftRect, node.rect)
      })
    }
    for (let j = i + 1; j < labelled.length; j += 1) {
      const right = labelled[j] as ArisLayoutNodePlacement
      const rightRect = right.labelRect as ArisLayoutRect
      if (!rectsOverlap(leftRect, rightRect)) continue
      labelSatelliteOverlaps.push({
        a: left.id,
        b: right.id,
        area: rectIntersectionArea(leftRect, rightRect)
      })
    }
  }

  // --- edge through unrelated shape ---------------------------------------
  const edgeShapeHits: EdgeShapeHit[] = []
  const edgeSegments = edges.map((edge) => segmentsOf(edge.points))
  edges.forEach((edge, edgeIndex) => {
    const segments = edgeSegments[edgeIndex] as [ArisLayoutPoint, ArisLayoutPoint][]
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      let hit = false
      for (const [a, b] of segments) {
        const box = boundingBoxOf(a, b)
        if (box.maxX <= node.rect.x || box.minX >= node.rect.x + node.rect.width) continue
        if (box.maxY <= node.rect.y || box.minY >= node.rect.y + node.rect.height) continue
        if (segmentIntersectsRectInterior(a, b, node.rect)) {
          hit = true
          break
        }
      }
      if (hit) edgeShapeHits.push({ edgeId: edge.id, nodeId: node.id })
    }
  })

  // --- edge/edge crossings -------------------------------------------------
  let edgeEdgeCrossings = 0
  for (let i = 0; i < edges.length; i += 1) {
    const first = edgeSegments[i] as [ArisLayoutPoint, ArisLayoutPoint][]
    for (let j = i + 1; j < edges.length; j += 1) {
      const second = edgeSegments[j] as [ArisLayoutPoint, ArisLayoutPoint][]
      for (const [a1, a2] of first) {
        const boxA = boundingBoxOf(a1, a2)
        for (const [b1, b2] of second) {
          const boxB = boundingBoxOf(b1, b2)
          if (boxA.maxX < boxB.minX || boxB.maxX < boxA.minX) continue
          if (boxA.maxY < boxB.minY || boxB.maxY < boxA.minY) continue
          if (segmentsProperlyCross(a1, a2, b1, b2)) edgeEdgeCrossings += 1
        }
      }
    }
  }

  // --- bends, lengths, attachment, degeneracy ------------------------------
  let bendCount = 0
  let maxBendsPerEdge = 0
  let routeLengthTotal = 0
  let routeLengthMax = 0
  const detachedEndpoints: DetachedEndpoint[] = []
  const zeroLengthEdgeIds: string[] = []
  const geometryKeys = new Map<string, string[]>()
  const seenEdgeIds = new Map<string, number>()

  for (const edge of edges) {
    seenEdgeIds.set(edge.id, (seenEdgeIds.get(edge.id) ?? 0) + 1)
    const bends = Math.max(0, edge.points.length - 2)
    bendCount += bends
    maxBendsPerEdge = Math.max(maxBendsPerEdge, bends)
    const length = polylineLength(edge.points)
    routeLengthTotal += length
    routeLengthMax = Math.max(routeLengthMax, length)
    if (edge.points.length < 2 || length <= LAYOUT_EPSILON) zeroLengthEdgeIds.push(edge.id)

    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    const first = edge.points[0]
    const last = edge.points[edge.points.length - 1]
    if (!source || !first || !pointOnRectBoundary(first, source.rect, attachTolerance)) {
      detachedEndpoints.push({ edgeId: edge.id, nodeId: edge.source, end: 'source' })
    }
    if (!target || !last || !pointOnRectBoundary(last, target.rect, attachTolerance)) {
      detachedEndpoints.push({ edgeId: edge.id, nodeId: edge.target, end: 'target' })
    }

    const key = `${edge.source} ${edge.target} ${edge.points
      .map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)
      .join(';')}`
    const bucket = geometryKeys.get(key)
    if (bucket) bucket.push(edge.id)
    else geometryKeys.set(key, [edge.id])
  }

  const duplicateEdgeIds: string[] = []
  for (const [, bucket] of [...geometryKeys.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
  )) {
    if (bucket.length > 1) duplicateEdgeIds.push(...bucket)
  }
  for (const [id, count] of [...seenEdgeIds.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
  )) {
    if (count > 1 && !duplicateEdgeIds.includes(id)) duplicateEdgeIds.push(id)
  }

  const drawn = new Set(edges.map((edge) => edge.id))
  const missingEdgeIds = input.expectedEdgeIds.filter((id) => !drawn.has(id))

  // --- canvas and whitespace ----------------------------------------------
  const canvas = input.canvas
  const coveredX: Interval[] = []
  const coveredY: Interval[] = []
  for (const node of nodes) {
    coveredX.push({ min: node.rect.x, max: node.rect.x + node.rect.width })
    coveredY.push({ min: node.rect.y, max: node.rect.y + node.rect.height })
    if (node.labelRect) {
      coveredX.push({ min: node.labelRect.x, max: node.labelRect.x + node.labelRect.width })
      coveredY.push({ min: node.labelRect.y, max: node.labelRect.y + node.labelRect.height })
    }
  }
  for (const edge of edges) {
    const bounds = boundsOfPoints(edge.points)
    if (!bounds) continue
    coveredX.push({ min: bounds.x - allowance, max: bounds.x + bounds.width + allowance })
    coveredY.push({ min: bounds.y - allowance, max: bounds.y + bounds.height + allowance })
  }
  const canvasWidth = Math.max(0, canvas.width)
  const canvasHeight = Math.max(0, canvas.height)
  for (const band of input.explainedBandsX ?? []) coveredX.push(band)
  for (const band of input.explainedBandsY ?? []) coveredY.push(band)
  const gapX = largestInteriorGap({ min: canvas.x, max: canvas.x + canvasWidth }, coveredX)
  const gapY = largestInteriorGap({ min: canvas.y, max: canvas.y + canvasHeight }, coveredY)
  const canvasArea = canvasWidth * canvasHeight
  let shapeArea = 0
  for (const node of nodes) shapeArea += rectArea(node.rect)

  const metrics: ArisLayoutMetrics = {
    shapeOverlaps: shapeOverlaps.length,
    labelSatelliteOverlaps: labelSatelliteOverlaps.length,
    edgeShapeCrossings: edgeShapeHits.length,
    edgeEdgeCrossings,
    bendCount,
    maxBendsPerEdge,
    routeLengthTotal,
    routeLengthMax,
    canvasArea,
    canvasWidth,
    canvasHeight,
    detachedEndpoints: detachedEndpoints.length,
    missingEdges: missingEdgeIds.length,
    duplicateEdges: duplicateEdgeIds.length,
    zeroLengthEdges: zeroLengthEdgeIds.length,
    largestEmptyBandXRatio: canvasWidth > 0 ? gapX / canvasWidth : 0,
    largestEmptyBandYRatio: canvasHeight > 0 ? gapY / canvasHeight : 0,
    shapeFillRatio: canvasArea > 0 ? shapeArea / canvasArea : 0
  }

  return {
    metrics,
    defects: {
      shapeOverlaps,
      labelSatelliteOverlaps,
      edgeShapeHits,
      detachedEndpoints,
      missingEdgeIds,
      duplicateEdgeIds,
      zeroLengthEdgeIds
    }
  }
}
