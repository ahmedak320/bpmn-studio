/**
 * Pre-render structural gate + machine-readable bilingual findings artifact
 * for the canonical->EPC projection (implementation plan Lane L-PROJECT,
 * Wave 19; master-plan "validate EPC structural rules BEFORE rendering").
 *
 * `validateProjectedDraft` runs `validateArisAiDraft` over the projected draft,
 * then projects each drafted model onto the shape `toEpcGraph` consumes —
 * exactly as `src/aris/ai/epcSemantics.ts`'s `adapterModelFor` does (the
 * adapter shape is COPIED here, not imported: this module must not pull in the
 * AI-repair wrapper) — and runs the existing `validateEpcGraph`. Every
 * resulting `EpcFinding` is mapped through the projection's anchor tables into
 * the canonical-id-keyed `EpcProjectionFinding` shape, with its bilingual
 * messages resolved from `./findingMessages`.
 *
 * Deterministic: `inputSha256` is the SHA-256 of `canonicalJsonBytes(process)`
 * (Web Crypto, available in Node 22 and the browser), and every findings array
 * is built in a fixed order, so the whole artifact is `canonicalJsonText`-stable
 * across runs.
 */

import type { ArisAiDraftV1, ArisAiLocalizedText } from '../ai/contract'
import { validateArisAiDraft } from '../ai/validateDraft'
import {
  FLOW_NODE_TYPES,
  toEpcGraph,
  validateEpcGraph,
  type EpcAdapterConnectionDefinition,
  type EpcAdapterConnectionOccurrence,
  type EpcAdapterModel,
  type EpcAdapterObjectDefinition,
  type EpcAdapterObjectOccurrence,
  type EpcFinding
} from '../epc'
import { canonicalJsonBytes } from '../packages/canonicalJson'
import type { CanonicalProcessV1 } from './contract'
import {
  PROJECTION_UNPROJECTED_EDGE_KEY,
  epcFindingMessages,
  epcProjectionMessages
} from './findingMessages'
import {
  PROJECTION_VERSION,
  type CanonicalProjectionAnchors,
  type CanonicalProjectionResult
} from './projectToEpc'

// ---------------------------------------------------------------------------
// Artifact shape (BINDING — the enterprise portal codes against these fields)
// ---------------------------------------------------------------------------

export interface EpcProjectionFinding {
  readonly ruleId: string
  readonly severity: 'error' | 'warning'
  /** An `aris.epc.finding.*` messageKey (or a `aris.projection.*` guard key). */
  readonly messageKey: string
  readonly messageEn: string
  readonly messageAr: string
  readonly canonicalNodeIds: readonly string[]
  readonly canonicalEdgeIds: readonly string[]
  readonly draftNodeIds: readonly string[]
  readonly draftEdgeIds: readonly string[]
}

export interface EpcProjectionFindings {
  readonly schemaVersion: 1
  readonly projectionVersion: 1
  /** SHA-256 (lowercase hex) of `canonicalJsonBytes(process)`. */
  readonly inputSha256: string
  /** No error-severity findings. */
  readonly ok: boolean
  readonly findings: readonly EpcProjectionFinding[]
}

/** ruleId/messageKey used when the draft itself fails `validateArisAiDraft`. */
export const PROJECTION_DRAFT_INVALID_KEY = 'aris.projection.draftInvalid'

// ---------------------------------------------------------------------------
// Adapter (copied from epcSemantics.adapterModelFor — do NOT import the wrapper)
// ---------------------------------------------------------------------------

function localizedValues(names: ArisAiLocalizedText | undefined): Record<string, string> {
  const values: Record<string, string> = {}
  if (names?.en) values.en = names.en
  if (names?.ar) values.ar = names.ar
  return values
}

/** Project one drafted model onto the shape `toEpcGraph` consumes. */
function adapterModelFor(draft: ArisAiDraftV1, modelLogicalId: string): EpcAdapterModel {
  const linkedModelsByObject = new Map<string, string[]>()
  for (const assignment of draft.assignments) {
    const list = linkedModelsByObject.get(assignment.objectLogicalId) ?? []
    list.push(assignment.assignedModelLogicalId)
    linkedModelsByObject.set(assignment.objectLogicalId, list)
  }

  const objects = draft.objects.filter((object) => object.modelLogicalId === modelLogicalId)
  const objectDefinitionById = new Map<string, EpcAdapterObjectDefinition>()
  const objectOccurrences: EpcAdapterObjectOccurrence[] = []
  for (const object of objects) {
    const linked = linkedModelsByObject.get(object.logicalId)
    objectDefinitionById.set(object.logicalId, {
      id: object.logicalId,
      type: object.objectType,
      names: { values: localizedValues(object.names) },
      ...(linked ? { linkedModelIds: linked } : {})
    })
    objectOccurrences.push({
      id: object.logicalId,
      definitionId: object.logicalId,
      symbol: object.symbolType ?? null
    })
  }

  const relations = draft.relations.filter((relation) => relation.modelLogicalId === modelLogicalId)
  const connectionDefinitionById = new Map<string, EpcAdapterConnectionDefinition>()
  const connectionOccurrences: EpcAdapterConnectionOccurrence[] = []
  for (const relation of relations) {
    connectionDefinitionById.set(relation.logicalId, {
      id: relation.logicalId,
      type: relation.connectionType
    })
    connectionOccurrences.push({
      id: relation.logicalId,
      definitionId: relation.logicalId,
      sourceOccurrenceId: relation.sourceLogicalId,
      targetOccurrenceId: relation.targetLogicalId,
      names: { values: localizedValues(relation.names) }
    })
  }

  return {
    modelId: modelLogicalId,
    objectOccurrences,
    objectDefinitionById,
    connectionOccurrences,
    connectionDefinitionById
  }
}

