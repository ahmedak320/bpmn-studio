// Builds an `ArisProcessDigest` (Section 17.1) from the assistant's own
// `ArisAssistantModelInput` seam type (see types.ts). Conceptually mirrors
// `src/assist/digest.ts` (the BPMN assistant's digest builder): a compact,
// retrieval-friendly summary keyed off explicit ids so the UI can later
// select the exact source element (Section 17.6). The classification rules
// (which object types are steps vs. metadata, which connections mean
// "responsible"/"input"/"output"/"system") live in `arisVocabulary.ts`.

import {
  gatewayTypeFromSymbol,
  isApplicationSystemType,
  isBasisObjectType,
  isInfoObjectType,
  isPersonObjectType,
  isRuleObjectType,
  isStepObjectType
} from './arisVocabulary'
import type {
  ArisAssistantLocalizedText,
  ArisAssistantModelInput,
  ArisAssistantObjectOccurrenceInput,
  ArisDigestAssignment,
  ArisDigestDecision,
  ArisDigestGap,
  ArisDigestStep,
  ArisProcessDigest
} from './types'

/** Trimmed text with no placeholder fallback — used for metadata/labels that should be omitted when empty. */
function rawText(t: ArisAssistantLocalizedText): string | undefined {
  const en = t.en?.trim()
  if (en) return en
  const ar = t.ar?.trim()
  if (ar) return ar
  const fallback = t.fallback?.trim()
  if (fallback) return fallback
  return undefined
}

/** Humanize an ARIS type code for a placeholder display name: `OT_EVT` -> `Event`. */
function humanizeTypeCode(code: string): string {
  const withoutPrefix = code.replace(/^(OT|CT|MT)_/, '')
  return withoutPrefix
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface DisplayName {
  readonly name: string
  readonly nameEn?: string
  readonly nameAr?: string
}

/** A step/model always needs a display name — falls back to a humanized type code when unnamed. */
function displayName(t: ArisAssistantLocalizedText, objectType: string): DisplayName {
  const en = t.en?.trim() || undefined
  const ar = t.ar?.trim() || undefined
  const name = en ?? ar ?? t.fallback?.trim() ?? humanizeTypeCode(objectType) ?? '(unnamed)'
  const out: { name: string; nameEn?: string; nameAr?: string } = { name }
  if (en) out.nameEn = en
  if (ar) out.nameAr = ar
  return out
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key)
  if (set) set.add(value)
  else map.set(key, new Set([value]))
}

interface RawNextEdge {
  readonly targetOccurrenceId: string
  readonly relationType: string
  readonly outcome?: string
  /** Whether `outcome` came from an explicit connection label, vs. being left unset. */
  readonly explicitOutcome: boolean
}

/**
 * Build a digest from one already-parsed ARIS model. Never throws: a model
 * with zero recognizable step occurrences still yields a valid (mostly
 * empty) digest rather than a rejected promise, matching the BPMN digest
 * builder's "never throws" contract.
 */
