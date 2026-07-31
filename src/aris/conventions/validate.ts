/**
 * ARIS convention validation rules (plan R2/R3, issue 3).
 *
 * Five DMT ARIS Convention Manual alignment checks, each emitting an
 * `ArisEpcModelFinding`-shaped warning row so it flows through the same
 * `buildArisValidationFindings` pipeline as the `src/aris/epc` structural
 * findings. An unrecognized `ruleId` maps to kind `'invalidSequence'` there
 * (see `EPC_RULE_GAP_KINDS` in `../shell/arisValidationFindings`), which is
 * exactly what every `conv.*` id gets — these rules are never added to that
 * map. Messages are i18n lookups only, never prose: `messageKey` resolves
 * through the `aris.conv.finding.*` keys C4 registered in both the `en` and
 * `ar` dictionaries (the `.body` variant — the single string both the
 * validation rail row and the per-element canvas marker tooltip render).
 *
 * Rules key off ARIS **object types**, not model types, except where the
 * convention itself is inherently model-type-scoped:
 *  - `conv.connection.illegal` calls `isLegalConnection`, which IS
 *    model-type aware (EEPC control flow differs from VACD chain wiring),
 *    so every model is checked against its own type's legality table.
 *  - `conv.model.missingAttribute` is about the MODEL's own attribute bag
 *    (plan R3's per-model attribute list), not any object inside it.
 *  - The other three (`missingIdentifier`, `noExecutor`, `naming.hint`) key
 *    off `OT_FUNC` / the element attribute schema. `missingIdentifier` and
 *    `naming.hint` apply wherever that object type occurs — R3 explicitly
 *    lists "Function/VACD element" for the mandatory identifier, so EEPC
 *    functions and VACD chain elements are both in scope. `noExecutor`, by
 *    contrast, IS model-type-restricted (EEPC only): the DMT convention
 *    manual documents the R/A/C/I executor relationship solely as an EPC
 *    Objects Relationship ("Connection from Executor to Function"), while
 *    the VACD chapter defines only the Is-Predecessor-of and
 *    Is-Process-Oriented-Superior relationships and no executor wiring.
 *    Flagging a VACD chain element therefore manufactures findings that are
 *    not defects (14 false warnings on the AnimalWF VACD before this
 *    scoping).
 *
 * Models flagged `unsupported` (an ARIS model type this working document
 * doesn't decode) are skipped by every rule — the convention manual has
 * nothing to say about a record type nobody has interpreted yet.
 *
 * NOTE on `conv.model.missingAttribute` (a documented assumption): plan R3
 * lists the EPC model attribute schema, but as authored in `attributes.ts`
 * none of its entries carry `mandatory: true` (R3 never writes
 * "(Mandatory)" for a model attribute the way it does for the element
 * `AT_ID`). Read strictly as "schema entries flagged mandatory", this rule
 * could never fire against any document. This module also treats a model
 * type's own `AT_ID` schema entry (its Identifier, e.g. "AWF.01.01" in the
 * fixture) as mandatory-in-effect, since R3 names it "Identifier" for the
 * model exactly as it does for the element attribute, and R4's fixture data
 * shows every real EPC model carries one. `mandatoryModelAttributeTypes`
 * still reads `entry.mandatory` first, so if `attributes.ts` ever marks an
 * EPC model attribute mandatory for real, it is enforced automatically too
 * — this rule is schema-driven, not a hardcoded attribute list.
 */

import type { ArisAttribute, ArisWorkingDocument } from '../model/types'
import type { ArisEpcModelFinding } from '../shell/arisEpcFindings'
import { isLegalConnection, RACI_BY_CONNECTION_TYPE } from './connectionRules'
import { schemaForModelType, schemaForObjectType } from './attributes'

/** Object types whose connection to a Function can carry RACI 'R' (plan R2). */
const EXECUTOR_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'OT_ORG_UNIT',
  'OT_POS',
  'OT_GRP',
  'OT_PERS_TYPE',
  'OT_PERS'
])

/** The five convention rule ids, in the order `buildConventionFindings` runs them. */
export const CONVENTION_RULE_IDS: readonly string[] = Object.freeze([
  'conv.connection.illegal',
  'conv.function.missingIdentifier',
  'conv.function.noExecutor',
  'conv.model.missingAttribute',
  'conv.naming.hint'
])

/** `true` when `attributeType` has at least one non-blank value on `attributes`. */
function hasAttributeValue(attributes: readonly ArisAttribute[], attributeType: string): boolean {
  const attribute = attributes.find((candidate) => candidate.type === attributeType)
  if (!attribute) return false
  return attribute.values.some((value) => value.text.trim() !== '')
}

/**
 * `definitionId -> modelId -> occurrence ids`, restricted to in-scope, supported
 * models. Shared by the two definition-scoped rules (`missingIdentifier`,
 * `naming.hint`) so a defect is reported once per model that actually places it.
 */
