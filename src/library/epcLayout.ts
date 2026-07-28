// Deterministic layered auto-layout + DI emission for imported EPC graphs.
//
// This is the single layout path for the ARIS → BPMN converter (apcImport):
// the ARIS occurrence geometry is NEVER copied into the output any more — it
// only survives as a per-node `hint` that breaks ordering ties, so the emitted
// diagram is always a clean, readable, deterministic layered drawing:
//
//   • sequential flow runs down ONE straight column (the "spine");
//   • gateway fan-outs place their branches symmetrically around the gateway
//     (half-column "slots" make even fan-outs exactly centred);
//   • every edge is orthogonal; exact base-shape, label and individual
//     decoration rectangles form a visibility graph, scored by bends then
//     Manhattan length, so a clear layer-skipping edge stays straight and a
//     genuinely blocked/back edge takes the smallest deterministic detour;
//   • column/row sizing reserves each node's decoration extents (owner chip,
//     responsible/CC/input/output lists, decision-basis tag, missing-info badge —
//     via org/decorExtents.computeDecorMargins) plus its external label, so no
//     edge segment ever crosses another node's decorations;
//   • no Date.now/Math.random anywhere: identical input graphs produce
//     byte-identical DI, independent of input array order.
//
// The engine lays out in a "flow space" where flow always runs top→bottom;
// `orientation: 'horizontal'` transposes the finished layout (x↔y), with the
// decoration margins computed for the REAL orientation and mapped into flow
// space, so both orientations reserve exactly what the renderer will paint.

import {
  computeDecorLayout,
  computeDecorMargins,
  decorationBoxes,
  type Box
} from '../org/decorExtents'
import type { OrgProps } from '../org/orgModel'
import { fitInteriorBox } from '../diagram/autoSize'

export type Orientation = 'vertical' | 'horizontal'

export interface LayoutNode {
  id: string
  /** Emit tag: 'task' | 'callActivity' | 'startEvent' | 'endEvent' |
   *  'intermediateThrowEvent' | 'exclusiveGateway' | … */
  tag: string
  /** Display name — sizes task-family shapes or the external label of
   *  events/gateways. */
  label?: string
  /** Present orbitpm:* values → reserved decoration margins. */
  attrs?: OrgProps
  /** Source-diagram position (raw ARIS units) — a determinism tiebreak that
   *  preserves the author's reading order; never copied into the output. */
  hint?: { x: number; y: number }
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
}

export interface PlacedShape {
  x: number
  y: number
  w: number
  h: number
  /** External label bounds (events/gateways with a label), absolute coords. */
  label?: Box
}

export interface RoutedEdge {
  waypoints: Array<{ x: number; y: number }>
  isBackEdge: boolean
}

export interface EpcLayoutResult {
  shapes: Map<string, PlacedShape>
  edges: Map<string, RoutedEdge>
  size: { w: number; h: number }
  /** True when some component had NO zero-in-degree node (pure cycle) and an
   *  arbitrary-but-deterministic entry node was chosen. */
  usedEntryFallback: boolean
}

// --- constants (the layout contract; unit tests pin these) -------------------

/** Base element sizes (bpmn-js native). */
export const TASK_W = 100
export const TASK_H = 80
export const GATEWAY_SIZE = 50
export const EVENT_SIZE = 36
/** Outer margin around the whole drawing. */
export const MARGIN = 40
/** Gap between adjacent column reserved boxes. */
export const H_GAP = 44
/** Gap between adjacent row (layer) reserved bands — routing channels live here. */
export const V_GAP = 56
/** First back/skip lane sits this far right of the grid's right edge. */
export const LANE_OFFSET = 24
/** Distance between adjacent back/skip lanes. */
export const LANE_STEP = 16
/** Vertical gap between stacked disconnected components. */
export const COMPONENT_GAP = 80

// External-label estimate (events/gateways render their name OUTSIDE the shape).
const LABEL_WRAP_CHARS = 16
const LABEL_CHAR_W = 6
const LABEL_LINE_H = 14
const LABEL_MAX_LINES = 3
const LABEL_MAX_W = 96
/** Vertical orientation: gap between the label's right edge and the shape. */
const LABEL_GAP = 8
/** Horizontal orientation: label sits below the shape (bpmn-js default +7). */
const LABEL_BELOW_GAP = 7

// Channel sub-lanes inside one inter-layer gap: one y per "port" (fan-outs
// share their source's y — symmetric T-splits; merges share the target's).
const CHAN_STEP_MAX = 10
const CHAN_KEEPOUT = 10

// --- per-node geometry -------------------------------------------------------

/** BPMN size for an emit tag (final-space width × height). Task-family nodes
 *  widen, then grow taller, using the same deterministic fit as live edits. */
export function nodeBaseSize(tag: string, label: string = ''): { w: number; h: number } {
  if (tag.endsWith('Gateway')) return { w: GATEWAY_SIZE, h: GATEWAY_SIZE }
  if (tag.endsWith('Event')) return { w: EVENT_SIZE, h: EVENT_SIZE }
  return fitInteriorBox(label, { reserveSubChip: tag === 'callActivity' })
}

/** 'callActivity' → 'bpmn:CallActivity' (decorExtents element-type form). */
function bpmnType(tag: string): string {
  return 'bpmn:' + tag.charAt(0).toUpperCase() + tag.slice(1)
}

/** Does this node render its name as an EXTERNAL label? */
function hasExternalLabel(node: { tag: string; label?: string }): boolean {
  if (!node.label) return false
  return node.tag.endsWith('Event') || node.tag.endsWith('Gateway')
}

