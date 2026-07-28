import { describe, expect, it } from 'vitest'
import { validateEpcGraph } from './validate'
import { classifyRules } from './xor'
import { detectReturnPathOutcomes, buildReturnPathApplyPayload, rankCandidates } from './returnPath'
import { buildFlowGraphIndex, connectedComponents, stronglyConnectedComponents, upstreamDistances } from './flowGraph'
import { toEpcGraph } from './adapter'
import { edge, graph, names, node } from './testFixtures'

/**
 * No function in `src/aris/epc` may mutate its input graph (or any node/edge inside it).
 * `testFixtures.ts` deep-freezes every graph it builds, so any attempted mutation — a
 * property write, an array push, a Map set on a frozen structure — throws a TypeError in
 * strict-mode ESM. These tests call every public entry point against a frozen input and
 * additionally compare a structural snapshot before/after to catch any mutation that would
 * not throw (e.g. mutating a plain nested object the freeze helper did not reach).
 */
describe('immutability guarantee: no function in src/aris/epc mutates its input', () => {
  function buildFrozenSampleGraph() {
    return graph(
      'M1',
      [
        node('S1', 'OT_EVT'),
        node('S2', 'OT_EVT'),
        node('Rmerge', 'OT_RULE', { symbolType: 'ST_OPR_XOR_1' }),
        node('Review', 'OT_FUNC', { linkedModelIds: ['Model.child'] }),
        node('Returned', 'OT_EVT', { names: names('Application Returned for modification', 'إرجاع الطلب') }),
        node('End', 'OT_EVT')
      ],
      [
        edge('e1', 'S1', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e2', 'S2', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e3', 'Rmerge', 'Review', 'CT_ACTIV_1'),
        edge('e4', 'Review', 'Returned', 'CT_CRT_1'),
        edge('e5', 'Returned', 'Rmerge', 'CT_IS_EVAL_BY_1'),
        edge('e6', 'Review', 'End', 'CT_CRT_1')
      ]
    )
  }

  it('graph fixtures are actually frozen (sanity check for the rest of this suite)', () => {
    const g = buildFrozenSampleGraph()
    expect(Object.isFrozen(g)).toBe(true)
    expect(Object.isFrozen(g.nodes)).toBe(true)
    expect(Object.isFrozen(g.edges)).toBe(true)
    expect(Object.isFrozen(g.nodes[0])).toBe(true)
    expect(() => {
      ;(g as { modelId: string }).modelId = 'tampered'
    }).toThrow(TypeError)
  })

  it('validateEpcGraph does not mutate its input', () => {
    const g = buildFrozenSampleGraph()
    const snapshot = JSON.stringify(g, replacer)
    validateEpcGraph(g, { knownModelIds: new Set(['Model.child']) })
    expect(JSON.stringify(g, replacer)).toBe(snapshot)
  })

  it('classifyRules does not mutate its input', () => {
    const g = buildFrozenSampleGraph()
    const snapshot = JSON.stringify(g, replacer)
    classifyRules(g)
    expect(JSON.stringify(g, replacer)).toBe(snapshot)
  })

  it('detectReturnPathOutcomes and rankCandidates do not mutate their input', () => {
    const g = buildFrozenSampleGraph()
    const snapshot = JSON.stringify(g, replacer)
    detectReturnPathOutcomes(g)
    const index = buildFlowGraphIndex(g)
    rankCandidates(index, 'Returned')
    expect(JSON.stringify(g, replacer)).toBe(snapshot)
  })

  it('flowGraph utilities do not mutate their input', () => {
    const g = buildFrozenSampleGraph()
    const snapshot = JSON.stringify(g, replacer)
    const index = buildFlowGraphIndex(g)
    stronglyConnectedComponents(index)
    connectedComponents(index)
    upstreamDistances(index, 'Returned')
    expect(JSON.stringify(g, replacer)).toBe(snapshot)
  })

  it('buildReturnPathApplyPayload does not mutate the candidate it is given', () => {
    const g = buildFrozenSampleGraph()
    const index = buildFlowGraphIndex(g)
    const candidates = rankCandidates(index, 'Returned')
    // Use a graph with a genuinely missing route so we have a real candidate to freeze.
    const missingGraph = graph('M2', [node('FnA', 'OT_FUNC'), node('Returned', 'OT_EVT', { names: names('Returned for modification') })], [
      edge('e1', 'FnA', 'Returned', 'CT_CRT_1')
    ])
    const [result] = detectReturnPathOutcomes(missingGraph)
    if (result.status !== 'missing') throw new Error('expected missing route in fixture')
    const candidate = result.candidates[0]
    const candidateSnapshot = JSON.stringify(candidate)
    buildReturnPathApplyPayload({
      outcomeNodeId: result.outcomeNodeId,
      candidate,
      connectionDefinitionId: 'CxnDef.new',
      connectionOccurrenceId: 'CxnOcc.new',
      connectionType: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'ObjDef.a',
      toObjectDefinitionId: 'ObjDef.b',
      modelId: 'M2',
      sourceOccurrenceId: 'Returned',
      targetOccurrenceId: 'FnA',
      confirmedBy: 'tester',
      confirmedAt: '2026-07-29T00:00:00.000Z'
    })
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot)
    expect(candidates.length).toBeGreaterThanOrEqual(0) // keep `candidates` referenced/used
  })

  it('toEpcGraph (the adapter seam) does not mutate its structural input', () => {
    const objectDefinitionById = new Map([
      ['Def.evt1', { id: 'Def.evt1', type: 'OT_EVT', names: { values: Object.freeze({ en: 'Start' }) } }],
      ['Def.func1', { id: 'Def.func1', type: 'OT_FUNC', names: { values: Object.freeze({ en: 'Do work' }) }, linkedModelIds: Object.freeze(['Model.x']) }]
    ])
    const connectionDefinitionById = new Map([['CxnDef.1', { id: 'CxnDef.1', type: 'CT_ACTIV_1' }]])
    const input = Object.freeze({
      modelId: 'M1',
      objectOccurrences: Object.freeze([
        Object.freeze({ id: 'Occ.evt1', definitionId: 'Def.evt1', symbol: 'ST_EV' }),
        Object.freeze({ id: 'Occ.func1', definitionId: 'Def.func1', symbol: 'ST_FUNC' })
      ]),
      objectDefinitionById,
      connectionOccurrences: Object.freeze([Object.freeze({ id: 'Occ.cxn1', definitionId: 'CxnDef.1', sourceOccurrenceId: 'Occ.evt1', targetOccurrenceId: 'Occ.func1' })]),
      connectionDefinitionById
    })
    const before = JSON.stringify({
      modelId: input.modelId,
      occ: input.objectOccurrences,
      defs: [...objectDefinitionById.entries()],
      cxnOcc: input.connectionOccurrences,
      cxnDefs: [...connectionDefinitionById.entries()]
    })
    const result = toEpcGraph(input)
    const after = JSON.stringify({
      modelId: input.modelId,
      occ: input.objectOccurrences,
      defs: [...objectDefinitionById.entries()],
      cxnOcc: input.connectionOccurrences,
      cxnDefs: [...connectionDefinitionById.entries()]
    })
    expect(after).toBe(before)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
  })
})

/** Stable-ish JSON replacer: Maps aren't relevant here, but keep this local and simple. */
function replacer(_key: string, value: unknown): unknown {
  return value
}
