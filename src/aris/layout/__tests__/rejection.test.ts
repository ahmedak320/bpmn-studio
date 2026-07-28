import { describe, expect, it } from 'vitest'

import { analyzeLayout } from '../metrics'
import {
  ARIS_LAYOUT_REJECTION_CODES,
  arisLayoutRejectionMessageKey,
  evaluateLayoutAcceptance
} from '../rejection'
import { cleanLayout } from '../cleanLayout'
import type {
  ArisLayoutEdgeRoute,
  ArisLayoutMetrics,
  ArisLayoutNodePlacement,
  ArisLayoutPoint,
  ArisLayoutRect
} from '../types'
import { chainWithSatellites, cycleGraph, flow, fn, twoComponentGraph, xorDiamond } from './fixtures'

function node(id: string, rect: ArisLayoutRect, labelRect: ArisLayoutRect | null = null): ArisLayoutNodePlacement {
  return {
    id,
    kind: 'control-flow',
    role: 'function',
    rect,
    labelRect,
    componentIndex: 0,
    stronglyConnectedIndex: 0,
    rank: 0,
    laneId: null
  }
}

function edge(
  id: string,
  source: string,
  target: string,
  points: readonly ArisLayoutPoint[]
): ArisLayoutEdgeRoute {
  return { id, source, target, kind: 'control-flow', classification: 'forward', points }
}

const CANVAS: ArisLayoutRect = { x: 0, y: 0, width: 500, height: 500 }

function gateFor(
  nodes: readonly ArisLayoutNodePlacement[],
  edges: readonly ArisLayoutEdgeRoute[],
  expectedEdgeIds: readonly string[] = edges.map((entry) => entry.id),
  canvas: ArisLayoutRect = CANVAS
): ReturnType<typeof evaluateLayoutAcceptance> {
  const analysis = analyzeLayout({ nodes, edges, canvas, expectedEdgeIds })
  return evaluateLayoutAcceptance(analysis.metrics, analysis.defects)
}

describe('message keys', () => {
  it('covers every rejection code with a stable i18n key and no English prose', () => {
    expect(ARIS_LAYOUT_REJECTION_CODES).toEqual([
      'shape-overlap',
      'label-satellite-overlap',
      'edge-through-unrelated-shape',
      'detached-endpoint',
      'missing-edge',
      'duplicate-edge',
      'zero-length-edge',
      'extreme-whitespace'
    ])
    for (const code of ARIS_LAYOUT_REJECTION_CODES) {
      expect(arisLayoutRejectionMessageKey(code)).toBe(`aris.layout.rejection.${code}`)
    }
  })

  it('carries only numbers in a finding payload', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 100, height: 100 }),
        node('B', { x: 50, y: 50, width: 100, height: 100 })
      ],
      []
    )
    const finding = acceptance.findings[0]
    expect(finding?.messageKey).toBe('aris.layout.rejection.shape-overlap')
    expect(finding?.subjects).toEqual(['A', 'B'])
    for (const value of Object.values(finding?.values ?? {})) {
      expect(typeof value).toBe('number')
    }
  })
})

