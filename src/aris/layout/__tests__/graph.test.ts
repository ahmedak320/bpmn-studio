import { describe, expect, it } from 'vitest'

import {
  buildAdjacency,
  classifyEdges,
  detectSourceOrientation,
  findConnectedComponents,
  findStronglyConnectedComponents,
  separateGraphs
} from '../graph'
import { attach, cycleGraph, event, flow, fn, rule, satellite, selfLoopGraph } from './fixtures'
import type { ArisLayoutGraphInput } from '../types'

describe('step 1 — separate the control-flow graph from the satellite graph', () => {
  it('splits nodes by role and edges by kind', () => {
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [event('E'), fn('F'), rule('R', 'xor'), satellite('S')],
      edges: [flow('E', 'F'), flow('F', 'R'), attach('F', 'S')]
    }
    const separated = separateGraphs(graph)
    expect(separated.controlNodes.map((node) => node.id)).toEqual(['E', 'F', 'R'])
    expect(separated.satelliteNodes.map((node) => node.id)).toEqual(['S'])
    expect(separated.controlEdges.map((edge) => edge.id)).toEqual(['E->F', 'F->R'])
    expect(separated.satelliteEdges.map((edge) => edge.id)).toEqual(['F~S'])
  })

  it('demotes a control-flow edge that touches a satellite', () => {
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [fn('F'), satellite('S')],
      edges: [{ id: 'x', source: 'F', target: 'S', kind: 'control-flow' }]
    }
    const separated = separateGraphs(graph)
    expect(separated.controlEdges).toHaveLength(0)
    expect(separated.satelliteEdges.map((edge) => edge.id)).toEqual(['x'])
  })

  it('reports an edge whose endpoint does not exist', () => {
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [fn('F')],
      edges: [flow('F', 'missing')]
    }
    expect(separateGraphs(graph).danglingEdges.map((edge) => edge.id)).toEqual(['F->missing'])
  })
})

describe('step 2 — connected components', () => {
  it('finds one component per disconnected sub-graph, ordered by first member', () => {
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [fn('A'), fn('B'), fn('C'), fn('D')],
      edges: [flow('A', 'B'), flow('C', 'D')]
    }
    const separated = separateGraphs(graph)
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    const components = findConnectedComponents(adjacency)
    expect(components.components).toEqual([
      [0, 1],
      [2, 3]
    ])
    expect(components.componentOf).toEqual([0, 0, 1, 1])
  })

  it('treats direction as irrelevant', () => {
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [fn('A'), fn('B'), fn('C')],
      edges: [flow('A', 'C'), flow('B', 'C')]
    }
    const separated = separateGraphs(graph)
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    expect(findConnectedComponents(adjacency).components).toEqual([[0, 1, 2]])
  })
})

describe('step 3 — strongly connected components', () => {
  it('groups a cycle into one component and leaves the rest singleton', () => {
    const separated = separateGraphs(cycleGraph())
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    const strong = findStronglyConnectedComponents(adjacency)
    const idsOf = (members: readonly number[]): string[] =>
      members.map((member) => separated.controlNodes[member]?.id ?? '?')
    const cycleComponent = strong.components.find((members) => members.length > 1)
    expect(cycleComponent).toBeDefined()
    expect(idsOf(cycleComponent as readonly number[]).sort()).toEqual(['F.a', 'F.b', 'F.c'])
    expect(strong.components.filter((members) => members.length === 1)).toHaveLength(2)
  })

  it('handles a 500-node chain without recursing', () => {
    const nodes = Array.from({ length: 500 }, (_value, index) => fn(`N.${index}`))
    const edges = Array.from({ length: 499 }, (_value, index) =>
      flow(`N.${index}`, `N.${index + 1}`)
    )
    const adjacency = buildAdjacency(nodes, edges)
    expect(findStronglyConnectedComponents(adjacency).components).toHaveLength(500)
  })
})

describe('step 4 — forward and back edge classification', () => {
  it('marks the return path as a back edge and everything else forward', () => {
    const separated = separateGraphs(cycleGraph())
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    const classification = classifyEdges(adjacency)
    const byId = new Map(
      separated.controlEdges.map((edge, index) => [edge.id, classification.classOf[index]])
    )
    expect(byId.get('F.c->F.a')).toBe('back')
    expect(byId.get('E.start->F.a')).toBe('forward')
    expect(byId.get('F.a->F.b')).toBe('forward')
    expect(byId.get('F.b->F.c')).toBe('forward')
    expect(byId.get('F.c->E.end')).toBe('forward')
  })

  it('marks a self loop as its own class', () => {
    const separated = separateGraphs(selfLoopGraph())
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    const classification = classifyEdges(adjacency)
    expect(classification.selfLoopEdgeIndices).toHaveLength(1)
    expect(classification.backEdgeIndices).toHaveLength(0)
  })

  it('leaves an acyclic graph once the back edges are removed', () => {
    // Two nested cycles: A->B->C->A and B->D->B.
    const graph: ArisLayoutGraphInput = {
      id: 'g',
      nodes: [fn('A'), fn('B'), fn('C'), fn('D')],
      edges: [flow('A', 'B'), flow('B', 'C'), flow('C', 'A'), flow('B', 'D'), flow('D', 'B')]
    }
    const separated = separateGraphs(graph)
    const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
    const classification = classifyEdges(adjacency)
    const forward = classification.forwardEdgeIndices.map(
      (index) => separated.controlEdges[index]?.id
    )
    // Depth-first search over A,B,C,D removes C->A and D->B.
    expect(forward.sort()).toEqual(['A->B', 'B->C', 'B->D'])
    expect(classification.backEdgeIndices).toHaveLength(2)
  })
})

describe('step 5 — preserve the source orientation', () => {
  const sized = { width: 100, height: 40 }

  it('derives top-to-bottom from vertically stacked source coordinates', () => {
    const nodes = [
      { id: 'A', role: 'function' as const, size: sized, sourcePosition: { x: 0, y: 0 } },
      { id: 'B', role: 'function' as const, size: sized, sourcePosition: { x: 0, y: 200 } }
    ]
    expect(detectSourceOrientation(nodes, [flow('A', 'B')])).toBe('top-to-bottom')
  })

  it('derives left-to-right from horizontally chained source coordinates', () => {
    const nodes = [
      { id: 'A', role: 'function' as const, size: sized, sourcePosition: { x: 0, y: 0 } },
      { id: 'B', role: 'function' as const, size: sized, sourcePosition: { x: 400, y: 0 } }
    ]
    expect(detectSourceOrientation(nodes, [flow('A', 'B')])).toBe('left-to-right')
  })

  it('follows the majority of the source edges', () => {
    const nodes = [
      { id: 'A', role: 'function' as const, size: sized, sourcePosition: { x: 0, y: 0 } },
      { id: 'B', role: 'function' as const, size: sized, sourcePosition: { x: 400, y: 0 } },
      { id: 'C', role: 'function' as const, size: sized, sourcePosition: { x: 800, y: 0 } },
      { id: 'D', role: 'function' as const, size: sized, sourcePosition: { x: 800, y: 400 } }
    ]
    expect(detectSourceOrientation(nodes, [flow('A', 'B'), flow('B', 'C'), flow('C', 'D')])).toBe(
      'left-to-right'
    )
  })

  it('falls back to top-to-bottom without any source geometry', () => {
    expect(detectSourceOrientation([fn('A'), fn('B')], [flow('A', 'B')])).toBe('top-to-bottom')
  })
})
