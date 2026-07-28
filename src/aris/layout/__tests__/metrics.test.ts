import { describe, expect, it } from 'vitest'

import { analyzeLayout } from '../metrics'
import type {
  ArisLayoutEdgeRoute,
  ArisLayoutNodePlacement,
  ArisLayoutPoint,
  ArisLayoutRect
} from '../types'

function node(
  id: string,
  rect: ArisLayoutRect,
  options: { labelRect?: ArisLayoutRect; kind?: 'control-flow' | 'satellite' } = {}
): ArisLayoutNodePlacement {
  return {
    id,
    kind: options.kind ?? 'control-flow',
    role: options.kind === 'satellite' ? 'satellite' : 'function',
    rect,
    labelRect: options.labelRect ?? null,
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

const CANVAS: ArisLayoutRect = { x: 0, y: 0, width: 400, height: 400 }

describe('shape overlaps', () => {
  it('counts one pair and reports the exact shared area', () => {
    // A 100x100 at (0,0) and 100x100 at (60,60) share the 40x40 square.
    const analysis = analyzeLayout({
      nodes: [
        node('A', { x: 0, y: 0, width: 100, height: 100 }),
        node('B', { x: 60, y: 60, width: 100, height: 100 }),
        node('C', { x: 300, y: 300, width: 50, height: 50 })
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    expect(analysis.metrics.shapeOverlaps).toBe(1)
    expect(analysis.defects.shapeOverlaps).toEqual([{ a: 'A', b: 'B', area: 1600 }])
  })

  it('does not count shapes that merely touch', () => {
    const analysis = analyzeLayout({
      nodes: [
        node('A', { x: 0, y: 0, width: 100, height: 100 }),
        node('B', { x: 100, y: 0, width: 100, height: 100 })
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    expect(analysis.metrics.shapeOverlaps).toBe(0)
  })

  it('counts a satellite shape overlapping a control-flow shape in both metrics', () => {
    const analysis = analyzeLayout({
      nodes: [
        node('A', { x: 0, y: 0, width: 100, height: 100 }),
        node('S', { x: 50, y: 50, width: 100, height: 100 }, { kind: 'satellite' })
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    expect(analysis.metrics.shapeOverlaps).toBe(1)
    expect(analysis.metrics.labelSatelliteOverlaps).toBe(1)
    expect(analysis.defects.labelSatelliteOverlaps).toEqual([{ a: 'A', b: 'S', area: 2500 }])
  })
})

describe('label / satellite overlaps', () => {
  it('counts a caption box that lands on another shape', () => {
    const analysis = analyzeLayout({
      nodes: [
        node(
          'A',
          { x: 0, y: 0, width: 100, height: 40 },
          { labelRect: { x: 0, y: 40, width: 100, height: 30 } }
        ),
        node('B', { x: 50, y: 60, width: 100, height: 40 })
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    // The caption 0..100 x 40..70 and B 50..150 x 60..100 share 50 x 10.
    expect(analysis.metrics.labelSatelliteOverlaps).toBe(1)
    expect(analysis.defects.labelSatelliteOverlaps[0]?.area).toBe(500)
  })

  it('never counts a caption against its own shape', () => {
    const analysis = analyzeLayout({
      nodes: [
        node(
          'A',
          { x: 0, y: 0, width: 100, height: 40 },
          { labelRect: { x: 0, y: 20, width: 100, height: 30 } }
        )
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    expect(analysis.metrics.labelSatelliteOverlaps).toBe(0)
  })

  it('counts two caption boxes that overlap each other', () => {
    const analysis = analyzeLayout({
      nodes: [
        node(
          'A',
          { x: 0, y: 0, width: 40, height: 20 },
          { labelRect: { x: 0, y: 20, width: 100, height: 30 } }
        ),
        node(
          'B',
          { x: 200, y: 0, width: 40, height: 20 },
          { labelRect: { x: 50, y: 30, width: 100, height: 30 } }
        )
      ],
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: []
    })
    expect(analysis.metrics.labelSatelliteOverlaps).toBe(1)
  })
})

describe('edge through an unrelated shape', () => {
  const nodes = [
    node('A', { x: 0, y: 0, width: 40, height: 40 }),
    node('B', { x: 100, y: 0, width: 40, height: 40 }),
    node('C', { x: 200, y: 0, width: 40, height: 40 })
  ]

  it('counts a route that ploughs through the middle shape', () => {
    const analysis = analyzeLayout({
      nodes,
      edges: [edge('e', 'A', 'C', [{ x: 40, y: 20 }, { x: 200, y: 20 }])],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.edgeShapeCrossings).toBe(1)
    expect(analysis.defects.edgeShapeHits).toEqual([{ edgeId: 'e', nodeId: 'B' }])
  })

  it('does not count a route that detours around the middle shape', () => {
    const analysis = analyzeLayout({
      nodes,
      edges: [
        edge('e', 'A', 'C', [
          { x: 20, y: 40 },
          { x: 20, y: 80 },
          { x: 220, y: 80 },
          { x: 220, y: 40 }
        ])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.edgeShapeCrossings).toBe(0)
  })

  it('never counts a route against its own endpoints', () => {
    const analysis = analyzeLayout({
      nodes,
      edges: [edge('e', 'A', 'B', [{ x: 20, y: 20 }, { x: 120, y: 20 }])],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.edgeShapeCrossings).toBe(0)
  })
})

describe('edge / edge crossings', () => {
  it('counts one proper crossing', () => {
    const analysis = analyzeLayout({
      nodes: [],
      edges: [
        edge('h', 'A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }]),
        edge('v', 'C', 'D', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['h', 'v']
    })
    expect(analysis.metrics.edgeEdgeCrossings).toBe(1)
  })

  it('does not count two routes that share an endpoint', () => {
    const analysis = analyzeLayout({
      nodes: [],
      edges: [
        edge('a', 'A', 'B', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
        edge('b', 'A', 'C', [{ x: 0, y: 0 }, { x: 0, y: 100 }])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['a', 'b']
    })
    expect(analysis.metrics.edgeEdgeCrossings).toBe(0)
  })

  it('counts each crossing segment pair once', () => {
    // A zig-zag crossing a straight vertical line twice.
    const analysis = analyzeLayout({
      nodes: [],
      edges: [
        edge('zig', 'A', 'B', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 }
        ]),
        edge('v', 'C', 'D', [{ x: 50, y: -50 }, { x: 50, y: 150 }])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['zig', 'v']
    })
    expect(analysis.metrics.edgeEdgeCrossings).toBe(2)
  })
})

describe('bends, lengths and canvas', () => {
  it('counts bends as points minus two', () => {
    const analysis = analyzeLayout({
      nodes: [],
      edges: [
        edge('straight', 'A', 'B', [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
        edge('zig', 'C', 'D', [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 20 }
        ])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['straight', 'zig']
    })
    expect(analysis.metrics.bendCount).toBe(2)
    expect(analysis.metrics.maxBendsPerEdge).toBe(2)
    // 10 for the straight route, 10 + 10 + 10 for the zig-zag.
    expect(analysis.metrics.routeLengthTotal).toBe(40)
    expect(analysis.metrics.routeLengthMax).toBe(30)
  })

  it('reports the canvas area and the shape fill ratio', () => {
    const analysis = analyzeLayout({
      nodes: [node('A', { x: 0, y: 0, width: 100, height: 100 })],
      edges: [],
      canvas: { x: 0, y: 0, width: 200, height: 100 },
      expectedEdgeIds: []
    })
    expect(analysis.metrics.canvasArea).toBe(20000)
    expect(analysis.metrics.canvasWidth).toBe(200)
    expect(analysis.metrics.canvasHeight).toBe(100)
    expect(analysis.metrics.shapeFillRatio).toBe(0.5)
  })
})

describe('endpoint attachment and edge degeneracy', () => {
  const shapes = [
    node('A', { x: 0, y: 0, width: 100, height: 40 }),
    node('B', { x: 0, y: 200, width: 100, height: 40 })
  ]

  it('accepts endpoints that sit on the outline', () => {
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [edge('e', 'A', 'B', [{ x: 50, y: 40 }, { x: 50, y: 200 }])],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.detachedEndpoints).toBe(0)
  })

  it('flags an endpoint that floats away from its shape', () => {
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [edge('e', 'A', 'B', [{ x: 50, y: 60 }, { x: 50, y: 200 }])],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.detachedEndpoints).toBe(1)
    expect(analysis.defects.detachedEndpoints).toEqual([
      { edgeId: 'e', nodeId: 'A', end: 'source' }
    ])
  })

  it('flags a zero-length route', () => {
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [edge('e', 'A', 'B', [{ x: 50, y: 40 }, { x: 50, y: 40 }])],
      canvas: CANVAS,
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.zeroLengthEdges).toBe(1)
  })

  it('flags a missing edge', () => {
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [],
      canvas: CANVAS,
      expectedEdgeIds: ['e1', 'e2']
    })
    expect(analysis.metrics.missingEdges).toBe(2)
    expect(analysis.defects.missingEdgeIds).toEqual(['e1', 'e2'])
  })

  it('flags two routes with identical endpoints and identical geometry', () => {
    const points = [{ x: 50, y: 40 }, { x: 50, y: 200 }]
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [edge('e1', 'A', 'B', points), edge('e2', 'A', 'B', points)],
      canvas: CANVAS,
      expectedEdgeIds: ['e1', 'e2']
    })
    expect(analysis.metrics.duplicateEdges).toBe(2)
    expect(analysis.defects.duplicateEdgeIds).toEqual(['e1', 'e2'])
  })

  it('does not flag parallel routes that are drawn apart', () => {
    const analysis = analyzeLayout({
      nodes: shapes,
      edges: [
        edge('e1', 'A', 'B', [{ x: 40, y: 40 }, { x: 40, y: 200 }]),
        edge('e2', 'A', 'B', [{ x: 60, y: 40 }, { x: 60, y: 200 }])
      ],
      canvas: CANVAS,
      expectedEdgeIds: ['e1', 'e2']
    })
    expect(analysis.metrics.duplicateEdges).toBe(0)
  })
})

describe('whitespace scan', () => {
  it('measures the largest empty band as a fraction of the canvas', () => {
    // Shapes cover x in 0..100 and x in 300..400 of a 400 wide canvas, so the
    // interior gap is 200 wide: exactly half the canvas.
    const analysis = analyzeLayout({
      nodes: [
        node('A', { x: 0, y: 0, width: 100, height: 400 }),
        node('B', { x: 300, y: 0, width: 100, height: 400 })
      ],
      edges: [],
      canvas: { x: 0, y: 0, width: 400, height: 400 },
      expectedEdgeIds: []
    })
    expect(analysis.metrics.largestEmptyBandXRatio).toBe(0.5)
    expect(analysis.metrics.largestEmptyBandYRatio).toBe(0)
  })

  it('credits a route that crosses the band as an explanation', () => {
    const analysis = analyzeLayout({
      nodes: [
        node('A', { x: 0, y: 0, width: 100, height: 400 }),
        node('B', { x: 300, y: 0, width: 100, height: 400 })
      ],
      edges: [edge('e', 'A', 'B', [{ x: 100, y: 200 }, { x: 300, y: 200 }])],
      canvas: { x: 0, y: 0, width: 400, height: 400 },
      expectedEdgeIds: ['e']
    })
    expect(analysis.metrics.largestEmptyBandXRatio).toBe(0)
  })
})
