import { describe, expect, it, vi } from 'vitest'

import { canonicalJsonText } from '../packages/canonicalJson'
import {
  CANONICAL_SCHEMA_VERSION,
  CanonicalProcessV1Schema,
  parseCanonicalProcess,
  type CanonicalProcessV1
} from './contract'

/**
 * A minimal-but-complete, hand-built valid process reused as the baseline for
 * every negative test below (each test mutates exactly one thing away from
 * this baseline, matching the master-plan fixture rule: "every invalid
 * example fails for the intended reason"). Deliberately NOT imported from
 * `fixtures.ts` — that module belongs to a different, sibling lane (L-FIXTURES)
 * and must not be a dependency of this lane's tests.
 */
function buildValidProcess(): CanonicalProcessV1 {
  return {
    version: 1,
    identity: {
      id: 'proc-1',
      names: { en: 'Purchase to Pay', ar: 'من الشراء إلى الدفع' },
      purpose: { en: 'Ensure goods are paid for correctly.' },
      code: 'P2P',
      processVersion: 'v001',
      confidence: 'high'
    },
    nodes: [
      { id: 'n-start', kind: 'event', names: { en: 'Request received' }, confidence: 'high' },
      {
        id: 'n-review',
        kind: 'activity',
        names: { en: 'Review request' },
        factIds: ['f-1'],
        confidence: 'high'
      },
      { id: 'n-decide', kind: 'decision', names: { en: 'Approve?' }, confidence: 'high' },
      { id: 'n-approved', kind: 'event', names: { en: 'Approved' }, confidence: 'high' },
      { id: 'n-rejected', kind: 'event', names: { en: 'Rejected' }, confidence: 'high' },
      { id: 'n-end', kind: 'event', names: { en: 'Request closed' }, confidence: 'high' }
    ],
    decisions: [
      {
        id: 'd-approve',
        nodeId: 'n-decide',
        criteria: { en: 'Amount under threshold' },
        outcomes: [
          { id: 'o-approved', names: { en: 'Approved' }, targetNodeId: 'n-approved' },
          { id: 'o-rejected', names: { en: 'Rejected' }, targetNodeId: 'n-rejected' }
        ],
        confidence: 'high'
      }
    ],
    edges: [
      {
        id: 'e-1',
        kind: 'sequence',
        sourceNodeId: 'n-start',
        targetNodeId: 'n-review',
        confidence: 'high'
      },
      {
        id: 'e-2',
        kind: 'sequence',
        sourceNodeId: 'n-review',
        targetNodeId: 'n-decide',
        confidence: 'high'
      },
      {
        id: 'e-3',
        kind: 'sequence',
        sourceNodeId: 'n-approved',
        targetNodeId: 'n-end',
        confidence: 'high'
      },
      {
        id: 'e-4',
        kind: 'sequence',
        sourceNodeId: 'n-rejected',
        targetNodeId: 'n-end',
        confidence: 'high'
      }
    ],
    roles: [
      {
        id: 'r-clerk',
        names: { en: 'Clerk' },
        nodeIds: ['n-review'],
        owner: true,
        factIds: ['f-2'],
        confidence: 'high'
      }
    ],
    systems: [{ id: 's-erp', names: { en: 'ERP' }, nodeIds: ['n-review'], confidence: 'medium' }],
    informationObjects: [
      {
        id: 'io-request',
        names: { en: 'Request form' },
        inputToNodeIds: ['n-review'],
        outputOfNodeIds: ['n-start'],
        confidence: 'medium'
      }
    ],
    controls: [
      {
        id: 'c-policy',
        names: { en: 'Approval policy' },
        kind: 'policy',
        nodeIds: ['n-decide'],
        confidence: 'high'
      }
    ],
    facts: [
      {
        id: 'f-1',
        statement: { en: 'Observed in source doc page 2' },
        evidenceRefs: ['ev-1'],
        confidence: 'high'
      },
      {
        id: 'f-2',
        statement: { en: 'Confirmed by SME' },
        evidenceRefs: ['ev-2'],
        confidence: 'medium'
      }
    ],
    unknowns: [
      { targetId: 'n-review', kind: 'missing-translation', message: { en: 'No Arabic name found' } }
    ]
  }
}

function firstIssue(result: ReturnType<typeof parseCanonicalProcess>, code: string) {
  if (result.ok) return undefined
  return result.issues.find((issue) => issue.code === code)
}

describe('CANONICAL_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(CANONICAL_SCHEMA_VERSION).toBe(1)
  })
})

