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
        node('E1', 'OT_EVT', { names: names('Approved') }),
        node('E2', 'OT_EVT', { names: names('Rejected') })
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
        edge('e2', 'R1', 'F1', 'CT_ACTIV_1', { names: names('accept') }),
        edge('e3', 'R1', 'F2', 'CT_ACTIV_1', { names: names('reject') }),
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

describe('validateEpcGraph — epc.rule.unlabeledDecisionBranch (checkLabeledDecisionBranches)', () => {
  /** event -> function -> XOR/OR split, with the branch outcomes supplied by the caller. */
  function decisionGraph(
    ruleSymbol: string | null,
    branchA: { edgeName?: string; targetName?: string },
    branchB: { edgeName?: string; targetName?: string }
  ) {
    return graph(
      'M1',
      [
        node('E0', 'OT_EVT', { names: names('Start') }),
        node('F1', 'OT_FUNC', { names: names('Decide') }),
        node('R1', 'OT_RULE', { symbolType: ruleSymbol }),
        node('EA', 'OT_EVT', branchA.targetName ? { names: names(branchA.targetName) } : {}),
        node('EB', 'OT_EVT', branchB.targetName ? { names: names(branchB.targetName) } : {})
      ],
      [
        edge('e0', 'E0', 'F1', 'CT_ACTIV_1'),
        edge('e1', 'F1', 'R1', 'CT_LEADS_TO_1'),
        edge(
          'eA',
          'R1',
          'EA',
          'CT_LEADS_TO_2',
          branchA.edgeName ? { names: names(branchA.edgeName) } : {}
        ),
        edge(
          'eB',
          'R1',
          'EB',
          'CT_LEADS_TO_2',
          branchB.edgeName ? { names: names(branchB.edgeName) } : {}
        )
      ]
    )
  }

  it('flags an XOR split branch whose edge is unnamed AND whose target event is unnamed', () => {
    const g = decisionGraph('ST_OPR_XOR_1', { targetName: 'Approved' }, {})
    const findings = validateEpcGraph(g)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'epc.rule.unlabeledDecisionBranch',
      severity: 'error',
      messageKey: 'aris.epc.finding.unlabeledDecisionBranch',
      nodeIds: ['R1', 'EB'],
      edgeIds: ['eB']
    })
  })

  it('does not flag a branch whose outgoing edge carries a name (named-edge branch)', () => {
    const g = decisionGraph('ST_OPR_XOR_1', { edgeName: 'yes' }, { edgeName: 'no' })
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain(
      'epc.rule.unlabeledDecisionBranch'
    )
  })

  it('does not flag a branch whose target is a named event even when the edge is unnamed', () => {
    const g = decisionGraph('ST_OPR_XOR_1', { targetName: 'Approved' }, { targetName: 'Rejected' })
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain(
      'epc.rule.unlabeledDecisionBranch'
    )
  })

  it('exempts an AND split (a parallel fork is not a decision)', () => {
    const g = decisionGraph('ST_OPR_AND_1', {}, {})
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain(
      'epc.rule.unlabeledDecisionBranch'
    )
  })

  it('includes OR splits (an inclusive decision still needs labeled branches)', () => {
    const g = decisionGraph('ST_OPR_OR_1', {}, {})
    const findings = validateEpcGraph(g).filter(
      (f) => f.ruleId === 'epc.rule.unlabeledDecisionBranch'
    )
    expect(findings).toHaveLength(2)
    expect(findings.map((f) => f.edgeIds[0]).sort()).toEqual(['eA', 'eB'])
    expect(findings.every((f) => f.severity === 'error')).toBe(true)
  })

  it('exempts an out-degree-1 XOR rule (a lone outgoing edge is not a split)', () => {
    const g = graph(
      'M1',
      [
        node('E0', 'OT_EVT', { names: names('Start') }),
        node('E0b', 'OT_EVT', { names: names('Also start') }),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('F1', 'OT_FUNC', { names: names('Continue') }),
        node('E1', 'OT_EVT', { names: names('Done') })
      ],
      [
        edge('e1', 'E0', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'E0b', 'R1', 'CT_IS_EVAL_BY_1'),
        edge('e3', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e4', 'F1', 'E1', 'CT_CRT_1')
      ]
    )
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain(
      'epc.rule.unlabeledDecisionBranch'
    )
  })

  it('flags an unlabeled branch even when the target is a function (only named events count)', () => {
    const g = graph(
      'M1',
      [
        node('E0', 'OT_EVT', { names: names('Start') }),
        node('F0', 'OT_FUNC', { names: names('Decide') }),
        node('R1', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('F1', 'OT_FUNC', { names: names('Accept') }),
        node('F2', 'OT_FUNC', { names: names('Reject') }),
        node('E1', 'OT_EVT', { names: names('Accepted') }),
        node('E2', 'OT_EVT', { names: names('Rejected') })
      ],
      [
        edge('e0', 'E0', 'F0', 'CT_ACTIV_1'),
        edge('e1', 'F0', 'R1', 'CT_LEADS_TO_1'),
        edge('e2', 'R1', 'F1', 'CT_ACTIV_1'),
        edge('e3', 'R1', 'F2', 'CT_ACTIV_1'),
        edge('e4', 'F1', 'E1', 'CT_CRT_1'),
        edge('e5', 'F2', 'E2', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g).filter(
      (f) => f.ruleId === 'epc.rule.unlabeledDecisionBranch'
    )
    expect(findings.map((f) => f.edgeIds[0]).sort()).toEqual(['e2', 'e3'])
  })
})

describe('validateEpcGraph — epc.startEnd.unreachableEnd (checkEndReachability)', () => {
  it('does not flag a linear start -> function -> end chain', () => {
    const g = graph(
      'M1',
      [
        node('E0', 'OT_EVT', { names: names('Start') }),
        node('F1', 'OT_FUNC', { names: names('Work') }),
        node('E1', 'OT_EVT', { names: names('End') })
      ],
      [edge('e1', 'E0', 'F1', 'CT_ACTIV_1'), edge('e2', 'F1', 'E1', 'CT_CRT_1')]
    )
    expect(validateEpcGraph(g).map((f) => f.ruleId)).not.toContain('epc.startEnd.unreachableEnd')
  })

  it('flags a start event that can only reach a cycle, never an out-degree-0 end event', () => {
    // A clean start->end chain (so an end event exists and the check is not skipped) plus a
    // second start trapped in a function<->event rework loop with no exit.
    const g = graph(
      'M1',
      [
        node('Sgood', 'OT_EVT', { names: names('Good start') }),
        node('Fg', 'OT_FUNC', { names: names('Finish') }),
        node('Egood', 'OT_EVT', { names: names('Done') }),
        node('Sbad', 'OT_EVT', { names: names('Trapped start') }),
        node('Fb', 'OT_FUNC', { names: names('Loop step') }),
        node('Eb', 'OT_EVT', { names: names('Loop event') })
      ],
      [
        edge('e1', 'Sgood', 'Fg', 'CT_ACTIV_1'),
        edge('e2', 'Fg', 'Egood', 'CT_CRT_1'),
        edge('e3', 'Sbad', 'Fb', 'CT_ACTIV_1'),
        edge('e4', 'Fb', 'Eb', 'CT_CRT_1'),
        edge('e5', 'Eb', 'Fb', 'CT_ACTIV_1')
      ]
    )
    const findings = validateEpcGraph(g).filter((f) => f.ruleId === 'epc.startEnd.unreachableEnd')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'epc.startEnd.unreachableEnd',
      severity: 'error',
      messageKey: 'aris.epc.finding.unreachableEnd',
      nodeIds: ['Sbad'],
      edgeIds: []
    })
  })

  it('emits one finding per trapped start, in sorted start-node id order (deterministic)', () => {
    // Two trapped starts inserted out of id order feed a shared exit-less cycle; a separate
    // clean chain supplies the end event that keeps the check active.
    const g = graph(
      'M1',
      [
        node('Sb', 'OT_EVT', { names: names('Second start') }),
        node('Sa', 'OT_EVT', { names: names('First start') }),
        node('Floop', 'OT_FUNC', { names: names('Loop step') }),
        node('Eloop', 'OT_EVT', { names: names('Loop event') }),
        node('G0', 'OT_EVT', { names: names('Good start') }),
        node('Gf', 'OT_FUNC', { names: names('Finish') }),
        node('Ge', 'OT_EVT', { names: names('Done') })
      ],
      [
        edge('e1', 'Sb', 'Floop', 'CT_ACTIV_1'),
        edge('e2', 'Sa', 'Floop', 'CT_ACTIV_1'),
        edge('e3', 'Floop', 'Eloop', 'CT_CRT_1'),
        edge('e4', 'Eloop', 'Floop', 'CT_ACTIV_1'),
        edge('e5', 'G0', 'Gf', 'CT_ACTIV_1'),
        edge('e6', 'Gf', 'Ge', 'CT_CRT_1')
      ]
    )
    const findings = validateEpcGraph(g).filter((f) => f.ruleId === 'epc.startEnd.unreachableEnd')
    expect(findings.map((f) => f.nodeIds)).toEqual([['Sa'], ['Sb']])
  })

  it('is skipped (no double-reporting) when the model has no end event', () => {
    const g = graph(
      'M1',
      [
        node('E0', 'OT_EVT', { names: names('Start') }),
        node('F1', 'OT_FUNC', { names: names('Loop step') }),
        node('E1', 'OT_EVT', { names: names('Loop event') })
      ],
      [
        edge('e1', 'E0', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E1', 'CT_CRT_1'),
        edge('e3', 'E1', 'F1', 'CT_ACTIV_1')
      ]
    )
    const ruleIds = validateEpcGraph(g).map((f) => f.ruleId)
    expect(ruleIds).toContain('epc.startEnd.missingEnd')
    expect(ruleIds).not.toContain('epc.startEnd.unreachableEnd')
  })

  it('is skipped (no double-reporting) when the model has no start event', () => {
    // E1 is fed by F1 (so no event has in-degree 0), while E2 remains a real end event —
    // isolating the "zero start events" skip branch rather than the zero-end one.
    const g = graph(
      'M1',
      [
        node('E1', 'OT_EVT', { names: names('A') }),
        node('F1', 'OT_FUNC', { names: names('Work') }),
        node('E2', 'OT_EVT', { names: names('End') })
      ],
      [
        edge('e1', 'E1', 'F1', 'CT_ACTIV_1'),
        edge('e2', 'F1', 'E1', 'CT_CRT_1'),
        edge('e3', 'F1', 'E2', 'CT_CRT_1')
      ]
    )
    const ruleIds = validateEpcGraph(g).map((f) => f.ruleId)
    expect(ruleIds).toContain('epc.startEnd.missingStart')
    expect(ruleIds).not.toContain('epc.startEnd.unreachableEnd')
  })
})
