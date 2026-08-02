/**
 * `CanonicalProcessV1` — the notation-neutral, bilingual (en/ar),
 * evidence-linked process contract (master-plan Part III §3; implementation
 * plan Lane L-SCHEMA, Wave 18).
 *
 * This is the ONE shape the private enterprise repo codes against — field
 * names are BINDING. It deliberately does not know about EPC, BPMN, or any
 * other notation: objects are events/activities/decisions/roles/systems/
 * information objects/controls, edges are sequence/conditional/parallel/
 * handoff/data-flow/exception-route, every citable object carries an id, and
 * every entity carries a `confidence` (mirroring `ArisAiConfidence` in
 * `src/aris/ai/contract.ts`, which this module otherwise does not import —
 * the canonical layer is self-contained so it can ship as an independent
 * package entry, see `src/aris/canonical/index.ts`).
 *
 * Strictness (mirrors `src/aris/ai/contract.ts`): every zod object schema
 * below is built with `z.strictObject(...).strict()` (unknown keys
 * rejected), there is no `.default()`/coercion anywhere, and
 * `parseCanonicalProcess` never throws — it always returns
 * `{ok:true, process}` or `{ok:false, issues}`.
 *
 * `CanonicalText` additionally requires at least one of `en`/`ar` to be
 * present (unlike `ArisAiLocalizedText`, which allows both to be absent so a
 * provider can flag the gap via an uncertainty instead) — this is the
 * bilingual contract's own baseline: a text carrier with neither locale
 * present is never valid here, in any position it appears.
 *
 * Cross-reference integrity — beyond per-field shape — is enforced by a
 * single `.superRefine()` on `CanonicalProcessV1Schema`. Every issue raised
 * there (and by `CanonicalTextSchema`'s own emptiness check) carries a
 * STABLE machine-readable code via zod's custom-issue `params.issueCode`
 * (surfaced by `parseCanonicalProcess` as `CanonicalParseIssue.code`,
 * overriding zod's generic `'custom'`). The full vocabulary:
 *
 *  - `canonical-text-empty`             — a `CanonicalText` has neither `en` nor `ar`.
 *  - `duplicate-id`                     — an id is reused across the entity arrays
 *                                          (nodes/decisions/edges/roles/systems/
 *                                          informationObjects/controls/facts).
 *  - `dangling-node-reference`          — a node-id-shaped field (edge endpoints,
 *                                          decision.nodeId/outcome.targetNodeId,
 *                                          role/system/control.nodeIds[*],
 *                                          informationObjects.*NodeIds[*]) does not
 *                                          resolve to a declared `nodes[].id`.
 *  - `dangling-fact-reference`          — a `factIds[*]` entry does not resolve to a
 *                                          declared `facts[].id`.
 *  - `dangling-unknown-target`          — `unknowns[*].targetId` does not resolve to
 *                                          any declared id in the process (identity,
 *                                          nodes, decisions, decision outcomes, edges,
 *                                          roles, systems, informationObjects,
 *                                          controls, facts).
 *  - `edge-condition-required`          — an edge of kind `'conditional'` has no
 *                                          `condition`.
 *  - `edge-condition-not-allowed`       — an edge NOT of kind `'conditional'` carries
 *                                          a `condition`.
 *  - `decision-node-kind-mismatch`      — `decisions[*].nodeId` resolves to a node
 *                                          whose `kind` is not `'decision'`.
 *  - `decision-node-unreferenced`       — a node of kind `'decision'` is not
 *                                          referenced by any `decisions[]` entry.
 *  - `decision-node-multiple-references`— a node of kind `'decision'` is referenced
 *                                          by more than one `decisions[]` entry.
 *  - `decision-node-sequence-edge`      — an edge of kind `'sequence'` has a decision
 *                                          node as its source (a decision's outgoing
 *                                          control flow must be expressed only
 *                                          through its `decisions[]` outcomes).
 *
 * `contract.test.ts` exercises every one of these codes individually.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const CANONICAL_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------
// Stable cross-reference issue codes (see module header)
// ---------------------------------------------------------------------------

export const CANONICAL_ISSUE_CODES = [
  'canonical-text-empty',
  'duplicate-id',
  'dangling-node-reference',
  'dangling-fact-reference',
  'dangling-unknown-target',
  'edge-condition-required',
  'edge-condition-not-allowed',
  'decision-node-kind-mismatch',
  'decision-node-unreferenced',
  'decision-node-multiple-references',
  'decision-node-sequence-edge'
] as const

export type CanonicalIssueCode = (typeof CANONICAL_ISSUE_CODES)[number]

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Every entity in the canonical process carries this. */
export type CanonicalConfidence = 'high' | 'medium' | 'low'