describe('parseCanonicalProcess — valid input', () => {
  it('parses the hand-built baseline process', () => {
    const result = parseCanonicalProcess(buildValidProcess())
    expect(result.ok).toBe(true)
  })

  it('accepts a minimal process with empty optional collections', () => {
    const process = buildValidProcess()
    const minimal: CanonicalProcessV1 = {
      version: 1,
      identity: process.identity,
      nodes: [process.nodes[0]],
      decisions: [],
      edges: [],
      roles: [],
      systems: [],
      informationObjects: [],
      controls: [],
      facts: [],
      unknowns: []
    }
    const result = parseCanonicalProcess(minimal)
    expect(result.ok).toBe(true)
  })

  it('never throws for arbitrary garbage input', () => {
    expect(() => parseCanonicalProcess(null)).not.toThrow()
    expect(() => parseCanonicalProcess(undefined)).not.toThrow()
    expect(() => parseCanonicalProcess(42)).not.toThrow()
    expect(() => parseCanonicalProcess('nope')).not.toThrow()
    expect(() => parseCanonicalProcess([])).not.toThrow()
    expect(() => parseCanonicalProcess({})).not.toThrow()
    expect(parseCanonicalProcess(null).ok).toBe(false)
  })

  it('never throws even for deeply malformed input (wrong types on required fields)', () => {
    expect(() =>
      parseCanonicalProcess({
        version: 1,
        identity: {},
        nodes: 'not-an-array',
        decisions: [{ id: 'd', outcomes: [] }],
        edges: null,
        roles: [],
        systems: [],
        informationObjects: [],
        controls: [],
        facts: [],
        unknowns: [{ targetId: 123 }]
      })
    ).not.toThrow()
  })

  it('produces canonicalJsonText-identical output across two parses of equivalent input', () => {
    const first = parseCanonicalProcess(buildValidProcess())
    const second = parseCanonicalProcess(buildValidProcess())
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(canonicalJsonText(first.process)).toBe(canonicalJsonText(second.process))
  })
})

