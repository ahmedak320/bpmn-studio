import { describe, expect, it } from 'vitest'
import {
  analyzeEdgeVisuals,
  findCrossings,
  findJunctions,
  normalizePolyline,
  splitPartialOverlaps,
  type Point,
  type PolylineEdge
} from '../edgeVisuals'

function edge(id: string, ...waypoints: Point[]): PolylineEdge {
  return { id, waypoints }
}

function topologicalEdge(
  id: string,
  sourceId: string,
  targetId: string,
  ...waypoints: Point[]
): PolylineEdge {
  return { id, sourceId, targetId, waypoints }
}

describe('normalizePolyline', () => {
  it('removes duplicates and redundant collinear points without mutating input', () => {
    const original = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 }
    ]

    expect(normalizePolyline(original)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 }
    ])
    expect(original).toHaveLength(5)
  })

  it('retains a collinear reversal because it changes path direction', () => {
    expect(
      normalizePolyline([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 40, y: 0 }
      ])
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 0 }
    ])
  })
})

describe('splitPartialOverlaps', () => {
  it('splits a long segment at both boundaries of a partial collinear overlap', () => {
    const result = splitPartialOverlaps([
      edge('long', { x: 0, y: 0 }, { x: 100, y: 0 }),
      edge('short', { x: 40, y: 0 }, { x: 70, y: 0 })
    ])

    expect(result[0].waypoints).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 70, y: 0 },
      { x: 100, y: 0 }
    ])
    expect(result[1].waypoints).toEqual([
      { x: 40, y: 0 },
      { x: 70, y: 0 }
    ])
  })
})

describe('strict-interior crossings', () => {
  it('reports a perpendicular interior crossing and puts the horizontal edge over', () => {
    expect(
      findCrossings([
        edge('vertical', { x: 50, y: 0 }, { x: 50, y: 100 }),
        edge('horizontal', { x: 0, y: 40 }, { x: 100, y: 40 })
      ])
    ).toEqual([
      {
        point: { x: 50, y: 40 },
        overEdgeId: 'horizontal',
        underEdgeId: 'vertical'
      }
    ])
  })

  it('does not classify endpoint touches or collinear overlaps as crossings', () => {
    expect(
      findCrossings([
        edge('horizontal', { x: 0, y: 50 }, { x: 50, y: 50 }),
        edge('endpoint-touch', { x: 50, y: 0 }, { x: 50, y: 50 }),
        edge('overlap', { x: 20, y: 50 }, { x: 80, y: 50 })
      ])
    ).toEqual([])
  })

  it('deduplicates the same edge-pair crossing produced by retraced segments', () => {
    expect(
      findCrossings([
        edge(
          'horizontal',
          { x: 0, y: 50 },
          { x: 100, y: 50 },
          { x: 0, y: 50 }
        ),
        edge('vertical', { x: 50, y: 0 }, { x: 50, y: 100 })
      ])
    ).toHaveLength(1)
  })
})

describe('source-prefix split junctions', () => {
  it('finds a two-edge common prefix', () => {
    expect(
      findJunctions([
        edge('up', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: -30 }),
        edge('down', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 })
      ])
    ).toEqual([
      {
        point: { x: 40, y: 0 },
        kind: 'split',
        edgeIds: ['down', 'up']
      }
    ])
  })

  it('groups three edges and detects a nested split on a partial segment', () => {
    expect(
      findJunctions([
        edge('upper', { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -40 }),
        edge('lower', { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }),
        edge('early', { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 60 })
      ])
    ).toEqual([
      {
        point: { x: 50, y: 0 },
        kind: 'split',
        edgeIds: ['early', 'lower', 'upper']
      },
      {
        point: { x: 100, y: 0 },
        kind: 'split',
        edgeIds: ['lower', 'upper']
      }
    ])
  })
})

