import { describe, expect, it } from 'vitest'

import { cleanLayout } from '../cleanLayout'
import { GapSlotAllocator } from '../routing'
import type { ArisLayoutEdgeRoute, ArisLayoutGraphInput, ArisLayoutResult } from '../types'
import { event, flow, fn, rule, xorDiamond } from './fixtures'

/**
 * Shared-target merge alignment (2026-08-09) — the mirror of the shared-source
 * split fix. Every forward edge that ARRIVES at the same merge node must land
 * its last horizontal segment at ONE cross coordinate, so the merge is a clean
 * 3+-way junction rather than N incoming lines that miss each other by a few px.
 *
 * The merge turn is the second-to-last point of an incoming route (the corner
 * right before the target's near-side stub). An incoming edge that happens to
 * run straight into the target has only 2 points and thus no turn to misalign,
 * so those are filtered out — the surviving turns must all coincide.
 */
function mergeTurnCross(edge: ArisLayoutEdgeRoute, vertical: boolean): number | null {
  if (edge.points.length < 3) return null
  const corner = edge.points[edge.points.length - 2] as { x: number; y: number }
  // The turn's shared axis is the CROSS axis: x in top-to-bottom, y in LTR.
  return vertical ? corner.y : corner.x
}

function incomingTurns(result: ArisLayoutResult, targetId: string): number[] {
  const vertical = result.orientation === 'top-to-bottom'
  return result.edges
    .filter((edge) => edge.target === targetId && edge.classification === 'forward')
    .map((edge) => mergeTurnCross(edge, vertical))
    .filter((value): value is number => value !== null)
}

function outgoingTurns(result: ArisLayoutResult, sourceId: string): number[] {
  const vertical = result.orientation === 'top-to-bottom'
  return result.edges
    .filter((edge) => edge.source === sourceId && edge.classification === 'forward')
    .map((edge) => mergeTurnCross(edge, vertical))
    .filter((value): value is number => value !== null)
}

function expectAccepted(result: ArisLayoutResult): void {
  expect(result.findings.map((finding) => finding.code)).toEqual([])
  expect(result.accepted).toBe(true)
}

describe('shared-target merge turns — every incoming edge lands its last horizontal segment on one line', () => {
  it('XOR-merge N=2: both incoming branches share the merge turn coordinate', () => {
    const result = cleanLayout(xorDiamond(2))
    const turns = incomingTurns(result, 'R.merge')
    expect(turns.length).toBe(2)
    for (const value of turns) expect(value).toBeCloseTo(turns[0] as number, 9)
    expectAccepted(result)
  })

  it('XOR-merge N=3: all bending incoming branches share the merge turn coordinate', () => {
    const result = cleanLayout(xorDiamond(3))
    const turns = incomingTurns(result, 'R.merge')
    expect(turns.length).toBeGreaterThanOrEqual(2)
    for (const value of turns) expect(value).toBeCloseTo(turns[0] as number, 9)
    expectAccepted(result)
  })

  it('fan-in function (no gate, 3 incoming edges): all incoming turns share a coordinate', () => {
    // Three sources on one rank feed a single downstream function directly — a
    // merge with no XOR/AND gate. Their target-side turns must still coincide.
    const result = cleanLayout({
      id: 'fan-in-3',
      nodes: [
        fn('A', { sourcePosition: { x: -400, y: 0 } }),
        fn('B', { sourcePosition: { x: 0, y: 0 } }),
        fn('C', { sourcePosition: { x: 400, y: 0 } }),
        fn('Sink', { sourcePosition: { x: 0, y: 600 } })
      ],
      edges: [flow('A', 'Sink'), flow('B', 'Sink'), flow('C', 'Sink')]
    })
    const turns = incomingTurns(result, 'Sink')
    expect(turns.length).toBeGreaterThanOrEqual(2)
    for (const value of turns) expect(value).toBeCloseTo(turns[0] as number, 9)
    expectAccepted(result)
  })

  it('mixed node — source of a split AND target of a merge — holds BOTH invariants', () => {
    // X receives from P, Q and Z (a merge into X) and emits to R and S (a split
    // out of X). The incoming edges must share X's target-side turn, and the
    // outgoing edges must share X's source-side turn — simultaneously. Three
    // incoming so at least two must bend even after X snaps under one predecessor.
    const result = cleanLayout({
      id: 'mixed-junction',
      nodes: [
        fn('P', { sourcePosition: { x: -600, y: 0 } }),
        fn('Q', { sourcePosition: { x: 0, y: 0 } }),
        fn('Z', { sourcePosition: { x: 600, y: 0 } }),
        fn('X', { sourcePosition: { x: 0, y: 600 } }),
        fn('R', { sourcePosition: { x: -400, y: 1200 } }),
        fn('S', { sourcePosition: { x: 400, y: 1200 } })
      ],
      edges: [flow('P', 'X'), flow('Q', 'X'), flow('Z', 'X'), flow('X', 'R'), flow('X', 'S')]
    })
    expectAccepted(result)

    const inTurns = incomingTurns(result, 'X')
    expect(inTurns.length).toBeGreaterThanOrEqual(2)
    for (const value of inTurns) expect(value).toBeCloseTo(inTurns[0] as number, 9)

    const outTurns = outgoingTurns(result, 'X')
    expect(outTurns.length).toBeGreaterThanOrEqual(2)
    for (const value of outTurns) expect(value).toBeCloseTo(outTurns[0] as number, 9)
  })

  it('AND-merge N=3 (gate): all incoming turns share the merge coordinate', () => {
    const nodes = [
      event('E.start'),
      rule('R.split', 'and'),
      rule('R.merge', 'and'),
      event('E.end'),
      fn('F.0'),
      fn('F.1'),
      fn('F.2')
    ]
    const graph: ArisLayoutGraphInput = {
      id: 'and-merge-3',
      nodes,
      edges: [
        flow('E.start', 'R.split'),
        flow('R.split', 'F.0'),
        flow('R.split', 'F.1'),
        flow('R.split', 'F.2'),
        flow('F.0', 'R.merge'),
        flow('F.1', 'R.merge'),
        flow('F.2', 'R.merge'),
        flow('R.merge', 'E.end')
      ]
    }
    const result = cleanLayout(graph)
    const turns = incomingTurns(result, 'R.merge')
    expect(turns.length).toBeGreaterThanOrEqual(2)
    for (const value of turns) expect(value).toBeCloseTo(turns[0] as number, 9)
    expectAccepted(result)
  })
})