describe('the gate rejects every forbidden condition', () => {
  it('rejects a shape overlap', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 100, height: 100 }),
        node('B', { x: 50, y: 50, width: 100, height: 100 })
      ],
      []
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['shape-overlap'])
  })

  it('rejects a caption box that lands on another shape', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 100, height: 40 }, { x: 0, y: 40, width: 100, height: 30 }),
        node('B', { x: 50, y: 50, width: 100, height: 40 })
      ],
      []
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toContain('label-satellite-overlap')
  })

  it('rejects an edge that passes through an unrelated shape', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 40, height: 40 }),
        node('B', { x: 100, y: 0, width: 40, height: 40 }),
        node('C', { x: 200, y: 0, width: 40, height: 40 })
      ],
      [edge('e', 'A', 'C', [{ x: 40, y: 20 }, { x: 200, y: 20 }])]
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual([
      'edge-through-unrelated-shape'
    ])
  })

  it('rejects a detached endpoint', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 40, height: 40 }),
        node('B', { x: 0, y: 200, width: 40, height: 40 })
      ],
      [edge('e', 'A', 'B', [{ x: 20, y: 100 }, { x: 20, y: 200 }])]
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['detached-endpoint'])
  })

  it('rejects a missing edge', () => {
    const acceptance = gateFor([node('A', { x: 0, y: 0, width: 40, height: 40 })], [], ['gone'])
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['missing-edge'])
    expect(acceptance.findings[0]?.subjects).toEqual(['gone'])
  })

  it('rejects a duplicate edge', () => {
    const points = [{ x: 20, y: 40 }, { x: 20, y: 200 }]
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 40, height: 40 }),
        node('B', { x: 0, y: 200, width: 40, height: 40 })
      ],
      [edge('e1', 'A', 'B', points), edge('e2', 'A', 'B', points)]
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['duplicate-edge'])
  })

  it('rejects a zero-length edge', () => {
    const acceptance = gateFor(
      [node('A', { x: 0, y: 0, width: 40, height: 40 })],
      [edge('e', 'A', 'A', [{ x: 20, y: 40 }, { x: 20, y: 40 }])]
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['zero-length-edge'])
  })

  it('rejects unexplained extreme whitespace', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 50, height: 500 }),
        node('B', { x: 450, y: 0, width: 50, height: 500 })
      ],
      []
    )
    expect(acceptance.accepted).toBe(false)
    expect(acceptance.findings.map((entry) => entry.code)).toEqual(['extreme-whitespace'])
  })

  it('accepts a layout that exhibits none of them', () => {
    const acceptance = gateFor(
      [
        node('A', { x: 0, y: 0, width: 200, height: 200 }),
        node('B', { x: 0, y: 300, width: 200, height: 200 })
      ],
      [edge('e', 'A', 'B', [{ x: 100, y: 200 }, { x: 100, y: 300 }])],
      ['e'],
      { x: 0, y: 0, width: 200, height: 500 }
    )
    expect(acceptance.findings).toEqual([])
    expect(acceptance.accepted).toBe(true)
  })

  it('honours a caller supplied whitespace limit', () => {
    const metrics: ArisLayoutMetrics = {
      shapeOverlaps: 0,
      labelSatelliteOverlaps: 0,
      edgeShapeCrossings: 0,
      edgeEdgeCrossings: 0,
      bendCount: 0,
      maxBendsPerEdge: 0,
      routeLengthTotal: 0,
      routeLengthMax: 0,
      canvasArea: 1,
      canvasWidth: 1,
      canvasHeight: 1,
      detachedEndpoints: 0,
      missingEdges: 0,
      duplicateEdges: 0,
      zeroLengthEdges: 0,
      largestEmptyBandXRatio: 0.2,
      largestEmptyBandYRatio: 0,
      shapeFillRatio: 0.5
    }
    const empty = {
      shapeOverlaps: [],
      labelSatelliteOverlaps: [],
      edgeShapeHits: [],
      detachedEndpoints: [],
      missingEdgeIds: [],
      duplicateEdgeIds: [],
      zeroLengthEdgeIds: []
    }
    expect(evaluateLayoutAcceptance(metrics, empty).accepted).toBe(true)
    expect(evaluateLayoutAcceptance(metrics, empty, { maxEmptyBandRatio: 0.1 }).accepted).toBe(false)
  })
})

describe('the engine gates its own output', () => {
  for (const [name, graph] of [
    ['chain', chainWithSatellites(0)],
    ['chain with satellites', chainWithSatellites(12)],
    ['xor diamond', xorDiamond(5)],
    ['cycle', cycleGraph()],
    ['two components', twoComponentGraph()]
  ] as const) {
    it(`emits an accepted layout for ${name}`, () => {
      const result = cleanLayout(graph)
      expect(result.findings).toEqual([])
      expect(result.accepted).toBe(true)
    })
  }

  it('reports exactly what the gate says about its own measured output', () => {
    const result = cleanLayout(xorDiamond(3))
    const analysis = analyzeLayout({
      nodes: result.nodes,
      edges: result.edges,
      canvas: result.canvas,
      expectedEdgeIds: xorDiamond(3).edges.map((entry) => entry.id)
    })
    expect(analysis.metrics.shapeOverlaps).toBe(result.metrics.shapeOverlaps)
    expect(analysis.metrics.edgeShapeCrossings).toBe(result.metrics.edgeShapeCrossings)
    expect(analysis.metrics.detachedEndpoints).toBe(result.metrics.detachedEndpoints)
    expect(evaluateLayoutAcceptance(analysis.metrics, analysis.defects).accepted).toBe(true)
  })

  it('does not waste rounds on a defect a wider grid cannot fix', () => {
    // A connection to an object that is not in the model can never be drawn.
    const result = cleanLayout({
      id: 'dangling',
      nodes: [fn('A'), fn('B')],
      edges: [flow('A', 'B'), flow('B', 'ghost')]
    })
    expect(result.accepted).toBe(false)
    expect(result.findings.map((entry) => entry.code)).toEqual(['missing-edge'])
    expect(result.findings[0]?.subjects).toEqual(['B->ghost'])
    expect(result.iterations).toBe(1)
  })

  it('retries while a finding is still repairable', () => {
    // A zero-width shape leaves no room to fan two parallel connections apart,
    // so they stay geometrically identical. The gate calls that repairable and
    // the engine spends every allowed round trying rather than emitting it.
    const result = cleanLayout(
      {
        id: 'degenerate',
        nodes: [
          { id: 'A', role: 'function', size: { width: 0, height: 80 } },
          { id: 'B', role: 'function', size: { width: 0, height: 80 } }
        ],
        edges: [
          { id: 'p1', source: 'A', target: 'B', kind: 'control-flow' },
          { id: 'p2', source: 'A', target: 'B', kind: 'control-flow' }
        ]
      },
      { maxIterations: 4 }
    )
    expect(result.findings.map((entry) => entry.code)).toContain('duplicate-edge')
    expect(result.accepted).toBe(false)
    expect(result.iterations).toBe(4)
  })
})