describe('target-suffix merge junctions', () => {
  it('finds a two-edge common suffix with a partial-segment boundary', () => {
    expect(
      findJunctions([
        edge('long', { x: 100, y: -50 }, { x: 100, y: 0 }, { x: 0, y: 0 }),
        edge('short', { x: 50, y: 50 }, { x: 50, y: 0 }, { x: 0, y: 0 })
      ])
    ).toEqual([
      {
        point: { x: 50, y: 0 },
        kind: 'merge',
        edgeIds: ['long', 'short']
      }
    ])
  })

  it('groups three incoming edges and keeps a nested downstream merge', () => {
    expect(
      findJunctions([
        edge('upper', { x: 100, y: -40 }, { x: 100, y: 0 }, { x: 0, y: 0 }),
        edge('lower', { x: 100, y: 40 }, { x: 100, y: 0 }, { x: 0, y: 0 }),
        edge('late', { x: 50, y: 60 }, { x: 50, y: 0 }, { x: 0, y: 0 })
      ])
    ).toEqual([
      {
        point: { x: 50, y: 0 },
        kind: 'merge',
        edgeIds: ['late', 'lower', 'upper']
      },
      {
        point: { x: 100, y: 0 },
        kind: 'merge',
        edgeIds: ['lower', 'upper']
      }
    ])
  })
})

describe('combined edge visual classification', () => {
  it('gives a junction precedence over an unrelated crossing at the same point', () => {
    const analysis = analyzeEdgeVisuals([
      edge('split-up', { x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 10 }),
      edge('split-down', { x: 0, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 90 }),
      edge('cross-horizontal', { x: -20, y: 50 }, { x: 120, y: 50 }),
      edge('cross-vertical', { x: 50, y: 0 }, { x: 50, y: 100 })
    ])

    expect(analysis.junctions).toContainEqual({
      point: { x: 50, y: 50 },
      kind: 'split',
      edgeIds: ['split-down', 'split-up']
    })
    expect(analysis.crossings).toEqual([])
  })

  it('uses BPMN topology to distinguish true joins from geometric overlap', () => {
    const unrelated = [
      topologicalEdge(
        'a',
        'Source_A',
        'Target_A',
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 30 }
      ),
      topologicalEdge(
        'b',
        'Source_B',
        'Target_B',
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: -30 }
      )
    ]
    expect(findJunctions(unrelated)).toEqual([])

    expect(
      findJunctions([
        { ...unrelated[0], sourceId: 'Shared_Source' },
        { ...unrelated[1], sourceId: 'Shared_Source' }
      ])
    ).toEqual([
      {
        point: { x: 50, y: 0 },
        kind: 'split',
        edgeIds: ['a', 'b']
      }
    ])
  })

  it('keeps an unrelated crossing visible at a true junction coordinate', () => {
    const analysis = analyzeEdgeVisuals([
      topologicalEdge(
        'split-up',
        'Shared',
        'Up',
        { x: 0, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 10 }
      ),
      topologicalEdge(
        'split-down',
        'Shared',
        'Down',
        { x: 0, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 90 }
      ),
      topologicalEdge(
        'cross-horizontal',
        'Left',
        'Right',
        { x: -20, y: 50 },
        { x: 120, y: 50 }
      ),
      topologicalEdge(
        'cross-vertical',
        'Top',
        'Bottom',
        { x: 50, y: 0 },
        { x: 50, y: 100 }
      )
    ])

    expect(analysis.junctions).toContainEqual({
      point: { x: 50, y: 50 },
      kind: 'split',
      edgeIds: ['split-down', 'split-up']
    })
    expect(analysis.crossings).toContainEqual({
      point: { x: 50, y: 50 },
      overEdgeId: 'cross-horizontal',
      underEdgeId: 'cross-vertical'
    })
  })

  it('is independent of input order and sorts every participating edge id', () => {
    const edges = [
      edge('z', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: -20 }),
      edge('a', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }),
      edge('m', { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 70, y: 0 })
    ]

    expect(analyzeEdgeVisuals([...edges].reverse())).toEqual(analyzeEdgeVisuals(edges))
    expect(analyzeEdgeVisuals(edges).junctions[0].edgeIds).toEqual(['a', 'm', 'z'])
  })
})
