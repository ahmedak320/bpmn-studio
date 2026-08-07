/**
 * Deterministic `CanonicalProcessV1` -> EPC projection (implementation plan
 * Lane L-PROJECT, Wave 19; deliverable 2).
 *
 * `projectCanonicalToDraft` turns a notation-neutral `CanonicalProcessV1`
 * (`./contract`) into a fully-valid `ArisAiDraftV1` (`../ai/contract`) plus an
 * anchor map that ties every emitted draft object/relation back to the
 * canonical id that caused it. The draft then feeds the existing
 * AML/import/layout/render pipeline unchanged (`buildAmlFromArisAiDraft`), and
 * because the draft's logical ids embed the canonical ids verbatim, those
 * canonical ids survive into the canvas element ids the headless render entry
 * anchors on.
 *
 * Determinism (a first-class requirement — see Global Constraints): every id
 * derives only from canonical ids (no clock or randomness, never a random id),
 * every array is assembled in a fixed order, and `suggestedOrder` is set
 * explicitly from a depth-first spine — so the same input yields a
 * `canonicalJsonText`-identical draft and a byte-identical AML across runs.
 *
 * ## Draft logicalId scheme (BINDING — derived only from canonical ids)
 *
 * `<cid>` is a canonical id.
 *  - primary node ............ `n:<cid>`
 *  - decision rule ........... `x:<decisionId>`
 *  - outcome event ........... `xo:<decisionId>:<outcomeId>`
 *  - parallel split (AND) .... `ps:<fanNodeId>`
 *  - parallel merge (AND) .... `pm:<fanNodeId>`
 *  - exception rule (XOR) .... `xe:<exceptionNodeId>`
 *  - exception event ......... `xev:<exceptionNodeId>`
 *  - alternation filler event  `fe:<edge>` / filler function `ff:<edge>`
 *  - role satellite .......... `r:<roleId>`  · system `s:<systemId>`
 *  - info object ............. `io:<infoId>` · control `c:<controlId>`
 *  - placeholder model ....... `m:<targetProcessRef>` (primary model `m:<processId>`)
 *  - primary edge relation ... `e:<edgeId>`
 *  - synthesized relation .... `re:<sourceDraftId>:<targetDraftId>`
 *  - inline attribute ........ `a:<ownerDraftId>:<attributeType>` (owner AT_PERS_RESP: `a:<roleId>:AT_PERS_RESP`)
 *  - linked-model assignment . `lm:<handoffNodeId>`
 *
 * ## Connection-type selection (endpoint-driven, promptBuilder cheat-sheet)
 *
 * Control-flow relations pick their `connectionType` from the endpoint object
 * types exactly as `src/aris/ai/promptBuilder.ts`'s cheat-sheet does
 * (`flowConnectionType` below): EVT->FUNC / RULE->FUNC => CT_ACTIV_1; FUNC->EVT
 * => CT_CRT_1; FUNC->RULE => CT_LEADS_TO_1; RULE->EVT => CT_LEADS_TO_2;
 * EVT->RULE => CT_IS_EVAL_BY_1. FUNC->FUNC / EVT->EVT never survive — they are
 * spliced by alternation completion (choice 5 below).
 *
 * ## Recorded table/source choices (see the lane brief's "hard constraints")
 *
 *  1. Decision `rule -> outcome event` uses **CT_ACTIV_1** (the L-PROJECT
 *     expansion table, verbatim), not the cheat-sheet's RULE->EVT pairing
 *     CT_LEADS_TO_2. Both are in `FLOW_CONNECTION_TYPES` and CT_ACTIV_1 is
 *     accepted as control flow by `isControlFlowTriple` for RULE->EVT, so the
 *     XOR is still seen as a split by `checkLabeledDecisionBranches` and there
 *     is no validation impact. The plan's explicit type is followed.
 *  2. Roles use **CT_EXEC_1** (expansion table), though the cheat-sheet pairs
 *     OT_PERS_TYPE->function with CT_EXEC_2. A role is a satellite (not a flow
 *     node), so this relation is never control flow -> no validation impact.
 *  3. Information objects use **CT_IS_INP_FOR** (input) / **CT_HAS_OUT**
 *     (output) per the expansion table (the cheat-sheet's entity-type verbs,
 *     reused for OT_INFO_CARR; its OT_INFO_CARR->CT_CRT_OUT_TO is NOT used).
 *     Both are satellite relations -> no validation impact.
 *  4. Alternation filler ids: for a spliced **primary** canonical edge
 *     (relation `e:<cid>`) the filler is `fe:<cid>`/`ff:<cid>` exactly as the
 *     plan writes it; for a spliced **synthesized** flow relation (which has
 *     no canonical edge id) the filler carries the full relation logicalId
 *     (`fe:re:...`/`ff:re:...`) to guarantee uniqueness. Filler `confidence`
 *     is `'high'` (a purely-structural, deterministic node).
 *  5. A `sequence`/`handoff` edge between two functions is NOT emitted as a
 *     direct CT_IS_PREDEC_OF_1 tuple; it is spliced with an `fe:` filler event
 *     so the projection is a properly-alternating EEPC. The expansion table's
 *     sequence-edge row is silent on FUNC->FUNC (it lists only EVT->func,
 *     func->EVT, and rule-adjacent), and the `fe:` filler template exists
 *     precisely for this case. CT_IS_PREDEC_OF_1 stays the alternation-EXEMPT
 *     code (a defensive guard for an externally-supplied predecessor tuple),
 *     mirroring `checkAlternation`'s own exemption — the projection never
 *     emits it.
 *
 * None of these deviate in *behaviour* from a valid projection (every one is a
 * `FLOW_CONNECTION_TYPES` entry with no EPC-rule impact); they are documented
 * here per the lane brief's instruction to record any table/source choice.
 */