export const CANONICAL_CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const

export const CanonicalConfidenceSchema = z.enum(CANONICAL_CONFIDENCE_VALUES)

/**
 * Bilingual text carrier. Unlike `ArisAiLocalizedText` (`src/aris/ai/contract.ts`),
 * at least one of `en`/`ar` is REQUIRED here — the canonical model is the
 * citable, evidence-linked record; a wholly-empty text is never meaningful in
 * any position it appears (use a `CanonicalUnknown` of kind
 * `'missing-translation'` to flag a missing locale instead of omitting both).
 */
export interface CanonicalText {
  readonly en?: string
  readonly ar?: string
}

export const CanonicalTextSchema = z
  .strictObject({
    en: z.string().min(1).optional(),
    ar: z.string().min(1).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.en === undefined && value.ar === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'CanonicalText requires at least one of "en" or "ar".',
        params: { issueCode: 'canonical-text-empty' satisfies CanonicalIssueCode }
      })
    }
  })

// ---------------------------------------------------------------------------
// CanonicalIdentity
// ---------------------------------------------------------------------------

export interface CanonicalIdentity {
  readonly id: string
  readonly names: CanonicalText
  readonly purpose?: CanonicalText
  readonly code?: string
  readonly processVersion?: string
  readonly confidence: CanonicalConfidence
}

export const CanonicalIdentitySchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    purpose: CanonicalTextSchema.optional(),
    code: z.string().min(1).optional(),
    processVersion: z.string().min(1).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalNode
// ---------------------------------------------------------------------------

export type CanonicalNodeKind = 'event' | 'activity' | 'decision' | 'wait' | 'handoff' | 'exception'

export const CANONICAL_NODE_KINDS = [
  'event',
  'activity',
  'decision',
  'wait',
  'handoff',
  'exception'
] as const

export interface CanonicalNode {
  readonly id: string
  readonly kind: CanonicalNodeKind
  readonly names: CanonicalText
  readonly description?: CanonicalText
  /** Meaningful for `kind === 'wait'` only; shape is not kind-enforced (see refinement notes). */
  readonly waitDetail?: CanonicalText
  /** Meaningful for `kind === 'handoff'` only; an opaque reference to another process. */
  readonly targetProcessRef?: string
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalNodeSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(CANONICAL_NODE_KINDS),
    names: CanonicalTextSchema,
    description: CanonicalTextSchema.optional(),
    waitDetail: CanonicalTextSchema.optional(),
    targetProcessRef: z.string().min(1).optional(),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalDecision
// ---------------------------------------------------------------------------

export interface CanonicalDecisionOutcome {
  readonly id: string
  readonly names: CanonicalText
  readonly targetNodeId: string
}

export const CanonicalDecisionOutcomeSchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    targetNodeId: z.string().min(1)
  })
  .strict()