function indexOccurrencesByDefinition(
  document: ArisWorkingDocument,
  modelIds: ReadonlySet<string> | undefined
): ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> {
  const index = new Map<string, Map<string, string[]>>()
  for (const [modelId, model] of document.models) {
    if (modelIds && !modelIds.has(modelId)) continue
    if (model.unsupported) continue
    for (const occurrence of model.occurrences) {
      let byModel = index.get(occurrence.definitionId)
      if (!byModel) {
        byModel = new Map()
        index.set(occurrence.definitionId, byModel)
      }
      let occurrenceIds = byModel.get(modelId)
      if (!occurrenceIds) {
        occurrenceIds = []
        byModel.set(modelId, occurrenceIds)
      }
      occurrenceIds.push(occurrence.id)
    }
  }
  return index
}

/**
 * `conv.connection.illegal` — every connection occurrence's (from-type, to-type,
 * connectionType) triple must be legal under `isLegalConnection` for its model's type.
 */
function checkIllegalConnections(
  document: ArisWorkingDocument,
  modelIds: ReadonlySet<string> | undefined
): ArisEpcModelFinding[] {
  const findings: ArisEpcModelFinding[] = []

  for (const [modelId, model] of document.models) {
    if (modelIds && !modelIds.has(modelId)) continue
    if (model.unsupported) continue

    const occurrenceById = new Map(
      model.occurrences.map((occurrence) => [occurrence.id, occurrence])
    )

    for (const connection of model.connectionOccurrences) {
      const connectionDefinition = document.connectionDefinitions.get(connection.definitionId)
      if (!connectionDefinition) continue
      const sourceOccurrence = occurrenceById.get(connection.sourceOccurrenceId)
      const targetOccurrence = occurrenceById.get(connection.targetOccurrenceId)
      if (!sourceOccurrence || !targetOccurrence) continue
      const sourceDefinition = document.objectDefinitions.get(sourceOccurrence.definitionId)
      const targetDefinition = document.objectDefinitions.get(targetOccurrence.definitionId)
      if (!sourceDefinition || !targetDefinition) continue

      const legal = isLegalConnection(
        model.type,
        sourceDefinition.type,
        targetDefinition.type,
        connectionDefinition.type
      )
      if (legal) continue

      findings.push({
        ruleId: 'conv.connection.illegal',
        severity: 'warning',
        messageKey: 'aris.conv.finding.illegalConnection.body',
        messageParams: {
          from: sourceDefinition.type,
          to: targetDefinition.type,
          type: connectionDefinition.type
        },
        nodeIds: [connection.id],
        edgeIds: [],
        modelId
      })
    }
  }

  return findings
}

/**
 * `conv.function.missingIdentifier` — every object definition missing one of its
 * object type's mandatory attributes (plan R3: `AT_ID` for `OT_FUNC`) is flagged once
 * per model that carries an occurrence of it.
 */
function checkFunctionMissingIdentifier(
  document: ArisWorkingDocument,
  index: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
): ArisEpcModelFinding[] {
  const findings: ArisEpcModelFinding[] = []

  for (const [definitionId, definition] of document.objectDefinitions) {
    const mandatoryTypes = schemaForObjectType(definition.type)
      .filter((entry) => entry.mandatory)
      .map((entry) => entry.attributeType)
    if (mandatoryTypes.length === 0) continue

    const isMissing = mandatoryTypes.some(
      (attributeType) => !hasAttributeValue(definition.attributes, attributeType)
    )
    if (!isMissing) continue

    const byModel = index.get(definitionId)
    if (!byModel) continue
    for (const [modelId, occurrenceIds] of byModel) {
      findings.push({
        ruleId: 'conv.function.missingIdentifier',
        severity: 'warning',
        messageKey: 'aris.conv.finding.missingIdentifier.body',
        nodeIds: occurrenceIds,
        edgeIds: [],
        modelId
      })
    }
  }

  return findings
}

/** The EPC model type `conv.function.noExecutor` applies to — see the module doc. */
const NO_EXECUTOR_MODEL_TYPE = 'MT_EEPC'

/**
 * `conv.function.noExecutor` — every `OT_FUNC` occurrence in an EEPC model must have at
 * least one incoming connection whose RACI is `R` (plan R2's `CT_EXEC_*` family) sourced
 * from one of the executor object types. EEPC-scoped: the DMT convention manual defines
 * the executor R/A/C/I wiring only for EPC models; VACD chain elements carry none.
 */