/** Greedy word wrap at LABEL_WRAP_CHARS; overlong words hard-split. */
function wrapLabel(label: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const chunks: string[] = []
    for (let i = 0; i < word.length; i += LABEL_WRAP_CHARS)
      chunks.push(word.slice(i, i + LABEL_WRAP_CHARS))
    for (const chunk of chunks) {
      if (!line) line = chunk
      else if (line.length + 1 + chunk.length <= LABEL_WRAP_CHARS) line += ' ' + chunk
      else {
        lines.push(line)
        line = chunk
      }
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Estimated external-label box size (0×0 when the node has none). */
export function estimateLabelSize(label: string): { w: number; h: number } {
  const lines = wrapLabel(label).slice(0, LABEL_MAX_LINES)
  if (lines.length === 0) return { w: 0, h: 0 }
  let longest = 0
  for (const l of lines) longest = Math.max(longest, l.length)
  return { w: Math.min(LABEL_MAX_W, LABEL_CHAR_W * longest), h: LABEL_LINE_H * lines.length }
}

/** External-label box in shape-local FINAL-space coords (null when none). */
function labelLocalBox(
  node: { tag: string; label?: string },
  orientation: Orientation
): Box | null {
  if (!hasExternalLabel(node)) return null
  const { w, h } = nodeBaseSize(node.tag, node.label)
  const size = estimateLabelSize(node.label as string)
  return orientation === 'vertical'
    ? // Left of the shape, vertically centred (the right side belongs to the
      // owner/resp/cc stack, top to the badge, bottom to the exit flow).
      { x: -(size.w + LABEL_GAP), y: (h - size.h) / 2, w: size.w, h: size.h }
    : // Below the shape, horizontally centred (bpmn-js's native spot).
      { x: (w - size.w) / 2, y: h + LABEL_BELOW_GAP, w: size.w, h: size.h }
}

export interface ReservedExtents {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * FINAL-space reserved extents beyond the base shape box: decoration margins
 * (computeDecorMargins with completenessOn — the frozen org contract) folded
 * with the external-label estimate. Exported so tests can inflate emitted DI
 * bounds by exactly what the layout reserved.
 */
export function reservedExtents(
  node: { tag: string; label?: string; attrs?: OrgProps },
  orientation: Orientation
): ReservedExtents {
  const { w, h } = nodeBaseSize(node.tag, node.label)
  const labelBox = labelLocalBox(node, orientation)
  const margins = computeDecorMargins({
    props: node.attrs ?? {},
    elementType: bpmnType(node.tag),
    width: w,
    height: h,
    orientation,
    completenessOn: true,
    labelBox
  })
  const ext = { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom }
  if (labelBox) {
    ext.left = Math.max(ext.left, -labelBox.x)
    ext.right = Math.max(ext.right, labelBox.x + labelBox.w - w)
    ext.top = Math.max(ext.top, -labelBox.y)
    ext.bottom = Math.max(ext.bottom, labelBox.y + labelBox.h - h)
  }
  return ext
}

// --- internal state ----------------------------------------------------------

type SortKey = [number, number, string]

interface NodeState {
  node: LayoutNode
  /** Final-space base size. */
  w: number
  h: number
  /** Flow-space base size (transposed when orientation is horizontal). */
  fw: number
  fh: number
  /** Flow-space reserved extents. */
  fl: number
  fr: number
  ft: number
  fb: number
  key: SortKey
  comp: number
  layer: number
  slot: number
  col: number
  /** Flow-space placement. */
  fx: number
  fy: number
  axis: number
}

function compareKey(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface RoutePoint {
  x: number
  y: number
}

export interface RouteRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

type RouteDirection = 0 | 1 | 2 // none, horizontal, vertical

const ROUTE_OUTER_GAP = LANE_OFFSET

function pointKey(point: RoutePoint): string {
  return `${point.x},${point.y}`
}

/** Drop duplicate and collinear points. Kept separate from route search so
 * rounding in the final orientation cannot re-introduce zero-length bends. */
function normalizeWaypoints(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && last.x === point.x && last.y === point.y) continue
    out.push(point)
    while (out.length >= 3) {
      const a = out[out.length - 3]
      const b = out[out.length - 2]
      const c = out[out.length - 1]
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y))
        out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

function pointStrictlyInside(point: RoutePoint, rect: RouteRect): boolean {
  return point.x > rect.x0 && point.x < rect.x1 && point.y > rect.y0 && point.y < rect.y1
}

/** Borders may be followed but interiors may not be entered. This makes the
 * shape port itself usable while still rejecting a tangent that turns inward. */
function segmentHitsRect(a: RoutePoint, b: RoutePoint, rect: RouteRect): boolean {
  if (a.x === b.x) {
    const y0 = Math.min(a.y, b.y)
    const y1 = Math.max(a.y, b.y)
    return a.x > rect.x0 && a.x < rect.x1 && y0 < rect.y1 && y1 > rect.y0
  }
  if (a.y === b.y) {
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    return a.y > rect.y0 && a.y < rect.y1 && x0 < rect.x1 && x1 > rect.x0
  }
  return true
}

function segmentVisible(a: RoutePoint, b: RoutePoint, obstacles: RouteRect[]): boolean {
  if (a.x !== b.x && a.y !== b.y) return false
  if (a.x === b.x && a.y === b.y) return true
  return !obstacles.some((rect) => segmentHitsRect(a, b, rect))
}

function segmentOutsideLength(a: RoutePoint, b: RoutePoint, grid: RouteRect): number {
  if (a.x === b.x) {
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    if (a.x < grid.x0 || a.x > grid.x1) return hi - lo
    return Math.max(0, Math.min(hi, grid.y0) - lo) + Math.max(0, hi - Math.max(lo, grid.y1))
  }
  const lo = Math.min(a.x, b.x)
  const hi = Math.max(a.x, b.x)
  if (a.y < grid.y0 || a.y > grid.y1) return hi - lo
  return Math.max(0, Math.min(hi, grid.x0) - lo) + Math.max(0, hi - Math.max(lo, grid.x1))
}

interface RouteScore {
  collisions: number
  bends: number
  length: number
  outside: number
  signature: string
}

function compareRouteScore(a: RouteScore, b: RouteScore): number {
  if (a.collisions !== b.collisions) return a.collisions - b.collisions
  if (a.bends !== b.bends) return a.bends - b.bends
  if (a.length !== b.length) return a.length - b.length
  if (a.outside !== b.outside) return a.outside - b.outside
  return compareIds(a.signature, b.signature)
}

function scoreWaypoints(
  points: RoutePoint[],
  obstacles: RouteRect[],
  grid: RouteRect,
  edgeId: string
): RouteScore {
  const normalized = normalizeWaypoints(points)
  let collisions = 0
  let bends = 0
  let length = 0
  let outside = 0
  for (let i = 1; i < normalized.length; i++) {
    const a = normalized[i - 1]
    const b = normalized[i]
    if (!segmentVisible(a, b, obstacles)) collisions += 1
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    outside += segmentOutsideLength(a, b, grid)
    if (i >= 2) {
      const before = normalized[i - 2]
      if ((before.x === a.x) !== (a.x === b.x)) bends += 1
    }
  }
  return {
    collisions,
    bends,
    length,
    outside,
    signature: `${normalized.map(pointKey).join(';')}|${edgeId}`
  }
}

/**
 * Sparse rectilinear visibility graph. An optimal orthogonal route only needs
 * to turn at an obstacle corner or on a source/target projection, so the graph
 * remains linear in obstacle count rather than materialising the full Hanan
 * grid. Dijkstra state includes arrival direction, making bend count the first
 * (and therefore dominant) cost.
 */
export function routeOrthogonal(
  start: RoutePoint,
  end: RoutePoint,
  obstacles: RouteRect[],
  grid: RouteRect,
  edgeId: string,
  initialDirection: RouteDirection = 0,
  finalDirection: RouteDirection = 0,
  requiredFirstDirection: RouteDirection = 0,
  requiredLastDirection: RouteDirection = 0
): RoutePoint[] {
  const directDirection: RouteDirection = start.y === end.y ? 1 : start.x === end.x ? 2 : 0
  if (
    directDirection !== 0 &&
    (initialDirection === 0 || initialDirection === directDirection) &&
    (finalDirection === 0 || finalDirection === directDirection) &&
    (requiredFirstDirection === 0 || requiredFirstDirection === directDirection) &&
    (requiredLastDirection === 0 || requiredLastDirection === directDirection) &&
    segmentVisible(start, end, obstacles)
  ) {
    return normalizeWaypoints([start, end])
  }

  let minX = Math.min(grid.x0, start.x, end.x)
  let minY = Math.min(grid.y0, start.y, end.y)
  let maxX = Math.max(grid.x1, start.x, end.x)
  let maxY = Math.max(grid.y1, start.y, end.y)
  for (const rect of obstacles) {
    minX = Math.min(minX, rect.x0)
    minY = Math.min(minY, rect.y0)
    maxX = Math.max(maxX, rect.x1)
    maxY = Math.max(maxY, rect.y1)
  }
  const outer = {
    x0: minX - ROUTE_OUTER_GAP,
    y0: minY - ROUTE_OUTER_GAP,
    x1: maxX + ROUTE_OUTER_GAP,
    y1: maxY + ROUTE_OUTER_GAP
  }

  const points = new Map<string, RoutePoint>()
  const addPoint = (x: number, y: number, terminal = false): void => {
    const point = { x, y }
    // Soft connector-clearance rectangles may contain another connection's
    // terminal. Terminals must remain in the graph; visibility still prevents
    // an invalid path through the rectangle interior.
    if (!terminal && obstacles.some((rect) => pointStrictlyInside(point, rect))) {
      return
    }
    points.set(pointKey(point), point)
  }
  addPoint(start.x, start.y, true)
  addPoint(end.x, end.y, true)
  addPoint(start.x, end.y)
  addPoint(end.x, start.y)
  for (const rect of obstacles) {
    addPoint(rect.x0, rect.y0)
    addPoint(rect.x0, rect.y1)
    addPoint(rect.x1, rect.y0)
    addPoint(rect.x1, rect.y1)
    // Projections of both terminals onto every obstacle face are sufficient
    // to enter the obstacle-corner visibility graph from arbitrary ports.
    addPoint(rect.x0, start.y)
    addPoint(rect.x1, start.y)
    addPoint(start.x, rect.y0)
    addPoint(start.x, rect.y1)
    addPoint(rect.x0, end.y)
    addPoint(rect.x1, end.y)
    addPoint(end.x, rect.y0)
    addPoint(end.x, rect.y1)
  }
  for (const x of [outer.x0, outer.x1, start.x, end.x]) {
    addPoint(x, outer.y0)
    addPoint(x, outer.y1)
  }
  for (const y of [outer.y0, outer.y1, start.y, end.y]) {
    addPoint(outer.x0, y)
    addPoint(outer.x1, y)
  }

  const pointList = [...points.values()].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y))
  const indexOf = new Map(pointList.map((point, index) => [pointKey(point), index]))
  const neighbours: number[][] = pointList.map(() => [])
  const connectRuns = (runs: Map<number, number[]>, primary: 'x' | 'y'): void => {
    for (const indices of runs.values()) {
      indices.sort((ai, bi) => {
        const a = pointList[ai]
        const b = pointList[bi]
        return primary === 'x' ? a.y - b.y : a.x - b.x
      })
      for (let i = 1; i < indices.length; i++) {
        const a = indices[i - 1]
        const b = indices[i]
        if (!segmentVisible(pointList[a], pointList[b], obstacles)) continue
        neighbours[a].push(b)
        neighbours[b].push(a)
      }
    }
  }
  const byX = new Map<number, number[]>()
  const byY = new Map<number, number[]>()
  pointList.forEach((point, index) => {
    const xs = byX.get(point.x) ?? []
    xs.push(index)
    byX.set(point.x, xs)
    const ys = byY.get(point.y) ?? []
    ys.push(index)
    byY.set(point.y, ys)
  })
  connectRuns(byX, 'x')
  connectRuns(byY, 'y')
  for (const list of neighbours) {
    list.sort((ai, bi) => {
      const a = pointList[ai]
      const b = pointList[bi]
      return a.x !== b.x ? a.x - b.x : a.y - b.y
    })
  }

  interface SearchState {
    node: number
    direction: RouteDirection
    score: RouteScore
    path: number[]
  }
  const startIndex = indexOf.get(pointKey(start))
  const endIndex = indexOf.get(pointKey(end))
  if (startIndex === undefined || endIndex === undefined) return [start, end]
  const queue: SearchState[] = [
    {
      node: startIndex,
      direction: initialDirection,
      score: {
        collisions: 0,
        bends: 0,
        length: 0,
        outside: 0,
        signature: `${pointKey(start)}|${edgeId}`
      },
      path: [startIndex]
    }
  ]
  const best = new Map<string, RouteScore>()
  best.set(`${startIndex}:${initialDirection}`, queue[0].score)
  while (queue.length > 0) {
    queue.sort((a, b) => compareRouteScore(a.score, b.score))
    const current = queue.shift() as SearchState
    const bestHere = best.get(`${current.node}:${current.direction}`)
    if (!bestHere || compareRouteScore(current.score, bestHere) !== 0) continue
    if (current.node === endIndex)
      return normalizeWaypoints(current.path.map((index) => pointList[index]))
    const from = pointList[current.node]
    for (const nextNode of neighbours[current.node]) {
      const to = pointList[nextNode]
      const direction: RouteDirection = from.y === to.y ? 1 : 2
      if (
        current.path.length === 1 &&
        requiredFirstDirection !== 0 &&
        direction !== requiredFirstDirection
      )
        continue
      if (
        nextNode === endIndex &&
        requiredLastDirection !== 0 &&
        direction !== requiredLastDirection
      )
        continue
      const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
      const score: RouteScore = {
        collisions: 0,
        bends:
          current.score.bends +
          (current.direction !== 0 && current.direction !== direction ? 1 : 0) +
          (nextNode === endIndex && finalDirection !== 0 && finalDirection !== direction ? 1 : 0),
        length: current.score.length + distance,
        outside: current.score.outside + segmentOutsideLength(from, to, grid),
        signature: `${current.score.signature};${pointKey(to)}`
      }
      const key = `${nextNode}:${direction}`
      const old = best.get(key)
      if (old && compareRouteScore(old, score) <= 0) continue
      best.set(key, score)
      queue.push({ node: nextNode, direction, score, path: [...current.path, nextNode] })
    }
  }

  // Malformed overlapping boxes can disconnect the sparse graph. Prefer the
  // least-colliding outer-frame candidate rather than blindly selecting the
  // right side; for ordinary finite disjoint rectangles at least one is clear.
  const fallbacks = [
    [start, { x: outer.x0, y: start.y }, { x: outer.x0, y: end.y }, end],
    [start, { x: outer.x1, y: start.y }, { x: outer.x1, y: end.y }, end],
    [start, { x: start.x, y: outer.y0 }, { x: end.x, y: outer.y0 }, end],
    [start, { x: start.x, y: outer.y1 }, { x: end.x, y: outer.y1 }, end]
  ].map(normalizeWaypoints)
  fallbacks.sort((a, b) =>
    compareRouteScore(
      scoreWaypoints(a, obstacles, grid, edgeId),
      scoreWaypoints(b, obstacles, grid, edgeId)
    )
  )
  return fallbacks[0]
}

// --- the layout --------------------------------------------------------------

export function layoutEpc(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts?: { orientation?: Orientation }
): EpcLayoutResult {
  const orientation: Orientation = opts?.orientation ?? 'vertical'
  const vertical = orientation === 'vertical'

  // 1. Node states: base sizes + reserved extents, mapped into flow space.
  //    Flow space always flows top→bottom; for 'horizontal' the finished
  //    layout is transposed (x↔y), so final-left ≡ flow-top etc.
  const states = new Map<string, NodeState>()
  for (const node of nodes) {
    if (states.has(node.id)) continue // defensive: first definition wins
    const { w, h } = nodeBaseSize(node.tag, node.label)
    const ext = reservedExtents(node, orientation)
    const hint = node.hint
    const key: SortKey = hint
      ? vertical
        ? [hint.y, hint.x, node.id]
        : [hint.x, hint.y, node.id]
      : [Infinity, Infinity, node.id]
    states.set(node.id, {
      node,
      w,
      h,
      fw: vertical ? w : h,
      fh: vertical ? h : w,
      fl: vertical ? ext.left : ext.top,
      fr: vertical ? ext.right : ext.bottom,
      ft: vertical ? ext.top : ext.left,
      fb: vertical ? ext.bottom : ext.right,
      key,
      comp: -1,
      layer: 0,
      slot: 0,
      col: 0,
      fx: 0,
      fy: 0,
      axis: 0
    })
  }

  // Usable edges (both endpoints known); adjacency in canonical order.
  const usable = edges.filter((e) => states.has(e.source) && states.has(e.target))
  const outEdges = new Map<string, LayoutEdge[]>()
  const inEdges = new Map<string, LayoutEdge[]>()
  for (const id of states.keys()) {
    outEdges.set(id, [])
    inEdges.set(id, [])
  }
  for (const e of usable) {
    ;(outEdges.get(e.source) as LayoutEdge[]).push(e)
    ;(inEdges.get(e.target) as LayoutEdge[]).push(e)
  }
  const edgeOrder = (a: LayoutEdge, b: LayoutEdge): number => {
    const ka = (states.get(a.target) as NodeState).key
    const kb = (states.get(b.target) as NodeState).key
    const c = compareKey(ka, kb)
    return c !== 0 ? c : compareIds(a.id, b.id)
  }
  for (const list of outEdges.values()) list.sort(edgeOrder)

  // 2. Weakly-connected components, ordered by their minimal sort key.
  const compOf = new Map<string, number>()
  const comps: string[][] = []
  const allIdsByKey = [...states.values()]
    .sort((a, b) => compareKey(a.key, b.key))
    .map((s) => s.node.id)
  for (const seed of allIdsByKey) {
    if (compOf.has(seed)) continue
    const compIdx = comps.length
    const members: string[] = []
    const queue = [seed]
    compOf.set(seed, compIdx)
    while (queue.length > 0) {
      const id = queue.shift() as string
      members.push(id)
      const neighbours = [
        ...(outEdges.get(id) as LayoutEdge[]).map((e) => e.target),
        ...(inEdges.get(id) as LayoutEdge[]).map((e) => e.source)
      ]
      for (const n of neighbours) {
        if (!compOf.has(n)) {
          compOf.set(n, compIdx)
          queue.push(n)
        }
      }
    }
    comps.push(members)
  }
  for (const [id, c] of compOf) (states.get(id) as NodeState).comp = c

  let usedEntryFallback = false
  const shapes = new Map<string, PlacedShape>()
  const routed = new Map<string, RoutedEdge>()

  // Global assembly cursor: components stack vertically in flow space.
  let stackCursor = 0
  let globalMaxX = 0

  for (let ci = 0; ci < comps.length; ci++) {
    const memberIds = comps[ci]
    const members = memberIds.map((id) => states.get(id) as NodeState)
    members.sort((a, b) => compareKey(a.key, b.key))
    const memberSet = new Set(memberIds)
    const compEdges = usable.filter((e) => memberSet.has(e.source))

    // 3. Cycle breaking: iterative DFS; edges reaching an on-stack node are
    //    back-edges. Roots = zero-in-degree by key; a rootless component takes
    //    its minimal-key node (entry fallback); leftovers restart at the
    //    minimal-key unvisited node.
    const backEdgeIds = new Set<string>()
    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    for (const id of memberIds) color.set(id, WHITE)
    const dfs = (rootId: string): void => {
      color.set(rootId, GRAY)
      const stack: Array<{ id: string; i: number }> = [{ id: rootId, i: 0 }]
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        const outs = outEdges.get(top.id) as LayoutEdge[]
        if (top.i < outs.length) {
          const e = outs[top.i]
          top.i += 1
          const c = color.get(e.target)
          if (c === GRAY) backEdgeIds.add(e.id)
          else if (c === WHITE) {
            color.set(e.target, GRAY)
            stack.push({ id: e.target, i: 0 })
          }
          // BLACK: forward/cross edge into a finished subtree — never a cycle.
        } else {
          color.set(top.id, BLACK)
          stack.pop()
        }
      }
    }
    const roots = members.filter((s) => (inEdges.get(s.node.id) as LayoutEdge[]).length === 0)
    if (roots.length === 0) usedEntryFallback = true
    for (const r of roots) if (color.get(r.node.id) === WHITE) dfs(r.node.id)
    for (const s of members) if (color.get(s.node.id) === WHITE) dfs(s.node.id)

    const forward = compEdges.filter((e) => !backEdgeIds.has(e.id))
    const fwdOut = new Map<string, LayoutEdge[]>()
    const fwdIn = new Map<string, LayoutEdge[]>()
    for (const id of memberIds) {
      fwdOut.set(id, [])
      fwdIn.set(id, [])
    }
    for (const e of forward) {
      ;(fwdOut.get(e.source) as LayoutEdge[]).push(e)
      ;(fwdIn.get(e.target) as LayoutEdge[]).push(e)
    }
    for (const list of fwdOut.values()) list.sort(edgeOrder)

    // 4. Layering: longest path from the forward roots (Kahn order).
    const indeg = new Map<string, number>()
    for (const id of memberIds) indeg.set(id, (fwdIn.get(id) as LayoutEdge[]).length)
    const queue = members.filter((s) => indeg.get(s.node.id) === 0).map((s) => s.node.id)
    for (const s of members) s.layer = 0
    let qi = 0
    while (qi < queue.length) {
      const id = queue[qi]
      qi += 1
      const st = states.get(id) as NodeState
      for (const e of fwdOut.get(id) as LayoutEdge[]) {
        const t = states.get(e.target) as NodeState
        if (st.layer + 1 > t.layer) t.layer = st.layer + 1
        const d = (indeg.get(e.target) as number) - 1
        indeg.set(e.target, d)
        if (d === 0) queue.push(e.target)
      }
    }

    // 5. Slot assignment (half-column units so even fan-outs centre exactly),
    //    per layer top→down.
    const byLayer: NodeState[][] = []
    for (const s of members) {
      ;(byLayer[s.layer] ??= []).push(s)
    }
    for (let l = 0; l < byLayer.length; l++) {
      const layerNodes = (byLayer[l] ?? []).slice().sort((a, b) => compareKey(a.key, b.key))
      const desired = new Map<NodeState, number>()
      if (l === 0) {
        const k = layerNodes.length
        layerNodes.forEach((s, i) => desired.set(s, 2 * i - (k - 1)))
      } else {
        for (const s of layerNodes) {
          const preds = (fwdIn.get(s.node.id) as LayoutEdge[]).map(
            (e) => states.get(e.source) as NodeState
          )
          if (preds.length === 1) {
            const p = preds[0]
            const siblings = (fwdOut.get(p.node.id) as LayoutEdge[]).map(
              (e) => states.get(e.target) as NodeState
            )
            if (siblings.length <= 1) {
              // Chain straightening: the spine stays one straight column.
              desired.set(s, p.slot)
            } else {
              // Symmetric fan-out around the splitting node's slot.
              const i = siblings.indexOf(s)
              desired.set(s, p.slot + (2 * i - (siblings.length - 1)))
            }
          } else {
            // Merge: settle under the mean of the branch columns.
            let sum = 0
            for (const p of preds) sum += p.slot
            desired.set(s, preds.length > 0 ? sum / preds.length : 0)
          }
        }
      }
      // Collision resolution: left→right by desired slot, minimum one
      // half-slot apart (distinct columns after compaction).
      const ordered = layerNodes.slice().sort((a, b) => {
        const da = desired.get(a) as number
        const db = desired.get(b) as number
        if (da !== db) return da - db
        return compareKey(a.key, b.key)
      })
      let prev = -Infinity
      for (const s of ordered) {
        s.slot = Math.max(Math.round(desired.get(s) as number), prev + 1)
        prev = s.slot
      }
    }

    // Compact used slots to dense column indexes 0..m-1 (component-wide, so a
    // slot shared across layers stays one straight column).
    const usedSlots = [...new Set(members.map((s) => s.slot))].sort((a, b) => a - b)
    const colOfSlot = new Map<number, number>()
    usedSlots.forEach((slot, i) => colOfSlot.set(slot, i))
    for (const s of members) s.col = colOfSlot.get(s.slot) as number

    // 6. Column/row metrics from member extents (decorations + labels).
    //    Columns reserve a SYMMETRIC half-width around their axis
    //    (base/2 + max(left, right) per member) so identical branch columns
    //    sit at identical distances from a splitting gateway no matter which
    //    SIDE their decorations/labels occupy. Rows pack asymmetrically —
    //    there is no symmetry to preserve along the flow direction.
    const colCount = usedSlots.length
    const layerCount = byLayer.length
    const colHalf = new Array<number>(colCount).fill(0)
    const rowTop = new Array<number>(layerCount).fill(0)
    const rowBase = new Array<number>(layerCount).fill(0)
    const rowBot = new Array<number>(layerCount).fill(0)
    for (const s of members) {
      colHalf[s.col] = Math.max(colHalf[s.col], s.fw / 2 + Math.max(s.fl, s.fr))
      rowTop[s.layer] = Math.max(rowTop[s.layer], s.ft)
      rowBase[s.layer] = Math.max(rowBase[s.layer], s.fh)
      rowBot[s.layer] = Math.max(rowBot[s.layer], s.fb)
    }
    const colX = new Array<number>(colCount).fill(0)
    for (let c = 1; c < colCount; c++) {
      colX[c] = colX[c - 1] + 2 * colHalf[c - 1] + H_GAP
    }
    const rowY = new Array<number>(layerCount).fill(0)
    for (let l = 1; l < layerCount; l++) {
      rowY[l] = rowY[l - 1] + rowTop[l - 1] + rowBase[l - 1] + rowBot[l - 1] + V_GAP
    }
    const rowH = (l: number): number => rowTop[l] + rowBase[l] + rowBot[l]
    const gridRight = colCount > 0 ? colX[colCount - 1] + 2 * colHalf[colCount - 1] : 0

    // 7. Placement: every member centres on its column axis / row band.
    for (const s of members) {
      s.axis = colX[s.col] + colHalf[s.col]
      s.fx = s.axis - s.fw / 2
      s.fy = rowY[s.layer] + rowTop[s.layer] + (rowBase[s.layer] - s.fh) / 2
    }

    // 8. Edge routing. Build exact obstacles from base shapes, external labels
    //    and each individual org decoration (never the coarse margin envelope),
    //    then search a sparse orthogonal visibility graph. Shared source/target
    //    stubs retain the geometric T-splits and joins of the layered layout.
    //    Gap g = between layer g and g+1 (g = -1: above the first layer).
    const chanCenter = (gap: number): number => {
      if (gap < 0) return rowY[0] - V_GAP / 2
      const g = Math.min(gap, layerCount - 1)
      return rowY[g] + rowH(g) + V_GAP / 2
    }

    // Register shared ports only. Single connections get a short legal stub
    // and the graph chooses their best route; a fan-out or merge uses one
    // channel coordinate for every related edge.
    const gapPorts = new Map<number, Map<string, number>>() // gap → portId → axis
    const registerPort = (gap: number, port: NodeState): void => {
      let ports = gapPorts.get(gap)
      if (!ports) {
        ports = new Map()
        gapPorts.set(gap, ports)
      }
      if (!ports.has(port.node.id)) ports.set(port.node.id, port.axis)
    }
    for (const e of compEdges) {
      const s = states.get(e.source) as NodeState
      const t = states.get(e.target) as NodeState
      if ((outEdges.get(s.node.id) as LayoutEdge[]).length > 1 || backEdgeIds.has(e.id))
        registerPort(s.layer, s)
      if ((inEdges.get(t.node.id) as LayoutEdge[]).length > 1 || backEdgeIds.has(e.id))
        registerPort(t.layer - 1, t)
    }
    const gapY = new Map<number, Map<string, number>>()
    for (const [gap, ports] of gapPorts) {
      const ordered = [...ports.entries()].sort((a, b) =>
        a[1] !== b[1] ? a[1] - b[1] : compareIds(a[0], b[0])
      )
      const m = ordered.length
      const step = m > 1 ? Math.min(CHAN_STEP_MAX, (V_GAP - 2 * CHAN_KEEPOUT) / (m - 1)) : 0
      const centre = chanCenter(gap)
      const ys = new Map<string, number>()
      ordered.forEach(([id], j) => ys.set(id, centre + (j - (m - 1) / 2) * step))
      gapY.set(gap, ys)
    }
    const portY = (gap: number, id: string): number => {
      const y = gapY.get(gap)?.get(id)
      return y !== undefined ? y : chanCenter(gap)
    }

    const flowRect = (s: NodeState, box: Box): RouteRect =>
      vertical
        ? { x0: s.fx + box.x, y0: s.fy + box.y, x1: s.fx + box.x + box.w, y1: s.fy + box.y + box.h }
        : {
            x0: s.fx + box.y,
            y0: s.fy + box.x,
            x1: s.fx + box.y + box.h,
            y1: s.fy + box.x + box.w
          }
    const obstacles: RouteRect[] = []
    const externalByNode = new Map<string, RouteRect[]>()
    for (const s of members) {
      obstacles.push({ x0: s.fx, y0: s.fy, x1: s.fx + s.fw, y1: s.fy + s.fh })
      const external: RouteRect[] = []
      const label = labelLocalBox(s.node, orientation)
      if (label) external.push(flowRect(s, label))
      const decor = computeDecorLayout({
        props: s.node.attrs ?? {},
        elementType: bpmnType(s.node.tag),
        width: s.w,
        height: s.h,
        orientation,
        direction: vertical ? 'down' : 'right',
        completenessOn: true,
        labelBox: label
      })
      for (const { box } of decorationBoxes(decor)) external.push(flowRect(s, box))
      externalByNode.set(s.node.id, external)
      obstacles.push(...external)
    }

    const sharedSource = new Set<string>()
    const sharedTarget = new Set<string>()
    for (const e of compEdges) {
      const s = states.get(e.source) as NodeState
      const t = states.get(e.target) as NodeState
      const isBack = backEdgeIds.has(e.id)
      if ((outEdges.get(s.node.id) as LayoutEdge[]).length > 1 || isBack)
        sharedSource.add(s.node.id)
      if ((inEdges.get(t.node.id) as LayoutEdge[]).length > 1 || isBack) sharedTarget.add(t.node.id)
    }

    // The centre is the sole normal port. When an endpoint decoration blocks
    // its outward probe, every deterministic boundary alternative is retained;
    // route scoring (not proximity alone) chooses between equally-near sides.
    const legalVerticalPortXs = (s: NodeState, source: boolean, probeY: number): number[] => {
      const centre = s.fx + s.fw / 2
      const portYValue = source ? s.fy + s.fh : s.fy
      const external = externalByNode.get(s.node.id) ?? []
      const centrePort = { x: centre, y: portYValue }
      const probe = { x: centre, y: probeY }
      if (segmentVisible(centrePort, probe, external)) return [centre]

      const candidates = new Set<number>([s.fx, s.fx + s.fw])
      for (const rect of external) {
        if (!segmentHitsRect(centrePort, probe, rect)) continue
        for (const x of [rect.x0, rect.x1]) {
          if (x >= s.fx && x <= s.fx + s.fw) candidates.add(x)
        }
      }
      const ordered = [...candidates].sort((a, b) => {
        const da = Math.abs(a - centre)
        const db = Math.abs(b - centre)
        return da !== db ? da - db : a - b
      })
      const legal = ordered.filter((x) =>
        segmentVisible({ x, y: portYValue }, { x, y: probeY }, external)
      )
      return legal.length > 0 ? legal : [source ? s.fx + s.fw : s.fx]
    }

    const sourcePortXs = new Map<string, number[]>()
    const targetPortXs = new Map<string, number[]>()
    for (const id of memberIds) {
      const s = states.get(id) as NodeState
      const sourceProbe = sharedSource.has(id) ? portY(s.layer, id) : s.fy + s.fh + 4
      const targetProbe = sharedTarget.has(id) ? portY(s.layer - 1, id) : s.fy - 4
      sourcePortXs.set(id, legalVerticalPortXs(s, true, sourceProbe))
      targetPortXs.set(id, legalVerticalPortXs(s, false, targetProbe))
    }

    const gridBounds: RouteRect = {
      x0: 0,
      y0: rowY[0],
      x1: gridRight,
      y1: rowY[layerCount - 1] + rowH(layerCount - 1)
    }
    const orderedEdges = compEdges.slice().sort((a, b) => compareIds(a.id, b.id))

    interface RouteChoice {
      waypoints: RoutePoint[]
      score: RouteScore
    }
    const routeCache = new Map<string, RouteChoice>()
    const routeChoice = (
      e: LayoutEdge,
      sourceX: number,
      targetX: number,
      routeObstacles: RouteRect[] = obstacles
    ): RouteChoice => {
      const cacheKey = routeObstacles === obstacles ? `${e.id}|${sourceX}|${targetX}` : undefined
      const cached = cacheKey ? routeCache.get(cacheKey) : undefined
      if (cached) return cached
      const s = states.get(e.source) as NodeState
      const t = states.get(e.target) as NodeState
      const sourcePort = { x: sourceX, y: s.fy + s.fh }
      const targetPort = { x: targetX, y: t.fy }
      const sourceAnchor = {
        x: sourcePort.x,
        y: sharedSource.has(e.source) ? portY(s.layer, e.source) : sourcePort.y + 4
      }
      const targetAnchor = {
        x: targetPort.x,
        y: sharedTarget.has(e.target) ? portY(t.layer - 1, e.target) : targetPort.y - 4
      }
      const sourceMustTurn = sharedSource.has(e.source) && sourceAnchor.x !== targetAnchor.x ? 1 : 0
      const targetMustTurn = sharedTarget.has(e.target) && sourceAnchor.x !== targetAnchor.x ? 1 : 0
      const middle = routeOrthogonal(
        sourceAnchor,
        targetAnchor,
        routeObstacles,
        gridBounds,
        e.id,
        2,
        2,
        sourceMustTurn,
        targetMustTurn
      )
      const waypoints = normalizeWaypoints([
        sourcePort,
        sourceAnchor,
        ...middle,
        targetAnchor,
        targetPort
      ])
      const choice = {
        waypoints,
        score: scoreWaypoints(waypoints, routeObstacles, gridBounds, e.id)
      }
      if (cacheKey) routeCache.set(cacheKey, choice)
      return choice
    }
    const bestEdgeChoice = (
      e: LayoutEdge,
      sourceOptions: number[],
      targetOptions: number[]
    ): RouteChoice => {
      let best: RouteChoice | undefined
      for (const sourceX of sourceOptions) {
        for (const targetX of targetOptions) {
          const candidate = routeChoice(e, sourceX, targetX)
          if (!best || compareRouteScore(candidate.score, best.score) < 0) best = candidate
        }
      }
      return best as RouteChoice
    }
    const aggregateScores = (scores: RouteScore[], signature: string): RouteScore => {
      const aggregate: RouteScore = { collisions: 0, bends: 0, length: 0, outside: 0, signature }
      for (const score of scores) {
        aggregate.collisions += score.collisions
        aggregate.bends += score.bends
        aggregate.length += score.length
        aggregate.outside += score.outside
        aggregate.signature += `|${score.signature}`
      }
      return aggregate
    }

    // A shared fan-out/merge port is selected once for the whole incident edge
    // set. Coordinate descent is deterministic and monotonically improves the
    // sum of complete route scores; non-shared endpoints remain freely scored
    // per edge.
    const selectedSource = new Map<string, number>()
    const selectedTarget = new Map<string, number>()
    for (const id of sharedSource) selectedSource.set(id, (sourcePortXs.get(id) as number[])[0])
    for (const id of sharedTarget) selectedTarget.set(id, (targetPortXs.get(id) as number[])[0])
    const groups = [
      ...[...sharedSource].map((id) => ({ kind: 'source' as const, id })),
      ...[...sharedTarget].map((id) => ({ kind: 'target' as const, id }))
    ].sort((a, b) => {
      const ka = `${a.kind}:${a.id}`
      const kb = `${b.kind}:${b.id}`
      return compareIds(ka, kb)
    })
    for (let pass = 0; pass <= groups.length; pass++) {
      let changed = false
      for (const group of groups) {
        const candidates =
          group.kind === 'source'
            ? (sourcePortXs.get(group.id) as number[])
            : (targetPortXs.get(group.id) as number[])
        if (candidates.length <= 1) continue
        const incident = orderedEdges.filter((e) =>
          group.kind === 'source' ? e.source === group.id : e.target === group.id
        )
        let bestX = candidates[0]
        let bestScore: RouteScore | undefined
        for (const candidateX of candidates) {
          const scores: RouteScore[] = []
          for (const e of incident) {
            const sourceOptions = sharedSource.has(e.source)
              ? [
                  group.kind === 'source' && e.source === group.id
                    ? candidateX
                    : (selectedSource.get(e.source) as number)
                ]
              : (sourcePortXs.get(e.source) as number[])
            const targetOptions = sharedTarget.has(e.target)
              ? [
                  group.kind === 'target' && e.target === group.id
                    ? candidateX
                    : (selectedTarget.get(e.target) as number)
                ]
              : (targetPortXs.get(e.target) as number[])
            scores.push(bestEdgeChoice(e, sourceOptions, targetOptions).score)
          }
          const score = aggregateScores(scores, `${group.kind}:${group.id}:${candidateX}`)
          if (!bestScore || compareRouteScore(score, bestScore) < 0) {
            bestScore = score
            bestX = candidateX
          }
        }
        const selected = group.kind === 'source' ? selectedSource : selectedTarget
        if (selected.get(group.id) !== bestX) {
          selected.set(group.id, bestX)
          changed = true
        }
      }
      if (!changed) break
    }

    for (const e of orderedEdges) {
      const sourceOptions = sharedSource.has(e.source)
        ? [selectedSource.get(e.source) as number]
        : (sourcePortXs.get(e.source) as number[])
      const targetOptions = sharedTarget.has(e.target)
        ? [selectedTarget.get(e.target) as number]
        : (targetPortXs.get(e.target) as number[])
      const selected = bestEdgeChoice(e, sourceOptions, targetOptions)
      routed.set(e.id, {
        waypoints: selected.waypoints.map((point) => ({ ...point })),
        isBackEdge: backEdgeIds.has(e.id)
      })
    }

    // 9. Component bounding box (inflated shapes + labels + waypoints), then
    //    stack this component below the previous one, left edge at x = 0.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const grow = (x0: number, y0: number, x1: number, y1: number): void => {
      minX = Math.min(minX, x0)
      minY = Math.min(minY, y0)
      maxX = Math.max(maxX, x1)
      maxY = Math.max(maxY, y1)
    }
    for (const s of members) grow(s.fx - s.fl, s.fy - s.ft, s.fx + s.fw + s.fr, s.fy + s.fh + s.fb)
    for (const e of compEdges) {
      const r = routed.get(e.id)
      if (r) for (const wp of r.waypoints) grow(wp.x, wp.y, wp.x, wp.y)
    }
    if (members.length === 0) continue
    const dx = -minX
    const dy = stackCursor - minY
    for (const s of members) {
      s.fx += dx
      s.fy += dy
      s.axis += dx
    }
    for (const e of compEdges) {
      const r = routed.get(e.id)
      if (r)
        for (const wp of r.waypoints) {
          wp.x += dx
          wp.y += dy
        }
    }
    stackCursor += maxY - minY + COMPONENT_GAP
    globalMaxX = Math.max(globalMaxX, maxX - minX)
  }

  // 10. Finalize: shift by the outer margin, transpose for 'horizontal',
  //     round, attach label boxes, measure the drawing.
  const finalize = (x: number, y: number): { x: number; y: number } =>
    vertical
      ? { x: Math.round(x + MARGIN), y: Math.round(y + MARGIN) }
      : { x: Math.round(y + MARGIN), y: Math.round(x + MARGIN) }

  let sizeW = 0
  let sizeH = 0
  const measure = (x: number, y: number): void => {
    sizeW = Math.max(sizeW, x)
    sizeH = Math.max(sizeH, y)
  }
  for (const s of states.values()) {
    const p = finalize(s.fx, s.fy)
    const shape: PlacedShape = { x: p.x, y: p.y, w: s.w, h: s.h }
    const local = labelLocalBox(s.node, orientation)
    if (local) {
      shape.label = {
        x: Math.round(shape.x + local.x),
        y: Math.round(shape.y + local.y),
        w: local.w,
        h: local.h
      }
      measure(shape.label.x + shape.label.w, shape.label.y + shape.label.h)
    }
    shapes.set(s.node.id, shape)
    measure(
      shape.x + shape.w + (vertical ? s.fr : s.fb),
      shape.y + shape.h + (vertical ? s.fb : s.fr)
    )
  }
  for (const r of routed.values()) {
    r.waypoints = normalizeWaypoints(r.waypoints.map((wp) => finalize(wp.x, wp.y)))
    for (const wp of r.waypoints) measure(wp.x, wp.y)
  }

  return {
    shapes,
    edges: routed,
    size: { w: sizeW + MARGIN, h: sizeH + MARGIN },
    usedEntryFallback
  }
}

