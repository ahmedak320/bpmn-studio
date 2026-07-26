import { describe, it, expect } from 'vitest'
import BpmnModdle from 'bpmn-moddle'
import {
  COMPONENT_GAP,
  H_GAP,
  MARGIN,
  emitLayoutDi,
  layoutEpc,
  nodeBaseSize,
  reservedExtents,
  type EpcLayoutResult,
  type LayoutEdge,
  type LayoutNode,
  type Orientation
} from '../epcLayout'
import { fitInteriorBox } from '../../editor/autoSize'
import { computeDecorLayout, decorationBoxes } from '../../org/decorExtents'

// ---------------------------------------------------------------------------
// Shared invariant helpers
// ---------------------------------------------------------------------------

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A node's shape bounds inflated by everything the layout reserved for it
 *  (decoration margins + external label). */
function inflatedBox(node: LayoutNode, result: EpcLayoutResult, orientation: Orientation): Rect {
  const s = result.shapes.get(node.id)
  if (!s) throw new Error(`no shape for ${node.id}`)
  const ext = reservedExtents(node, orientation)
  return { x0: s.x - ext.left, y0: s.y - ext.top, x1: s.x + s.w + ext.right, y1: s.y + s.h + ext.bottom }
}

function axisOf(result: EpcLayoutResult, id: string): number {
  const s = result.shapes.get(id)
  if (!s) throw new Error(`no shape for ${id}`)
  return s.x + s.w / 2
}

function midOf(result: EpcLayoutResult, id: string): number {
  const s = result.shapes.get(id)
  if (!s) throw new Error(`no shape for ${id}`)
  return s.y + s.h / 2
}

/** Every emitted coordinate (shapes, labels, waypoints) is >= 0. */
function assertPositive(result: EpcLayoutResult): void {
  for (const [id, s] of result.shapes) {
    expect(s.x, `${id} x`).toBeGreaterThanOrEqual(0)
    expect(s.y, `${id} y`).toBeGreaterThanOrEqual(0)
    if (s.label) {
      expect(s.label.x, `${id} label x`).toBeGreaterThanOrEqual(0)
      expect(s.label.y, `${id} label y`).toBeGreaterThanOrEqual(0)
    }
  }
  for (const [id, e] of result.edges) {
    for (const wp of e.waypoints) {
      expect(wp.x, `${id} waypoint x`).toBeGreaterThanOrEqual(0)
      expect(wp.y, `${id} waypoint y`).toBeGreaterThanOrEqual(0)
    }
  }
}

/** Every edge is orthogonal: consecutive waypoints share an x or a y. */
function assertOrthogonal(result: EpcLayoutResult): void {
  for (const [id, e] of result.edges) {
    expect(e.waypoints.length, `${id} has waypoints`).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < e.waypoints.length; i++) {
      const a = e.waypoints[i - 1]
      const b = e.waypoints[i]
      expect(a.x === b.x || a.y === b.y, `${id} segment ${i} orthogonal`).toBe(true)
    }
  }
}

function bendCount(points: Array<{ x: number; y: number }>): number {
  let bends = 0
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2]
    const b = points[i - 1]
    const c = points[i]
    if ((a.x === b.x) !== (b.x === c.x)) bends += 1
  }
  return bends
}