function checkFunctionNoExecutor(
  document: ArisWorkingDocument,
  modelIds: ReadonlySet<string> | undefined
): ArisEpcModelFinding[] {
  const findings: ArisEpcModelFinding[] = []

  for (const [modelId, model] of document.models) {
    if (modelIds && !modelIds.has(modelId)) continue
    if (model.unsupported) continue
    if (model.type !== NO_EXECUTOR_MODEL_TYPE) continue

    const occurrenceById = new Map(
      model.occurrences.map((occurrence) => [occurrence.id, occurrence])
    )

    for (const occurrence of model.occurrences) {
      const definition = document.objectDefinitions.get(occurrence.definitionId)
      if (!definition || definition.type !== 'OT_FUNC') continue

      const hasExecutorR = model.connectionOccurrences.some((connection) => {
        if (connection.targetOccurrenceId !== occurrence.id) return false
        const connectionDefinition = document.connectionDefinitions.get(connection.definitionId)
        if (!connectionDefinition) return false
        if (RACI_BY_CONNECTION_TYPE[connectionDefinition.type] !== 'R') return false
        const sourceOccurrence = occurrenceById.get(connection.sourceOccurrenceId)
        if (!sourceOccurrence) return false
        const sourceDefinition = document.objectDefinitions.get(sourceOccurrence.definitionId)
        return sourceDefinition ? EXECUTOR_OBJECT_TYPES.has(sourceDefinition.type) : false
      })
      if (hasExecutorR) continue

      findings.push({
        ruleId: 'conv.function.noExecutor',
        severity: 'warning',
        messageKey: 'aris.conv.finding.noExecutor.body',
        nodeIds: [occurrence.id],
        edgeIds: [],
        modelId
      })
    }
  }

  return findings
}

/** A model type's own attribute types treated as mandatory-in-effect — see the module doc. */
function mandatoryModelAttributeTypes(modelType: string): readonly string[] {
  const types = new Set<string>()
  for (const entry of schemaForModelType(modelType)) {
    if (entry.mandatory || entry.attributeType === 'AT_ID') types.add(entry.attributeType)
  }
  return [...types]
}

/**
 * `conv.model.missingAttribute` — model-scoped (empty `nodeIds`; `modelId` set so the
 * rail/marker fall back to revealing the model itself): flags a model missing one of
 * its own mandatory-in-effect schema attributes.
 */
function checkModelMissingAttribute(
  document: ArisWorkingDocument,
  modelIds: ReadonlySet<string> | undefined
): ArisEpcModelFinding[] {
  const findings: ArisEpcModelFinding[] = []

  for (const [modelId, model] of document.models) {
    if (modelIds && !modelIds.has(modelId)) continue
    if (model.unsupported) continue

    const mandatoryTypes = mandatoryModelAttributeTypes(model.type)
    if (mandatoryTypes.length === 0) continue

    const isMissing = mandatoryTypes.some(
      (attributeType) => !hasAttributeValue(model.attributes, attributeType)
    )
    if (!isMissing) continue

    findings.push({
      ruleId: 'conv.model.missingAttribute',
      severity: 'warning',
      messageKey: 'aris.conv.finding.missingAttribute.body',
      nodeIds: [],
      edgeIds: [],
      modelId
    })
  }

  return findings
}

/** `true` when `text` reads as a naming-convention hint: too long, or a trailing period. */
function isNamingHintText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed.length > 60 || trimmed.endsWith('.')
}

/**
 * `conv.naming.hint` — any object definition whose display name (in any locale) is
 * longer than 60 characters or ends with a trailing period, flagged once per model
 * that carries an occurrence of it.
 */
function checkNamingHint(
  document: ArisWorkingDocument,
  index: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
): ArisEpcModelFinding[] {
  const findings: ArisEpcModelFinding[] = []

  for (const [definitionId, definition] of document.objectDefinitions) {
    const flagged = Object.values(definition.names.values).some(isNamingHintText)
    if (!flagged) continue

    const byModel = index.get(definitionId)
    if (!byModel) continue
    for (const [modelId, occurrenceIds] of byModel) {
      findings.push({
        ruleId: 'conv.naming.hint',
        severity: 'warning',
        messageKey: 'aris.conv.finding.namingHint.body',
        nodeIds: occurrenceIds,
        edgeIds: [],
        modelId
      })
    }
  }

  return findings
}

/**
 * Run all five convention rules against `document`, returning `ArisEpcModelFinding`
 * rows shaped exactly like `buildArisEpcFindings`'s output so they flow through
 * `buildArisValidationFindings` unchanged (an unrecognized `ruleId` maps to kind
 * `'invalidSequence'` there).
 *
 * @param modelIds restrict validation to these models; omit to validate every model.
 */
export function buildConventionFindings(
  document: ArisWorkingDocument,
  modelIds?: ReadonlySet<string>
): readonly ArisEpcModelFinding[] {
  const index = indexOccurrencesByDefinition(document, modelIds)

  return Object.freeze([
    ...checkIllegalConnections(document, modelIds),
    ...checkFunctionMissingIdentifier(document, index),
    ...checkFunctionNoExecutor(document, modelIds),
    ...checkModelMissingAttribute(document, modelIds),
    ...checkNamingHint(document, index)
  ])
}