// --- DI emission -------------------------------------------------------------

/**
 * Serialize a layout as a `<bpmndi:BPMNDiagram>` block (shapes with BPMNLabel
 * bounds for externally-labelled events/gateways, orthogonal edge waypoints).
 * Emission order is canonical (sorted by element id) so identical graphs give
 * byte-identical DI regardless of input array order.
 */
export function emitLayoutDi(
  processId: string,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  result: EpcLayoutResult,
  escapeAttr: (s: string) => string
): string {
  let out = '<bpmndi:BPMNDiagram id="BPMNDiagram_1">'
  out += `<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${escapeAttr(processId)}">`
  const nodesSorted = nodes.slice().sort((a, b) => compareIds(a.id, b.id))
  for (const node of nodesSorted) {
    const shape = result.shapes.get(node.id)
    if (!shape) continue
    const marker = node.tag === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''
    out += `<bpmndi:BPMNShape id="BPMNShape_${escapeAttr(node.id)}" bpmnElement="${escapeAttr(node.id)}"${marker}>`
    out += `<dc:Bounds x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" />`
    if (shape.label) {
      out += '<bpmndi:BPMNLabel>'
      out += `<dc:Bounds x="${shape.label.x}" y="${shape.label.y}" width="${shape.label.w}" height="${shape.label.h}" />`
      out += '</bpmndi:BPMNLabel>'
    }
    out += '</bpmndi:BPMNShape>'
  }
  const edgesSorted = edges.slice().sort((a, b) => compareIds(a.id, b.id))
  for (const edge of edgesSorted) {
    const r = result.edges.get(edge.id)
    if (!r) continue
    out += `<bpmndi:BPMNEdge id="BPMNEdge_${escapeAttr(edge.id)}" bpmnElement="${escapeAttr(edge.id)}">`
    for (const wp of r.waypoints) out += `<di:waypoint x="${wp.x}" y="${wp.y}" />`
    out += '</bpmndi:BPMNEdge>'
  }
  out += '</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>'
  return out
}
