import { describe, expect, it } from 'vitest'

import { buildFlowGraphIndex, isControlFlowEdge } from './flowGraph'
import { edge, graph, node } from './testFixtures'

describe('buildFlowGraphIndex — tuple-scoped DMT control flow', () => {
  it('indexes a CT_IS_PREDEC_OF_1 Function→Function edge as control flow', () => {
    const g = graph(
      'M1',
      [node('F1', 'OT_FUNC'), node('F2', 'OT_FUNC')],
      [edge('e1', 'F1', 'F2', 'CT_IS_PREDEC_OF_1')]
    )

    const index = buildFlowGraphIndex(g)

    expect(index.flowEdges.map((candidate) => candidate.id)).toEqual(['e1'])
    expect(index.flowEdgesBySource.get('F1')?.map((candidate) => candidate.id)).toEqual(['e1'])
    expect(index.flowEdgesByTarget.get('F2')?.map((candidate) => candidate.id)).toEqual(['e1'])
    expect(isControlFlowEdge(g.edges[0], index.nodeById)).toBe(true)
  })

  it('rejects predecessor edges with a non-Function endpoint', () => {
    const g = graph(
      'M1',
      [node('F1', 'OT_FUNC'), node('E1', 'OT_EVT'), node('S1', 'OT_APPL_SYS')],
      [
        edge('e1', 'F1', 'E1', 'CT_IS_PREDEC_OF_1'),
        edge('e2', 'E1', 'F1', 'CT_IS_PREDEC_OF_1'),
        edge('e3', 'F1', 'S1', 'CT_IS_PREDEC_OF_1')
      ]
    )

    const index = buildFlowGraphIndex(g)

    expect(index.flowEdges).toEqual([])
    for (const candidate of g.edges) {
      expect(isControlFlowEdge(candidate, index.nodeById)).toBe(false)
    }
  })
})
