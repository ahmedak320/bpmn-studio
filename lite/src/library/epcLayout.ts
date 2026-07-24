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
//   • every edge is orthogonal; adjacent-layer edges ride a horizontal channel
//     inside the inter-layer gap, back-edges and layer-skipping edges travel
//     dedicated lanes on the RIGHT of the grid and enter the target's TOP;
//   • column/row sizing reserves each node's decoration extents (owner chip,
//     responsible/CC/inputs lists, decision-basis tag, missing-info badge —
//     via org/decorExtents.computeDecorMargins) plus its external label, so no
//     edge segment ever crosses another node's decorations;
//   • no Date.now/Math.random anywhere: identical input graphs produce
//     byte-identical DI, independent of input array order.
//
// The engine lays out in a "flow space" where flow always runs top→bottom;
// `orientation: 'horizontal'` transposes the finished layout (x↔y), with the
// decoration margins computed for the REAL orientation and mapped into flow
// space, so both orientations reserve exactly what the renderer will paint.

import { computeDecorMargins, type Box } from '../org/decorExtents'
import type { OrgProps } from '../org/orgModel'

export type Orientation = 'vertical' | 'horizontal'

export interface LayoutNode {
  id: string
  /** Emit tag: 'task' | 'callActivity' | 'startEvent' | 'endEvent' |
   *  'intermediateThrowEvent' | 'exclusiveGateway' | … */
  tag: string
  /** Display name — sizes the external label of events/gateways. */
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

/** Base BPMN size for an emit tag (final-space width × height). */
export function nodeBaseSize(tag: string): { w: number; h: number } {
  if (tag.endsWith('Gateway')) return { w: GATEWAY_SIZE, h: GATEWAY_SIZE }
  if (tag.endsWith('Event')) return { w: EVENT_SIZE, h: EVENT_SIZE }
  return { w: TASK_W, h: TASK_H }
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
    for (let i = 0; i < word.length; i += LABEL_WRAP_CHARS) chunks.push(word.slice(i, i + LABEL_WRAP_CHARS))
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
function labelLocalBox(node: { tag: string; label?: string }, orientation: Orientation): Box | null {
  if (!hasExternalLabel(node)) return null
  const { w, h } = nodeBaseSize(node.tag)
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
  const { w, h } = nodeBaseSize(node.tag)
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
    const { w, h } = nodeBaseSize(node.tag)
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
  const allIdsByKey = [...states.values()].sort((a, b) => compareKey(a.key, b.key)).map((s) => s.node.id)
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
          const preds = (fwdIn.get(s.node.id) as LayoutEdge[]).map((e) => states.get(e.source) as NodeState)
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
      const ordered = layerNodes
        .slice()
        .sort((a, b) => {
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

    // 8. Edge routing. Channel y midway in a gap; one sub-y per "port" so
    //    fan-outs/merges share a symmetric T while unrelated runs never
    //    overlap collinearly. Gap g = between layer g and g+1 (g = -1: above
    //    the first layer; g = last: below the grid — used by back/skip lanes).
    const chanCenter = (gap: number): number => {
      if (gap < 0) return rowY[0] - V_GAP / 2
      const g = Math.min(gap, layerCount - 1)
      return rowY[g] + rowH(g) + V_GAP / 2
    }
    // Lane-routed edges: DFS back-edges plus forward edges skipping ≥ 2 layers.
    const isLaneEdge = (e: LayoutEdge): boolean => {
      if (backEdgeIds.has(e.id)) return true
      const span = (states.get(e.target) as NodeState).layer - (states.get(e.source) as NodeState).layer
      return span >= 2
    }
    const laneEdges = compEdges.filter(isLaneEdge).sort((a, b) => {
      const la = states.get(a.target) as NodeState
      const lb = states.get(b.target) as NodeState
      if (la.layer !== lb.layer) return la.layer - lb.layer
      const sa = states.get(a.source) as NodeState
      const sb = states.get(b.source) as NodeState
      if (sa.layer !== sb.layer) return sa.layer - sb.layer
      return compareIds(a.id, b.id)
    })
    const laneX = new Map<string, number>()
    laneEdges.forEach((e, i) => laneX.set(e.id, gridRight + LANE_OFFSET + i * LANE_STEP))

    // Register every horizontal run's (gap, port) pair.
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
      if (isLaneEdge(e)) {
        registerPort(s.layer, s)
        registerPort(t.layer - 1, t)
      } else if (t.layer === s.layer + 1 && t.col !== s.col) {
        registerPort(s.layer, s)
      }
    }
    const gapY = new Map<number, Map<string, number>>()
    for (const [gap, ports] of gapPorts) {
      const ordered = [...ports.entries()].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : compareIds(a[0], b[0])))
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

    for (const e of compEdges) {
      const s = states.get(e.source) as NodeState
      const t = states.get(e.target) as NodeState
      const isBack = backEdgeIds.has(e.id)
      const sx = s.axis
      const dx = t.axis
      const srcBottom = s.fy + s.fh
      const dstTop = t.fy
      let waypoints: Array<{ x: number; y: number }>
      if (!isLaneEdge(e)) {
        if (t.col === s.col) {
          // Straight spine segment.
          waypoints = [
            { x: sx, y: srcBottom },
            { x: dx, y: dstTop }
          ]
        } else {
          const chan = portY(s.layer, s.node.id)
          waypoints = [
            { x: sx, y: srcBottom },
            { x: sx, y: chan },
            { x: dx, y: chan },
            { x: dx, y: dstTop }
          ]
        }
      } else {
        // Right-side lane: down into the source's gap, across to the lane,
        // along it, then in above the target and down into its top.
        const y1 = portY(s.layer, s.node.id)
        const y2 = portY(t.layer - 1, t.node.id)
        const lx = laneX.get(e.id) as number
        waypoints = [
          { x: sx, y: srcBottom },
          { x: sx, y: y1 },
          { x: lx, y: y1 },
          { x: lx, y: y2 },
          { x: dx, y: y2 },
          { x: dx, y: dstTop }
        ]
      }
      routed.set(e.id, { waypoints, isBackEdge: isBack })
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
      if (r) for (const wp of r.waypoints) {
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
    vertical ? { x: Math.round(x + MARGIN), y: Math.round(y + MARGIN) } : { x: Math.round(y + MARGIN), y: Math.round(x + MARGIN) }

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
    measure(shape.x + shape.w + (vertical ? s.fr : s.fb), shape.y + shape.h + (vertical ? s.fb : s.fr))
  }
  for (const r of routed.values()) {
    r.waypoints = r.waypoints.map((wp) => finalize(wp.x, wp.y))
    for (const wp of r.waypoints) measure(wp.x, wp.y)
  }

  return { shapes, edges: routed, size: { w: sizeW + MARGIN, h: sizeH + MARGIN }, usedEntryFallback }
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
