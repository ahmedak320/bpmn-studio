/**
 * Free-text annotation placement — plan §14.4 steps 10-12, §13.2.
 */

import { describe, expect, it } from 'vitest'

import { placeAnnotations } from '../annotations'
import { cleanLayout } from '../cleanLayout'
import { rectsOverlap, segmentIntersectsRectInterior } from '../geometry'
import type {
  ArisLayoutAnnotationInput,
  ArisLayoutEdgeRoute,
  ArisLayoutNodePlacement,
  ArisLayoutRect
} from '../types'

function node(id: string, rect: ArisLayoutRect): ArisLayoutNodePlacement {
  return {
    id,
    kind: 'control-flow',
    role: 'function',
    rect,
    labelRect: null,
    componentIndex: 0,
    stronglyConnectedIndex: 0,
    rank: 0,
    laneId: null
  }
}

function note(id: string, rect: ArisLayoutRect): ArisLayoutAnnotationInput {
  return { id, rect }
}

const GAP = 20
const STEP = 40

describe('placeAnnotations', () => {
  it('returns nothing for a graph with no notes', () => {
    expect(
      placeAnnotations({
        annotations: [],
        sourceRects: new Map(),
        placed: [],
        obstacles: [],
        edges: [],
        gap: GAP,
        step: STEP
      })
    ).toEqual([])
  })

  it('keeps the note exactly the size it was handed', () => {
    const placed = [node('a', { x: 1000, y: 1000, width: 100, height: 60 })]
    const result = placeAnnotations({
      annotations: [note('n1', { x: 300, y: 300, width: 160, height: 32 })],
      sourceRects: new Map([['a', { x: 200, y: 300, width: 100, height: 60 }]]),
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.rect.width).toBe(160)
    expect(result[0]?.rect.height).toBe(32)
  })

  it('follows its nearest source neighbour to that node’s new position', () => {
    // `far` is nearest to the note in the source; both nodes move, and the
    // note has to end up beside `far`, not beside `near-in-the-result`.
    const sourceRects = new Map<string, ArisLayoutRect>([
      ['far', { x: 5000, y: 5000, width: 100, height: 60 }],
      ['other', { x: 0, y: 0, width: 100, height: 60 }]
    ])
    const placed = [
      node('far', { x: 200, y: 200, width: 100, height: 60 }),
      node('other', { x: 4000, y: 4000, width: 100, height: 60 })
    ]
    const [placement] = placeAnnotations({
      annotations: [note('n1', { x: 5200, y: 5000, width: 160, height: 32 })],
      sourceRects,
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })
    expect(placement).toBeDefined()
    const distanceToFar = Math.abs((placement as { rect: ArisLayoutRect }).rect.x - 300)
    expect(distanceToFar).toBeLessThan(200)
  })

  it('keeps the side the note was on in the source', () => {
    const sourceRects = new Map<string, ArisLayoutRect>([
      ['a', { x: 1000, y: 1000, width: 100, height: 60 }]
    ])
    const placed = [node('a', { x: 500, y: 500, width: 100, height: 60 })]
    const above = placeAnnotations({
      annotations: [note('n', { x: 1000, y: 300, width: 160, height: 32 })],
      sourceRects,
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })[0]
    const below = placeAnnotations({
      annotations: [note('n', { x: 1000, y: 1800, width: 160, height: 32 })],
      sourceRects,
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })[0]
    expect(above?.rect.y).toBeLessThan(500)
    expect(below?.rect.y).toBeGreaterThan(560)
  })

  it('never overlaps a shape, a caption box, a route or another note', () => {
    const placed: ArisLayoutNodePlacement[] = []
    for (let index = 0; index < 12; index += 1) {
      placed.push(node(`n${index}`, { x: 500, y: 400 + index * 200, width: 200, height: 120 }))
    }
    const obstacles: ArisLayoutRect[] = [{ x: 760, y: 400, width: 200, height: 120 }]
    const edges: ArisLayoutEdgeRoute[] = [
      {
        id: 'e1',
        source: 'n0',
        target: 'n11',
        kind: 'control-flow',
        classification: 'forward',
        points: [
          { x: 600, y: 520 },
          { x: 600, y: 2600 }
        ]
      }
    ]
    const sourceRects = new Map(placed.map((entry) => [entry.id, entry.rect]))
    const notes = Array.from({ length: 8 }, (_value, index) =>
      note(`note${index}`, { x: 520, y: 420 + index * 200, width: 160, height: 32 })
    )
    const result = placeAnnotations({
      annotations: notes,
      sourceRects,
      placed,
      obstacles,
      edges,
      gap: GAP,
      step: STEP
    })
    expect(result).toHaveLength(8)
    for (const placement of result) {
      for (const entry of placed) expect(rectsOverlap(placement.rect, entry.rect)).toBe(false)
      for (const rect of obstacles) expect(rectsOverlap(placement.rect, rect)).toBe(false)
      for (const edge of edges) {
        for (let index = 1; index < edge.points.length; index += 1) {
          expect(
            segmentIntersectsRectInterior(
              edge.points[index - 1] as { x: number; y: number },
              edge.points[index] as { x: number; y: number },
              placement.rect
            )
          ).toBe(false)
        }
      }
    }
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        expect(
          rectsOverlap(
            (result[i] as { rect: ArisLayoutRect }).rect,
            (result[j] as { rect: ArisLayoutRect }).rect
          )
        ).toBe(false)
      }
    }
  })

  it('never places a note at a negative coordinate', () => {
    const placed = [node('a', { x: 0, y: 0, width: 100, height: 60 })]
    const [placement] = placeAnnotations({
      annotations: [note('n', { x: -4000, y: -4000, width: 160, height: 32 })],
      sourceRects: new Map([['a', { x: 0, y: 0, width: 100, height: 60 }]]),
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })
    expect(placement?.rect.x).toBeGreaterThanOrEqual(0)
    expect(placement?.rect.y).toBeGreaterThanOrEqual(0)
  })

  it('falls back to a column butted against the content when nothing is anchored', () => {
    const [placement] = placeAnnotations({
      annotations: [note('n', { x: 10, y: 10, width: 160, height: 32 })],
      sourceRects: new Map(),
      placed: [],
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    })
    expect(placement).toMatchObject({ id: 'n', rect: { width: 160, height: 32 } })
  })

  it('is deterministic', () => {
    const placed = [
      node('a', { x: 500, y: 500, width: 200, height: 120 }),
      node('b', { x: 500, y: 900, width: 200, height: 120 })
    ]
    const input = {
      annotations: [
        note('n1', { x: 520, y: 520, width: 160, height: 32 }),
        note('n2', { x: 520, y: 920, width: 160, height: 32 })
      ],
      sourceRects: new Map(placed.map((entry) => [entry.id, entry.rect])),
      placed,
      obstacles: [],
      edges: [],
      gap: GAP,
      step: STEP
    }
    expect(JSON.stringify(placeAnnotations(input))).toBe(JSON.stringify(placeAnnotations(input)))
  })
})