import type {
  ArisAiAssignment,
  ArisAiAttribute,
  ArisAiConfidence,
  ArisAiDraftV1,
  ArisAiLocalizedText,
  ArisAiModel,
  ArisAiUncertainty
} from '../ai/contract'
import type {
  CanonicalControl,
  CanonicalDecision,
  CanonicalNode,
  CanonicalProcessV1,
  CanonicalText
} from './contract'

export const PROJECTION_VERSION = 1 as const

// ---------------------------------------------------------------------------
// ARIS type/symbol/connection code constants (kept local so the projection
// core carries no runtime dependency on the epc/ modules).
// ---------------------------------------------------------------------------

const OT_EVT = 'OT_EVT'
const OT_FUNC = 'OT_FUNC'
const OT_RULE = 'OT_RULE'
const OT_PERS_TYPE = 'OT_PERS_TYPE'
const OT_APPL_SYS = 'OT_APPL_SYS'
const OT_INFO_CARR = 'OT_INFO_CARR'
const OT_POLICY = 'OT_POLICY'
const OT_BUSINESS_RULE = 'OT_BUSINESS_RULE'
const OT_REQUIREMENT = 'OT_REQUIREMENT'

const ST_EV = 'ST_EV'
const ST_FUNC = 'ST_FUNC'
const ST_PRCS_IF = 'ST_PRCS_IF'
const ST_OPR_XOR_1 = 'ST_OPR_XOR_1'
const ST_OPR_AND_1 = 'ST_OPR_AND_1'
// Satellite symbol constants — added 2026-08-07 to fix the missing-symbolType
// bug where every satellite (role/system/info/control) got rendered as
// orbitpm:unknown-symbol. Registered in src/aris/symbols/shapes.ts; the writer
// (arisAiCreate.ts) now propagates any symbolType we set here into the AML.
const ST_EMPL_TYPE = 'ST_EMPL_TYPE'
const ST_APPL_SYS = 'ST_APPL_SYS'
const ST_INFO_CARR_EDOC = 'ST_INFO_CARR_EDOC'
const ST_REQUIREMENT = 'ST_REQUIREMENT'
const ST_BUSINESS_POLICY = 'ST_BUSINESS_POLICY'
const ST_BUSINESS_RULE = 'ST_BUSINESS_RULE'

const CT_ACTIV_1 = 'CT_ACTIV_1'
const CT_CRT_1 = 'CT_CRT_1'
const CT_LEADS_TO_1 = 'CT_LEADS_TO_1'
const CT_LEADS_TO_2 = 'CT_LEADS_TO_2'
const CT_IS_EVAL_BY_1 = 'CT_IS_EVAL_BY_1'
const CT_IS_PREDEC_OF_1 = 'CT_IS_PREDEC_OF_1'
const CT_EXEC_1 = 'CT_EXEC_1'
const CT_SUPP_3 = 'CT_SUPP_3'
const CT_IS_INP_FOR = 'CT_IS_INP_FOR'
const CT_HAS_OUT = 'CT_HAS_OUT'
const CT_AFFECTS = 'CT_AFFECTS'
const CT_REFS_TO_2 = 'CT_REFS_TO_2'

const AT_DESC = 'AT_DESC'
const AT_PERS_RESP = 'AT_PERS_RESP'

const MT_EEPC = 'MT_EEPC'

/** Canonical edge kinds that carry control flow (the DFS-spine / projection set). */
const CONTROL_FLOW_EDGE_KINDS: ReadonlySet<string> = new Set([
  'sequence',
  'conditional',
  'parallel',
  'handoff',
  'exception-route'
])

// ---------------------------------------------------------------------------
// Result / anchor shapes
// ---------------------------------------------------------------------------

export interface CanonicalProjectionAnchors {
  /** draft object logicalId -> the canonical id that caused it. */
  readonly nodeByDraftId: Readonly<Record<string, string>>
  /** draft relation logicalId -> the canonical id that caused it. */
  readonly edgeByDraftId: Readonly<Record<string, string>>
}