/** No two margins-inflated node boxes overlap (positive-area intersection). */
function assertNoOverlap(nodes: LayoutNode[], result: EpcLayoutResult, orientation: Orientation): void {
  const boxes = nodes.map((n) => ({ id: n.id, box: inflatedBox(n, result, orientation) }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box
      const b = boxes[j].box
      const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
      expect(overlaps, `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false)
    }
  }
}

/** Does an axis-aligned segment pass through the rect's interior? */
function segmentThroughRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  if (a.x === b.x) {
    const y0 = Math.min(a.y, b.y)
    const y1 = Math.max(a.y, b.y)
    return a.x > r.x0 && a.x < r.x1 && y0 < r.y1 && y1 > r.y0
  }
  if (a.y === b.y) {
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    return a.y > r.y0 && a.y < r.y1 && x0 < r.x1 && x1 > r.x0
  }
  return false // non-orthogonal segments are caught by assertOrthogonal
}

function exactObstacleBoxes(
  node: LayoutNode,
  result: EpcLayoutResult,
  orientation: Orientation
): Rect[] {
  const shape = result.shapes.get(node.id)
  if (!shape) throw new Error(`no shape for ${node.id}`)
  const out: Rect[] = [{ x0: shape.x, y0: shape.y, x1: shape.x + shape.w, y1: shape.y + shape.h }]
  if (shape.label) {
    out.push({
      x0: shape.label.x,
      y0: shape.label.y,
      x1: shape.label.x + shape.label.w,
      y1: shape.label.y + shape.label.h
    })
  }
  const layout = computeDecorLayout({
    props: node.attrs ?? {},
    elementType: 'bpmn:' + node.tag.charAt(0).toUpperCase() + node.tag.slice(1),
    width: shape.w,
    height: shape.h,
    orientation,
    direction: orientation === 'vertical' ? 'down' : 'right',
    completenessOn: true,
    labelBox: shape.label
      ? { x: shape.label.x - shape.x, y: shape.label.y - shape.y, w: shape.label.w, h: shape.label.h }
      : null
  })
  for (const { box } of decorationBoxes(layout)) {
    out.push({
      x0: shape.x + box.x,
      y0: shape.y + box.y,
      x1: shape.x + box.x + box.w,
      y1: shape.y + box.y + box.h
    })
  }
  return out
}

/** No edge segment crosses a base-shape interior, external label, or
 * individual decoration. Endpoint ports sit on the base border, so they need
 * no whole-rectangle exemption and endpoint decorations remain obstacles. */
function assertNoEdgeThroughNode(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  result: EpcLayoutResult,
  orientation: Orientation
): void {
  const boxes = new Map(nodes.map((n) => [n.id, exactObstacleBoxes(n, result, orientation)]))
  for (const edge of edges) {
    const routedEdge = result.edges.get(edge.id)
    if (!routedEdge) continue
    for (const [id, nodeBoxes] of boxes) {
      for (const rect of nodeBoxes) {
        for (let i = 1; i < routedEdge.waypoints.length; i++) {
          const through = segmentThroughRect(routedEdge.waypoints[i - 1], routedEdge.waypoints[i], rect)
          expect(through, `${edge.id} segment ${i} through ${id}`).toBe(false)
        }
      }
    }
  }
}

function assertAllInvariants(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  result: EpcLayoutResult,
  orientation: Orientation = 'vertical'
): void {
  assertPositive(result)
  assertOrthogonal(result)
  assertNoOverlap(nodes, result, orientation)
  assertNoEdgeThroughNode(nodes, edges, result, orientation)
}

function chain(ids: string[]): LayoutEdge[] {
  const edges: LayoutEdge[] = []
  for (let i = 0; i + 1 < ids.length; i++) {
    edges.push({ id: `f${i + 1}`, source: ids[i], target: ids[i + 1] })
  }
  return edges
}

// ---------------------------------------------------------------------------
// The suites
// ---------------------------------------------------------------------------

describe('layoutEpc — straight chains', () => {
  const nodes: LayoutNode[] = [
    { id: 's', tag: 'startEvent', label: 'Start here' },
    { id: 't1', tag: 'task', label: 'One' },
    { id: 't2', tag: 'task', label: 'Two' },
    { id: 't3', tag: 'task', label: 'Three' },
    { id: 'e', tag: 'endEvent', label: 'Done' }
  ]
  const edges = chain(['s', 't1', 't2', 't3', 'e'])

  it('a 5-node chain is one straight column with strictly increasing y', () => {
    const result = layoutEpc(nodes, edges)
    const axes = nodes.map((n) => axisOf(result, n.id))
    for (const a of axes) expect(a).toBe(axes[0])
    const ys = nodes.map((n) => (result.shapes.get(n.id) as { y: number }).y)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
    expect(result.usedEntryFallback).toBe(false)
    assertAllInvariants(nodes, edges, result)
  })

  it('chain flows are straight 2-waypoint verticals from bottom to top edge', () => {
    const result = layoutEpc(nodes, edges)
    for (const e of edges) {
      const r = result.edges.get(e.id)
      expect(r).toBeTruthy()
      expect(r?.isBackEdge).toBe(false)
      expect(r?.waypoints).toHaveLength(2)
      const src = result.shapes.get(e.source) as { x: number; y: number; w: number; h: number }
      const dst = result.shapes.get(e.target) as { x: number; y: number; w: number; h: number }
      expect(r?.waypoints[0]).toEqual({ x: src.x + src.w / 2, y: src.y + src.h })
      expect(r?.waypoints[1]).toEqual({ x: dst.x + dst.w / 2, y: dst.y })
    }
  })

  it('event/gateway labels sit LEFT of the shape in vertical orientation', () => {
    const result = layoutEpc(nodes, edges)
    const s = result.shapes.get('s')
    expect(s?.label).toBeTruthy()
    const label = s?.label as { x: number; y: number; w: number; h: number }
    expect(label.x + label.w).toBeLessThan((s as { x: number }).x)
    // Tasks carry their name INSIDE the shape: no external label box.
    expect(result.shapes.get('t1')?.label).toBeUndefined()
  })
})

describe('layoutEpc — label-aware task sizes', () => {
  it('keeps short task labels at the 100x80 native minimum', () => {
    const nodes: LayoutNode[] = [{ id: 'short', tag: 'task', label: 'Review' }]
    const result = layoutEpc(nodes, [])
    expect(nodeBaseSize('task', 'Review')).toEqual({ w: 100, h: 80 })
    expect(result.shapes.get('short')).toMatchObject({ w: 100, h: 80 })
  })

  it('emits a long-label task at the same capped/even size as the live fitter', () => {
    const label = 'x'.repeat(100)
    const nodes: LayoutNode[] = [{ id: 'long', tag: 'task', label }]
    const result = layoutEpc(nodes, [])
    const expected = fitInteriorBox(label, { reserveSubChip: false })
    expect(expected.w).toBeLessThanOrEqual(160)
    expect(expected.h).toBeGreaterThan(80)
    expect(result.shapes.get('long')).toMatchObject(expected)
    assertAllInvariants(nodes, [], result)
  })

  it('reserves the sub-chip band for imported call activities', () => {
    const label = 'x'.repeat(100)
    const nodes: LayoutNode[] = [{ id: 'call', tag: 'callActivity', label }]
    const result = layoutEpc(nodes, [])
    const expected = fitInteriorBox(label, { reserveSubChip: true })
    expect(result.shapes.get('call')).toMatchObject(expected)
    expect(expected.h).toBeGreaterThan(fitInteriorBox(label, { reserveSubChip: false }).h)
    assertAllInvariants(nodes, [], result)
  })
})

describe('layoutEpc — gateway fan-out and merge', () => {
  const nodes: LayoutNode[] = [
    { id: 's', tag: 'startEvent', label: 'Go' },
    { id: 'gw', tag: 'exclusiveGateway', label: 'OK?' },
    { id: 'b1', tag: 'task', label: 'Yes path' },
    { id: 'b2', tag: 'task', label: 'No path' },
    { id: 'm', tag: 'exclusiveGateway' },
    { id: 'e', tag: 'endEvent', label: 'Done' }
  ]
  const edges: LayoutEdge[] = [
    { id: 'f1', source: 's', target: 'gw' },
    { id: 'f2', source: 'gw', target: 'b1' },
    { id: 'f3', source: 'gw', target: 'b2' },
    { id: 'f4', source: 'b1', target: 'm' },
    { id: 'f5', source: 'b2', target: 'm' },
    { id: 'f6', source: 'm', target: 'e' }
  ]

  it('two identical branches sit symmetric around the gateway axis', () => {
    const result = layoutEpc(nodes, edges)
    const gw = axisOf(result, 'gw')
    const d1 = gw - axisOf(result, 'b1')
    const d2 = axisOf(result, 'b2') - gw
    expect(d1).toBeGreaterThan(0)
    expect(d2).toBeGreaterThan(0)
    expect(d1).toBe(d2)
    // The split/merge pair keeps the spine straight.
    expect(axisOf(result, 'm')).toBe(gw)
    expect(axisOf(result, 'e')).toBe(gw)
    assertAllInvariants(nodes, edges, result)
  })

  it('both branch flows share one channel y — a symmetric T-split', () => {
    const result = layoutEpc(nodes, edges)
    const f2 = result.edges.get('f2')
    const f3 = result.edges.get('f3')
    expect(f2?.waypoints).toHaveLength(4)
    expect(f3?.waypoints).toHaveLength(4)
    expect(f2?.waypoints[1].y).toBe(f3?.waypoints[1].y)
  })

  it('the join is entered at its top-center', () => {
    const result = layoutEpc(nodes, edges)
    const m = result.shapes.get('m') as { x: number; y: number; w: number }
    for (const id of ['f4', 'f5']) {
      const wps = (result.edges.get(id) as { waypoints: Array<{ x: number; y: number }> }).waypoints
      expect(wps[wps.length - 1]).toEqual({ x: m.x + m.w / 2, y: m.y })
    }
  })

  it('a 3-way fan-out keeps the middle branch on the spine, sides symmetric', () => {
    const nodes3: LayoutNode[] = [
      { id: 'gw', tag: 'parallelGateway' },
      { id: 'a', tag: 'task', label: 'A' },
      { id: 'b', tag: 'task', label: 'B' },
      { id: 'c', tag: 'task', label: 'C' }
    ]
    const edges3: LayoutEdge[] = [
      { id: 'f1', source: 'gw', target: 'a' },
      { id: 'f2', source: 'gw', target: 'b' },
      { id: 'f3', source: 'gw', target: 'c' }
    ]
    const result = layoutEpc(nodes3, edges3)
    const gw = axisOf(result, 'gw')
    expect(axisOf(result, 'b')).toBe(gw) // middle branch continues straight
    expect(gw - axisOf(result, 'a')).toBe(axisOf(result, 'c') - gw)
    assertAllInvariants(nodes3, edges3, result)
  })
})

describe('layoutEpc — back edges, skip edges, cycles', () => {
  it('a genuine loop-back clears every intervening shape on an orthogonal outside route', () => {
    const nodes: LayoutNode[] = [
      { id: 's', tag: 'startEvent', label: 'Start' },
      { id: 't1', tag: 'task', label: 'Work' },
      { id: 't2', tag: 'task', label: 'Check' },
      { id: 'e', tag: 'endEvent', label: 'End' }
    ]
    const edges: LayoutEdge[] = [...chain(['s', 't1', 't2', 'e']), { id: 'loop', source: 't2', target: 't1' }]
    const result = layoutEpc(nodes, edges)
    const loop = result.edges.get('loop')
    expect(loop?.isBackEdge).toBe(true)
    expect(loop?.waypoints.length).toBeGreaterThanOrEqual(4)
    expect(bendCount(loop?.waypoints ?? [])).toBeGreaterThanOrEqual(2)
    // It re-enters through a legal point on the target's top border.
    const t1 = result.shapes.get('t1') as { x: number; y: number; w: number }
    const last = (loop as { waypoints: Array<{ x: number; y: number }> }).waypoints.at(-1)
    expect(last?.y).toBe(t1.y)
    expect(last?.x).toBeGreaterThanOrEqual(t1.x)
    expect(last?.x).toBeLessThanOrEqual(t1.x + t1.w)
    expect(result.usedEntryFallback).toBe(false)
    assertAllInvariants(nodes, edges, result)
  })

  it('a blocked forward edge skipping layers detours with normalized bends', () => {
    const nodes: LayoutNode[] = [
      { id: 's', tag: 'startEvent', label: 'Start' },
      { id: 't1', tag: 'task', label: 'One' },
      { id: 't2', tag: 'task', label: 'Two' },
      { id: 'e', tag: 'endEvent', label: 'End' }
    ]
    const edges: LayoutEdge[] = [...chain(['s', 't1', 't2', 'e']), { id: 'skip', source: 's', target: 'e' }]
    const result = layoutEpc(nodes, edges)
    const skip = result.edges.get('skip')
    expect(skip?.isBackEdge).toBe(false)
    expect(bendCount(skip?.waypoints ?? [])).toBeGreaterThanOrEqual(2)
    expect(skip?.waypoints.length).toBe(bendCount(skip?.waypoints ?? []) + 2)
    assertAllInvariants(nodes, edges, result)
  })

  it('a pure cycle completes with usedEntryFallback', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', tag: 'task', label: 'A' },
      { id: 'b', tag: 'task', label: 'B' },
      { id: 'c', tag: 'task', label: 'C' }
    ]
    const edges: LayoutEdge[] = [
      { id: 'f1', source: 'a', target: 'b' },
      { id: 'f2', source: 'b', target: 'c' },
      { id: 'f3', source: 'c', target: 'a' }
    ]
    const result = layoutEpc(nodes, edges)
    expect(result.usedEntryFallback).toBe(true)
    expect(result.shapes.size).toBe(3)
    // Exactly one edge was broken into a back edge.
    const backs = [...result.edges.values()].filter((e) => e.isBackEdge)
    expect(backs).toHaveLength(1)
    assertAllInvariants(nodes, edges, result)
  })
})

describe('layoutEpc — obstacle-aware minimum-bend routing', () => {
  const corridorAttrs = {
    inputs: 'Application form\nIdentity record',
    outputs: 'Registered profile\nConfirmation',
    respList: 'Registration officer'
  }

  it.each<Orientation>(['vertical', 'horizontal'])(
    'keeps the clear %s input/output/responsible corridor straight',
    (orientation) => {
      const nodes: LayoutNode[] = [
        { id: 'a', tag: 'task', label: 'Collect', attrs: corridorAttrs },
        { id: 'b', tag: 'task', label: 'Register', attrs: corridorAttrs },
        { id: 'c', tag: 'task', label: 'Confirm', attrs: corridorAttrs }
      ]
      const edges = chain(['a', 'b', 'c'])
      const result = layoutEpc(nodes, edges, { orientation })
      for (const edge of edges) {
        expect(result.edges.get(edge.id)?.waypoints).toHaveLength(2)
      }
      assertAllInvariants(nodes, edges, result, orientation)
    }
  )

  it('does not exempt channel/input/output decorations at an endpoint', () => {
    const nodes: LayoutNode[] = [
      { id: 's', tag: 'task', label: 'Send' },
      {
        id: 't',
        tag: 'task',
        label: 'Receive',
        attrs: {
          channel: 'portal',
          inputs: 'Incoming request',
          outputs: 'Validated request',
          respList: 'Case owner'
        }
      }
    ]
    const edges: LayoutEdge[] = [{ id: 'f', source: 's', target: 't' }]
    const result = layoutEpc(nodes, edges)
    const route = result.edges.get('f')?.waypoints ?? []
    const target = result.shapes.get('t') as { x: number; y: number; w: number }
    const last = route.at(-1) as { x: number; y: number }
    expect(last.y).toBe(target.y)
    expect(last.x).toBeGreaterThanOrEqual(target.x)
    expect(last.x).toBeLessThanOrEqual(target.x + target.w)
    assertAllInvariants(nodes, edges, result)
  })

  it('scores equally-near legal ports by the complete route length', () => {
    const nodes: LayoutNode[] = [
      { id: 'aux', tag: 'task', label: 'Aux', hint: { x: 0, y: 0 } },
      { id: 'split', tag: 'parallelGateway', hint: { x: 900, y: 0 } },
      {
        id: 'left',
        tag: 'task',
        label: 'Left',
        // The long fallback channel tag spans the full 100px task width,
        // blocking top-centre. Its legal left/right task-boundary ports are
        // equally near the centre, but RIGHT is closer to the split gateway.
        attrs: { channel: 'abcdefghijklmnop' }
      }
    ]
    const edges: LayoutEdge[] = [
      { id: 'to-left', source: 'split', target: 'left' },
      { id: 'also-left', source: 'split', target: 'left' },
      { id: 'from-aux', source: 'aux', target: 'left' }
    ]
    const result = layoutEpc(nodes, edges)
    const left = result.shapes.get('left') as { x: number; y: number; w: number }
    const route = result.edges.get('to-left')?.waypoints ?? []
    expect(route.at(-1)).toEqual({ x: left.x + left.w, y: left.y })
    for (const edgeId of ['also-left', 'from-aux']) {
      expect(result.edges.get(edgeId)?.waypoints.at(-1)).toEqual(route.at(-1))
    }
    assertAllInvariants(nodes, edges, result)
  })

  function multiLayerFixture(blocked: boolean): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
    const nodes: LayoutNode[] = [
      { id: 'split', tag: 'parallelGateway' },
      { id: 'side1', tag: 'task', label: 'Side one', hint: { x: 0, y: 100 } },
      { id: 'side2', tag: 'task', label: 'Side two', hint: { x: 0, y: 200 } },
      {
        id: 'merge',
        tag: 'task',
        label: 'Merge',
        hint: { x: 450, y: 100 },
        attrs: blocked ? { channel: 'portal' } : undefined
      }
    ]
    const edges: LayoutEdge[] = [
      { id: 'long', source: 'split', target: 'merge' },
      { id: 's1', source: 'split', target: 'side1' },
      { id: 's2', source: 'side1', target: 'side2' },
      { id: 's3', source: 'side2', target: 'merge' }
    ]
    return { nodes, edges }
  }

  it('routes an unobstructed multi-layer edge into a merge as one straight segment', () => {
    const { nodes, edges } = multiLayerFixture(false)
    const result = layoutEpc(nodes, edges)
    expect(result.edges.get('long')?.waypoints).toHaveLength(2)
    expect(bendCount(result.edges.get('long')?.waypoints ?? [])).toBe(0)
    assertAllInvariants(nodes, edges, result)
  })

  it('detours around the genuinely blocked counterpart and normalizes every bend', () => {
    const { nodes, edges } = multiLayerFixture(true)
    const result = layoutEpc(nodes, edges)
    const route = result.edges.get('long')?.waypoints ?? []
    expect(bendCount(route)).toBeGreaterThanOrEqual(2)
    expect(route.length).toBe(bendCount(route) + 2)
    for (let i = 1; i < route.length; i++) expect(route[i]).not.toEqual(route[i - 1])
    assertAllInvariants(nodes, edges, result)
  })

  it('chooses the same stable side of a symmetric blocker after input shuffling', () => {
    const fixture = multiLayerFixture(true)
    const a = layoutEpc(fixture.nodes, fixture.edges).edges.get('long')?.waypoints
    const b = layoutEpc(fixture.nodes.slice().reverse(), fixture.edges.slice().reverse()).edges.get('long')?.waypoints
    expect(b).toEqual(a)
    expect(a?.length).toBeGreaterThan(2)
  })
})

describe('layoutEpc — decoration margins and multiple components', () => {
  it('a decorated node pushes its neighbour column clear of the reserved boxes', () => {
    const heavyAttrs = {
      inputs: 'Owner record\nAnimal data\nOld registry entry',
      ccList: 'Municipality officer\nVet clinic',
      respList: 'Registration officer'
    }
    const nodes: LayoutNode[] = [
      { id: 'gw', tag: 'parallelGateway' },
      { id: 'heavy', tag: 'task', label: 'Verify', attrs: heavyAttrs },
      { id: 'plain', tag: 'task', label: 'File' }
    ]
    const edges: LayoutEdge[] = [
      { id: 'f1', source: 'gw', target: 'heavy' },
      { id: 'f2', source: 'gw', target: 'plain' }
    ]
    const result = layoutEpc(nodes, edges)
    const heavyBox = inflatedBox(nodes[1], result, 'vertical')
    const plainBox = inflatedBox(nodes[2], result, 'vertical')
    // Reserved boxes are disjoint AND at least H_GAP apart.
    const gap = Math.min(Math.abs(plainBox.x0 - heavyBox.x1), Math.abs(heavyBox.x0 - plainBox.x1))
    expect(gap).toBeGreaterThanOrEqual(H_GAP)
    // The margins really reflect the decorations (inputs left, lists right).
    const ext = reservedExtents(nodes[1], 'vertical')
    expect(ext.left).toBeGreaterThan(0)
    expect(ext.right).toBeGreaterThan(0)
    assertAllInvariants(nodes, edges, result)
  })

  it('disconnected components stack vertically, COMPONENT_GAP apart', () => {
    const nodes: LayoutNode[] = [
      { id: 'a1', tag: 'task', label: 'A1', hint: { x: 0, y: 0 } },
      { id: 'a2', tag: 'task', label: 'A2', hint: { x: 0, y: 100 } },
      { id: 'b1', tag: 'task', label: 'B1', hint: { x: 0, y: 900 } },
      { id: 'b2', tag: 'task', label: 'B2', hint: { x: 0, y: 950 } }
    ]
    const edges: LayoutEdge[] = [
      { id: 'f1', source: 'a1', target: 'a2' },
      { id: 'f2', source: 'b1', target: 'b2' }
    ]
    const result = layoutEpc(nodes, edges)
    // Component order follows the hints: the A pair sits above the B pair.
    const a2 = result.shapes.get('a2') as { y: number; h: number }
    const b1 = result.shapes.get('b1') as { y: number }
    expect(b1.y).toBeGreaterThanOrEqual(a2.y + a2.h + COMPONENT_GAP)
    assertAllInvariants(nodes, edges, result)
  })

  it('a single node lays out at the margin with its reserved extents', () => {
    const nodes: LayoutNode[] = [{ id: 'only', tag: 'task', label: 'Solo' }]
    const result = layoutEpc(nodes, [])
    const s = result.shapes.get('only') as { x: number; y: number; w: number }
    const ext = reservedExtents(nodes[0], 'vertical')
    expect(s.x).toBe(MARGIN + ext.left)
    expect(s.y).toBe(MARGIN + ext.top)
    expect(result.size.w).toBeGreaterThan(s.x + s.w)
  })
})

describe('layoutEpc — horizontal orientation', () => {
  const nodes: LayoutNode[] = [
    { id: 's', tag: 'startEvent', label: 'Start' },
    { id: 'gw', tag: 'exclusiveGateway', label: 'OK?' },
    { id: 'b1', tag: 'task', label: 'Yes' },
    { id: 'b2', tag: 'task', label: 'No' }
  ]
  const edges: LayoutEdge[] = [
    { id: 'f1', source: 's', target: 'gw' },
    { id: 'f2', source: 'gw', target: 'b1' },
    { id: 'f3', source: 'gw', target: 'b2' }
  ]

  it('transposes the flow: layers advance in x, branches spread in y', () => {
    const result = layoutEpc(nodes, edges, { orientation: 'horizontal' })
    const sMid = midOf(result, 's')
    const gwMid = midOf(result, 'gw')
    expect(sMid).toBe(gwMid) // the spine is now a horizontal row
    const sShape = result.shapes.get('s') as { x: number; w: number }
    const gwShape = result.shapes.get('gw') as { x: number }
    expect(gwShape.x).toBeGreaterThan(sShape.x + sShape.w)
    // Branches symmetric around the spine, vertically.
    const d1 = gwMid - midOf(result, 'b1')
    const d2 = midOf(result, 'b2') - gwMid
    expect(d1).toBeGreaterThan(0)
    expect(d1).toBe(d2)
    assertAllInvariants(nodes, edges, result, 'horizontal')
  })

  it('places event/gateway labels BELOW the shape in horizontal orientation', () => {
    const result = layoutEpc(nodes, edges, { orientation: 'horizontal' })
    const s = result.shapes.get('s') as { y: number; h: number; label?: { y: number } }
    expect(s.label).toBeTruthy()
    expect((s.label as { y: number }).y).toBeGreaterThanOrEqual(s.y + s.h)
  })

  it('shapes keep their real element size (no w/h swap leaks out)', () => {
    const result = layoutEpc(nodes, edges, { orientation: 'horizontal' })
    const b1 = result.shapes.get('b1') as { w: number; h: number }
    // Both branch labels are short, so variable sizing stays at the minimum.
    expect(b1).toMatchObject(nodeBaseSize('task', 'Yes'))
    expect(b1).toMatchObject({ w: 100, h: 80 })
  })
})

describe('layoutEpc — determinism', () => {
  const nodes: LayoutNode[] = [
    { id: 's1', tag: 'startEvent', label: 'First', hint: { x: 100, y: 0 } },
    { id: 's2', tag: 'startEvent', label: 'Second', hint: { x: 500, y: 0 } },
    { id: 't1', tag: 'task', label: 'Alpha', hint: { x: 100, y: 200 } },
    { id: 't2', tag: 'task', label: 'Beta', hint: { x: 500, y: 200 } },
    { id: 'j', tag: 'exclusiveGateway', hint: { x: 300, y: 400 } },
    { id: 'e', tag: 'endEvent', label: 'End', hint: { x: 300, y: 600 } }
  ]
  const edges: LayoutEdge[] = [
    { id: 'f1', source: 's1', target: 't1' },
    { id: 'f2', source: 's2', target: 't2' },
    { id: 'f3', source: 't1', target: 'j' },
    { id: 'f4', source: 't2', target: 'j' },
    { id: 'f5', source: 'j', target: 'e' }
  ]

  it('multiple start events share layer 0 side by side', () => {
    const result = layoutEpc(nodes, edges)
    const s1 = result.shapes.get('s1') as { y: number }
    const s2 = result.shapes.get('s2') as { y: number }
    expect(s1.y).toBe(s2.y)
    expect(axisOf(result, 's1')).toBeLessThan(axisOf(result, 's2'))
    assertAllInvariants(nodes, edges, result)
  })

  it('shuffled input arrays produce byte-identical DI', () => {
    const di = emitLayoutDi('P1', nodes, edges, layoutEpc(nodes, edges), (s) => s)
    const shuffledNodes = [nodes[4], nodes[1], nodes[5], nodes[0], nodes[3], nodes[2]]
    const shuffledEdges = [edges[3], edges[0], edges[4], edges[2], edges[1]]
    const di2 = emitLayoutDi('P1', shuffledNodes, shuffledEdges, layoutEpc(shuffledNodes, shuffledEdges), (s) => s)
    expect(di2).toBe(di)
  })

  it('hint-less graphs are still shuffle-independent (ids break ties)', () => {
    const bare = nodes.map(({ id, tag, label }) => ({ id, tag, label }))
    const di = emitLayoutDi('P1', bare, edges, layoutEpc(bare, edges), (s) => s)
    const shuffled = [bare[5], bare[3], bare[0], bare[4], bare[2], bare[1]]
    const di2 = emitLayoutDi('P1', shuffled, edges, layoutEpc(shuffled, edges), (s) => s)
    expect(di2).toBe(di)
  })

  it('hints beat ids as the ordering tiebreak', () => {
    // z has the LEFTMOST hint; id order alone would put it last. Both starts
    // feed one join so they share a component (and compete for layer-0 order).
    const trio: LayoutNode[] = [
      { id: 'a', tag: 'startEvent', label: 'A', hint: { x: 900, y: 0 } },
      { id: 'z', tag: 'startEvent', label: 'Z', hint: { x: 100, y: 0 } },
      { id: 'j', tag: 'task', label: 'Join', hint: { x: 500, y: 200 } }
    ]
    const trioEdges: LayoutEdge[] = [
      { id: 'f1', source: 'a', target: 'j' },
      { id: 'f2', source: 'z', target: 'j' }
    ]
    const result = layoutEpc(trio, trioEdges)
    expect(axisOf(result, 'z')).toBeLessThan(axisOf(result, 'a'))
    // Without hints the same graph orders by id instead: a left of z.
    const bare = trio.map(({ id, tag, label }) => ({ id, tag, label }))
    const byId = layoutEpc(bare, trioEdges)
    expect(axisOf(byId, 'a')).toBeLessThan(axisOf(byId, 'z'))
  })
})

describe('emitLayoutDi', () => {
  const nodes: LayoutNode[] = [
    { id: 'S', tag: 'startEvent', label: 'Request received' },
    { id: 'T', tag: 'task', label: 'Review' },
    { id: 'G', tag: 'exclusiveGateway', label: 'Approved?' },
    { id: 'E1', tag: 'endEvent', label: 'Yes' },
    { id: 'E2', tag: 'endEvent' } // unlabeled: NO BPMNLabel expected
  ]
  const edges: LayoutEdge[] = [
    { id: 'f1', source: 'S', target: 'T' },
    { id: 'f2', source: 'T', target: 'G' },
    { id: 'f3', source: 'G', target: 'E1' },
    { id: 'f4', source: 'G', target: 'E2' }
  ]

  function fullXml(): string {
    const result = layoutEpc(nodes, edges)
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    let xml = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"'
    xml += ' xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"'
    xml += ' xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"'
    xml += ' xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1">'
    xml += '<process id="P1" isExecutable="false">'
    for (const n of nodes) {
      xml += `<${n.tag} id="${n.id}"${n.label ? ` name="${esc(n.label)}"` : ''} />`
    }
    for (const e of edges) {
      xml += `<sequenceFlow id="${e.id}" sourceRef="${e.source}" targetRef="${e.target}" />`
    }
    xml += '</process>'
    xml += emitLayoutDi('P1', nodes, edges, result, esc)
    xml += '</definitions>'
    return xml
  }

  it('round-trips through bpmn-moddle with zero warnings', async () => {
    const moddle = new BpmnModdle()
    const { rootElement, warnings } = await moddle.fromXML(fullXml())
    expect(warnings).toEqual([])
    expect(rootElement.$type).toBe('bpmn:Definitions')
    const plane = rootElement.diagrams[0].plane
    expect(plane.planeElement).toHaveLength(nodes.length + edges.length)
  })

  it('emits BPMNLabel bounds exactly for labeled events/gateways', async () => {
    const moddle = new BpmnModdle()
    const { rootElement } = await moddle.fromXML(fullXml())
    const plane = rootElement.diagrams[0].plane
    const shapesById = new Map<string, { label?: { bounds?: unknown } }>()
    for (const el of plane.planeElement) {
      if (el.$type === 'bpmndi:BPMNShape') shapesById.set(el.bpmnElement.id, el)
    }
    expect(shapesById.get('S')?.label?.bounds).toBeTruthy()
    expect(shapesById.get('G')?.label?.bounds).toBeTruthy()
    expect(shapesById.get('E1')?.label?.bounds).toBeTruthy()
    expect(shapesById.get('T')?.label).toBeUndefined() // internal label
    expect(shapesById.get('E2')?.label).toBeUndefined() // no name
  })

  it('marks exclusive gateways isMarkerVisible', () => {
    const result = layoutEpc(nodes, edges)
    const di = emitLayoutDi('P1', nodes, edges, result, (s) => s)
    expect(di).toContain('bpmnElement="G" isMarkerVisible="true"')
    expect(di).not.toContain('bpmnElement="T" isMarkerVisible')
  })

  it('emits only integer coordinates', () => {
    const result = layoutEpc(nodes, edges)
    const di = emitLayoutDi('P1', nodes, edges, result, (s) => s)
    const coords = di.match(/(?:x|y|width|height)="([^"]+)"/g) ?? []
    expect(coords.length).toBeGreaterThan(0)
    for (const c of coords) {
      const value = (/"([^"]+)"/.exec(c) as RegExpExecArray)[1]
      expect(String(parseInt(value, 10)), c).toBe(value)
    }
  })
})
