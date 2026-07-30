/**
 * Shared validation findings core.
 *
 * Combines the EPC structural findings (`buildArisEpcFindings`) and the 15-kind gap scanner
 * (`scanArisGaps`) into a single `ArisValidationFinding` shape. The shape is consumed by both
 * the right-rail validation section and the per-element canvas warning markers.
 */

import type { ArisWorkingDocument } from '../model/types'
import type { ArisChatGap, ArisChatGapKind } from '../chat/gapScanner'
import type { ArisEpcModelFinding } from './arisEpcFindings'
import type { ArisDetailsTabId } from '../details/tabs'

export type ArisRailFieldTarget =
  | { readonly kind: 'name'; readonly lang: 'en' | 'ar' }
  | { readonly kind: 'attribute'; readonly attributeType: string }
  | { readonly kind: 'section' }

export interface ArisRailTarget {
  /** Only the tabs that host a fixable field/section are ever used. */
  readonly tab: ArisDetailsTabId
  readonly field: ArisRailFieldTarget | null
}

export interface ArisValidationFinding {
  /** Stable list key: `${source}:${ruleId ?? kind}:${targetIds.join(',')}`. */
  readonly key: string
  readonly source: 'epc' | 'gap'
  /** Gap kind; for EPC rows the mapped kind (start/end → 'missingStartOrEndEvent', …). */
  readonly kind: ArisChatGapKind
  /** EPC rule id, EPC rows only (preserves the `data-orbitpm-aris-epc-finding` contract). */
  readonly ruleId: string | null
  readonly severity: 'error' | 'warning'
  readonly messageKey: string
  readonly messageParams?: Readonly<Record<string, string>>
  /** The element `revealAndHighlight` selects; null ⇒ use fallbackModelId or show the notice. */
  readonly anchorElementId: string | null
  /** Model to switch to + root-select when no anchor exists (EPC model-scoped rows). */
  readonly fallbackModelId: string | null
  /** Every occurrence/connection that gets an issue-6 marker (definitions are expanded). */
  readonly canvasElementIds: readonly string[]
  /** Rail tab/field to open + flash; null ⇒ selection alone is the highlight. */
  readonly railTarget: ArisRailTarget | null
}

/** EPC rule id → the gap kind used for mapping and rail/markers. */
export const EPC_RULE_GAP_KINDS: Readonly<Record<string, ArisChatGapKind>> = Object.freeze({
  'epc.startEnd.missingStart': 'missingStartOrEndEvent',
  'epc.startEnd.missingEnd': 'missingStartOrEndEvent',
  'epc.alternation': 'invalidSequence',
  'epc.rule.splitMergeConflict': 'invalidSequence',
  'epc.event.decisionViolation': 'invalidSequence',
  'epc.rule.unrecognizedSymbol': 'invalidSequence',
  'epc.connectivity.orphanNode': 'danglingObjectOrConnection',
  'epc.connection.missingType': 'danglingObjectOrConnection',
  'epc.linkedModel.danglingReference': 'danglingObjectOrConnection'
})

const START_END_RULE_IDS = new Set(['epc.startEnd.missingStart', 'epc.startEnd.missingEnd'])

export interface ArisValidationFindingOptions {
  /** Occurrences on this model win the anchor slot. Default null. */
  readonly preferredModelId?: string | null
  /** Attribute-type vocabulary; default mirrors DEFAULT_GAP_SCAN_CONFIG. */
  readonly attributeTypes?: {
    readonly processCode: string
    readonly owner: string
    readonly decisionBasis: string
  }
}

const DEFAULT_ATTRIBUTE_TYPES: NonNullable<ArisValidationFindingOptions['attributeTypes']> =
  Object.freeze({
    processCode: 'AT_PROC_CODE',
    owner: 'AT_PERS_RESP',
    decisionBasis: 'AT_DESC'
  })

interface OccurrenceIndex {
  readonly occurrenceIdsByDefinitionId: ReadonlyMap<string, readonly string[]>
  readonly occurrenceIds: ReadonlySet<string>
  readonly connectionOccurrenceIds: ReadonlySet<string>
}