export interface CanonicalProjectionResult {
  readonly draft: ArisAiDraftV1
  readonly anchors: CanonicalProjectionAnchors
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function localizedText(text: CanonicalText | undefined): ArisAiLocalizedText {
  const out: { en?: string; ar?: string } = {}
  if (text?.en !== undefined) out.en = text.en
  if (text?.ar !== undefined) out.ar = text.ar
  return out
}

/** Comma-joined, sorted fact ids -> an `evidence` string, or `undefined`. */
function evidenceFor(factIds: readonly string[] | undefined): string | undefined {
  if (!factIds || factIds.length === 0) return undefined
  return [...factIds].sort().join(',')
}

/** EN/AR endpoint-driven control-flow connection type (promptBuilder cheat-sheet). */
function flowConnectionType(sourceType: string, targetType: string): string {
  if (sourceType === OT_EVT && targetType === OT_FUNC) return CT_ACTIV_1
  if (sourceType === OT_RULE && targetType === OT_FUNC) return CT_ACTIV_1
  if (sourceType === OT_FUNC && targetType === OT_EVT) return CT_CRT_1
  if (sourceType === OT_FUNC && targetType === OT_RULE) return CT_LEADS_TO_1
  if (sourceType === OT_RULE && targetType === OT_EVT) return CT_LEADS_TO_2
  if (sourceType === OT_EVT && targetType === OT_RULE) return CT_IS_EVAL_BY_1
  // FUNC->FUNC and EVT->EVT are non-alternating and are ALWAYS spliced by
  // alternation completion (fe: event between two functions, ff: function
  // between two events), so this provisional type is cosmetic and removed
  // before the draft is assembled. It is deliberately NOT CT_IS_PREDEC_OF_1:
  // that code is the alternation-EXEMPT DMT predecessor tuple, and emitting it
  // here would suppress the fe: filler the expansion table requires for a
  // notation-correct alternating EEPC. CT_ACTIV_1 is a listed
  // FLOW_CONNECTION_TYPE, so a transient edge (should one ever survive) stays
  // visible to the validator rather than silently non-flow.
  return CT_ACTIV_1
}

// ---------------------------------------------------------------------------
// canonicalFlowOrder — the DFS spine over canonical nodes (exported for L-VPKG)
// ---------------------------------------------------------------------------

/**
 * Depth-first order of the canonical node ids, starting from each start event
 * (an `event` node with no incoming control-flow), following
 * `sequence|conditional|parallel|handoff|exception-route` edges (children in
 * edge-array order) plus a decision node's outcomes (in outcome order). Nodes
 * unreachable from any start are appended in declaration order so every node
 * appears exactly once. Deterministic and pure.
 */
export function canonicalFlowOrder(process: CanonicalProcessV1): readonly string[] {
  const decisionsByNodeId = new Map<string, CanonicalDecision>()
  for (const decision of process.decisions) decisionsByNodeId.set(decision.nodeId, decision)

  const outgoingByNode = new Map<string, string[]>()
  const hasIncoming = new Set<string>()
  for (const edge of process.edges) {
    if (!CONTROL_FLOW_EDGE_KINDS.has(edge.kind)) continue
    const list = outgoingByNode.get(edge.sourceNodeId) ?? []
    list.push(edge.targetNodeId)
    outgoingByNode.set(edge.sourceNodeId, list)
    hasIncoming.add(edge.targetNodeId)
  }
  for (const decision of process.decisions) {
    for (const outcome of decision.outcomes) hasIncoming.add(outcome.targetNodeId)
  }

  const childrenOf = (nodeId: string): string[] => {
    const kids: string[] = []
    const decision = decisionsByNodeId.get(nodeId)
    if (decision) {
      for (const outcome of decision.outcomes) kids.push(outcome.targetNodeId)
    }
    for (const target of outgoingByNode.get(nodeId) ?? []) kids.push(target)
    return kids
  }

  const order: string[] = []
  const visited = new Set<string>()
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    order.push(nodeId)
    for (const child of childrenOf(nodeId)) visit(child)
  }

  for (const node of process.nodes) {
    if (node.kind === 'event' && !hasIncoming.has(node.id)) visit(node.id)
  }
  // Any remaining node (no start reaches it, e.g. an isolated cycle) in
  // declaration order, so the spine still covers every node deterministically.
  for (const node of process.nodes) visit(node.id)

  return order
}

// ---------------------------------------------------------------------------
// projectCanonicalToDraft
// ---------------------------------------------------------------------------

interface MutableObject {
  logicalId: string
  modelLogicalId: string
  objectType: string
  symbolType?: string
  names: ArisAiLocalizedText
  attributes: ArisAiAttribute[]
  suggestedOrder?: number
  evidence?: string
  confidence: ArisAiConfidence
}

interface MutableRelation {
  logicalId: string
  modelLogicalId: string
  sourceLogicalId: string
  targetLogicalId: string
  connectionType: string
  names?: ArisAiLocalizedText
  confidence: ArisAiConfidence
}

