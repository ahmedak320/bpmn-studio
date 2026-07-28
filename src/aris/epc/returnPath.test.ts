import { describe, expect, it } from 'vitest'
import { buildReturnPathApplyPayload, detectReturnPathOutcomes, rankCandidates } from './returnPath'
import { buildFlowGraphIndex } from './flowGraph'
import { normalizeArabic } from './arabicNormalize'
import { findReturnOutcomeMatches, isReturnOutcomeName } from './returnTerms'
import { edge, graph, names, node } from './testFixtures'

describe('bilingual return-outcome name matching (14.3.2)', () => {
  it('matches the English terms the plan names explicitly: return, returned, modify, rework', () => {
    expect(isReturnOutcomeName(names('Application Returned for modification'))).toBe(true)
    expect(isReturnOutcomeName(names('Return the file to the applicant'))).toBe(true)
    expect(isReturnOutcomeName(names('Modify the application details'))).toBe(true)
    expect(isReturnOutcomeName(names('Rework required'))).toBe(true)
  })

  it('matches Arabic return/rework/reject roots regardless of hamza/alef/diacritic spelling', () => {
    expect(isReturnOutcomeName(names(undefined, 'إرجاع الطلب'))).toBe(true) // hamza-under-alef
    expect(isReturnOutcomeName(names(undefined, 'ارجاع الطلب'))).toBe(true) // bare alef
    expect(isReturnOutcomeName(names(undefined, 'الإرجاع'))).toBe(true) // with definite article
    expect(isReturnOutcomeName(names(undefined, 'تَعْدِيل الطلب'))).toBe(true) // with full diacritics
    expect(isReturnOutcomeName(names(undefined, 'الطلب مرفوض'))).toBe(true) // rejected
  })

  it('does not match ordinary text with no return/rework/reject term', () => {
    expect(isReturnOutcomeName(names('Approve the application'))).toBe(false)
    expect(isReturnOutcomeName(names(undefined, 'الموافقة على الطلب'))).toBe(false)
  })

  it('normalizes teh-marbuta and does not mangle a short word starting with the definite-article letters', () => {
    expect(normalizeArabic('مرفوضة')).toContain(normalizeArabic('مرفوض'))
    // "ال" alone, or a word too short to safely strip, is left intact.
    expect(normalizeArabic('ال')).toBe('ال')
  })

  it('reports which concept and language matched', () => {
    const matches = findReturnOutcomeMatches(names('Application rejected'))
    expect(matches).toHaveLength(1)
    expect(matches[0].language).toBe('en')
    expect(matches[0].concept).toBe('reject')
  })
})