describe('parseCanonicalProcess — internal error safety net', () => {
  it('returns ok:false with an internal-error code if the schema throws an Error instance', () => {
    const spy = vi.spyOn(CanonicalProcessV1Schema, 'safeParse').mockImplementationOnce(() => {
      throw new Error('boom')
    })
    try {
      const result = parseCanonicalProcess(buildValidProcess())
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.issues).toEqual([{ code: 'internal-error', path: [], message: 'boom' }])
    } finally {
      spy.mockRestore()
    }
  })

  it('returns ok:false with a generic message if the schema throws a non-Error value', () => {
    const spy = vi.spyOn(CanonicalProcessV1Schema, 'safeParse').mockImplementationOnce(() => {
      throw 'boom-string'
    })
    try {
      const result = parseCanonicalProcess(buildValidProcess())
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.issues).toEqual([
        {
          code: 'internal-error',
          path: [],
          message: 'Unknown error while parsing CanonicalProcessV1.'
        }
      ])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('parseCanonicalProcess — shape rejections (native zod)', () => {
  it('rejects an unknown top-level key', () => {
    const process = buildValidProcess()
    const result = parseCanonicalProcess({ ...process, extra: 'sneaky' })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown key nested inside a node', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: process.nodes.map((node) =>
        node.id === 'n-start' ? { ...node, extra: 'sneaky' } : node
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown key nested inside a CanonicalText (names)', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      identity: { ...process.identity, names: { en: 'x', fr: 'sneaky' } }
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
  })

  it('rejects a node missing confidence', () => {
    const process = buildValidProcess()
    const { confidence: _confidence, ...withoutConfidence } = process.nodes[0]
    const result = parseCanonicalProcess({
      ...process,
      nodes: [withoutConfidence, ...process.nodes.slice(1)]
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a confidence value outside the high/medium/low union', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: process.nodes.map((node) =>
        node.id === 'n-start' ? { ...node, confidence: 'extreme' } : node
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
  })

  it('rejects a decision with only 1 outcome', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      decisions: process.decisions.map((decision) => ({
        ...decision,
        outcomes: [decision.outcomes[0]]
      }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
  })

  it('rejects the wrong version literal', () => {
    const process = buildValidProcess()
    const result = parseCanonicalProcess({ ...process, version: 2 })
    expect(result.ok).toBe(false)
  })
})

describe('CanonicalTextSchema — canonical-text-empty', () => {
  it('flags a CanonicalText with neither en nor ar', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: process.nodes.map((node) => (node.id === 'n-start' ? { ...node, names: {} } : node))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'canonical-text-empty')
    expect(issue?.path).toEqual(['nodes', 0, 'names'])
  })

  it('accepts a CanonicalText with only ar populated', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: process.nodes.map((node) =>
        node.id === 'n-start' ? { ...node, names: { ar: 'بداية' } } : node
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(true)
  })
})

describe('cross-reference refinement: duplicate-id', () => {
  it('flags an id shared across two different entity arrays', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      systems: process.systems.map((system) => ({ ...system, id: process.roles[0].id }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'duplicate-id')
    expect(issue?.path).toEqual(['systems', 0, 'id'])
  })

  it('flags every occurrence beyond the first when an id is reused 3 times', () => {
    const process = buildValidProcess()
    const sharedId = process.nodes[0].id
    const mutated = {
      ...process,
      systems: process.systems.map((system) => ({ ...system, id: sharedId })),
      controls: process.controls.map((control) => ({ ...control, id: sharedId }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const duplicateIssues = result.issues.filter((issue) => issue.code === 'duplicate-id')
    expect(duplicateIssues).toHaveLength(2)
  })

  it('flags two decision outcomes that share an id (outcome ids are in the namespace)', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      decisions: process.decisions.map((decision) => ({
        ...decision,
        outcomes: decision.outcomes.map((outcome) => ({ ...outcome, id: 'o-same' }))
      }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'duplicate-id')
    // The SECOND occurrence is reported, at the outcome's own id path.
    expect(issue?.path).toEqual(['decisions', 0, 'outcomes', 1, 'id'])
  })

  it('flags an outcome id that collides with a top-level entity id', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      decisions: process.decisions.map((decision) => ({
        ...decision,
        outcomes: decision.outcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, id: process.nodes[0].id } : outcome
        )
      }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'duplicate-id')
    expect(issue?.path).toEqual(['decisions', 0, 'outcomes', 0, 'id'])
  })
})

describe('field shape: declared ids must match the safe alphabet', () => {
  it('accepts the baseline (all declared ids already safe)', () => {
    expect(parseCanonicalProcess(buildValidProcess()).ok).toBe(true)
  })

  it('rejects an unsafe identity.id (contains ":")', () => {
    const process = buildValidProcess()
    const result = parseCanonicalProcess({
      ...process,
      identity: { ...process.identity, id: 'proc:bad' }
    })
    expect(result.ok).toBe(false)
    const issue = result.ok
      ? undefined
      : result.issues.find((i) => i.path.join('.') === 'identity.id')
    expect(issue).toBeDefined()
  })

  it('rejects unsafe declared node ids (space, slash, colon, hash)', () => {
    for (const badId of ['n bad', 'n/bad', 'n:bad', 'n#bad']) {
      const process = buildValidProcess()
      const mutated = {
        ...process,
        nodes: process.nodes.map((node) => (node.id === 'n-end' ? { ...node, id: badId } : node))
      }
      expect(parseCanonicalProcess(mutated).ok).toBe(false)
    }
  })

  it('rejects an unsafe targetProcessRef (it becomes the m:<ref> draft id)', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: [
        ...process.nodes,
        {
          id: 'n-handoff',
          kind: 'handoff',
          names: { en: 'Handoff' },
          targetProcessRef: 'other:proc',
          confidence: 'high'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = result.ok
      ? undefined
      : result.issues.find((i) => i.path.join('.') === 'nodes.6.targetProcessRef')
    expect(issue).toBeDefined()
  })
})

describe('cross-reference refinement: dangling-node-reference', () => {
  it('flags a dangling edges[*].targetNodeId', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      edges: process.edges.map((edge) =>
        edge.id === 'e-1' ? { ...edge, targetNodeId: 'missing-node' } : edge
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-node-reference')
    expect(issue?.path).toEqual(['edges', 0, 'targetNodeId'])
  })

  it('flags a dangling decisions[*].outcomes[*].targetNodeId', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      decisions: process.decisions.map((decision) => ({
        ...decision,
        outcomes: decision.outcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, targetNodeId: 'missing-node' } : outcome
        )
      }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-node-reference')
    expect(issue?.path).toEqual(['decisions', 0, 'outcomes', 0, 'targetNodeId'])
  })

  it('flags a dangling roles[*].nodeIds[*]', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      roles: process.roles.map((role) => ({ ...role, nodeIds: ['missing-node'] }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-node-reference')
    expect(issue?.path).toEqual(['roles', 0, 'nodeIds', 0])
  })

  it('flags a dangling informationObjects[*].outputOfNodeIds[*]', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      informationObjects: process.informationObjects.map((info) => ({
        ...info,
        outputOfNodeIds: ['missing-node']
      }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-node-reference')
    expect(issue?.path).toEqual(['informationObjects', 0, 'outputOfNodeIds', 0])
  })
})

describe('cross-reference refinement: dangling-fact-reference', () => {
  it('flags a dangling nodes[*].factIds[*]', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      nodes: process.nodes.map((node) =>
        node.id === 'n-review' ? { ...node, factIds: ['missing-fact'] } : node
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-fact-reference')
    expect(issue?.path).toEqual(['nodes', 1, 'factIds', 0])
  })

  it('flags a dangling unknowns[*].factIds[*]', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      unknowns: process.unknowns.map((unknown) => ({ ...unknown, factIds: ['missing-fact'] }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-fact-reference')
    expect(issue?.path).toEqual(['unknowns', 0, 'factIds', 0])
  })

  it('flags a dangling decisions[*].approval.factIds[*] through the same check', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({
        authorityRoleIds: ['r-clerk'],
        status: 'confirmed',
        factIds: ['missing-fact']
      })
    )
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-fact-reference')
    expect(issue?.path).toEqual(['decisions', 0, 'approval', 'factIds', 0])
  })
})

/**
 * Attach an (arbitrary, possibly-invalid) `approval` block to the baseline's
 * `d-approve` decision. Typed `unknown` in/out so the negative tests can pass
 * malformed shapes straight through `parseCanonicalProcess`.
 */
function withApprovalOnDecide(approval: unknown): unknown {
  const process = buildValidProcess()
  return {
    ...process,
    decisions: process.decisions.map((decision) =>
      decision.id === 'd-approve' ? { ...decision, approval } : decision
    )
  }
}

describe('explicit approval authority: shape + cross-reference', () => {
  it('accepts a fully-referenced approval block (authority + threshold + facts)', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({
        authorityRoleIds: ['r-clerk'],
        thresholdControlIds: ['c-policy'],
        status: 'confirmed',
        factIds: ['f-1']
      })
    )
    expect(result.ok).toBe(true)
  })

  it('accepts a minimal approval block (authority + status only)', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({ authorityRoleIds: ['r-clerk'], status: 'proposed' })
    )
    expect(result.ok).toBe(true)
  })

  it('flags dangling-approval-authority for an unknown authority role id', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({ authorityRoleIds: ['missing-role'], status: 'confirmed' })
    )
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-approval-authority')
    expect(issue?.path).toEqual(['decisions', 0, 'approval', 'authorityRoleIds', 0])
  })

  it('flags dangling-approval-threshold for an unknown threshold control id', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({
        authorityRoleIds: ['r-clerk'],
        thresholdControlIds: ['missing-control'],
        status: 'confirmed'
      })
    )
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-approval-threshold')
    expect(issue?.path).toEqual(['decisions', 0, 'approval', 'thresholdControlIds', 0])
  })

  it('rejects an empty authorityRoleIds array (an approval must name at least one authority)', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({ authorityRoleIds: [], status: 'confirmed' })
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown approval status', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({ authorityRoleIds: ['r-clerk'], status: 'rubber-stamped' })
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown key inside the approval block (strict object)', () => {
    const result = parseCanonicalProcess(
      withApprovalOnDecide({ authorityRoleIds: ['r-clerk'], status: 'confirmed', approver: 'x' })
    )
    expect(result.ok).toBe(false)
  })
})