function buildOccurrenceIndex(
  document: ArisWorkingDocument,
  preferredModelId: string | null | undefined
): OccurrenceIndex {
  const byDefinition = new Map<string, { preferred: string[]; others: string[] }>()
  const occurrenceIds = new Set<string>()
  const connectionOccurrenceIds = new Set<string>()

  for (const [modelId, model] of document.models) {
    for (const occurrence of model.occurrences) {
      occurrenceIds.add(occurrence.id)
      let entry = byDefinition.get(occurrence.definitionId)
      if (!entry) {
        entry = { preferred: [], others: [] }
        byDefinition.set(occurrence.definitionId, entry)
      }
      if (modelId === preferredModelId) {
        entry.preferred.push(occurrence.id)
      } else {
        entry.others.push(occurrence.id)
      }
    }

    for (const connection of model.connectionOccurrences) {
      connectionOccurrenceIds.add(connection.id)
    }
  }

  const occurrenceIdsByDefinitionId = new Map<string, readonly string[]>()
  for (const [definitionId, { preferred, others }] of byDefinition) {
    occurrenceIdsByDefinitionId.set(definitionId, Object.freeze([...preferred, ...others]))
  }

  return {
    occurrenceIdsByDefinitionId: Object.freeze(occurrenceIdsByDefinitionId),
    occurrenceIds: Object.freeze(occurrenceIds),
    connectionOccurrenceIds: Object.freeze(connectionOccurrenceIds)
  }
}

function epcFindingTargetIds(finding: ArisEpcModelFinding): readonly string[] {
  return Object.freeze([...finding.nodeIds, ...finding.edgeIds])
}