describe('cleanLayout with annotations', () => {
  const graph = {
    id: 'M',
    nodes: [
      {
        id: 'start',
        role: 'event' as const,
        size: { width: 200, height: 100 },
        sourcePosition: { x: 0, y: 0 }
      },
      {
        id: 'do',
        role: 'function' as const,
        size: { width: 200, height: 100 },
        sourcePosition: { x: 0, y: 300 }
      },
      {
        id: 'end',
        role: 'event' as const,
        size: { width: 200, height: 100 },
        sourcePosition: { x: 0, y: 600 }
      }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'do', kind: 'control-flow' as const },
      { id: 'e2', source: 'do', target: 'end', kind: 'control-flow' as const }
    ]
  }

  it('leaves the control flow byte-identical whether notes are present or not', () => {
    const without = cleanLayout(graph)
    const with_ = cleanLayout({
      ...graph,
      annotations: [
        { id: 'n1', rect: { x: 20, y: 320, width: 160, height: 32 } },
        { id: 'n2', rect: { x: 20, y: 20, width: 160, height: 32 } }
      ]
    })
    expect(JSON.stringify(with_.nodes)).toBe(JSON.stringify(without.nodes))
    expect(JSON.stringify(with_.edges)).toBe(JSON.stringify(without.edges))
    expect(with_.annotations).toHaveLength(2)
    expect(without.annotations).toEqual([])
  })

  it('accepts the layout and reports the notes as non-overlapping', () => {
    const result = cleanLayout({
      ...graph,
      annotations: [
        { id: 'n1', rect: { x: 20, y: 320, width: 160, height: 32 } },
        { id: 'n2', rect: { x: 20, y: 20, width: 160, height: 32 } }
      ]
    })
    expect(result.accepted).toBe(true)
    expect(result.metrics.shapeOverlaps).toBe(0)
    expect(result.metrics.labelSatelliteOverlaps).toBe(0)
    expect(result.metrics.edgeShapeCrossings).toBe(0)
    for (const annotation of result.annotations) {
      for (const placement of result.nodes) {
        expect(rectsOverlap(annotation.rect, placement.rect)).toBe(false)
      }
    }
  })

  it('keeps an external caption clear of every note', () => {
    const result = cleanLayout({
      ...graph,
      nodes: graph.nodes.map((entry, index) =>
        index === 1
          ? {
              ...entry,
              externalCaption: { offsetX: 220, offsetY: 0, width: 300, height: 60 }
            }
          : entry
      ),
      annotations: [{ id: 'n1', rect: { x: 220, y: 300, width: 160, height: 32 } }]
    })
    const owner = result.nodes.find((entry) => entry.id === 'do')
    expect(owner).toBeDefined()
    const caption = {
      x: (owner as { rect: ArisLayoutRect }).rect.x + 220,
      y: (owner as { rect: ArisLayoutRect }).rect.y,
      width: 300,
      height: 60
    }
    for (const annotation of result.annotations) {
      expect(rectsOverlap(annotation.rect, caption)).toBe(false)
    }
  })
})