describe('cross-reference refinement: dangling-unknown-target', () => {
  it('flags an unknowns[*].targetId with no matching declared id', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      unknowns: process.unknowns.map((unknown) => ({ ...unknown, targetId: 'missing-id' }))
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'dangling-unknown-target')
    expect(issue?.path).toEqual(['unknowns', 0, 'targetId'])
  })

  it('accepts an unknown targeting a fact id, a role id, or a decision outcome id', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      unknowns: [
        { targetId: process.facts[0].id, kind: 'other' as const, message: { en: 'x' } },
        { targetId: process.roles[0].id, kind: 'other' as const, message: { en: 'y' } },
        {
          targetId: process.decisions[0].outcomes[0].id,
          kind: 'other' as const,
          message: { en: 'z' }
        },
        { targetId: process.identity.id, kind: 'other' as const, message: { en: 'w' } }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(true)
  })
})

describe('cross-reference refinement: edge-condition-required / edge-condition-not-allowed', () => {
  it('flags a conditional edge missing condition', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      edges: process.edges.map((edge) =>
        edge.id === 'e-3' ? { ...edge, kind: 'conditional' as const } : edge
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'edge-condition-required')
    expect(issue?.path).toEqual(['edges', 2, 'condition'])
  })

  it('flags a non-conditional edge carrying a condition', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      edges: process.edges.map((edge) =>
        edge.id === 'e-3' ? { ...edge, condition: { en: 'unexpected' } } : edge
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'edge-condition-not-allowed')
    expect(issue?.path).toEqual(['edges', 2, 'condition'])
  })

  it('accepts a conditional edge that does carry a condition', () => {
    const process = buildValidProcess()
    const mutated = {
      ...process,
      edges: process.edges.map((edge) =>
        edge.id === 'e-3'
          ? { ...edge, kind: 'conditional' as const, condition: { en: 'if approved' } }
          : edge
      )
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(true)
  })
})