export function projectCanonicalToDraft(process: CanonicalProcessV1): CanonicalProjectionResult {
  const primaryModelId = `m:${process.identity.id}`

  // --- precompute canonical structure -------------------------------------
  const nodeById = new Map<string, CanonicalNode>()
  for (const node of process.nodes) nodeById.set(node.id, node)

  const decisionsByNodeId = new Map<string, CanonicalDecision>()
  for (const decision of process.decisions) decisionsByNodeId.set(decision.nodeId, decision)

  const exceptionNodeIds = new Set(
    process.nodes.filter((node) => node.kind === 'exception').map((node) => node.id)
  )

  const parallelOutCount = new Map<string, number>()
  const parallelInCount = new Map<string, number>()
  for (const edge of process.edges) {
    if (edge.kind !== 'parallel') continue
    parallelOutCount.set(edge.sourceNodeId, (parallelOutCount.get(edge.sourceNodeId) ?? 0) + 1)
    parallelInCount.set(edge.targetNodeId, (parallelInCount.get(edge.targetNodeId) ?? 0) + 1)
  }
  const fanOutNodes = new Set(
    [...parallelOutCount.entries()].filter(([, count]) => count >= 2).map(([id]) => id)
  )
  const fanInNodes = new Set(
    [...parallelInCount.entries()].filter(([, count]) => count >= 2).map(([id]) => id)
  )

  // --- accumulators + anchor tables ---------------------------------------
  const objects: MutableObject[] = []
  const flowRelations: MutableRelation[] = []
  const satelliteRelations: MutableRelation[] = []
  const models: ArisAiModel[] = []
  const topLevelAttributes: ArisAiAttribute[] = []
  const assignments: ArisAiAssignment[] = []
  const uncertainties: ArisAiUncertainty[] = []

  const objectTypeById = new Map<string, string>()
  const objectById = new Map<string, MutableObject>()
  const modelIds = new Set<string>()
  const nodeByDraftId: Record<string, string> = {}
  const edgeByDraftId: Record<string, string> = {}
  /** canonical id -> the draft object/relation that best represents it (for unknowns). */
  const draftByCanonicalId = new Map<string, string>()

  const rememberRepresentative = (canonicalId: string, draftId: string): void => {
    if (!draftByCanonicalId.has(canonicalId)) draftByCanonicalId.set(canonicalId, draftId)
  }

  const addModel = (model: ArisAiModel): void => {
    if (modelIds.has(model.logicalId)) return
    modelIds.add(model.logicalId)
    models.push(model)
  }

  const addObject = (spec: {
    logicalId: string
    cause: string
    objectType: string
    symbolType?: string
    names: ArisAiLocalizedText
    confidence: ArisAiConfidence
    evidence?: string
    attributes?: ArisAiAttribute[]
    representativeFor?: string
  }): void => {
    if (objectTypeById.has(spec.logicalId)) return
    const object: MutableObject = {
      logicalId: spec.logicalId,
      modelLogicalId: primaryModelId,
      objectType: spec.objectType,
      names: spec.names,
      attributes: spec.attributes ?? [],
      confidence: spec.confidence
    }
    if (spec.symbolType !== undefined) object.symbolType = spec.symbolType
    if (spec.evidence !== undefined) object.evidence = spec.evidence
    objects.push(object)
    objectTypeById.set(spec.logicalId, spec.objectType)
    objectById.set(spec.logicalId, object)
    nodeByDraftId[spec.logicalId] = spec.cause
    if (spec.representativeFor !== undefined) {
      rememberRepresentative(spec.representativeFor, spec.logicalId)
    }
  }

  const addFlowRelation = (spec: {
    logicalId: string
    cause: string
    source: string
    target: string
    confidence: ArisAiConfidence
    connectionType?: string
    names?: ArisAiLocalizedText
  }): void => {
    if (edgeByDraftId[spec.logicalId] !== undefined) return
    const connectionType =
      spec.connectionType ??
      flowConnectionType(
        objectTypeById.get(spec.source) ?? '',
        objectTypeById.get(spec.target) ?? ''
      )
    const relation: MutableRelation = {
      logicalId: spec.logicalId,
      modelLogicalId: primaryModelId,
      sourceLogicalId: spec.source,
      targetLogicalId: spec.target,
      connectionType,
      confidence: spec.confidence
    }
    if (spec.names !== undefined) relation.names = spec.names
    flowRelations.push(relation)
    edgeByDraftId[spec.logicalId] = spec.cause
    rememberRepresentative(spec.cause, spec.logicalId)
  }

  const addSatelliteRelation = (spec: {
    logicalId: string
    cause: string
    source: string
    target: string
    connectionType: string
    confidence: ArisAiConfidence
  }): void => {
    if (edgeByDraftId[spec.logicalId] !== undefined) return
    satelliteRelations.push({
      logicalId: spec.logicalId,
      modelLogicalId: primaryModelId,
      sourceLogicalId: spec.source,
      targetLogicalId: spec.target,
      connectionType: spec.connectionType,
      confidence: spec.confidence
    })
    edgeByDraftId[spec.logicalId] = spec.cause
    rememberRepresentative(spec.cause, spec.logicalId)
  }

  const representativeObjectId = (nodeId: string): string =>
    exceptionNodeIds.has(nodeId) ? `xe:${nodeId}` : `n:${nodeId}`

  const synthRelId = (source: string, target: string): string => `re:${source}:${target}`

  // --- primary model + placeholder handoff models -------------------------
  addModel({
    logicalId: primaryModelId,
    modelType: MT_EEPC,
    names: localizedText(process.identity.names),
    confidence: process.identity.confidence
  })

  // === Phase A: objects ===================================================
  for (const node of process.nodes) {
    switch (node.kind) {
      case 'event':
        addObject({
          logicalId: `n:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_EVT,
          symbolType: ST_EV,
          names: localizedText(node.names),
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds)
        })
        break
      case 'activity':
        addObject({
          logicalId: `n:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_FUNC,
          symbolType: ST_FUNC,
          names: localizedText(node.names),
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds)
        })
        break
      case 'wait': {
        const waitAttr = waitDetailAttribute(node)
        addObject({
          logicalId: `n:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_EVT,
          symbolType: ST_EV,
          names: localizedText(node.names),
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds),
          attributes: waitAttr ? [waitAttr] : []
        })
        break
      }
      case 'handoff':
        addObject({
          logicalId: `n:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_FUNC,
          symbolType: ST_PRCS_IF,
          names: localizedText(node.names),
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds)
        })
        if (node.targetProcessRef !== undefined) {
          const linkedModelId = `m:${node.targetProcessRef}`
          addModel({
            logicalId: linkedModelId,
            modelType: MT_EEPC,
            names: { en: node.targetProcessRef },
            confidence: node.confidence
          })
          assignments.push({
            logicalId: `lm:${node.id}`,
            assignmentType: 'linked-model',
            objectLogicalId: `n:${node.id}`,
            assignedModelLogicalId: linkedModelId,
            confidence: node.confidence
          })
        }
        break
      case 'decision': {
        const criteriaAttr = decisionCriteriaAttribute(node, decisionsByNodeId.get(node.id))
        addObject({
          logicalId: `n:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_FUNC,
          symbolType: ST_FUNC,
          names: localizedText(node.names),
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds),
          attributes: criteriaAttr ? [criteriaAttr] : []
        })
        break
      }
      case 'exception':
        addObject({
          logicalId: `xe:${node.id}`,
          cause: node.id,
          representativeFor: node.id,
          objectType: OT_RULE,
          symbolType: ST_OPR_XOR_1,
          names: {},
          confidence: node.confidence,
          evidence: evidenceFor(node.factIds)
        })
        addObject({
          logicalId: `xev:${node.id}`,
          cause: node.id,
          objectType: OT_EVT,
          symbolType: ST_EV,
          names: localizedText(node.names),
          confidence: node.confidence
        })
        break
    }
  }

  for (const decision of process.decisions) {
    addObject({
      logicalId: `x:${decision.id}`,
      cause: decision.id,
      representativeFor: decision.id,
      objectType: OT_RULE,
      symbolType: ST_OPR_XOR_1,
      names: {},
      confidence: decision.confidence,
      evidence: evidenceFor(decision.factIds)
    })
    for (const outcome of decision.outcomes) {
      addObject({
        logicalId: `xo:${decision.id}:${outcome.id}`,
        cause: decision.id,
        representativeFor: outcome.id,
        objectType: OT_EVT,
        symbolType: ST_EV,
        names: localizedText(outcome.names),
        confidence: decision.confidence
      })
    }
  }

  for (const node of process.nodes) {
    if (fanOutNodes.has(node.id)) {
      addObject({
        logicalId: `ps:${node.id}`,
        cause: node.id,
        objectType: OT_RULE,
        symbolType: ST_OPR_AND_1,
        names: {},
        confidence: node.confidence
      })
    }
    if (fanInNodes.has(node.id)) {
      addObject({
        logicalId: `pm:${node.id}`,
        cause: node.id,
        objectType: OT_RULE,
        symbolType: ST_OPR_AND_1,
        names: {},
        confidence: node.confidence
      })
    }
  }

  for (const role of process.roles) {
    addObject({
      logicalId: `r:${role.id}`,
      cause: role.id,
      representativeFor: role.id,
      objectType: OT_PERS_TYPE,
      // Without symbolType, arisAiCreate.ts's DEFAULT_SYMBOLS table (which
      // only knows OT_FUNC/OT_EVT/OT_RULE) fell through to 'ST_FUNC' and the
      // renderer stamped orbitpm:unknown-symbol on the group. See fix note
      // near constants above.
      symbolType: ST_EMPL_TYPE,
      names: localizedText(role.names),
      confidence: role.confidence,
      evidence: evidenceFor(role.factIds)
    })
  }
  for (const system of process.systems) {
    addObject({
      logicalId: `s:${system.id}`,
      cause: system.id,
      representativeFor: system.id,
      objectType: OT_APPL_SYS,
      symbolType: ST_APPL_SYS,
      names: localizedText(system.names),
      confidence: system.confidence,
      evidence: evidenceFor(system.factIds)
    })
  }
  for (const info of process.informationObjects) {
    addObject({
      logicalId: `io:${info.id}`,
      cause: info.id,
      representativeFor: info.id,
      objectType: OT_INFO_CARR,
      symbolType: ST_INFO_CARR_EDOC,
      names: localizedText(info.names),
      confidence: info.confidence,
      evidence: evidenceFor(info.factIds)
    })
  }
  for (const control of process.controls) {
    addObject({
      logicalId: `c:${control.id}`,
      cause: control.id,
      representativeFor: control.id,
      objectType: controlObjectType(control),
      symbolType: controlSymbolType(control),
      names: localizedText(control.names),
      confidence: control.confidence,
      evidence: evidenceFor(control.factIds)
    })
  }

  // === Phase B: control-flow relations ====================================
  for (const edge of process.edges) {
    // parallel is realized as an AND split/merge below; exception-route is the
    // XOR exception branch handled in the exception pass; data-flow is not a
    // control-flow relation at all. Every canonical edge that yields no draft
    // relation is surfaced (never silently dropped) by `validateProjectedDraft`
    // — see the unprojected-edge finding in `findings.ts`.
    if (edge.kind === 'parallel' || edge.kind === 'exception-route' || edge.kind === 'data-flow') {
      continue
    }
    // Carry a branch label onto the relation wherever the contract supplies one,
    // so it survives into the draft/AML/SVG and labels any XOR split it leaves:
    //  - a `conditional` edge's REQUIRED `condition` text becomes the relation
    //    name (otherwise the condition is silently dropped — nothing else reads
    //    `edge.condition`);
    //  - a normal branch OUT of an exception node (whose source projects to the
    //    XOR `xe:`) is labelled with its target's names so it never trips
    //    `epc.rule.unlabeledDecisionBranch`, mirroring the decision
    //    belt-and-braces. Applied only when the target does not itself supply
    //    the label (an `event`/`wait` projects to a NAMED OT_EVT), so an
    //    already-labelled event branch is left byte-for-byte unchanged.
    let names: ArisAiLocalizedText | undefined
    if (edge.kind === 'conditional') {
      names = localizedText(edge.condition)
    } else if (exceptionNodeIds.has(edge.sourceNodeId)) {
      const targetNode = nodeById.get(edge.targetNodeId)
      if (targetNode !== undefined && targetNode.kind !== 'event' && targetNode.kind !== 'wait') {
        names = localizedText(targetNode.names)
      }
    }
    addFlowRelation({
      logicalId: `e:${edge.id}`,
      cause: edge.id,
      source: representativeObjectId(edge.sourceNodeId),
      target: representativeObjectId(edge.targetNodeId),
      confidence: edge.confidence,
      ...(names && (names.en !== undefined || names.ar !== undefined) ? { names } : {})
    })
  }

  // decisions: decidingFunc -> XOR -> (named outcome events) -> outcome target
  for (const decision of process.decisions) {
    const decidingFunc = `n:${decision.nodeId}`
    const ruleId = `x:${decision.id}`
    addFlowRelation({
      logicalId: synthRelId(decidingFunc, ruleId),
      cause: decision.id,
      source: decidingFunc,
      target: ruleId,
      confidence: decision.confidence
    })
    for (const outcome of decision.outcomes) {
      const outcomeEventId = `xo:${decision.id}:${outcome.id}`
      // rule -> outcome event: CT_ACTIV_1 + names (expansion table, verbatim).
      addFlowRelation({
        logicalId: synthRelId(ruleId, outcomeEventId),
        cause: decision.id,
        source: ruleId,
        target: outcomeEventId,
        confidence: decision.confidence,
        connectionType: CT_ACTIV_1,
        names: localizedText(outcome.names)
      })
      const target = representativeObjectId(outcome.targetNodeId)
      // outcome event -> target: CT_ACTIV_1 (spliced to a filler if EVT->EVT).
      addFlowRelation({
        logicalId: synthRelId(outcomeEventId, target),
        cause: decision.id,
        source: outcomeEventId,
        target,
        confidence: decision.confidence,
        connectionType: CT_ACTIV_1
      })
    }
  }

  // parallel: AND split after each fan-out node, AND merge before each fan-in.
  for (const node of process.nodes) {
    if (fanOutNodes.has(node.id)) {
      addFlowRelation({
        logicalId: synthRelId(`n:${node.id}`, `ps:${node.id}`),
        cause: node.id,
        source: `n:${node.id}`,
        target: `ps:${node.id}`,
        confidence: node.confidence
      })
    }
    if (fanInNodes.has(node.id)) {
      addFlowRelation({
        logicalId: synthRelId(`pm:${node.id}`, `n:${node.id}`),
        cause: node.id,
        source: `pm:${node.id}`,
        target: `n:${node.id}`,
        confidence: node.confidence
      })
    }
  }
  for (const edge of process.edges) {
    if (edge.kind !== 'parallel') continue
    const source = fanOutNodes.has(edge.sourceNodeId)
      ? `ps:${edge.sourceNodeId}`
      : representativeObjectId(edge.sourceNodeId)
    const target = fanInNodes.has(edge.targetNodeId)
      ? `pm:${edge.targetNodeId}`
      : representativeObjectId(edge.targetNodeId)
    addFlowRelation({
      logicalId: synthRelId(source, target),
      cause: edge.id,
      source,
      target,
      confidence: edge.confidence
    })
  }

  // exceptions: XOR -> exception event -> route target (branch B); the normal
  // branch(es) and the incoming flow are ordinary edges via the resolvers.
  for (const node of process.nodes) {
    if (node.kind !== 'exception') continue
    const ruleId = `xe:${node.id}`
    const eventId = `xev:${node.id}`
    addFlowRelation({
      logicalId: synthRelId(ruleId, eventId),
      cause: node.id,
      source: ruleId,
      target: eventId,
      confidence: node.confidence
    })
    for (const edge of process.edges) {
      if (edge.kind !== 'exception-route' || edge.sourceNodeId !== node.id) continue
      const target = representativeObjectId(edge.targetNodeId)
      addFlowRelation({
        logicalId: synthRelId(eventId, target),
        cause: edge.id,
        source: eventId,
        target,
        confidence: edge.confidence,
        connectionType: CT_ACTIV_1
      })
    }
  }

  // === Phase C: alternation completion ====================================
  applyAlternationCompletion({
    flowRelations,
    objectTypeById,
    objectById,
    edgeByDraftId,
    addObject
  })

  // === Phase D: satellite relations =======================================
  for (const role of process.roles) {
    for (const nodeId of role.nodeIds) {
      const target = representativeObjectId(nodeId)
      addSatelliteRelation({
        logicalId: synthRelId(`r:${role.id}`, target),
        cause: role.id,
        source: `r:${role.id}`,
        target,
        connectionType: CT_EXEC_1,
        confidence: role.confidence
      })
    }
  }
  for (const system of process.systems) {
    for (const nodeId of system.nodeIds) {
      const target = representativeObjectId(nodeId)
      addSatelliteRelation({
        logicalId: synthRelId(`s:${system.id}`, target),
        cause: system.id,
        source: `s:${system.id}`,
        target,
        connectionType: CT_SUPP_3,
        confidence: system.confidence
      })
    }
  }
  for (const info of process.informationObjects) {
    for (const nodeId of info.inputToNodeIds) {
      const target = representativeObjectId(nodeId)
      addSatelliteRelation({
        logicalId: synthRelId(`io:${info.id}`, target),
        cause: info.id,
        source: `io:${info.id}`,
        target,
        connectionType: CT_IS_INP_FOR,
        confidence: info.confidence
      })
    }
    for (const nodeId of info.outputOfNodeIds) {
      const source = representativeObjectId(nodeId)
      addSatelliteRelation({
        logicalId: synthRelId(source, `io:${info.id}`),
        cause: info.id,
        source,
        target: `io:${info.id}`,
        connectionType: CT_HAS_OUT,
        confidence: info.confidence
      })
    }
  }
  for (const control of process.controls) {
    for (const nodeId of control.nodeIds) {
      const target = representativeObjectId(nodeId)
      addSatelliteRelation({
        logicalId: synthRelId(`c:${control.id}`, target),
        cause: control.id,
        source: `c:${control.id}`,
        target,
        connectionType: controlConnectionType(control),
        confidence: control.confidence
      })
    }
  }

  // === Phase E: owner AT_PERS_RESP model attributes + uncertainties =======
  for (const role of process.roles) {
    if (role.owner === true) {
      topLevelAttributes.push({
        logicalId: `a:${role.id}:${AT_PERS_RESP}`,
        ownerKind: 'model',
        ownerLogicalId: primaryModelId,
        attributeType: AT_PERS_RESP,
        values: localizedText(role.names),
        confidence: role.confidence
      })
    }
  }
  for (const unknown of process.unknowns) {
    const target = draftByCanonicalId.get(unknown.targetId) ?? primaryModelId
    const message = unknown.message.en ?? unknown.message.ar ?? unknown.targetId
    const uncertainty: {
      targetLogicalId: string
      kind: ArisAiUncertainty['kind']
      field?: string
      message: string
      evidence?: string
    } = {
      targetLogicalId: target,
      kind: unknown.kind,
      message
    }
    if (unknown.field !== undefined) uncertainty.field = unknown.field
    const evidence = evidenceFor(unknown.factIds)
    if (evidence !== undefined) uncertainty.evidence = evidence
    uncertainties.push(uncertainty)
  }

  // === Phase F: suggestedOrder (draft-flow DFS spine) =====================
  assignSuggestedOrder(objects, flowRelations)

  // === Phase G: assemble ==================================================
  const draft: ArisAiDraftV1 = {
    version: 1,
    models,
    objects,
    relations: [...flowRelations, ...satelliteRelations],
    attributes: topLevelAttributes,
    assignments,
    uncertainties
  }

  return {
    draft,
    anchors: {
      nodeByDraftId,
      edgeByDraftId
    }
  }
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

function waitDetailAttribute(node: CanonicalNode): ArisAiAttribute | null {
  const detail = node.waitDetail
  if (!detail) return null
  const values: { en?: string; ar?: string } = {}
  if (detail.en !== undefined) values.en = `wait: ${detail.en}`
  if (detail.ar !== undefined) values.ar = `انتظار: ${detail.ar}`
  if (values.en === undefined && values.ar === undefined) return null
  return {
    logicalId: `a:n:${node.id}:${AT_DESC}`,
    ownerKind: 'object',
    ownerLogicalId: `n:${node.id}`,
    attributeType: AT_DESC,
    values,
    confidence: node.confidence
  }
}

function decisionCriteriaAttribute(
  node: CanonicalNode,
  decision: CanonicalDecision | undefined
): ArisAiAttribute | null {
  const criteria = decision?.criteria
  if (!criteria) return null
  const values: { en?: string; ar?: string } = {}
  if (criteria.en !== undefined) values.en = criteria.en
  if (criteria.ar !== undefined) values.ar = criteria.ar
  if (values.en === undefined && values.ar === undefined) return null
  return {
    logicalId: `a:n:${node.id}:${AT_DESC}`,
    ownerKind: 'object',
    ownerLogicalId: `n:${node.id}`,
    attributeType: AT_DESC,
    values,
    confidence: decision?.confidence ?? node.confidence
  }
}

function controlObjectType(control: CanonicalControl): string {
  switch (control.kind) {
    case 'policy':
      return OT_POLICY
    case 'business-rule':
      return OT_BUSINESS_RULE
    case 'requirement':
      return OT_REQUIREMENT
  }
}

/** ARIS symbol type for a control — matches the OT_ classification above so
 * the renderer's registry hits the exact-triple lookup (MT_EEPC:OT_X:ST_X)
 * instead of falling back to orbitpm:unknown-symbol. */
function controlSymbolType(control: CanonicalControl): string {
  switch (control.kind) {
    case 'policy':
      return ST_BUSINESS_POLICY
    case 'business-rule':
      return ST_BUSINESS_RULE
    case 'requirement':
      return ST_REQUIREMENT
  }
}

function controlConnectionType(control: CanonicalControl): string {
  switch (control.kind) {
    case 'policy':
      return CT_AFFECTS
    case 'business-rule':
      return CT_IS_EVAL_BY_1
    case 'requirement':
      return CT_REFS_TO_2
  }
}

/** `fe:`/`ff:` filler id suffix for a split relation (primary edge -> `<cid>`). */
function fillerSuffix(relationLogicalId: string): string {
  return relationLogicalId.startsWith('e:') ? relationLogicalId.slice(2) : relationLogicalId
}

function completedFillerNames(sourceNames: ArisAiLocalizedText): ArisAiLocalizedText {
  const out: { en?: string; ar?: string } = {}
  if (sourceNames.en !== undefined) out.en = `${sourceNames.en} completed`
  if (sourceNames.ar !== undefined) out.ar = `اكتمل ${sourceNames.ar}`
  return out
}

function handleFillerNames(targetNames: ArisAiLocalizedText): ArisAiLocalizedText {
  const out: { en?: string; ar?: string } = {}
  if (targetNames.en !== undefined) out.en = `Handle ${targetNames.en}`
  if (targetNames.ar !== undefined) out.ar = `معالجة ${targetNames.ar}`
  return out
}

interface AlternationContext {
  flowRelations: MutableRelation[]
  objectTypeById: Map<string, string>
  objectById: Map<string, MutableObject>
  edgeByDraftId: Record<string, string>
  addObject: (spec: {
    logicalId: string
    cause: string
    objectType: string
    symbolType?: string
    names: ArisAiLocalizedText
    confidence: ArisAiConfidence
  }) => void
}

/**
 * Final deterministic pass: every func->func control-flow relation (except the
 * exempt CT_IS_PREDEC_OF_1 tuple) gets an OT_EVT spliced in; every evt->evt
 * gets an OT_FUNC. A single pass suffices — splicing only ever produces
 * properly-alternating func<->event pairs, never a new offender.
 */
function applyAlternationCompletion(ctx: AlternationContext): void {
  const original = ctx.flowRelations.splice(0, ctx.flowRelations.length)
  const pushRelation = (relation: MutableRelation): void => {
    ctx.flowRelations.push(relation)
  }

  // An OT_EVT feeding a *splitting* XOR rule directly (out-degree >= 2) trips
  // `epc.event.decisionViolation` ("only a rule may decide, never an event") —
  // it happens when an `event`/`wait` sequences straight into an exception node
  // (source EVT -> the `xe:` XOR split). Shield it with a filler function: the
  // EVT->splitting-XOR analogue of the FUNC<->FUNC / EVT<->EVT splices below.
  // Out-degree is taken over the pre-splice relation set; a splice only ever
  // rewrites the inbound (source) side of an edge, never a rule's outgoing
  // count, so the single-pass property still holds.
  const ruleOutDegree = new Map<string, number>()
  for (const relation of original) {
    if (ctx.objectTypeById.get(relation.sourceLogicalId) === OT_RULE) {
      ruleOutDegree.set(
        relation.sourceLogicalId,
        (ruleOutDegree.get(relation.sourceLogicalId) ?? 0) + 1
      )
    }
  }
  // A splitting XOR is the only decision-making split the projection emits (AND
  // forks are exempt from the event-decision rule, and OR is never produced).
  const isSplittingXor = (id: string): boolean =>
    (ruleOutDegree.get(id) ?? 0) >= 2 && ctx.objectById.get(id)?.symbolType === ST_OPR_XOR_1

  for (const relation of original) {
    const sourceType = ctx.objectTypeById.get(relation.sourceLogicalId) ?? ''
    const targetType = ctx.objectTypeById.get(relation.targetLogicalId) ?? ''
    const cause = ctx.edgeByDraftId[relation.logicalId] ?? relation.logicalId

    if (
      sourceType === OT_FUNC &&
      targetType === OT_FUNC &&
      relation.connectionType !== CT_IS_PREDEC_OF_1
    ) {
      const fillerId = `fe:${fillerSuffix(relation.logicalId)}`
      const sourceNames = ctx.objectById.get(relation.sourceLogicalId)?.names ?? {}
      ctx.addObject({
        logicalId: fillerId,
        cause,
        objectType: OT_EVT,
        symbolType: ST_EV,
        names: completedFillerNames(sourceNames),
        confidence: 'high'
      })
      spliceRelation(ctx, relation, fillerId, cause, pushRelation)
      continue
    }

    if (sourceType === OT_EVT && targetType === OT_EVT) {
      const fillerId = `ff:${fillerSuffix(relation.logicalId)}`
      const targetNames = ctx.objectById.get(relation.targetLogicalId)?.names ?? {}
      ctx.addObject({
        logicalId: fillerId,
        cause,
        objectType: OT_FUNC,
        symbolType: ST_FUNC,
        names: handleFillerNames(targetNames),
        confidence: 'high'
      })
      spliceRelation(ctx, relation, fillerId, cause, pushRelation)
      continue
    }

    if (
      sourceType === OT_EVT &&
      targetType === OT_RULE &&
      isSplittingXor(relation.targetLogicalId)
    ) {
      const fillerId = `ff:${fillerSuffix(relation.logicalId)}`
      const sourceNames = ctx.objectById.get(relation.sourceLogicalId)?.names ?? {}
      ctx.addObject({
        logicalId: fillerId,
        cause,
        objectType: OT_FUNC,
        symbolType: ST_FUNC,
        names: handleFillerNames(sourceNames),
        confidence: 'high'
      })
      spliceRelation(ctx, relation, fillerId, cause, pushRelation)
      continue
    }

    pushRelation(relation)
  }
}

function spliceRelation(
  ctx: AlternationContext,
  relation: MutableRelation,
  fillerId: string,
  cause: string,
  push: (relation: MutableRelation) => void
): void {
  const fillerType = ctx.objectTypeById.get(fillerId) ?? ''
  const sourceType = ctx.objectTypeById.get(relation.sourceLogicalId) ?? ''
  const targetType = ctx.objectTypeById.get(relation.targetLogicalId) ?? ''

  const firstId = `re:${relation.sourceLogicalId}:${fillerId}`
  const secondId = `re:${fillerId}:${relation.targetLogicalId}`
  const first: MutableRelation = {
    logicalId: firstId,
    modelLogicalId: relation.modelLogicalId,
    sourceLogicalId: relation.sourceLogicalId,
    targetLogicalId: fillerId,
    connectionType: flowConnectionType(sourceType, fillerType),
    confidence: relation.confidence
  }
  const second: MutableRelation = {
    logicalId: secondId,
    modelLogicalId: relation.modelLogicalId,
    sourceLogicalId: fillerId,
    targetLogicalId: relation.targetLogicalId,
    connectionType: flowConnectionType(fillerType, targetType),
    confidence: relation.confidence
  }
  // Preserve any label the spliced relation carried onto the first segment, so a
  // `conditional` edge whose endpoints happen to be same-typed (FUNC->FUNC /
  // EVT->EVT) keeps its `condition` text in the draft rather than losing it to
  // the splice. Most spliced relations are unnamed (the decision rule->outcome
  // edges, which are the only other named flow relations, are RULE->EVT and are
  // never spliced), so this is a no-op for them.
  if (relation.names !== undefined) first.names = relation.names

  ctx.edgeByDraftId[firstId] = cause
  ctx.edgeByDraftId[secondId] = cause
  push(first)
  push(second)
}

/**
 * Assign `suggestedOrder` to every flow object (event/function/rule) by a
 * depth-first walk of the draft flow graph from its start events, so
 * synthesized nodes fall immediately after their trigger. Satellites keep no
 * order (they are not flow nodes). Deterministic: adjacency is taken in
 * relation-array order and starts in object-creation order.
 */
function assignSuggestedOrder(
  objects: MutableObject[],
  flowRelations: readonly MutableRelation[]
): void {
  const flowTypes = new Set([OT_EVT, OT_FUNC, OT_RULE])
  const flowIdSet = new Set(
    objects.filter((object) => flowTypes.has(object.objectType)).map((object) => object.logicalId)
  )
  const isFlow = (id: string): boolean => flowIdSet.has(id)

  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const relation of flowRelations) {
    const list = adjacency.get(relation.sourceLogicalId) ?? []
    list.push(relation.targetLogicalId)
    adjacency.set(relation.sourceLogicalId, list)
    indegree.set(relation.targetLogicalId, (indegree.get(relation.targetLogicalId) ?? 0) + 1)
  }

  const order = new Map<string, number>()
  let counter = 0
  const visit = (id: string): void => {
    if (order.has(id) || !isFlow(id)) return
    order.set(id, counter)
    counter += 1
    for (const target of adjacency.get(id) ?? []) visit(target)
  }

  const flowIds = objects
    .filter((object) => flowTypes.has(object.objectType))
    .map((object) => object.logicalId)
  for (const id of flowIds) {
    if ((indegree.get(id) ?? 0) === 0) visit(id)
  }
  for (const id of flowIds) visit(id)

  for (const object of objects) {
    const assigned = order.get(object.logicalId)
    if (assigned !== undefined) object.suggestedOrder = assigned
  }
}