export function buildDigest(model: ArisAssistantModelInput): ArisProcessDigest {
  const occById = new Map<string, ArisAssistantObjectOccurrenceInput>()
  for (const occ of model.occurrences) occById.set(occ.occurrenceId, occ)

  const stepOccs = model.occurrences.filter((o) => isStepObjectType(o.objectType))
  const stepIds = new Set(stepOccs.map((o) => o.occurrenceId))

  const respMap = new Map<string, Set<string>>()
  const inputMap = new Map<string, Set<string>>()
  const outputMap = new Map<string, Set<string>>()
  const systemMap = new Map<string, Set<string>>()
  const basisMap = new Map<string, Set<string>>()
  const nextMap = new Map<string, RawNextEdge[]>()
  const danglingConnectionIds: string[] = []

  const attachMetadata = (
    stepOccurrenceId: string,
    meta: ArisAssistantObjectOccurrenceInput,
    direction: 'metaToStep' | 'stepToMeta'
  ): void => {
    const metaName = rawText(meta.names)
    if (!metaName) return
    if (isPersonObjectType(meta.objectType)) {
      addTo(respMap, stepOccurrenceId, metaName)
    } else if (isApplicationSystemType(meta.objectType)) {
      addTo(systemMap, stepOccurrenceId, metaName)
    } else if (isInfoObjectType(meta.objectType)) {
      addTo(direction === 'metaToStep' ? inputMap : outputMap, stepOccurrenceId, metaName)
    } else if (isBasisObjectType(meta.objectType)) {
      addTo(basisMap, stepOccurrenceId, metaName)
    }
  }

  for (const c of model.connectionOccurrences) {
    const src = occById.get(c.sourceOccurrenceId)
    const tgt = occById.get(c.targetOccurrenceId)
    if (!src || !tgt) {
      danglingConnectionIds.push(c.occurrenceId)
      continue
    }
    const srcIsStep = stepIds.has(src.occurrenceId)
    const tgtIsStep = stepIds.has(tgt.occurrenceId)
    if (srcIsStep && tgtIsStep) {
      const label = rawText(c.names)
      const edge: RawNextEdge = {
        targetOccurrenceId: tgt.occurrenceId,
        relationType: c.connectionType,
        explicitOutcome: label !== undefined,
        ...(label !== undefined ? { outcome: label } : {})
      }
      const list = nextMap.get(src.occurrenceId)
      if (list) list.push(edge)
      else nextMap.set(src.occurrenceId, [edge])
      continue
    }
    if (srcIsStep && !tgtIsStep) attachMetadata(src.occurrenceId, tgt, 'stepToMeta')
    else if (!srcIsStep && tgtIsStep) attachMetadata(tgt.occurrenceId, src, 'metaToStep')
    // Neither side is a step: a metadata-to-metadata relation, out of digest scope.
  }

  const nameByOccId = new Map<string, string>()
  const nameEnByOccId = new Map<string, string>()
  const nameArByOccId = new Map<string, string>()
  const steps: ArisDigestStep[] = stepOccs.map((occ) => {
    const { name, nameEn, nameAr } = displayName(occ.names, occ.objectType)
    nameByOccId.set(occ.occurrenceId, name)
    if (nameEn) nameEnByOccId.set(occ.occurrenceId, nameEn)
    if (nameAr) nameArByOccId.set(occ.occurrenceId, nameAr)
    const step: ArisDigestStep = {
      occurrenceId: occ.occurrenceId,
      definitionId: occ.definitionId,
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(nameAr ? { nameAr } : {}),
      objectType: occ.objectType,
      responsible: [...(respMap.get(occ.occurrenceId) ?? [])],
      inputs: [...(inputMap.get(occ.occurrenceId) ?? [])],
      outputs: [...(outputMap.get(occ.occurrenceId) ?? [])],
      systems: [...(systemMap.get(occ.occurrenceId) ?? [])],
      next: (nextMap.get(occ.occurrenceId) ?? []).map((e) => ({
        targetOccurrenceId: e.targetOccurrenceId,
        relationType: e.relationType,
        ...(e.outcome !== undefined ? { outcome: e.outcome } : {})
      }))
    }
    return step
  })

  // Resolve target names now that every step's display name is known.
  const decisions: ArisDigestDecision[] = stepOccs
    .filter((occ) => isRuleObjectType(occ.objectType))
    .map((occ) => {
      const rawEdges = nextMap.get(occ.occurrenceId) ?? []
      const basisSet = basisMap.get(occ.occurrenceId)
      const decisionNameEn = nameEnByOccId.get(occ.occurrenceId)
      const decisionNameAr = nameArByOccId.get(occ.occurrenceId)
      const decision: ArisDigestDecision = {
        occurrenceId: occ.occurrenceId,
        definitionId: occ.definitionId,
        name: nameByOccId.get(occ.occurrenceId) ?? occ.occurrenceId,
        ...(decisionNameEn ? { nameEn: decisionNameEn } : {}),
        ...(decisionNameAr ? { nameAr: decisionNameAr } : {}),
        gatewayType: gatewayTypeFromSymbol(occ.symbol),
        ...(basisSet && basisSet.size > 0 ? { basis: [...basisSet].join('; ') } : {}),
        outcomes: rawEdges.map((e) => ({
          outcome: e.outcome ?? nameByOccId.get(e.targetOccurrenceId) ?? e.targetOccurrenceId,
          targetOccurrenceId: e.targetOccurrenceId,
          targetName: nameByOccId.get(e.targetOccurrenceId) ?? e.targetOccurrenceId
        }))
      }
      return decision
    })

  // Triggers: event-type steps with no incoming control-flow edge.
  const hasIncoming = new Set<string>()
  for (const edges of nextMap.values()) for (const e of edges) hasIncoming.add(e.targetOccurrenceId)
  const triggers = steps
    .filter((s) => s.objectType === 'OT_EVT' && !hasIncoming.has(s.occurrenceId))
    .map((s) => s.name)

  // Assignments: any occurrence (step or not) whose definition links to another model.
  const assignments: ArisDigestAssignment[] = []
  for (const occ of model.occurrences) {
    if (occ.linkedModelIds.length === 0) continue
    const { name, nameEn, nameAr } = displayName(occ.names, occ.objectType)
    for (const linkedModelId of occ.linkedModelIds) {
      assignments.push({
        occurrenceId: occ.occurrenceId,
        definitionId: occ.definitionId,
        name,
        ...(nameEn ? { nameEn } : {}),
        ...(nameAr ? { nameAr } : {}),
        linkedModelId
      })
    }
  }

  // Model-level attributes: process code + owners.
  const ownerSet = new Set<string>()
  let processCode: string | undefined
  for (const attr of model.attributes) {
    const text = rawText(attr.text)
    if (!text) continue
    if (attr.type === 'AT_PERS_RESP') ownerSet.add(text)
    else if (attr.type === 'AT_PROC_CODE' && processCode === undefined) processCode = text
  }
  if (ownerSet.size === 0) {
    for (const step of steps) for (const r of step.responsible) ownerSet.add(r)
  }

  const dedupe = (values: Iterable<string>): string[] => [...new Set(values)]
  const digestInputs = dedupe(steps.flatMap((s) => s.inputs))
  const digestOutputs = dedupe(steps.flatMap((s) => s.outputs))
  const digestSystems = dedupe(steps.flatMap((s) => s.systems))

  const missingInformation: ArisDigestGap[] = []
  if (processCode === undefined) missingInformation.push({ kind: 'missingProcessCode' })
  if (ownerSet.size === 0) missingInformation.push({ kind: 'missingOwner' })
  for (const step of steps) {
    if (!step.nameEn) {
      missingInformation.push({
        kind: 'missingNameEn',
        occurrenceId: step.occurrenceId,
        definitionId: step.definitionId,
        stepName: step.name
      })
    }
    if (!step.nameAr) {
      missingInformation.push({
        kind: 'missingNameAr',
        occurrenceId: step.occurrenceId,
        definitionId: step.definitionId,
        stepName: step.name
      })
    }
    if (step.objectType === 'OT_FUNC') {
      if (step.inputs.length === 0) {
        missingInformation.push({
          kind: 'missingInputs',
          occurrenceId: step.occurrenceId,
          definitionId: step.definitionId,
          stepName: step.name
        })
      }
      if (step.outputs.length === 0) {
        missingInformation.push({
          kind: 'missingOutputs',
          occurrenceId: step.occurrenceId,
          definitionId: step.definitionId,
          stepName: step.name
        })
      }
      if (step.systems.length === 0) {
        missingInformation.push({
          kind: 'missingSystem',
          occurrenceId: step.occurrenceId,
          definitionId: step.definitionId,
          stepName: step.name
        })
      }
    }
  }
  for (const decision of decisions) {
    if (!decision.basis) {
      missingInformation.push({
        kind: 'missingDecisionBasis',
        occurrenceId: decision.occurrenceId,
        definitionId: decision.definitionId,
        stepName: decision.name
      })
    }
    if (
      (decision.gatewayType === 'XOR' || decision.gatewayType === 'OR') &&
      decision.outcomes.length >= 2 &&
      !(nextMap.get(decision.occurrenceId) ?? []).some((e) => e.explicitOutcome)
    ) {
      missingInformation.push({
        kind: 'missingOutcome',
        occurrenceId: decision.occurrenceId,
        definitionId: decision.definitionId,
        stepName: decision.name,
        detail: `${decision.outcomes.length} branches with no explicit outcome label`
      })
    }
  }
  for (const danglingId of danglingConnectionIds) {
    missingInformation.push({ kind: 'danglingConnection', detail: danglingId })
  }

  const { name: modelName } = displayName(model.names, model.modelType)

  return {
    relPath: model.relPath,
    modelId: model.modelId,
    modelType: model.modelType,
    modelName,
    ...(processCode !== undefined ? { processCode } : {}),
    owners: [...ownerSet],
    triggers,
    steps,
    decisions,
    inputs: digestInputs,
    outputs: digestOutputs,
    systems: digestSystems,
    assignments,
    missingInformation
  }
}

/** Digest every model. Order follows `models` input order. */
export function buildAllDigests(models: readonly ArisAssistantModelInput[]): ArisProcessDigest[] {
  return models.map((m) => buildDigest(m))
}
