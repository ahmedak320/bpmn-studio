/**
 * Shared test fixtures for `src/aris/chat`: small document builders plus a reference in-memory
 * `ArisChatApplyHost<ArisChatWorkingDocument>` implementation. Not a `.test.ts` file itself (so
 * vitest does not try to run it) — mirrors the `testFixtures.ts` / `testFixture.ts` convention
 * already used by `src/aris/ai` and `src/aris/model`.
 */

import type { ArisChatApplyHost, ArisChatValidationIssue } from './applyEngine'
import type { ArisChatCommand } from './patchSchema'
import type {
  ArisChatAttachmentRef,
  ArisChatAttribute,
  ArisChatConnectionDefinition,
  ArisChatConnectionOccurrence,
  ArisChatLocalizedValue,
  ArisChatModel,
  ArisChatObjectDefinition,
  ArisChatObjectOccurrence,
  ArisChatWorkingDocument
} from './types'

export function names(en: string | null, ar: string | null = null): ArisChatLocalizedValue {
  const values: Record<string, string> = {}
  if (en !== null) values.en = en
  if (ar !== null) values.ar = ar
  return Object.freeze({ values: Object.freeze(values), fallback: en ?? ar })
}

export function attribute(type: string, text: string, localeId: string | null = null): ArisChatAttribute {
  return Object.freeze({ type, values: Object.freeze([Object.freeze({ localeId, text })]) })
}

export interface BuildDocumentInput {
  readonly revision?: number
  readonly models?: readonly ArisChatModel[]
  readonly objectDefinitions?: readonly ArisChatObjectDefinition[]
  readonly connectionDefinitions?: readonly ArisChatConnectionDefinition[]
  readonly attachments?: readonly ArisChatAttachmentRef[]
  readonly unaccountedSourceIds?: readonly string[]
}

export function buildDocument(input: BuildDocumentInput): ArisChatWorkingDocument {
  const models = new Map<string, ArisChatModel>()
  for (const model of input.models ?? []) models.set(model.id, model)
  const objectDefinitions = new Map<string, ArisChatObjectDefinition>()
  for (const definition of input.objectDefinitions ?? []) objectDefinitions.set(definition.id, definition)
  const connectionDefinitions = new Map<string, ArisChatConnectionDefinition>()
  for (const definition of input.connectionDefinitions ?? []) connectionDefinitions.set(definition.id, definition)
  const attachments = new Map<string, ArisChatAttachmentRef>()
  for (const attachmentRef of input.attachments ?? []) attachments.set(attachmentRef.id, attachmentRef)

  return Object.freeze({
    revision: input.revision ?? 0,
    models: Object.freeze(models),
    objectDefinitions: Object.freeze(objectDefinitions),
    connectionDefinitions: Object.freeze(connectionDefinitions),
    attachments: attachments.size > 0 ? Object.freeze(attachments) : undefined,
    unaccountedSourceIds: input.unaccountedSourceIds
  })
}

/**
 * A minimal, gap-free EEPC: start event -> function (owned, coded, with an IO connection) ->
 * XOR split rule (two distinctly labeled outgoing branches, with a decision-basis connection)
 * -> two end events. Every name is present in both English and Arabic.
 */