describe('GapSlotAllocator per-target sharing (unit)', () => {
  it('reuses one slot for repeated calls with the same target, own slot per distinct target', () => {
    const alloc = new GapSlotAllocator([0, 0], [100, 100])
    const a1 = alloc.nextForTarget(0, 7)
    const a2 = alloc.nextForTarget(0, 7) // same target -> reuse
    const b1 = alloc.nextForTarget(0, 9) // different target -> its own slot
    expect(a2).toBe(a1)
    expect(b1).not.toBe(a1)
    // A different rank gap allocates independently: target 7 in gap 1 is the
    // first ticket of band 1 and lands at that band's centre, untouched by gap 0.
    const c1 = alloc.nextForTarget(1, 7)
    expect(c1).toBe(50)
  })

  it('regression: an unrelated forward edge to a non-merge target still gets its OWN slot', () => {
    // Per-target sharing must only collapse repeated calls for the SAME target.
    // A merge target (2+ callers) shares; a plain target (1 caller) is called
    // once and is indistinguishable from a per-slot `next()` allocation.
    const alloc = new GapSlotAllocator([0], [100])
    const merge = alloc.nextForTarget(0, 1) // merge target: first of two callers
    const mergeAgain = alloc.nextForTarget(0, 1) // second caller -> shares
    const lonely = alloc.nextForTarget(0, 2) // distinct non-merge target -> own slot
    expect(mergeAgain).toBe(merge)
    expect(lonely).not.toBe(merge)
  })

  it('nextForJunction shares source-first, then target, so splits win ties over merges', () => {
    const alloc = new GapSlotAllocator([0], [100])
    // A split source 1 -> targets 10, 11 (adjacent branches): share source slot.
    const s0 = alloc.nextForJunction(0, 1, 10)
    const s1 = alloc.nextForJunction(0, 1, 11)
    expect(s1).toBe(s0)
    // A merge into target 20 from sources 2, 3: share target slot.
    const m0 = alloc.nextForJunction(0, 2, 20)
    const m1 = alloc.nextForJunction(0, 3, 20)
    expect(m1).toBe(m0)
    expect(m0).not.toBe(s0)
    // Interop: a long-edge branch of the SAME split source reuses the source key
    // that `nextForJunction` registered, so adjacent + long branches align.
    const s2 = alloc.nextForSource(0, 1)
    expect(s2).toBe(s0)
  })
})
