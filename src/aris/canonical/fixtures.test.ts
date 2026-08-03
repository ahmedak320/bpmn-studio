import { describe, expect, it } from 'vitest'

import { canonicalJsonText } from '../packages/canonicalJson'
import { parseCanonicalProcess, type CanonicalProcessV1 } from './contract'
import {
  INVALID_CANONICAL_CONDITIONAL_WITHOUT_CONDITION,
  INVALID_CANONICAL_DANGLING_EDGE_TARGET,
  INVALID_CANONICAL_DANGLING_FACT_ID,
  INVALID_CANONICAL_DANGLING_UNKNOWN_TARGET,
  INVALID_CANONICAL_DECISION_SINGLE_OUTCOME,
  INVALID_CANONICAL_DUPLICATE_ID,
  INVALID_CANONICAL_EMPTY_NAMES,
  INVALID_CANONICAL_MISSING_CONFIDENCE,
  INVALID_CANONICAL_SEQUENCE_FROM_DECISION,
  INVALID_CANONICAL_UNKNOWN_KEY,
  VALID_CANONICAL_FULL,
  VALID_CANONICAL_MINIMAL,
  VALID_CANONICAL_MISSING_ROLE,
  VALID_CANONICAL_RETURN_PATH
} from './fixtures'

// ---------------------------------------------------------------------------
// Graph helpers (test-local only — no dependency on any other lane's code).
// Control flow here is exactly what contract.ts itself considers control
// flow out of a node: edges[] (sourceNodeId -> targetNodeId) PLUS a
// decision node's outcomes (decision.nodeId -> outcome.targetNodeId).
// ---------------------------------------------------------------------------

function buildOutgoingMap(process: CanonicalProcessV1): ReadonlyMap<string, readonly string[]> {
  const outgoing = new Map<string, string[]>()
  const push = (from: string, to: string): void => {
    const bucket = outgoing.get(from)
    if (bucket) {
      bucket.push(to)
    } else {
      outgoing.set(from, [to])
    }
  }
  for (const edge of process.edges) push(edge.sourceNodeId, edge.targetNodeId)
  for (const decision of process.decisions) {
    for (const outcome of decision.outcomes) push(decision.nodeId, outcome.targetNodeId)
  }
  return outgoing
}

/** Every node reachable from `start` via 1+ hops (does NOT trivially include `start`). */
function reachableFrom(
  outgoing: ReadonlyMap<string, readonly string[]>,
  start: string
): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = [...(outgoing.get(start) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined || visited.has(next)) continue
    visited.add(next)
    for (const target of outgoing.get(next) ?? []) queue.push(target)
  }
  return visited
}

function allConfidenceValues(process: CanonicalProcessV1): Set<string> {
  const values = new Set<string>()
  values.add(process.identity.confidence)
  for (const node of process.nodes) values.add(node.confidence)
  for (const decision of process.decisions) values.add(decision.confidence)
  for (const edge of process.edges) values.add(edge.confidence)
  for (const role of process.roles) values.add(role.confidence)
  for (const system of process.systems) values.add(system.confidence)
  for (const info of process.informationObjects) values.add(info.confidence)
  for (const control of process.controls) values.add(control.confidence)
  for (const fact of process.facts) values.add(fact.confidence)
  return values
}

function bothLocalesPresent(text: { readonly en?: string; readonly ar?: string }): boolean {
  return (
    typeof text.en === 'string' &&
    text.en.length > 0 &&
    typeof text.ar === 'string' &&
    text.ar.length > 0
  )
}

// ---------------------------------------------------------------------------
// Valid fixtures parse ok
// ---------------------------------------------------------------------------

const VALID_FIXTURE_CASES: ReadonlyArray<{
  readonly label: string
  readonly fixture: CanonicalProcessV1
}> = [
  { label: 'VALID_CANONICAL_MINIMAL', fixture: VALID_CANONICAL_MINIMAL },
  { label: 'VALID_CANONICAL_FULL', fixture: VALID_CANONICAL_FULL },
  { label: 'VALID_CANONICAL_RETURN_PATH', fixture: VALID_CANONICAL_RETURN_PATH },
  { label: 'VALID_CANONICAL_MISSING_ROLE', fixture: VALID_CANONICAL_MISSING_ROLE }
]