export function buildCleanEepcDocument(): ArisChatWorkingDocument {
  const modelId = 'M1'
  const startEventDefId = 'OD_START'
  const funcDefId = 'OD_FUNC'
  const ruleDefId = 'OD_RULE'
  const endApprovedDefId = 'OD_END_A'
  const endRejectedDefId = 'OD_END_R'
  const systemDefId = 'OD_SYS'
  const dataDefId = 'OD_DATA'

  const startEventOccId = 'OC_START'
  const funcOccId = 'OC_FUNC'
  const ruleOccId = 'OC_RULE'
  const endApprovedOccId = 'OC_END_A'
  const endRejectedOccId = 'OC_END_R'
  const systemOccId = 'OC_SYS'
  const dataOccId = 'OC_DATA'

  const objectDefinitions: ArisChatObjectDefinition[] = [
    { id: startEventDefId, type: 'OT_EVT', names: names('Request received', 'تم استلام الطلب'), attributes: [], linkedModelIds: [] },
    {
      id: funcDefId,
      type: 'OT_FUNC',
      names: names('Review request', 'مراجعة الطلب'),
      attributes: [attribute('AT_PROC_CODE', 'P-001'), attribute('AT_PERS_RESP', 'Reviewer')],
      linkedModelIds: []
    },
    { id: ruleDefId, type: 'OT_RULE', names: names(null, null), attributes: [], linkedModelIds: [] },
    { id: endApprovedDefId, type: 'OT_EVT', names: names('Request approved', 'تمت الموافقة على الطلب'), attributes: [], linkedModelIds: [] },
    { id: endRejectedDefId, type: 'OT_EVT', names: names('Request closed without approval', 'تم إغلاق الطلب دون موافقة'), attributes: [], linkedModelIds: [] },
    { id: systemDefId, type: 'OT_APPL_SYS', names: names('Case system', 'نظام الحالات'), attributes: [], linkedModelIds: [] },
    { id: dataDefId, type: 'OT_ENT_TYPE', names: names('Application data', 'بيانات الطلب'), attributes: [], linkedModelIds: [] }
  ]

  const connectionDefinitions: ArisChatConnectionDefinition[] = [
    { id: 'CD1', type: 'CT_ACTIV_1', fromObjectDefinitionId: startEventDefId, toObjectDefinitionId: funcDefId, names: names(null), attributes: [] },
    { id: 'CD2', type: 'CT_LEADS_TO_1', fromObjectDefinitionId: funcDefId, toObjectDefinitionId: ruleDefId, names: names(null), attributes: [] },
    { id: 'CD3', type: 'CT_LEADS_TO_2', fromObjectDefinitionId: ruleDefId, toObjectDefinitionId: endApprovedDefId, names: names(null), attributes: [] },
    { id: 'CD4', type: 'CT_LEADS_TO_2', fromObjectDefinitionId: ruleDefId, toObjectDefinitionId: endRejectedDefId, names: names(null), attributes: [] },
    { id: 'CD5', type: 'CT_SUPP_3', fromObjectDefinitionId: systemDefId, toObjectDefinitionId: funcDefId, names: names(null), attributes: [] },
    { id: 'CD6', type: 'CT_REFS_TO_2', fromObjectDefinitionId: ruleDefId, toObjectDefinitionId: dataDefId, names: names(null), attributes: [] }
  ]

  const occurrences: ArisChatObjectOccurrence[] = [
    { id: startEventOccId, definitionId: startEventDefId, modelId, symbol: 'ST_EV' },
    { id: funcOccId, definitionId: funcDefId, modelId, symbol: 'ST_FUNC' },
    { id: ruleOccId, definitionId: ruleDefId, modelId, symbol: 'ST_OPR_XOR_1' },
    { id: endApprovedOccId, definitionId: endApprovedDefId, modelId, symbol: 'ST_EV' },
    { id: endRejectedOccId, definitionId: endRejectedDefId, modelId, symbol: 'ST_EV' },
    { id: systemOccId, definitionId: systemDefId, modelId, symbol: 'ST_APPL_SYS' },
    { id: dataOccId, definitionId: dataDefId, modelId, symbol: 'ST_ENT_TYPE' }
  ]

  const connectionOccurrences: ArisChatConnectionOccurrence[] = [
    { id: 'C1', definitionId: 'CD1', modelId, sourceOccurrenceId: startEventOccId, targetOccurrenceId: funcOccId },
    { id: 'C2', definitionId: 'CD2', modelId, sourceOccurrenceId: funcOccId, targetOccurrenceId: ruleOccId },
    { id: 'C3', definitionId: 'CD3', modelId, sourceOccurrenceId: ruleOccId, targetOccurrenceId: endApprovedOccId, names: names('Approved', 'موافق عليه') },
    { id: 'C4', definitionId: 'CD4', modelId, sourceOccurrenceId: ruleOccId, targetOccurrenceId: endRejectedOccId, names: names('Not approved', 'غير موافق عليه') },
    { id: 'C5', definitionId: 'CD5', modelId, sourceOccurrenceId: systemOccId, targetOccurrenceId: funcOccId },
    { id: 'C6', definitionId: 'CD6', modelId, sourceOccurrenceId: ruleOccId, targetOccurrenceId: dataOccId }
  ]

  const model: ArisChatModel = {
    id: modelId,
    names: names('Request handling', 'معالجة الطلب'),
    occurrences,
    connectionOccurrences
  }

  return buildDocument({ models: [model], objectDefinitions, connectionDefinitions })
}

