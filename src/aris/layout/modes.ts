/**
 * Layout modes as a data contract — plan §12.4.
 *
 * * **Source Layout** uses the imported coordinates and routes verbatim.
 * * **Clean Layout** writes a *working* revision only.
 * * **Reset to Source Layout** rebuilds the source revision from the same
 *   untouched input, which is why a reset can never lose imported geometry.
 *
 * The contract that makes all three safe is a single rule: nothing in this
 * package ever writes to the graph it is given. Every coordinate in every
 * revision is newly allocated, so `sourcePosition` and `sourceRoute` survive
 * any number of clean-layout runs unchanged. `cleanLayoutRevision` on a deeply
 * frozen graph is a supported call.
 */

import type {
  ArisLayoutEdgeRoute,
  ArisLayoutGraphInput,
  ArisLayoutLaneBand,
  ArisLayoutNodeInput,
  ArisLayoutNodePlacement,
  ArisLayoutOptions,
  ArisLayoutPoint,
  ArisLayoutRect,
  ArisLayoutRevision
} from './types'
import { cleanLayout } from './cleanLayout'
import { detectSourceOrientation, separateGraphs } from './graph'
import { labelFitsInside } from './axis'
import { LAYOUT_EPSILON, rectCenter, unionRect } from './geometry'

function rectOf(node: ArisLayoutNodeInput): ArisLayoutRect {
  const position = node.sourcePosition ?? { x: 0, y: 0 }
  return { x: position.x, y: position.y, width: node.size.width, height: node.size.height }
}

/**
 * Point where the ray from the centre of `rect` towards `towards` leaves the
 * rectangle. Used only to attach a connector when the imported record carried
 * no route points at all.
 */
export function boundaryPointTowards(
  rect: ArisLayoutRect,
  towards: ArisLayoutPoint
): ArisLayoutPoint {
  const center = rectCenter(rect)
  const dx = towards.x - center.x
  const dy = towards.y - center.y
  if (Math.abs(dx) < LAYOUT_EPSILON && Math.abs(dy) < LAYOUT_EPSILON) {
    return { x: center.x, y: rect.y }
  }
  const scaleX =
    Math.abs(dx) < LAYOUT_EPSILON ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx)
  const scaleY =
    Math.abs(dy) < LAYOUT_EPSILON ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

/**
 * Build the Source Layout revision: imported coordinates and imported routes,
 * copied, never referenced.
 */
export function sourceLayoutRevision(graph: ArisLayoutGraphInput): ArisLayoutRevision {
  const separated = separateGraphs(graph)
  const orientation = detectSourceOrientation(separated.controlNodes, separated.controlEdges)
  const rectById = new Map<string, ArisLayoutRect>()
  const nodes: ArisLayoutNodePlacement[] = []
  for (const node of graph.nodes) {
    if (rectById.has(node.id)) continue
    const rect = rectOf(node)
    rectById.set(node.id, rect)
    const overflowing = !labelFitsInside(node.size, node.label)
    nodes.push({
      id: node.id,
      kind: node.role === 'satellite' ? 'satellite' : 'control-flow',
      role: node.role,
      rect,
      labelRect:
        overflowing && node.label
          ? {
              x: rect.x + (rect.width - node.label.width) / 2,
              y: rect.y + rect.height,
              width: node.label.width,
              height: node.label.height
            }
          : null,
      componentIndex: -1,
      stronglyConnectedIndex: -1,
      rank: -1,
      laneId: node.laneId ?? null
    })
  }

  const edges: ArisLayoutEdgeRoute[] = []
  for (const edge of graph.edges) {
    const source = rectById.get(edge.source)
    const target = rectById.get(edge.target)
    if (!source || !target) continue
    const imported = edge.sourceRoute
    const points: ArisLayoutPoint[] =
      imported && imported.length >= 2
        ? imported.map((point) => ({ x: point.x, y: point.y }))
        : [
            boundaryPointTowards(source, rectCenter(target)),
            boundaryPointTowards(target, rectCenter(source))
          ]
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      classification: edge.kind === 'satellite' ? 'satellite' : 'forward',
      points
    })
  }

  let canvas: ArisLayoutRect | null = null
  for (const node of nodes) {
    canvas = canvas ? unionRect(canvas, node.rect) : node.rect
    if (node.labelRect) canvas = unionRect(canvas, node.labelRect)
  }
  const lanes: ArisLayoutLaneBand[] = []
  const bounds = canvas ?? { x: 0, y: 0, width: 0, height: 0 }
  for (const lane of graph.lanes ?? []) {
    let laneBounds: ArisLayoutRect | null = null
    for (const node of nodes) {
      if (node.laneId !== lane.id) continue
      laneBounds = laneBounds ? unionRect(laneBounds, node.rect) : node.rect
    }
    if (!laneBounds) continue
    lanes.push({
      id: lane.id,
      orientation: lane.orientation,
      rect:
        lane.orientation === 'horizontal'
          ? { x: bounds.x, y: laneBounds.y, width: bounds.width, height: laneBounds.height }
          : { x: laneBounds.x, y: bounds.y, width: laneBounds.width, height: bounds.height }
    })
  }

  // Notes keep their imported rectangle verbatim — this is what a reset
  // restores, so it has to be a copy of the input and nothing else.
  const annotations = (graph.annotations ?? []).map((annotation) => ({
    id: annotation.id,
    rect: {
      x: annotation.rect.x,
      y: annotation.rect.y,
      width: annotation.rect.width,
      height: annotation.rect.height
    }
  }))

  return {
    mode: 'source',
    graphId: graph.id,
    orientation,
    nodes,
    edges,
    lanes,
    annotations,
    canvas: bounds
  }
}

/**
 * Build the Clean Layout **working** revision. It carries only derived
 * coordinates; the caller stores it under `working/` and leaves the immutable
 * original source untouched (plan §7.4).
 */
export function cleanLayoutRevision(
  graph: ArisLayoutGraphInput,
  options: ArisLayoutOptions = {}
): ArisLayoutRevision {
  const result = cleanLayout(graph, options)
  return {
    mode: 'clean',
    graphId: result.graphId,
    orientation: result.orientation,
    nodes: result.nodes,
    edges: result.edges,
    lanes: result.lanes,
    annotations: result.annotations,
    canvas: result.canvas
  }
}

/**
 * Reset to Source Layout. It reads the same untouched input the importer
 * produced, so it is exact no matter how many clean layouts ran before it.
 */
export function resetToSourceLayout(graph: ArisLayoutGraphInput): ArisLayoutRevision {
  return sourceLayoutRevision(graph)
}