describe('valid canonical fixtures parse ok', () => {
  it.each(VALID_FIXTURE_CASES)('$label parses with ok:true and no issues', ({ fixture }) => {
    const result = parseCanonicalProcess(fixture)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      // Surfaces the actual rejection reason in the failure output instead of
      // just "expected true to be false" — a contract disagreement would show
      // up here as one of these issues, not as a silent false failure.
      expect(result.issues).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_MINIMAL — structural coverage
// ---------------------------------------------------------------------------

describe('VALID_CANONICAL_MINIMAL structural coverage', () => {
  it('is start event -> activity -> end event with one role, 2 facts, 1 unknown', () => {
    const process = VALID_CANONICAL_MINIMAL
    expect(process.nodes.map((node) => node.kind)).toEqual(['event', 'activity', 'event'])
    expect(process.roles).toHaveLength(1)
    expect(process.facts).toHaveLength(2)
    expect(process.unknowns).toHaveLength(1)
  })

  it('is bilingual (en+ar) on identity, every node, and the role', () => {
    const process = VALID_CANONICAL_MINIMAL
    expect(bothLocalesPresent(process.identity.names)).toBe(true)
    for (const node of process.nodes) expect(bothLocalesPresent(node.names)).toBe(true)
    for (const role of process.roles) expect(bothLocalesPresent(role.names)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_FULL — structural coverage (every kind + composition counts)
// ---------------------------------------------------------------------------

describe('VALID_CANONICAL_FULL structural coverage', () => {
  it('exercises every CanonicalNodeKind with the required counts', () => {
    const kinds = VALID_CANONICAL_FULL.nodes.map((node) => node.kind)
    expect(kinds.filter((kind) => kind === 'event').length).toBeGreaterThanOrEqual(1)
    expect(kinds.filter((kind) => kind === 'activity')).toHaveLength(3)
    expect(kinds.filter((kind) => kind === 'decision')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'wait')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'handoff')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'exception')).toHaveLength(1)
  })

  it('has exactly 1 decision with a criteria and 2 bilingual labeled outcomes', () => {
    expect(VALID_CANONICAL_FULL.decisions).toHaveLength(1)
    const decision = VALID_CANONICAL_FULL.decisions[0]
    expect(decision.criteria).toBeDefined()
    expect(decision.outcomes).toHaveLength(2)
    for (const outcome of decision.outcomes) expect(bothLocalesPresent(outcome.names)).toBe(true)
  })

  it('has a parallel fan-out from one node and a parallel fan-in to one node', () => {
    const parallelEdges = VALID_CANONICAL_FULL.edges.filter((edge) => edge.kind === 'parallel')
    expect(parallelEdges).toHaveLength(4)
    const bySource = new Map<string, number>()
    const byTarget = new Map<string, number>()
    for (const edge of parallelEdges) {
      bySource.set(edge.sourceNodeId, (bySource.get(edge.sourceNodeId) ?? 0) + 1)
      byTarget.set(edge.targetNodeId, (byTarget.get(edge.targetNodeId) ?? 0) + 1)
    }
    // Fan-out: exactly one source node has >=2 outgoing parallel edges.
    expect([...bySource.values()].filter((count) => count >= 2)).toHaveLength(1)
    // Fan-in: exactly one target node has >=2 incoming parallel edges.
    expect([...byTarget.values()].filter((count) => count >= 2)).toHaveLength(1)
  })

  it('has exactly 1 wait node with a waitDetail', () => {
    const waitNodes = VALID_CANONICAL_FULL.nodes.filter((node) => node.kind === 'wait')
    expect(waitNodes).toHaveLength(1)
    expect(waitNodes[0].waitDetail).toBeDefined()
  })

  it('has exactly 1 handoff node with a targetProcessRef', () => {
    const handoffNodes = VALID_CANONICAL_FULL.nodes.filter((node) => node.kind === 'handoff')
    expect(handoffNodes).toHaveLength(1)
    expect(handoffNodes[0].targetProcessRef).toBe('proc-vendor-escalation-v1')
  })

  it('has exactly 1 exception node with an exception-route edge to an event node', () => {
    const exceptionNodes = VALID_CANONICAL_FULL.nodes.filter((node) => node.kind === 'exception')
    expect(exceptionNodes).toHaveLength(1)
    const exceptionRouteEdges = VALID_CANONICAL_FULL.edges.filter(
      (edge) => edge.kind === 'exception-route'
    )
    expect(exceptionRouteEdges).toHaveLength(1)
    const [routeEdge] = exceptionRouteEdges
    expect(routeEdge.sourceNodeId).toBe(exceptionNodes[0].id)
    const targetNode = VALID_CANONICAL_FULL.nodes.find((node) => node.id === routeEdge.targetNodeId)
    expect(targetNode?.kind).toBe('event')
  })

  it('has 2 roles, one owner:true with a unit', () => {
    expect(VALID_CANONICAL_FULL.roles).toHaveLength(2)
    const owners = VALID_CANONICAL_FULL.roles.filter((role) => role.owner === true)
    expect(owners).toHaveLength(1)
    expect(owners[0].unit).toBeDefined()
  })

  it('has 2 systems, 2 information objects (one input-only, one output-only), 2 controls', () => {
    expect(VALID_CANONICAL_FULL.systems).toHaveLength(2)
    expect(VALID_CANONICAL_FULL.informationObjects).toHaveLength(2)
    const inputOnly = VALID_CANONICAL_FULL.informationObjects.filter(
      (info) => info.inputToNodeIds.length > 0 && info.outputOfNodeIds.length === 0
    )
    const outputOnly = VALID_CANONICAL_FULL.informationObjects.filter(
      (info) => info.outputOfNodeIds.length > 0 && info.inputToNodeIds.length === 0
    )
    expect(inputOnly).toHaveLength(1)
    expect(outputOnly).toHaveLength(1)
    expect(VALID_CANONICAL_FULL.controls).toHaveLength(2)
    expect(VALID_CANONICAL_FULL.controls.map((control) => control.kind).sort()).toEqual([
      'business-rule',
      'policy'
    ])
  })

  it('has >=6 facts each with a non-empty evidenceRefs, and >=2 unknowns', () => {
    expect(VALID_CANONICAL_FULL.facts.length).toBeGreaterThanOrEqual(6)
    for (const fact of VALID_CANONICAL_FULL.facts) {
      expect(fact.evidenceRefs.length).toBeGreaterThan(0)
    }
    expect(VALID_CANONICAL_FULL.unknowns.length).toBeGreaterThanOrEqual(2)
  })

  it('uses mixed confidence values across entities', () => {
    const values = allConfidenceValues(VALID_CANONICAL_FULL)
    expect(values).toEqual(new Set(['high', 'medium', 'low']))
  })

  it('is bilingual (en+ar) throughout: identity, every node, decision, outcome, role, system, information object, control, and fact', () => {
    const process = VALID_CANONICAL_FULL
    expect(bothLocalesPresent(process.identity.names)).toBe(true)
    expect(process.identity.purpose && bothLocalesPresent(process.identity.purpose)).toBe(true)
    for (const node of process.nodes) expect(bothLocalesPresent(node.names)).toBe(true)
    for (const decision of process.decisions) {
      expect(decision.criteria && bothLocalesPresent(decision.criteria)).toBe(true)
      for (const outcome of decision.outcomes) expect(bothLocalesPresent(outcome.names)).toBe(true)
    }
    for (const role of process.roles) expect(bothLocalesPresent(role.names)).toBe(true)
    for (const system of process.systems) expect(bothLocalesPresent(system.names)).toBe(true)
    for (const info of process.informationObjects) expect(bothLocalesPresent(info.names)).toBe(true)
    for (const control of process.controls) expect(bothLocalesPresent(control.names)).toBe(true)
    for (const fact of process.facts) expect(bothLocalesPresent(fact.statement)).toBe(true)
    for (const unknown of process.unknowns) expect(bothLocalesPresent(unknown.message)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_RETURN_PATH — genuinely has a cycle AND a reachable end
// ---------------------------------------------------------------------------

describe('VALID_CANONICAL_RETURN_PATH structural coverage', () => {
  it('has a return edge that closes a real cycle back through n-review', () => {
    const outgoing = buildOutgoingMap(VALID_CANONICAL_RETURN_PATH)
    const fromReview = reachableFrom(outgoing, 'n-review')
    // n-review is reachable FROM ITSELF (review -> decide -> [rework outcome] ->
    // rework -> review, the return edge) — the formal signature of a cycle.
    expect(fromReview.has('n-review')).toBe(true)
    expect(fromReview.has('n-rework')).toBe(true)
  })

  it('still reaches the end event from the start despite the loop', () => {
    const outgoing = buildOutgoingMap(VALID_CANONICAL_RETURN_PATH)
    const fromStart = reachableFrom(outgoing, 'n-start')
    expect(fromStart.has('n-end')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// VALID_CANONICAL_MISSING_ROLE — gap is an unknown, not a hard error
// ---------------------------------------------------------------------------

describe('VALID_CANONICAL_MISSING_ROLE structural coverage', () => {
  it('declares zero roles and surfaces the gap as a missing-field unknown', () => {
    const process = VALID_CANONICAL_MISSING_ROLE
    expect(process.roles).toHaveLength(0)
    const activity = process.nodes.find((node) => node.kind === 'activity')
    expect(activity).toBeDefined()
    const roleUnknown = process.unknowns.find(
      (unknown) => unknown.targetId === activity?.id && unknown.field === 'role'
    )
    expect(roleUnknown).toBeDefined()
    expect(roleUnknown?.kind).toBe('missing-field')
  })
})

// ---------------------------------------------------------------------------
// Invalid fixtures each fail for their ONE intended reason
// ---------------------------------------------------------------------------

const INVALID_FIXTURE_CASES: ReadonlyArray<{
  readonly label: string
  readonly fixture: unknown
  readonly expectedCode: string
  readonly expectedPath: readonly (string | number)[]
}> = [
  {
    label: 'INVALID_CANONICAL_UNKNOWN_KEY',
    fixture: INVALID_CANONICAL_UNKNOWN_KEY,
    expectedCode: 'unrecognized_keys',
    expectedPath: []
  },
  {
    label: 'INVALID_CANONICAL_MISSING_CONFIDENCE',
    fixture: INVALID_CANONICAL_MISSING_CONFIDENCE,
    expectedCode: 'invalid_value',
    expectedPath: ['nodes', 0, 'confidence']
  },
  {
    label: 'INVALID_CANONICAL_DANGLING_EDGE_TARGET',
    fixture: INVALID_CANONICAL_DANGLING_EDGE_TARGET,
    expectedCode: 'dangling-node-reference',
    expectedPath: ['edges', 0, 'targetNodeId']
  },
  {
    label: 'INVALID_CANONICAL_DUPLICATE_ID',
    fixture: INVALID_CANONICAL_DUPLICATE_ID,
    expectedCode: 'duplicate-id',
    expectedPath: ['facts', 0, 'id']
  },
  {
    label: 'INVALID_CANONICAL_EMPTY_NAMES',
    fixture: INVALID_CANONICAL_EMPTY_NAMES,
    expectedCode: 'canonical-text-empty',
    expectedPath: ['nodes', 0, 'names']
  },
  {
    label: 'INVALID_CANONICAL_CONDITIONAL_WITHOUT_CONDITION',
    fixture: INVALID_CANONICAL_CONDITIONAL_WITHOUT_CONDITION,
    expectedCode: 'edge-condition-required',
    expectedPath: ['edges', 0, 'condition']
  },
  {
    label: 'INVALID_CANONICAL_SEQUENCE_FROM_DECISION',
    fixture: INVALID_CANONICAL_SEQUENCE_FROM_DECISION,
    expectedCode: 'decision-node-sequence-edge',
    expectedPath: ['edges', 0, 'kind']
  },
  {
    label: 'INVALID_CANONICAL_DECISION_SINGLE_OUTCOME',
    fixture: INVALID_CANONICAL_DECISION_SINGLE_OUTCOME,
    expectedCode: 'too_small',
    expectedPath: ['decisions', 0, 'outcomes']
  },
  {
    label: 'INVALID_CANONICAL_DANGLING_FACT_ID',
    fixture: INVALID_CANONICAL_DANGLING_FACT_ID,
    expectedCode: 'dangling-fact-reference',
    expectedPath: ['nodes', 0, 'factIds', 0]
  },
  {
    label: 'INVALID_CANONICAL_DANGLING_UNKNOWN_TARGET',
    fixture: INVALID_CANONICAL_DANGLING_UNKNOWN_TARGET,
    expectedCode: 'dangling-unknown-target',
    expectedPath: ['unknowns', 0, 'targetId']
  }
]

describe('invalid canonical fixtures fail for their one intended reason', () => {
  it('covers exactly 10 intent-labeled invalid fixtures', () => {
    expect(INVALID_FIXTURE_CASES).toHaveLength(10)
  })

  it.each(INVALID_FIXTURE_CASES)(
    '$label fails with code "$expectedCode" at the intended path, and ONLY that issue',
    ({ fixture, expectedCode, expectedPath }) => {
      const result = parseCanonicalProcess(fixture)
      expect(result.ok).toBe(false)
      if (result.ok) return
      // The reason, not merely "it failed": exactly one issue, with the
      // intended code AND the intended path — proves no other rule tripped
      // first (and none tripped alongside it).
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].code).toBe(expectedCode)
      expect(result.issues[0].path).toEqual(expectedPath)
    }
  )
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('canonicalJsonText determinism', () => {
  it('is byte-identical across two direct serializations of VALID_CANONICAL_FULL', () => {
    const first = canonicalJsonText(VALID_CANONICAL_FULL)
    const second = canonicalJsonText(VALID_CANONICAL_FULL)
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it('is byte-identical across two independent parses of VALID_CANONICAL_FULL', () => {
    const first = parseCanonicalProcess(VALID_CANONICAL_FULL)
    const second = parseCanonicalProcess(VALID_CANONICAL_FULL)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(canonicalJsonText(first.process)).toBe(canonicalJsonText(second.process))
  })
})