describe('detectReturnPathOutcomes — explicit route preserved (14.3 step 1)', () => {
  it('reports status "explicit" and proposes nothing when the outcome node already sits on a cycle', () => {
    // Mirrors the real AnimalWF "Owner Registration Renewal & Closure" shape: the return
    // event flows back into an XOR merge rule that re-enters the main flow.
    const g = graph(
      'M1',
      [
        node('Start', 'OT_EVT'),
        node('Review', 'OT_FUNC'),
        node('Rmerge', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('Returned', 'OT_EVT', { names: names('Application Returned for modification') }),
        node('End', 'OT_EVT')
      ],
      [
        edge('e0', 'Start', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e1', 'Rmerge', 'Review', 'CT_ACTIV_1'),
        edge('e2', 'Review', 'Returned', 'CT_CRT_1'),
        edge('e3', 'Returned', 'Rmerge', 'CT_IS_EVAL_BY_1'), // explicit back-edge
        edge('e4', 'Review', 'End', 'CT_CRT_1')
      ]
    )
    const results = detectReturnPathOutcomes(g)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('explicit')
    expect(results[0].outcomeNodeId).toBe('Returned')
    if (results[0].status === 'explicit') {
      expect(results[0].cycleNodeIds).toEqual(expect.arrayContaining(['Returned', 'Rmerge', 'Review']))
    }
  })
})

describe('detectReturnPathOutcomes — missing route candidate ranking (14.3 step 3)', () => {
  it('ranks the nearer upstream function ahead of a farther one', () => {
    // Start -> Near -> Far -> Returned (dead end). "Near" is the closer editable candidate.
    const g = graph(
      'M1',
      [
        node('Start', 'OT_EVT'),
        node('Near', 'OT_FUNC'),
        node('MidEvt', 'OT_EVT'),
        node('Far', 'OT_FUNC'),
        node('Returned', 'OT_EVT', { names: names('Application returned for amendments') })
      ],
      [
        edge('e1', 'Start', 'Near', 'CT_ACTIV_1'),
        edge('e2', 'Near', 'MidEvt', 'CT_CRT_1'),
        edge('e3', 'MidEvt', 'Far', 'CT_ACTIV_1'),
        edge('e4', 'Far', 'Returned', 'CT_CRT_1')
      ]
    )
    const results = detectReturnPathOutcomes(g)
    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.status).toBe('missing')
    if (result.status !== 'missing') throw new Error('unreachable')
    expect(result.candidates.map((c) => c.targetNodeId)).toEqual(['Far', 'Near'])
    expect(result.candidates[0].distance).toBeLessThan(result.candidates[1].distance)
    expect(result.recommendedTargetId).toBe('Far')
    expect(result.requiresManualSelection).toBe(false)
    expect(result.candidates.every((c) => c.dashed)).toBe(true)
  })

  it('prefers an existing merge/re-entry rule over a same-distance plain function', () => {
    // "Returned" has two direct (distance-1) OT_FUNC predecessors: "FnA" is a plain
    // function, "FnB" is fed by an existing XOR merge rule (Rmerge, indegree 2). Even
    // though both are 1 hop away, the merge-backed candidate must be ranked first and its
    // proposed target is the rule itself (reusing the established re-entry point).
    const g = graph(
      'M1',
      [
        node('S1', 'OT_EVT'),
        node('S2', 'OT_EVT'),
        node('Rmerge', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('FnB', 'OT_FUNC'),
        node('FnA', 'OT_FUNC'),
        node('Returned', 'OT_FUNC', { names: names('Fill in required modifications after rework') })
      ],
      [
        edge('e1', 'S1', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'S2', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e3', 'Rmerge', 'FnB', 'CT_ACTIV_1'),
        edge('e4', 'FnB', 'Returned', 'CT_CRT_1'),
        edge('e5', 'FnA', 'Returned', 'CT_CRT_1')
      ]
    )
    const index = buildFlowGraphIndex(g)
    const candidates = rankCandidates(index, 'Returned')
    expect(candidates.map((c) => c.distance)).toEqual([1, 1])
    expect(candidates[0].reason).toBe('existingMergeRule')
    expect(candidates[0].targetKind).toBe('mergeRule')
    expect(candidates[0].targetNodeId).toBe('Rmerge')
    expect(candidates[0].viaFunctionNodeId).toBe('FnB')
    expect(candidates[1].reason).toBe('nearestUpstreamFunction')
    expect(candidates[1].targetNodeId).toBe('FnA')
  })

  it('breaks a true distance+reason tie by requiring manual selection, never auto-picking', () => {
    // Two equally-distant plain function candidates, neither backed by a merge rule — a
    // genuine tie.
    const tieGraph = graph(
      'M2',
      [node('FnA', 'OT_FUNC'), node('FnB', 'OT_FUNC'), node('Returned', 'OT_EVT', { names: names('Returned for modification') })],
      [edge('e1', 'FnA', 'Returned', 'CT_CRT_1'), edge('e2', 'FnB', 'Returned', 'CT_CRT_1')]
    )
    const results = detectReturnPathOutcomes(tieGraph)
    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.status).toBe('missing')
    if (result.status !== 'missing') throw new Error('unreachable')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].distance).toBe(result.candidates[1].distance)
    expect(result.candidates[0].reason).toBe(result.candidates[1].reason)
    expect(result.recommendedTargetId).toBeNull()
    expect(result.requiresManualSelection).toBe(true)
  })
})

describe('buildReturnPathApplyPayload (14.3 step 4)', () => {
  it('assembles a definition + occurrence + route + audit entry as one payload, always dashed', () => {
    const tieGraph = graph(
      'M2',
      [node('FnA', 'OT_FUNC'), node('Returned', 'OT_EVT', { names: names('Returned for modification') })],
      [edge('e1', 'FnA', 'Returned', 'CT_CRT_1')]
    )
    const [result] = detectReturnPathOutcomes(tieGraph)
    if (result.status !== 'missing') throw new Error('expected a missing route')
    const [candidate] = result.candidates

    const payload = buildReturnPathApplyPayload({
      outcomeNodeId: result.outcomeNodeId,
      candidate,
      connectionDefinitionId: 'CxnDef.new1',
      connectionOccurrenceId: 'CxnOcc.new1',
      connectionType: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'ObjDef.returned',
      toObjectDefinitionId: 'ObjDef.fnA',
      modelId: 'M2',
      sourceOccurrenceId: 'Returned',
      targetOccurrenceId: 'FnA',
      confirmedBy: 'test-user',
      confirmedAt: '2026-07-29T00:00:00.000Z'
    })

    expect(payload.kind).toBe('returnPathApply')
    expect(payload.connectionDefinition.id).toBe('CxnDef.new1')
    expect(payload.connectionOccurrence.id).toBe('CxnOcc.new1')
    expect(payload.connectionOccurrence.lineStyle).toBe('dashed')
    expect(payload.audit.kind).toBe('return-path-applied')
    expect(payload.audit.confirmedBy).toBe('test-user')
    expect(payload.audit.targetNodeId).toBe(candidate.targetNodeId)
  })
})