// --- reference apply host ------------------------------------------------------------------

function replaceMap<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(map)
  next.set(key, value)
  return Object.freeze(next)
}

function deleteFromMap<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map)
  next.delete(key)
  return Object.freeze(next)
}

function findModelIdForOccurrence(document: ArisChatWorkingDocument, occurrenceId: string): string | undefined {
  for (const model of document.models.values()) {
    if (model.occurrences.some((occurrence) => occurrence.id === occurrenceId)) return model.id
  }
  return undefined
}

function findModelIdForConnection(document: ArisChatWorkingDocument, connectionOccurrenceId: string): string | undefined {
  for (const model of document.models.values()) {
    if (model.connectionOccurrences.some((connection) => connection.id === connectionOccurrenceId)) return model.id
  }
  return undefined
}

function updateModel(document: ArisChatWorkingDocument, modelId: string, updater: (model: ArisChatModel) => ArisChatModel): ArisChatWorkingDocument {
  const model = document.models.get(modelId)
  if (!model) throw new Error(`Unknown model ${modelId}`)
  return { ...document, models: replaceMap(document.models, modelId, updater(model)) }
}

function nextLocalizedValue(current: ArisChatLocalizedValue, localeId: string, value: string): ArisChatLocalizedValue {
  const values = { ...current.values, [localeId]: value }
  return Object.freeze({ values: Object.freeze(values), fallback: current.fallback ?? value })
}

function updateAttributes(
  attributes: readonly ArisChatAttribute[],
  attributeType: string,
  values: readonly { readonly localeId: string | null; readonly text: string }[]
): readonly ArisChatAttribute[] {
  const index = attributes.findIndex((attr) => attr.type === attributeType)
  const next = attributes.slice()
  const attr = Object.freeze({ type: attributeType, values: Object.freeze([...values]) })
  if (index >= 0) next[index] = attr
  else next.push(attr)
  return Object.freeze(next)
}

/**
 * A complete reference `ArisChatApplyHost` over `ArisChatWorkingDocument`, implementing every
 * one of the fifteen chat command kinds. `revision` increments by one per successfully applied
 * command (simulating one model-layer `applyCommand` per chat command — see
 * `modelCommandMapping.ts`). Validation hooks and `applyCommand` are individually overridable so
 * tests can inject failures at a specific point without reimplementing the whole host.
 */
export interface TestApplyHostOverrides {
  readonly validateSemantic?: (document: ArisChatWorkingDocument) => readonly ArisChatValidationIssue[]
  readonly validateReference?: (document: ArisChatWorkingDocument) => readonly ArisChatValidationIssue[]
  readonly validateAccounting?: (document: ArisChatWorkingDocument) => readonly ArisChatValidationIssue[]
  readonly saveDraftRevision?: ArisChatApplyHost<ArisChatWorkingDocument>['saveDraftRevision']
  /** Called before the real apply logic; throwing here short-circuits (for rollback tests). */
  readonly beforeApply?: (document: ArisChatWorkingDocument, command: ArisChatCommand, callIndex: number) => void
}