describe('cross-reference refinement: decision-node-kind-mismatch', () => {
  it('flags a decisions[*].nodeId pointing at a non-decision-kind node', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      decisions: [
        ...process.decisions,
        {
          id: 'd-extra',
          nodeId: 'n-review', // kind 'activity', not 'decision'
          outcomes: [
            { id: 'o-extra-1', names: { en: 'Path A' }, targetNodeId: 'n-approved' },
            { id: 'o-extra-2', names: { en: 'Path B' }, targetNodeId: 'n-rejected' }
          ],
          confidence: 'medium'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'decision-node-kind-mismatch')
    expect(issue?.path).toEqual(['decisions', 1, 'nodeId'])
  })
})

describe('cross-reference refinement: decision-node-unreferenced', () => {
  it('flags a decision-kind node referenced by zero decisions[] entries', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      nodes: [
        ...process.nodes,
        { id: 'n-decide-2', kind: 'decision', names: { en: 'Second gate' }, confidence: 'medium' }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'decision-node-unreferenced')
    expect(issue?.path).toEqual(['nodes', process.nodes.length])
  })
})

describe('cross-reference refinement: decision-node-multiple-references', () => {
  it('flags a decision-kind node referenced by more than one decisions[] entry', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      decisions: [
        ...process.decisions,
        {
          id: 'd-approve-2',
          nodeId: 'n-decide',
          outcomes: [
            { id: 'o-approved-2', names: { en: 'Approved (dup)' }, targetNodeId: 'n-approved' },
            { id: 'o-rejected-2', names: { en: 'Rejected (dup)' }, targetNodeId: 'n-rejected' }
          ],
          confidence: 'medium'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'decision-node-multiple-references')
    expect(issue?.path).toEqual(['decisions', 1, 'nodeId'])
  })
})

describe('cross-reference refinement: decision-node-sequence-edge', () => {
  it('flags a plain sequence edge out of a decision node', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      edges: [
        ...process.edges,
        {
          id: 'e-bad',
          kind: 'sequence',
          sourceNodeId: 'n-decide',
          targetNodeId: 'n-approved',
          confidence: 'low'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'decision-node-sequence-edge')
    expect(issue?.path).toEqual(['edges', process.edges.length, 'kind'])
  })

  it('does not flag a non-sequence edge out of a decision node', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      edges: [
        ...process.edges,
        {
          id: 'e-info',
          kind: 'data-flow',
          sourceNodeId: 'n-decide',
          targetNodeId: 'n-approved',
          confidence: 'low'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(true)
  })
})

describe('cross-reference refinement: decision-node-conditional-edge', () => {
  it('flags a conditional edge out of a decision node (branching must use outcomes)', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      edges: [
        ...process.edges,
        {
          id: 'e-bad',
          kind: 'conditional',
          sourceNodeId: 'n-decide',
          targetNodeId: 'n-approved',
          condition: { en: 'if approved' },
          confidence: 'low'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(false)
    const issue = firstIssue(result, 'decision-node-conditional-edge')
    expect(issue?.path).toEqual(['edges', process.edges.length, 'kind'])
  })

  it('does not flag a conditional edge out of a non-decision node', () => {
    const process = buildValidProcess()
    const mutated: CanonicalProcessV1 = {
      ...process,
      edges: [
        ...process.edges,
        {
          id: 'e-cond',
          kind: 'conditional',
          sourceNodeId: 'n-approved',
          targetNodeId: 'n-end',
          condition: { en: 'if ready' },
          confidence: 'low'
        }
      ]
    }
    const result = parseCanonicalProcess(mutated)
    expect(result.ok).toBe(true)
  })
})

describe('CanonicalProcessV1Schema', () => {
  it('is the schema parseCanonicalProcess delegates to', () => {
    const process = buildValidProcess()
    expect(CanonicalProcessV1Schema.safeParse(process).success).toBe(true)
  })
})