// ---------------------------------------------------------------------------
// Finding mapping
// ---------------------------------------------------------------------------

function dedupe(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function mapEpcFinding(
  finding: EpcFinding,
  anchors: CanonicalProjectionAnchors
): EpcProjectionFinding {
  const messages = epcFindingMessages(finding.messageKey, finding.messageParams)
  const canonicalNodeIds = dedupe(
    finding.nodeIds
      .map((id) => anchors.nodeByDraftId[id])
      .filter((id): id is string => id !== undefined)
  )
  const canonicalEdgeIds = dedupe(
    finding.edgeIds
      .map((id) => anchors.edgeByDraftId[id])
      .filter((id): id is string => id !== undefined)
  )
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    messageKey: finding.messageKey,
    messageEn: messages.en,
    messageAr: messages.ar,
    canonicalNodeIds,
    canonicalEdgeIds,
    draftNodeIds: [...finding.nodeIds],
    draftEdgeIds: [...finding.edgeIds]
  }
}

// ---------------------------------------------------------------------------
// SHA-256 (Web Crypto — isomorphic across Node 22 and the browser)
// ---------------------------------------------------------------------------

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (const byte of view) hex += byte.toString(16).padStart(2, '0')
  return hex
}

// ---------------------------------------------------------------------------
// validateProjectedDraft
// ---------------------------------------------------------------------------

/**
 * Run the pre-render structural gate over a projection result and produce the
 * bilingual, canonical-id-anchored findings artifact. Never throws.
 *
 * `ok` is true iff there are no error-severity findings — i.e. the draft is a
 * well-formed `ArisAiDraftV1` (else a `aris.projection.draftInvalid` error
 * finding is emitted per draft-validation failure) AND every drafted model
 * with control-flow objects passes `validateEpcGraph` without an error.
 */
export async function validateProjectedDraft(
  result: CanonicalProjectionResult,
  canonical: CanonicalProcessV1
): Promise<EpcProjectionFindings> {
  const inputSha256 = await sha256Hex(canonicalJsonBytes(canonical))
  const draft = result.draft
  const findings: EpcProjectionFinding[] = []

  const draftValidation = validateArisAiDraft(draft)
  if (!draftValidation.ok) {
    for (const draftFinding of draftValidation.findings) {
      findings.push({
        ruleId: `${PROJECTION_DRAFT_INVALID_KEY}:${draftFinding.code}`,
        severity: 'error',
        messageKey: PROJECTION_DRAFT_INVALID_KEY,
        messageEn: `${draftFinding.path}: ${draftFinding.message}`,
        messageAr: `${draftFinding.path}: ${draftFinding.message}`,
        canonicalNodeIds: [],
        canonicalEdgeIds: [],
        draftNodeIds: [],
        draftEdgeIds: []
      })
    }
  }

  const knownModelIds = new Set(draft.models.map((model) => model.logicalId))
  // The PRIMARY model (`m:<identity.id>`, always `draft.models[0]`) is ALWAYS
  // validated — even when it carries no flow objects — so a contract-legal but
  // empty process surfaces `missingStart`/`missingEnd` and is `ok:false` rather
  // than bypassing the gate and rendering a blank diagram at exit 0. The
  // `hasFlowNode` skip applies ONLY to linked placeholder models (a handoff's
  // empty child model), which legitimately hold no flow objects of their own.
  const primaryModelId = draft.models.length > 0 ? draft.models[0].logicalId : undefined
  for (const model of draft.models) {
    const isPrimary = model.logicalId === primaryModelId
    const hasFlowNode = draft.objects.some(
      (object) =>
        object.modelLogicalId === model.logicalId && FLOW_NODE_TYPES.has(object.objectType)
    )
    if (!isPrimary && !hasFlowNode) continue
    const graph = toEpcGraph(adapterModelFor(draft, model.logicalId))
    for (const epcFinding of validateEpcGraph(graph, { knownModelIds })) {
      findings.push(mapEpcFinding(epcFinding, result.anchors))
    }
  }

  // Surface every canonical edge that produced NO draft relation as a
  // warning-severity finding — never a silent drop. This catches `data-flow`
  // edges (whose factIds/confidence are otherwise lost) and any `exception-route`
  // whose source is not an exception node (control flow that would otherwise
  // vanish), plus any future unhandled edge kind. A projected edge records its
  // own id as the `cause` of the relation(s) it yields, so a canonical edge id
  // absent from the anchor table's values was dropped. Emitted in canonical
  // edge-array order for determinism.
  const causedEdgeIds = new Set(Object.values(result.anchors.edgeByDraftId))
  for (const edge of canonical.edges) {
    if (causedEdgeIds.has(edge.id)) continue
    const messages = epcProjectionMessages(PROJECTION_UNPROJECTED_EDGE_KEY, {
      edgeId: edge.id,
      edgeKind: edge.kind
    })
    findings.push({
      ruleId: PROJECTION_UNPROJECTED_EDGE_KEY,
      severity: 'warning',
      messageKey: PROJECTION_UNPROJECTED_EDGE_KEY,
      messageEn: messages.en,
      messageAr: messages.ar,
      canonicalNodeIds: dedupe([edge.sourceNodeId, edge.targetNodeId]),
      canonicalEdgeIds: [edge.id],
      draftNodeIds: [],
      draftEdgeIds: []
    })
  }

  const ok = findings.every((finding) => finding.severity !== 'error')

  return {
    schemaVersion: 1,
    projectionVersion: PROJECTION_VERSION,
    inputSha256,
    ok,
    findings
  }
}