export function createTestApplyHost(overrides: TestApplyHostOverrides = {}): ArisChatApplyHost<ArisChatWorkingDocument> {
  let callIndex = 0

  return {
    getRevision: (document) => document.revision,
    applyCommand: (document, command) => {
      callIndex += 1
      overrides.beforeApply?.(document, command, callIndex)
      return Object.freeze({ ...applyOneCommand(document, command), revision: document.revision + 1 })
    },
    validateSemantic: overrides.validateSemantic,
    validateReference: overrides.validateReference,
    validateAccounting: overrides.validateAccounting,
    saveDraftRevision: overrides.saveDraftRevision
  }
}

function applyOneCommand(document: ArisChatWorkingDocument, command: ArisChatCommand): ArisChatWorkingDocument {
  switch (command.kind) {
    case 'setLocalizedName': {
      const { ownerKind, ownerId, localeId, value } = command.payload
      if (ownerKind === 'model') {
        const model = document.models.get(ownerId)
        if (!model) throw new Error(`Unknown model ${ownerId}`)
        return updateModel(document, ownerId, (m) => ({ ...m, names: nextLocalizedValue(m.names, localeId, value) }))
      }
      if (ownerKind === 'objectDefinition') {
        const definition = document.objectDefinitions.get(ownerId)
        if (!definition) throw new Error(`Unknown object definition ${ownerId}`)
        return { ...document, objectDefinitions: replaceMap(document.objectDefinitions, ownerId, { ...definition, names: nextLocalizedValue(definition.names, localeId, value) }) }
      }
      const definition = document.connectionDefinitions.get(ownerId)
      if (!definition) throw new Error(`Unknown connection definition ${ownerId}`)
      return { ...document, connectionDefinitions: replaceMap(document.connectionDefinitions, ownerId, { ...definition, names: nextLocalizedValue(definition.names, localeId, value) }) }
    }
    case 'setAttribute': {
      const { ownerKind, ownerId, attributeType, values } = command.payload
      if (ownerKind === 'model') {
        const model = document.models.get(ownerId)
        if (!model) throw new Error(`Unknown model ${ownerId}`)
        return document // models carry no attributes in this fixture set; no-op but valid
      }
      if (ownerKind === 'objectDefinition') {
        const definition = document.objectDefinitions.get(ownerId)
        if (!definition) throw new Error(`Unknown object definition ${ownerId}`)
        return { ...document, objectDefinitions: replaceMap(document.objectDefinitions, ownerId, { ...definition, attributes: updateAttributes(definition.attributes, attributeType, values) }) }
      }
      const definition = document.connectionDefinitions.get(ownerId)
      if (!definition) throw new Error(`Unknown connection definition ${ownerId}`)
      return { ...document, connectionDefinitions: replaceMap(document.connectionDefinitions, ownerId, { ...definition, attributes: updateAttributes(definition.attributes, attributeType, values) }) }
    }
    case 'addAttributeValue': {
      const { ownerKind, ownerId, attributeType, value } = command.payload
      if (ownerKind === 'objectDefinition') {
        const definition = document.objectDefinitions.get(ownerId)
        if (!definition) throw new Error(`Unknown object definition ${ownerId}`)
        const existing = definition.attributes.find((attr) => attr.type === attributeType)
        const values = existing ? [...existing.values.filter((v) => v.localeId !== value.localeId), value] : [value]
        return { ...document, objectDefinitions: replaceMap(document.objectDefinitions, ownerId, { ...definition, attributes: updateAttributes(definition.attributes, attributeType, values) }) }
      }
      if (ownerKind === 'connectionDefinition') {
        const definition = document.connectionDefinitions.get(ownerId)
        if (!definition) throw new Error(`Unknown connection definition ${ownerId}`)
        const existing = definition.attributes.find((attr) => attr.type === attributeType)
        const values = existing ? [...existing.values.filter((v) => v.localeId !== value.localeId), value] : [value]
        return { ...document, connectionDefinitions: replaceMap(document.connectionDefinitions, ownerId, { ...definition, attributes: updateAttributes(definition.attributes, attributeType, values) }) }
      }
      throw new Error('model attributes are not supported by this fixture host')
    }
    case 'addMetadataDefinition': {
      const { definitionId, objectType, names: newNames } = command.payload
      if (document.objectDefinitions.has(definitionId)) throw new Error(`Definition ${definitionId} already exists`)
      const definition: ArisChatObjectDefinition = { id: definitionId, type: objectType, names: newNames, attributes: [], linkedModelIds: [] }
      return { ...document, objectDefinitions: replaceMap(document.objectDefinitions, definitionId, definition) }
    }
    case 'addMetadataOccurrence':
    case 'addCoreObject': {
      const definitionId = command.kind === 'addMetadataOccurrence' ? command.payload.definitionId : command.payload.definitionId
      const modelId = command.payload.modelId
      if (command.kind === 'addCoreObject') {
        const { definitionId: coreDefId, occurrenceId, objectType, names: newNames } = command.payload
        if (document.objectDefinitions.has(coreDefId)) throw new Error(`Definition ${coreDefId} already exists`)
        if (!document.models.has(modelId)) throw new Error(`Unknown model ${modelId}`)
        const definition: ArisChatObjectDefinition = { id: coreDefId, type: objectType, names: newNames, attributes: [], linkedModelIds: [] }
        const occurrence: ArisChatObjectOccurrence = { id: occurrenceId, definitionId: coreDefId, modelId, symbol: command.payload.symbol }
        const withDefinition = { ...document, objectDefinitions: replaceMap(document.objectDefinitions, coreDefId, definition) }
        return updateModel(withDefinition, modelId, (m) => ({ ...m, occurrences: Object.freeze([...m.occurrences, occurrence]) }))
      }
      const { occurrenceId, symbol } = command.payload
      if (!document.models.has(modelId)) throw new Error(`Unknown model ${modelId}`)
      if (!document.objectDefinitions.has(definitionId)) throw new Error(`Unknown object definition ${definitionId}`)
      const occurrence: ArisChatObjectOccurrence = { id: occurrenceId, definitionId, modelId, symbol }
      return updateModel(document, modelId, (m) => ({ ...m, occurrences: Object.freeze([...m.occurrences, occurrence]) }))
    }
    case 'addMetadataConnection':
    case 'addCoreConnection': {
      const {
        connectionDefinitionId,
        connectionType,
        connectionOccurrenceId,
        modelId,
        fromObjectDefinitionId,
        toObjectDefinitionId,
        sourceOccurrenceId,
        targetOccurrenceId
      } = command.payload
      if (!document.models.has(modelId)) throw new Error(`Unknown model ${modelId}`)
      if (!document.objectDefinitions.has(fromObjectDefinitionId)) throw new Error(`Unknown object definition ${fromObjectDefinitionId}`)
      if (!document.objectDefinitions.has(toObjectDefinitionId)) throw new Error(`Unknown object definition ${toObjectDefinitionId}`)
      const model = document.models.get(modelId)!
      if (!model.occurrences.some((o) => o.id === sourceOccurrenceId)) throw new Error(`Unknown source occurrence ${sourceOccurrenceId}`)
      if (!model.occurrences.some((o) => o.id === targetOccurrenceId)) throw new Error(`Unknown target occurrence ${targetOccurrenceId}`)

      const connectionDefinition: ArisChatConnectionDefinition = document.connectionDefinitions.get(connectionDefinitionId) ?? {
        id: connectionDefinitionId,
        type: connectionType,
        fromObjectDefinitionId,
        toObjectDefinitionId,
        names: names(null),
        attributes: []
      }
      const withDefinition = { ...document, connectionDefinitions: replaceMap(document.connectionDefinitions, connectionDefinitionId, connectionDefinition) }
      const connectionOccurrence: ArisChatConnectionOccurrence = {
        id: connectionOccurrenceId,
        definitionId: connectionDefinitionId,
        modelId,
        sourceOccurrenceId,
        targetOccurrenceId
      }
      return updateModel(withDefinition, modelId, (m) => ({ ...m, connectionOccurrences: Object.freeze([...m.connectionOccurrences, connectionOccurrence]) }))
    }
    case 'setAssignment': {
      const { objectDefinitionId, modelId, action } = command.payload
      const definition = document.objectDefinitions.get(objectDefinitionId)
      if (!definition) throw new Error(`Unknown object definition ${objectDefinitionId}`)
      const linked = new Set(definition.linkedModelIds)
      if (action === 'add') linked.add(modelId)
      else linked.delete(modelId)
      return { ...document, objectDefinitions: replaceMap(document.objectDefinitions, objectDefinitionId, { ...definition, linkedModelIds: Object.freeze([...linked]) }) }
    }
    case 'setRoute': {
      const { connectionOccurrenceId, route } = command.payload
      const modelId = findModelIdForConnection(document, connectionOccurrenceId)
      if (!modelId) throw new Error(`Unknown connection occurrence ${connectionOccurrenceId}`)
      return updateModel(document, modelId, (m) => ({
        ...m,
        connectionOccurrences: Object.freeze(m.connectionOccurrences.map((c) => (c.id === connectionOccurrenceId ? { ...c, route } : c)))
      }))
    }
    case 'reconnect': {
      const { connectionOccurrenceId, sourceOccurrenceId, targetOccurrenceId } = command.payload
      const modelId = findModelIdForConnection(document, connectionOccurrenceId)
      if (!modelId) throw new Error(`Unknown connection occurrence ${connectionOccurrenceId}`)
      return updateModel(document, modelId, (m) => ({
        ...m,
        connectionOccurrences: Object.freeze(
          m.connectionOccurrences.map((c) =>
            c.id === connectionOccurrenceId
              ? { ...c, sourceOccurrenceId: sourceOccurrenceId ?? c.sourceOccurrenceId, targetOccurrenceId: targetOccurrenceId ?? c.targetOccurrenceId }
              : c
          )
        )
      }))
    }
    case 'deleteConnection': {
      const { connectionOccurrenceId } = command.payload
      const modelId = findModelIdForConnection(document, connectionOccurrenceId)
      if (!modelId) throw new Error(`Unknown connection occurrence ${connectionOccurrenceId}`)
      return updateModel(document, modelId, (m) => ({ ...m, connectionOccurrences: Object.freeze(m.connectionOccurrences.filter((c) => c.id !== connectionOccurrenceId)) }))
    }
    case 'deleteOccurrence': {
      const { occurrenceId } = command.payload
      const modelId = findModelIdForOccurrence(document, occurrenceId)
      if (!modelId) throw new Error(`Unknown occurrence ${occurrenceId}`)
      return updateModel(document, modelId, (m) => ({ ...m, occurrences: Object.freeze(m.occurrences.filter((o) => o.id !== occurrenceId)) }))
    }
    case 'deleteDefinition': {
      const { definitionId } = command.payload
      if (!document.objectDefinitions.has(definitionId)) throw new Error(`Unknown object definition ${definitionId}`)
      return { ...document, objectDefinitions: deleteFromMap(document.objectDefinitions, definitionId) }
    }
    case 'removeAttachment': {
      const { attachmentId } = command.payload
      if (!document.attachments?.has(attachmentId)) throw new Error(`Unknown attachment ${attachmentId}`)
      return { ...document, attachments: deleteFromMap(document.attachments, attachmentId) }
    }
    default: {
      const exhaustive: never = command
      throw new Error(`Unhandled command kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