function epcCanvasElementIds(
  finding: ArisEpcModelFinding,
  occurrenceIds: ReadonlySet<string>,
  connectionOccurrenceIds: ReadonlySet<string>
): readonly string[] {
  if (START_END_RULE_IDS.has(finding.ruleId)) {
    return Object.freeze([])
  }

  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of [...finding.nodeIds, ...finding.edgeIds]) {
    if (seen.has(id)) continue
    if (!occurrenceIds.has(id) && !connectionOccurrenceIds.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return Object.freeze(ids)
}

function epcRailTarget(ruleId: string): ArisRailTarget | null {
  if (ruleId === 'epc.linkedModel.danglingReference') {
    return Object.freeze({ tab: 'assignments', field: Object.freeze({ kind: 'section' }) })
  }
  return null
}

function buildEpcFinding(
  finding: ArisEpcModelFinding,
  index: OccurrenceIndex
): ArisValidationFinding {
  const targetIds = epcFindingTargetIds(finding)
  const kind = EPC_RULE_GAP_KINDS[finding.ruleId] ?? 'invalidSequence'
  return Object.freeze({
    key: `epc:${finding.ruleId}:${targetIds.join(',')}`,
    source: 'epc' as const,
    kind,
    ruleId: finding.ruleId,
    severity: finding.severity,
    messageKey: finding.messageKey,
    ...(finding.messageParams ? { messageParams: finding.messageParams } : {}),
    anchorElementId: finding.nodeIds[0] ?? finding.edgeIds[0] ?? null,
    fallbackModelId: finding.modelId,
    canvasElementIds: epcCanvasElementIds(
      finding,
      index.occurrenceIds,
      index.connectionOccurrenceIds
    ),
    railTarget: epcRailTarget(finding.ruleId)
  })
}

function gapRailTarget(
  kind: ArisChatGapKind,
  attributeTypes: NonNullable<ArisValidationFindingOptions['attributeTypes']>
): ArisRailTarget | null {
  switch (kind) {
    case 'missingEnglishName':
      return Object.freeze({
        tab: 'names',
        field: Object.freeze({ kind: 'name', lang: 'en' as const })
      })
    case 'missingArabicName':
      return Object.freeze({
        tab: 'names',
        field: Object.freeze({ kind: 'name', lang: 'ar' as const })
      })
    case 'missingProcessCode':
      return Object.freeze({
        tab: 'attributes',
        field: Object.freeze({ kind: 'attribute', attributeType: attributeTypes.processCode })
      })
    case 'missingOwner':
      return Object.freeze({
        tab: 'attributes',
        field: Object.freeze({ kind: 'attribute', attributeType: attributeTypes.owner })
      })
    case 'missingDecisionBasis':
      return Object.freeze({
        tab: 'attributes',
        field: Object.freeze({ kind: 'attribute', attributeType: attributeTypes.decisionBasis })
      })
    case 'missingLinkedModel':
      return Object.freeze({ tab: 'assignments', field: Object.freeze({ kind: 'section' }) })
    case 'missingAttachment':
      return Object.freeze({ tab: 'attachments', field: Object.freeze({ kind: 'section' }) })
    default:
      return null
  }
}

function resolveGapAnchor(
  gap: ArisChatGap,
  document: ArisWorkingDocument,
  index: OccurrenceIndex
): {
  readonly anchorElementId: string | null
  readonly fallbackModelId: string | null
  readonly canvasElementIds: readonly string[]
} {
  const targetId = gap.targetIds[0]
  if (targetId === undefined) {
    return { anchorElementId: null, fallbackModelId: null, canvasElementIds: Object.freeze([]) }
  }

  if (document.models.has(targetId)) {
    return {
      anchorElementId: null,
      fallbackModelId: targetId,
      canvasElementIds: Object.freeze([])
    }
  }

  if (index.occurrenceIds.has(targetId) || index.connectionOccurrenceIds.has(targetId)) {
    return {
      anchorElementId: targetId,
      fallbackModelId: null,
      canvasElementIds: Object.freeze([targetId])
    }
  }

  if (document.objectDefinitions.has(targetId)) {
    const occurrences = index.occurrenceIdsByDefinitionId.get(targetId) ?? Object.freeze([])
    return {
      anchorElementId: occurrences[0] ?? null,
      fallbackModelId: null,
      canvasElementIds: occurrences
    }
  }

  return { anchorElementId: null, fallbackModelId: null, canvasElementIds: Object.freeze([]) }
}

function buildGapFinding(
  gap: ArisChatGap,
  document: ArisWorkingDocument,
  index: OccurrenceIndex,
  attributeTypes: NonNullable<ArisValidationFindingOptions['attributeTypes']>
): ArisValidationFinding {
  const { anchorElementId, fallbackModelId, canvasElementIds } = resolveGapAnchor(
    gap,
    document,
    index
  )

  return Object.freeze({
    key: `gap:${gap.kind}:${gap.targetIds.join(',')}`,
    source: 'gap' as const,
    kind: gap.kind,
    ruleId: null,
    severity: gap.severity,
    messageKey: gap.messageKey,
    ...(gap.messageParams ? { messageParams: gap.messageParams } : {}),
    anchorElementId,
    fallbackModelId,
    canvasElementIds,
    railTarget: gapRailTarget(gap.kind, attributeTypes)
  })
}

/**
 * Combine EPC findings and gap-scan results into a unified, reveal/marker-ready finding list.
 *
 * EPC findings are emitted first (preserving `epcFindings` order), then non-duplicate gap rows
 * (preserving `gaps` order). Gaps whose `messageKey` starts with `aris.epc.finding.` are skipped
 * because the EPC rows already carry the canonical `ruleId` + `modelId` fallback.
 */
export function buildArisValidationFindings(
  document: ArisWorkingDocument,
  epcFindings: readonly ArisEpcModelFinding[],
  gaps: readonly ArisChatGap[],
  options?: ArisValidationFindingOptions
): readonly ArisValidationFinding[] {
  const attributeTypes = options?.attributeTypes ?? DEFAULT_ATTRIBUTE_TYPES
  const preferredModelId = options?.preferredModelId ?? null
  const index = buildOccurrenceIndex(document, preferredModelId)

  const findings: ArisValidationFinding[] = []
  for (const finding of epcFindings) {
    findings.push(buildEpcFinding(finding, index))
  }

  for (const gap of gaps) {
    if (gap.messageKey.startsWith('aris.epc.finding.')) continue
    findings.push(buildGapFinding(gap, document, index, attributeTypes))
  }

  return Object.freeze(
    findings.map((finding) => Object.freeze(finding))
  ) as readonly ArisValidationFinding[]
}

function severityRank(severity: 'error' | 'warning'): number {
  return severity === 'error' ? 0 : 1
}

/**
 * Fan findings out by the canvas element ids they mark.
 *
 * Each element maps to its findings ordered errors-first; the sort is stable within a severity.
 */
export function findingsByCanvasElement(
  findings: readonly ArisValidationFinding[]
): ReadonlyMap<string, readonly ArisValidationFinding[]> {
  const map = new Map<string, ArisValidationFinding[]>()

  for (const finding of findings) {
    for (const elementId of finding.canvasElementIds) {
      let list = map.get(elementId)
      if (!list) {
        list = []
        map.set(elementId, list)
      }
      list.push(finding)
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  }

  return Object.freeze(map) as ReadonlyMap<string, readonly ArisValidationFinding[]>
}
