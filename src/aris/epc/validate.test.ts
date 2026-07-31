import { describe, expect, it } from 'vitest'
import { validateEpcGraph } from './validate'
import { edge, graph, names, node } from './testFixtures'

describe('validateEpcGraph — clean baseline', () => {
  it('reports no findings for a minimal well-formed EPC (event -> function -> event)', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT', { names: names('Start') }),
        node('F1', 'OT_FUNC', { names: names('Do work') }),
        node('E2', 'OT_EVT', { names: names('End') })
      ],
      [edge('e1', 'E1', 'F1', 'CT_ACTIV_1'), edge('e2', 'F1', 'E2', 'CT_CRT_1')]
    )
    expect(validateEpcGraph(g)).toEqual([])
  })
})

describe('validateEpcGraph — epc.alternation (checkAlternation)', () => {
  it('allows the DMT CT_IS_PREDEC_OF_1 Function→Function sequence tuple', () => {
    const g = graph(
      'M1',
      [node('E1', 'OT_EVT'), node('F1', 'OT_FUNC'), node('F2', 'OT_FUNC'), node('E2', 'OT_EVT')],
      [
        edge('e1', 'E1', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'F2', 'CT_IS_PREDEC_OF_1'),
        edge('e3', 'F2', 'E2', 'CT_CRT_1')
      ]
    )

    expect(validateEpcGraph(g)).toEqual([])
  })

  it('flags two events connected directly by a flow edge', () => {
    const g = graph(
      'M1',
      [node('E1', 'OT_EVT'), node('E2', 'OT_EVT')],
      [edge('e1', 'E1', 'E2', 'CT_ACTIV_1')]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.alternation')
    expect(findings[0].severity).toBe('error')
    expect(findings[0].edgeIds).toEqual(['e1'])
  })

  it('flags two functions connected directly by a flow edge', () => {
    const g = graph(
      'M1',
      [node('F1', 'OT_FUNC'), node('F2', 'OT_FUNC')],
      [edge('e1', 'F1', 'F2', 'CT_ACTIV_1')]
    )
    const finding = validateEpcGraph(g).find((candidate) => candidate.ruleId === 'epc.alternation')
    expect(finding).toMatchObject({ ruleId: 'epc.alternation', severity: 'error' })
  })
})

describe('validateEpcGraph — epc.startEnd.missingStart (checkStartEndCompleteness)', () => {
  it('flags a model whose every event has an incoming flow edge (no start event)', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('E2', 'OT_EVT'),
        node('E3', 'OT_EVT'),
        node('F1', 'OT_FUNC'),
        node('F2', 'OT_FUNC')
      ],
      [
        edge('e1', 'E1', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E2', 'CT_CRT_1'),
        edge('e3', 'E2', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F2', 'E1', 'CT_CRT_1'),
        edge('e5', 'F2', 'E3', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.startEnd.missingStart')
  })
})

describe('validateEpcGraph — epc.startEnd.missingEnd (checkStartEndCompleteness)', () => {
  it('flags a model whose every event has an outgoing flow edge (no end event)', () => {
    const g = graph(
      'M1',
      [node('E0', 'OT_EVT'), node('E1', 'OT_EVT'), node('F1', 'OT_FUNC'), node('F2', 'OT_FUNC')],
      [
        edge('e1', 'E0', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E1', 'CT_CRT_1'),
        edge('e3', 'E1', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F2', 'E1', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.startEnd.missingEnd')
  })
})

describe('validateEpcGraph — epc.rule.splitMergeConflict (checkRuleSplitMergeConflict)', () => {
  it('flags a rule with more than one incoming AND more than one outgoing flow edge', () => {
    const g = graph(
      'M1',
      [
        node('E0', 'OT_EVT'),
        node('E0b', 'OT_EVT'),
        node('F1', 'OT_FUNC'),
        node('F2', 'OT_FUNC'),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('E1', 'OT_EVT'),
        node('E2', 'OT_EVT')
      ],
      [
        edge('e1', 'E0', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'E0b', 'F2', 'CT_ACTIV_1'),
        edge('e3', 'F1', 'R1', 'CT_LEADS_TO_1'),
        edge('e4', 'F2', 'R1', 'CT_LEADS_TO_1'),
        edge('e5', 'R1', 'E1', 'CT_LEADS_TO_2'),
        edge('e6', 'R1', 'E2', 'CT_LEADS_TO_2')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.rule.splitMergeConflict')
    expect(findings[0].nodeIds).toEqual(['R1'])
    expect([...findings[0].edgeIds].sort()).toEqual(['e3', 'e4', 'e5', 'e6'])
  })
})

describe('validateEpcGraph — epc.event.decisionViolation (checkEventPrecedesDecisionSplit)', () => {
  it('flags an event flowing directly into an XOR rule that splits', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('F1', 'OT_FUNC'),
        node('F2', 'OT_FUNC'),
        node('E2', 'OT_EVT'),
        node('E3', 'OT_EVT')
      ],
      [
        edge('e1', 'E1', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e3', 'R1', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F1', 'E2', 'CT_CRT_1'),
        edge('e5', 'F2', 'E3', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.event.decisionViolation')
    expect(findings[0].nodeIds).toEqual(['E1', 'R1'])
  })

  it('does not flag an event flowing into an XOR rule that only merges', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('E1b', 'OT_EVT'),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('F1', 'OT_FUNC'),
        node('E2', 'OT_EVT')
      ],
      [
        edge('e1', 'E1', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'E1b', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e3', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e4', 'F1', 'E2', 'CT_CRT_1')
      ]
    )
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain('epc.event.decisionViolation')
  })

  it('does not flag an event flowing into an AND rule that splits (a fork is not a decision)', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_AND_1' }),
        node('F1', 'OT_FUNC'),
        node('F2', 'OT_FUNC'),
        node('E2', 'OT_EVT'),
        node('E3', 'OT_EVT')
      ],
      [
        edge('e1', 'E1', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e3', 'R1', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F1', 'E2', 'CT_CRT_1'),
        edge('e5', 'F2', 'E3', 'CT_CRT_1')
      ]
    )
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain('epc.event.decisionViolation')
  })
})

describe('validateEpcGraph — epc.connectivity.orphanNode (checkConnectedComponentIntegrity)', () => {
  it('flags every node of a smaller disconnected control-flow component', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('F1', 'OT_FUNC'),
        node('E2', 'OT_EVT'),
        node('E3', 'OT_EVT'),
        node('F2', 'OT_FUNC'),
        node('E4', 'OT_EVT')
      ],
      [
        edge('e1', 'E1', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E2', 'CT_CRT_1'),
        edge('e3', 'E3', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F2', 'E4', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g).filter((f) => f.ruleId === 'epc.connectivity.orphanNode')
    expect(findings).toHaveLength(3)
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true)
    expect(new Set(findings.flatMap((f) => f.nodeIds))).toEqual(new Set(['E3', 'F2', 'E4']))
  })
})

describe('validateEpcGraph — epc.rule.unrecognizedSymbol (checkRuleSymbolRecognized)', () => {
  it('flags a rule with a null/unrecognized symbol', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('R1', 'OT_RULE', { symbolType: null }),
        node('F1', 'OT_FUNC'),
        node('E2', 'OT_EVT')
      ],
      [
        edge('e1', 'E1', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e3', 'F1', 'E2', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.rule.unrecognizedSymbol')
    expect(findings[0].nodeIds).toEqual(['R1'])
  })
})

describe('validateEpcGraph — epc.connection.missingType (checkTypedConnections)', () => {
  it('flags a connection occurrence with an empty connection type', () => {
    const g = graph(
      'M1',
      [node('E1', 'OT_EVT'), node('F1', 'OT_FUNC'), node('E2', 'OT_EVT')],
      [
        edge('e1', 'E1', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E2', 'CT_CRT_1'),
        edge('e3', 'F1', 'E2', '')
      ]
    )
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.connection.missingType')
    expect(findings[0].edgeIds).toEqual(['e3'])
  })
})

describe('validateEpcGraph — epc.linkedModel.danglingReference (checkLinkedModelAssignments)', () => {
  it('flags a node whose linkedModelIds reference an unknown model', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('F1', 'OT_FUNC', { linkedModelIds: ['Model.unknown'] }),
        node('E2', 'OT_EVT')
      ],
      [edge('e1', 'E1', 'F1', 'CT_ACTIV_1'), edge('e2', 'F1', 'E2', 'CT_CRT_1')]
    )
    const findings = validateEpcGraph(g, { knownModelIds: new Set(['Model.other']) })
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('epc.linkedModel.danglingReference')
    expect(findings[0].nodeIds).toEqual(['F1'])
  })

  it('does not flag anything when knownModelIds is not supplied', () => {
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT'),
        node('F1', 'OT_FUNC', { linkedModelIds: ['Model.unknown'] }),
        node('E2', 'OT_EVT')
      ],
      [edge('e1', 'E1', 'F1', 'CT_ACTIV_1'), edge('e2', 'F1', 'E2', 'CT_CRT_1')]
    )
    expect(validateEpcGraph(g)).toEqual([])
  })
})