export interface CanonicalDecision {
  readonly id: string
  /** Must resolve to a declared node of kind `'decision'`, referenced by exactly one decision. */
  readonly nodeId: string
  readonly criteria?: CanonicalText
  readonly outcomes: readonly CanonicalDecisionOutcome[]
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalDecisionSchema = z
  .strictObject({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    criteria: CanonicalTextSchema.optional(),
    outcomes: z.array(CanonicalDecisionOutcomeSchema).min(2),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalEdge
// ---------------------------------------------------------------------------

export type CanonicalEdgeKind =
  'sequence' | 'conditional' | 'parallel' | 'handoff' | 'data-flow' | 'exception-route'

export const CANONICAL_EDGE_KINDS = [
  'sequence',
  'conditional',
  'parallel',
  'handoff',
  'data-flow',
  'exception-route'
] as const

export interface CanonicalEdge {
  readonly id: string
  readonly kind: CanonicalEdgeKind
  readonly sourceNodeId: string
  readonly targetNodeId: string
  /** REQUIRED iff `kind === 'conditional'`; forbidden otherwise. */
  readonly condition?: CanonicalText
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalEdgeSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(CANONICAL_EDGE_KINDS),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
    condition: CanonicalTextSchema.optional(),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalRole
// ---------------------------------------------------------------------------

export interface CanonicalRole {
  readonly id: string
  readonly names: CanonicalText
  readonly unit?: CanonicalText
  readonly nodeIds: readonly string[]
  readonly owner?: boolean
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalRoleSchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    unit: CanonicalTextSchema.optional(),
    nodeIds: z.array(z.string().min(1)),
    owner: z.boolean().optional(),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalSystem
// ---------------------------------------------------------------------------

export interface CanonicalSystem {
  readonly id: string
  readonly names: CanonicalText
  readonly nodeIds: readonly string[]
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalSystemSchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    nodeIds: z.array(z.string().min(1)),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalInformationObject
// ---------------------------------------------------------------------------

export interface CanonicalInformationObject {
  readonly id: string
  readonly names: CanonicalText
  readonly inputToNodeIds: readonly string[]
  readonly outputOfNodeIds: readonly string[]
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalInformationObjectSchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    inputToNodeIds: z.array(z.string().min(1)),
    outputOfNodeIds: z.array(z.string().min(1)),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalControl
// ---------------------------------------------------------------------------

export type CanonicalControlKind = 'policy' | 'business-rule' | 'requirement'

export const CANONICAL_CONTROL_KINDS = ['policy', 'business-rule', 'requirement'] as const

export interface CanonicalControl {
  readonly id: string
  readonly names: CanonicalText
  readonly kind: CanonicalControlKind
  readonly nodeIds: readonly string[]
  readonly factIds?: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalControlSchema = z
  .strictObject({
    id: z.string().min(1),
    names: CanonicalTextSchema,
    kind: z.enum(CANONICAL_CONTROL_KINDS),
    nodeIds: z.array(z.string().min(1)),
    factIds: z.array(z.string().min(1)).optional(),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalFact
// ---------------------------------------------------------------------------

export interface CanonicalFact {
  readonly id: string
  readonly statement: CanonicalText
  /** Opaque IDs into the caller's evidence store — never resolved or interpreted here. */
  readonly evidenceRefs: readonly string[]
  readonly confidence: CanonicalConfidence
}

export const CanonicalFactSchema = z
  .strictObject({
    id: z.string().min(1),
    statement: CanonicalTextSchema,
    evidenceRefs: z.array(z.string().min(1)),
    confidence: CanonicalConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalUnknown
// ---------------------------------------------------------------------------

export type CanonicalUnknownKind =
  'missing-field' | 'missing-translation' | 'ambiguous-mapping' | 'unclear-symbol' | 'other'

export const CANONICAL_UNKNOWN_KINDS = [
  'missing-field',
  'missing-translation',
  'ambiguous-mapping',
  'unclear-symbol',
  'other'
] as const

export interface CanonicalUnknown {
  /** Must resolve to some declared id anywhere in the process. */
  readonly targetId: string
  readonly kind: CanonicalUnknownKind
  readonly field?: string
  readonly message: CanonicalText
  readonly factIds?: readonly string[]
}

export const CanonicalUnknownSchema = z
  .strictObject({
    targetId: z.string().min(1),
    kind: z.enum(CANONICAL_UNKNOWN_KINDS),
    field: z.string().min(1).optional(),
    message: CanonicalTextSchema,
    factIds: z.array(z.string().min(1)).optional()
  })
  .strict()

// ---------------------------------------------------------------------------
// CanonicalProcessV1 — top-level shape (pre cross-reference refinement)
// ---------------------------------------------------------------------------

export interface CanonicalProcessV1 {
  readonly version: 1
  readonly identity: CanonicalIdentity
  readonly nodes: readonly CanonicalNode[]
  readonly decisions: readonly CanonicalDecision[]
  readonly edges: readonly CanonicalEdge[]
  readonly roles: readonly CanonicalRole[]
  readonly systems: readonly CanonicalSystem[]
  readonly informationObjects: readonly CanonicalInformationObject[]
  readonly controls: readonly CanonicalControl[]
  readonly facts: readonly CanonicalFact[]
  readonly unknowns: readonly CanonicalUnknown[]
}

const CanonicalProcessV1BaseSchema = z
  .strictObject({
    version: z.literal(1),
    identity: CanonicalIdentitySchema,
    nodes: z.array(CanonicalNodeSchema),
    decisions: z.array(CanonicalDecisionSchema),
    edges: z.array(CanonicalEdgeSchema),
    roles: z.array(CanonicalRoleSchema),
    systems: z.array(CanonicalSystemSchema),
    informationObjects: z.array(CanonicalInformationObjectSchema),
    controls: z.array(CanonicalControlSchema),
    facts: z.array(CanonicalFactSchema),
    unknowns: z.array(CanonicalUnknownSchema)
  })
  .strict()

type CanonicalProcessV1Shape = z.infer<typeof CanonicalProcessV1BaseSchema>

type CanonicalRefinementCtx = z.core.$RefinementCtx<CanonicalProcessV1Shape>

// ---------------------------------------------------------------------------
// Cross-reference refinements
// ---------------------------------------------------------------------------

/** The 8 top-level entity arrays that share a single, process-wide id namespace. */
const ENTITY_ARRAY_KEYS = [
  'nodes',
  'decisions',
  'edges',
  'roles',
  'systems',
  'informationObjects',
  'controls',
  'facts'
] as const

type EntityArrayKey = (typeof ENTITY_ARRAY_KEYS)[number]

function addCustomIssue(
  ctx: CanonicalRefinementCtx,
  path: readonly (string | number)[],
  issueCode: CanonicalIssueCode,
  message: string
): void {
  ctx.addIssue({
    code: 'custom',
    path: [...path],
    message,
    params: { issueCode }
  })
}

interface EntityIdOccurrence {
  readonly key: EntityArrayKey
  readonly index: number
  readonly id: string
}

function allEntityIdOccurrences(process: CanonicalProcessV1Shape): readonly EntityIdOccurrence[] {
  const entityArraysByKey: Record<EntityArrayKey, readonly { readonly id: string }[]> = {
    nodes: process.nodes,
    decisions: process.decisions,
    edges: process.edges,
    roles: process.roles,
    systems: process.systems,
    informationObjects: process.informationObjects,
    controls: process.controls,
    facts: process.facts
  }
  const occurrences: EntityIdOccurrence[] = []
  for (const key of ENTITY_ARRAY_KEYS) {
    entityArraysByKey[key].forEach((entity, index) =>
      occurrences.push({ key, index, id: entity.id })
    )
  }
  return occurrences
}

/** `duplicate-id`: an id reused across the 8 top-level entity arrays. */
function checkDuplicateIds(process: CanonicalProcessV1Shape, ctx: CanonicalRefinementCtx): void {
  const byId = new Map<string, EntityIdOccurrence[]>()
  for (const occurrence of allEntityIdOccurrences(process)) {
    const bucket = byId.get(occurrence.id)
    if (bucket) {
      bucket.push(occurrence)
    } else {
      byId.set(occurrence.id, [occurrence])
    }
  }
  for (const bucket of byId.values()) {
    if (bucket.length < 2) continue
    const first = bucket[0]
    for (let i = 1; i < bucket.length; i += 1) {
      const duplicate = bucket[i]
      addCustomIssue(
        ctx,
        [duplicate.key, duplicate.index, 'id'],
        'duplicate-id',
        `Id "${duplicate.id}" is already used by ${first.key}[${first.index}]; ids must be unique across the whole canonical process.`
      )
    }
  }
}

/**
 * `dangling-node-reference`: every node-id-shaped foreign key resolves to a
 * declared `nodes[].id` — edge endpoints, decision.nodeId/outcome.targetNodeId,
 * role/system/control.nodeIds[*], informationObjects.*NodeIds[*].
 */
function checkNodeReferences(process: CanonicalProcessV1Shape, ctx: CanonicalRefinementCtx): void {
  const nodeIds = new Set(process.nodes.map((node) => node.id))
  const requireNode = (
    path: readonly (string | number)[],
    nodeId: string,
    describe: string
  ): void => {
    if (!nodeIds.has(nodeId)) {
      addCustomIssue(
        ctx,
        path,
        'dangling-node-reference',
        `${describe} references undeclared node id "${nodeId}".`
      )
    }
  }

  process.edges.forEach((edge, index) => {
    requireNode(['edges', index, 'sourceNodeId'], edge.sourceNodeId, `edges[${index}].sourceNodeId`)
    requireNode(['edges', index, 'targetNodeId'], edge.targetNodeId, `edges[${index}].targetNodeId`)
  })

  process.decisions.forEach((decision, index) => {
    requireNode(['decisions', index, 'nodeId'], decision.nodeId, `decisions[${index}].nodeId`)
    decision.outcomes.forEach((outcome, outcomeIndex) => {
      requireNode(
        ['decisions', index, 'outcomes', outcomeIndex, 'targetNodeId'],
        outcome.targetNodeId,
        `decisions[${index}].outcomes[${outcomeIndex}].targetNodeId`
      )
    })
  })

  process.roles.forEach((role, index) => {
    role.nodeIds.forEach((nodeId, nodeIdIndex) => {
      requireNode(
        ['roles', index, 'nodeIds', nodeIdIndex],
        nodeId,
        `roles[${index}].nodeIds[${nodeIdIndex}]`
      )
    })
  })

  process.systems.forEach((system, index) => {
    system.nodeIds.forEach((nodeId, nodeIdIndex) => {
      requireNode(
        ['systems', index, 'nodeIds', nodeIdIndex],
        nodeId,
        `systems[${index}].nodeIds[${nodeIdIndex}]`
      )
    })
  })

  process.controls.forEach((control, index) => {
    control.nodeIds.forEach((nodeId, nodeIdIndex) => {
      requireNode(
        ['controls', index, 'nodeIds', nodeIdIndex],
        nodeId,
        `controls[${index}].nodeIds[${nodeIdIndex}]`
      )
    })
  })

  process.informationObjects.forEach((info, index) => {
    info.inputToNodeIds.forEach((nodeId, nodeIdIndex) => {
      requireNode(
        ['informationObjects', index, 'inputToNodeIds', nodeIdIndex],
        nodeId,
        `informationObjects[${index}].inputToNodeIds[${nodeIdIndex}]`
      )
    })
    info.outputOfNodeIds.forEach((nodeId, nodeIdIndex) => {
      requireNode(
        ['informationObjects', index, 'outputOfNodeIds', nodeIdIndex],
        nodeId,
        `informationObjects[${index}].outputOfNodeIds[${nodeIdIndex}]`
      )
    })
  })
}

/** `dangling-fact-reference`: every `factIds[*]` resolves to a declared `facts[].id`. */
function checkFactReferences(process: CanonicalProcessV1Shape, ctx: CanonicalRefinementCtx): void {
  const factIds = new Set(process.facts.map((fact) => fact.id))
  const requireFacts = (
    path: readonly (string | number)[],
    ids: readonly string[] | undefined,
    describe: string
  ): void => {
    if (!ids) return
    ids.forEach((id, index) => {
      if (!factIds.has(id)) {
        addCustomIssue(
          ctx,
          [...path, index],
          'dangling-fact-reference',
          `${describe}[${index}] references undeclared fact id "${id}".`
        )
      }
    })
  }

  process.nodes.forEach((node, index) =>
    requireFacts(['nodes', index, 'factIds'], node.factIds, `nodes[${index}].factIds`)
  )
  process.decisions.forEach((decision, index) =>
    requireFacts(['decisions', index, 'factIds'], decision.factIds, `decisions[${index}].factIds`)
  )
  process.edges.forEach((edge, index) =>
    requireFacts(['edges', index, 'factIds'], edge.factIds, `edges[${index}].factIds`)
  )
  process.roles.forEach((role, index) =>
    requireFacts(['roles', index, 'factIds'], role.factIds, `roles[${index}].factIds`)
  )
  process.systems.forEach((system, index) =>
    requireFacts(['systems', index, 'factIds'], system.factIds, `systems[${index}].factIds`)
  )
  process.controls.forEach((control, index) =>
    requireFacts(['controls', index, 'factIds'], control.factIds, `controls[${index}].factIds`)
  )
  process.informationObjects.forEach((info, index) =>
    requireFacts(
      ['informationObjects', index, 'factIds'],
      info.factIds,
      `informationObjects[${index}].factIds`
    )
  )
  process.unknowns.forEach((unknown, index) =>
    requireFacts(['unknowns', index, 'factIds'], unknown.factIds, `unknowns[${index}].factIds`)
  )
}

/** Every id declared anywhere in the process — the resolution universe for `unknowns[*].targetId`. */
function allDeclaredIds(process: CanonicalProcessV1Shape): ReadonlySet<string> {
  const ids = new Set<string>()
  ids.add(process.identity.id)
  for (const node of process.nodes) ids.add(node.id)
  for (const decision of process.decisions) {
    ids.add(decision.id)
    for (const outcome of decision.outcomes) ids.add(outcome.id)
  }
  for (const edge of process.edges) ids.add(edge.id)
  for (const role of process.roles) ids.add(role.id)
  for (const system of process.systems) ids.add(system.id)
  for (const info of process.informationObjects) ids.add(info.id)
  for (const control of process.controls) ids.add(control.id)
  for (const fact of process.facts) ids.add(fact.id)
  return ids
}

/** `dangling-unknown-target`: `unknowns[*].targetId` resolves to some declared id. */
function checkUnknownTargets(process: CanonicalProcessV1Shape, ctx: CanonicalRefinementCtx): void {
  const declaredIds = allDeclaredIds(process)
  process.unknowns.forEach((unknown, index) => {
    if (!declaredIds.has(unknown.targetId)) {
      addCustomIssue(
        ctx,
        ['unknowns', index, 'targetId'],
        'dangling-unknown-target',
        `unknowns[${index}].targetId "${unknown.targetId}" does not match any declared id in the canonical process.`
      )
    }
  })
}

/**
 * `edge-condition-required` / `edge-condition-not-allowed`: `condition` is
 * present if and only if `kind === 'conditional'`.
 */
function checkConditionalEdgeConditions(
  process: CanonicalProcessV1Shape,
  ctx: CanonicalRefinementCtx
): void {
  process.edges.forEach((edge, index) => {
    if (edge.kind === 'conditional' && edge.condition === undefined) {
      addCustomIssue(
        ctx,
        ['edges', index, 'condition'],
        'edge-condition-required',
        `edges[${index}] has kind "conditional" and must carry a "condition".`
      )
    }
    if (edge.kind !== 'conditional' && edge.condition !== undefined) {
      addCustomIssue(
        ctx,
        ['edges', index, 'condition'],
        'edge-condition-not-allowed',
        `edges[${index}] has kind "${edge.kind}" and must not carry a "condition" (only "conditional" edges may).`
      )
    }
  })
}

/**
 * `decision-node-kind-mismatch` / `decision-node-unreferenced` /
 * `decision-node-multiple-references`: every `decisions[*].nodeId` points at a
 * node of kind `'decision'`, and every `'decision'`-kind node is referenced by
 * EXACTLY one `decisions[]` entry.
 */
function checkDecisionNodeReferences(
  process: CanonicalProcessV1Shape,
  ctx: CanonicalRefinementCtx
): void {
  const nodeById = new Map(process.nodes.map((node) => [node.id, node] as const))

  process.decisions.forEach((decision, index) => {
    const node = nodeById.get(decision.nodeId)
    if (node !== undefined && node.kind !== 'decision') {
      addCustomIssue(
        ctx,
        ['decisions', index, 'nodeId'],
        'decision-node-kind-mismatch',
        `decisions[${index}].nodeId references node "${decision.nodeId}" of kind "${node.kind}"; it must reference a node of kind "decision".`
      )
    }
  })

  const referencingIndicesByNodeId = new Map<string, number[]>()
  process.decisions.forEach((decision, index) => {
    const bucket = referencingIndicesByNodeId.get(decision.nodeId)
    if (bucket) {
      bucket.push(index)
    } else {
      referencingIndicesByNodeId.set(decision.nodeId, [index])
    }
  })

  process.nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'decision') return
    const referencingIndices = referencingIndicesByNodeId.get(node.id) ?? []
    if (referencingIndices.length === 0) {
      addCustomIssue(
        ctx,
        ['nodes', nodeIndex],
        'decision-node-unreferenced',
        `Node "${node.id}" has kind "decision" but no decisions[] entry references it.`
      )
      return
    }
    for (let i = 1; i < referencingIndices.length; i += 1) {
      addCustomIssue(
        ctx,
        ['decisions', referencingIndices[i], 'nodeId'],
        'decision-node-multiple-references',
        `Node "${node.id}" is already referenced by decisions[${referencingIndices[0]}]; each decision node must be referenced by exactly one decisions[] entry.`
      )
    }
  })
}

/**
 * `decision-node-sequence-edge`: a decision node's outgoing control flow is
 * expressed ONLY through its `decisions[]` outcomes — no plain `'sequence'`
 * edge may originate from it.
 */
function checkDecisionNodeSequenceEdges(
  process: CanonicalProcessV1Shape,
  ctx: CanonicalRefinementCtx
): void {
  const decisionNodeIds = new Set(
    process.nodes.filter((node) => node.kind === 'decision').map((node) => node.id)
  )
  process.edges.forEach((edge, index) => {
    if (edge.kind === 'sequence' && decisionNodeIds.has(edge.sourceNodeId)) {
      addCustomIssue(
        ctx,
        ['edges', index, 'kind'],
        'decision-node-sequence-edge',
        `edges[${index}] is a "sequence" edge out of decision node "${edge.sourceNodeId}"; a decision node's outgoing control flow must be expressed only through its decisions[] outcomes.`
      )
    }
  })
}

export const CanonicalProcessV1Schema = CanonicalProcessV1BaseSchema.superRefine((process, ctx) => {
  checkDuplicateIds(process, ctx)
  checkNodeReferences(process, ctx)
  checkFactReferences(process, ctx)
  checkUnknownTargets(process, ctx)
  checkConditionalEdgeConditions(process, ctx)
  checkDecisionNodeReferences(process, ctx)
  checkDecisionNodeSequenceEdges(process, ctx)
})

// ---------------------------------------------------------------------------
// parseCanonicalProcess — never throws
// ---------------------------------------------------------------------------

export interface CanonicalParseIssue {
  /** A `CanonicalIssueCode` for cross-reference/text issues, or zod's own issue code otherwise. */
  readonly code: string
  readonly path: readonly (string | number)[]
  readonly message: string
}

export type CanonicalParseResult =
  | { readonly ok: true; readonly process: CanonicalProcessV1 }
  | { readonly ok: false; readonly issues: readonly CanonicalParseIssue[] }

function zodIssuePath(path: readonly PropertyKey[]): readonly (string | number)[] {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
}

function toCanonicalParseIssue(issue: z.core.$ZodIssue): CanonicalParseIssue {
  const path = zodIssuePath(issue.path)
  if (issue.code === 'custom') {
    const issueCode = issue.params?.issueCode
    return {
      code: typeof issueCode === 'string' ? issueCode : 'custom',
      path,
      message: issue.message
    }
  }
  return { code: issue.code, path, message: issue.message }
}

/**
 * Parse an unknown, untrusted value as `CanonicalProcessV1`. Never throws —
 * every failure path (shape violation, cross-reference violation, or an
 * unexpected internal error) returns `{ok:false, issues}`.
 */
export function parseCanonicalProcess(raw: unknown): CanonicalParseResult {
  try {
    const result = CanonicalProcessV1Schema.safeParse(raw)
    if (!result.success) {
      return { ok: false, issues: result.error.issues.map(toCanonicalParseIssue) }
    }
    return { ok: true, process: result.data }
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'internal-error',
          path: [],
          message:
            error instanceof Error
              ? error.message
              : 'Unknown error while parsing CanonicalProcessV1.'
        }
      ]
    }
  }
}
