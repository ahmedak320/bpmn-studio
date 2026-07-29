import { describe, expect, it } from 'vitest'
import {
  classifyRule,
  classifyRules,
  isAndRule,
  isMerge,
  isOrRule,
  isSplit,
  isXorRule
} from './xor'
import { validateEpcGraph } from './validate'
import { buildFlowGraphIndex } from './flowGraph'
import { edge, graph, node } from './testFixtures'

describe('XOR / AND rule classification (section 14.2)', () => {
  it('classifies ST_OPR_XOR_1 (the real AnimalWF symbol, with trailing "_1") as XOR', () => {
    const g = graph('M1', [node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' })], [])
    const [classification] = classifyRules(g)
    expect(isXorRule(classification)).toBe(true)
    expect(isAndRule(classification)).toBe(false)
    expect(isOrRule(classification)).toBe(false)
  })

  it('classifies ST_OPR_AND_1 as AND, and does not misfire on the "OR" substring inside "XOR"', () => {
    const and = graph('M1', [node('R1', 'OT_RULE', { symbolType: 'ST_OPR_AND_1' })], [])
    const xor = graph('M1', [node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' })], [])
    expect(isAndRule(classifyRules(and)[0])).toBe(true)
    expect(isOrRule(classifyRules(xor)[0])).toBe(false)
  })

  it('classifies a bare OR symbol as OR', () => {
    const g = graph('M1', [node('R1', 'OT_RULE', { symbolType: 'ST_OPR_OR_1' })], [])
    expect(isOrRule(classifyRules(g)[0])).toBe(true)
  })

  it('preserves split vs merge as distinct roles', () => {
    const g = graph(
      'M1',
      [
        node('F1', 'OT_FUNC'),
        node('Rsplit', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('E1', 'OT_EVT'),
        node('E2', 'OT_EVT')
      ],
      [
        edge('e1', 'F1', 'Rsplit', 'CT_LEADS_TO_1'),
        edge('e2', 'Rsplit', 'E1', 'CT_LEADS_TO_2'),
        edge('e3', 'Rsplit', 'E2', 'CT_LEADS_TO_2')
      ]
    )
    const index = buildFlowGraphIndex(g)
    const split = classifyRule(index, 'Rsplit')
    expect(split.role).toBe('split')
    expect(isSplit(split)).toBe(true)
    expect(isMerge(split)).toBe(false)
    expect([...split.outgoingEdgeIds].sort()).toEqual(['e2', 'e3'])

    const merge = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('E2', 'OT_EVT'),
        node('Rmerge', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('F1', 'OT_FUNC')
      ],
      [
        edge('e1', 'E1', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'E2', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e3', 'Rmerge', 'F1', 'CT_ACTIV_1')
      ]
    )
    const mergeIndex = buildFlowGraphIndex(merge)
    const mergeClassification = classifyRule(mergeIndex, 'Rmerge')
    expect(mergeClassification.role).toBe('merge')
    expect(isMerge(mergeClassification)).toBe(true)
    expect(isSplit(mergeClassification)).toBe(false)
    expect([...mergeClassification.incomingEdgeIds].sort()).toEqual(['e1', 'e2'])
  })

  it('never dedupes parallel edges or a self-loop when classifying a rule', () => {
    const g = graph(
      'M1',
      [
        node('F1', 'OT_FUNC'),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('E1', 'OT_EVT')
      ],
      [
        edge('e1', 'F1', 'R1', 'CT_LEADS_TO_1'),
        edge('e2', 'F1', 'R1', 'CT_LEADS_TO_1'), // explicit parallel edge, must not collapse
        edge('e3', 'R1', 'E1', 'CT_LEADS_TO_2')
      ]
    )
    const index = buildFlowGraphIndex(g)
    const classification = classifyRule(index, 'R1')
    expect([...classification.incomingEdgeIds].sort()).toEqual(['e1', 'e2'])
    expect(classification.inDegree).toBe(2)
  })
})

describe('explicit cycle preservation (14.2 / 14.3)', () => {
  it('leaves an explicit cycle completely untouched by validation', () => {
    // A -> R(merge/split) -> B -> A, an explicit rework loop through a rule connector.
    const nodes = [
      node('A', 'OT_FUNC'),
      node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
      node('B', 'OT_EVT'),
      node('E0', 'OT_EVT'),
      node('Eend', 'OT_EVT')
    ]
    const edges = [
      edge('e0', 'E0', 'A', 'CT_ACTIV_1'),
      edge('e1', 'A', 'R1', 'CT_LEADS_TO_1'),
      edge('e2', 'R1', 'B', 'CT_LEADS_TO_2'),
      edge('e3', 'B', 'A', 'CT_ACTIV_1'), // wait: B is EVT, A is FUNC — EVT->FUNC is valid alternation
      edge('e4', 'R1', 'Eend', 'CT_LEADS_TO_2')
    ]
    const g = graph('M1', nodes, edges)
    const edgeIdsBefore = g.edges.map((e) => e.id).sort()

    const findings = validateEpcGraph(g)
    // Explicit cycles through a well-formed rule connector are valid EPC topology.
    expect(findings).toEqual([])

    // The graph object itself must be completely unchanged after validation.
    expect(g.edges.map((e) => e.id).sort()).toEqual(edgeIdsBefore)
    expect(g.edges.some((e) => e.id === 'e3')).toBe(true)
  })
})
