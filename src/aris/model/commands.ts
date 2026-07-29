import type {
  ArisAttribute,
  ArisAttributeOccurrence,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLane,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisPoint,
  ArisWorkingDocument
} from './types'

export type ArisCommandKind =
  | 'setLocalizedName'
  | 'setAttribute'
  | 'addAttributeValue'
  | 'removeAttributeValue'
  | 'moveOccurrence'
  | 'resizeOccurrence'
  | 'restyleOccurrence'
  | 'setOccurrenceSymbol'
  | 'setAttributeOccurrencePlacement'
  | 'createDefinition'
  | 'createOccurrence'
  | 'createConnectionDefinition'
  | 'createConnectionOccurrence'
  | 'setConnectionRoute'
  | 'reconnectConnection'
  | 'deleteOccurrence'
  | 'deleteDefinition'
  | 'deleteConnection'
  | 'deleteConnectionDefinition'
  | 'addLane'
  | 'editLane'
  | 'deleteLane'
  | 'addFreeText'
  | 'editFreeText'
  | 'deleteFreeText'
  | 'setModelAssignment'
  | 'transaction'

/**
 * A single reversible edit. `before` and `after` are kind-specific snapshots.
 */
export interface ArisEditCommand {
  readonly commandId: string
  readonly baseRevision: number
  readonly kind: ArisCommandKind
  readonly affectedSourceIds: readonly string[]
  readonly before: unknown
  readonly after: unknown
  readonly origin: 'user' | 'ai-auto' | 'ai-confirmed' | 'import-repair'
}

export class ArisCommandError extends Error {
  readonly code: string
  readonly commandId?: string

  constructor(code: string, message: string, commandId?: string) {
    super(message)
    this.name = 'ArisCommandError'
    this.code = code
    this.commandId = commandId
  }
}

function assertRevision(command: ArisEditCommand, document: ArisWorkingDocument): void {
  if (command.baseRevision !== document.revision) {
    throw new ArisCommandError(
      'stale-revision',
      `Command ${command.commandId} targets revision ${command.baseRevision} but document is at ${document.revision}.`,
      command.commandId
    )
  }
}

function assertDefined<T>(value: T | undefined, name: string, command: ArisEditCommand): T {
  if (value === undefined) {
    throw new ArisCommandError(
      'missing-reference',
      `Command ${command.commandId} references missing ${name}.`,
      command.commandId
    )
  }
  return value
}

export function replaceMap<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(map)
  next.set(key, value)
  return Object.freeze(next)
}

export function deleteMap<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map)
  next.delete(key)
  return Object.freeze(next)
}

function updateModel(
  document: ArisWorkingDocument,
  modelId: string,
  updater: (
    model: NonNullable<
      ArisWorkingDocument['models'] extends ReadonlyMap<string, infer M> ? M : never
    >
  ) => NonNullable<ArisWorkingDocument['models'] extends ReadonlyMap<string, infer M> ? M : never>
): ArisWorkingDocument {
  const model = document.models.get(modelId)
  if (!model) return document
  return { ...document, models: replaceMap(document.models, modelId, updater(model)) }
}

function updateOccurrence(
  document: ArisWorkingDocument,
  occurrenceId: string,
  updater: (occurrence: ArisObjectOccurrence) => ArisObjectOccurrence
): ArisWorkingDocument {
  for (const [modelId, model] of document.models) {
    const index = model.occurrences.findIndex((occurrence) => occurrence.id === occurrenceId)
    if (index >= 0) {
      const next = model.occurrences.slice()
      next[index] = updater(model.occurrences[index])
      return {
        ...document,
        models: replaceMap(document.models, modelId, { ...model, occurrences: Object.freeze(next) })
      }
    }
  }
  return document
}

function updateConnectionOccurrence(
  document: ArisWorkingDocument,
  occurrenceId: string,
  updater: (occurrence: ArisConnectionOccurrence) => ArisConnectionOccurrence
): ArisWorkingDocument {
  for (const [modelId, model] of document.models) {
    const index = model.connectionOccurrences.findIndex(
      (occurrence) => occurrence.id === occurrenceId
    )
    if (index >= 0) {
      const next = model.connectionOccurrences.slice()
      next[index] = updater(model.connectionOccurrences[index])
      return {
        ...document,
        models: replaceMap(document.models, modelId, {
          ...model,
          connectionOccurrences: Object.freeze(next)
        })
      }
    }
  }
  return document
}

function findOccurrence(
  document: ArisWorkingDocument,
  occurrenceId: string
): ArisObjectOccurrence | undefined {
  for (const model of document.models.values()) {
    const occurrence = model.occurrences.find((candidate) => candidate.id === occurrenceId)
    if (occurrence) return occurrence
  }
  return undefined
}

function findConnectionOccurrence(
  document: ArisWorkingDocument,
  occurrenceId: string
): ArisConnectionOccurrence | undefined {
  for (const model of document.models.values()) {
    const occurrence = model.connectionOccurrences.find(
      (candidate) => candidate.id === occurrenceId
    )
    if (occurrence) return occurrence
  }
  return undefined
}

function findLane(
  document: ArisWorkingDocument,
  laneId: string
): { readonly modelId: string; readonly lane: ArisLane } | undefined {
  for (const [modelId, model] of document.models) {
    const lane = model.lanes.find((candidate) => candidate.id === laneId)
    if (lane) return { modelId, lane }
  }
  return undefined
}

function findFreeText(
  document: ArisWorkingDocument,
  freeTextId: string
): { readonly modelId: string; readonly freeText: ArisFreeText } | undefined {
  for (const [modelId, model] of document.models) {
    const item = model.freeText.find((candidate) => candidate.id === freeTextId)
    if (item) return { modelId, freeText: item }
  }
  return undefined
}

function validateDocument(document: ArisWorkingDocument, command: ArisEditCommand): void {
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) {
      if (!document.objectDefinitions.has(occurrence.definitionId)) {
        throw new ArisCommandError(
          'dangling-occurrence',
          `Occurrence ${occurrence.id} references missing definition ${occurrence.definitionId}.`,
          command.commandId
        )
      }
      if (occurrence.modelId !== model.id) {
        throw new ArisCommandError(
          'occurrence-model-mismatch',
          `Occurrence ${occurrence.id} belongs to model ${occurrence.modelId} but is stored under ${model.id}.`,
          command.commandId
        )
      }
    }
    for (const connection of model.connectionOccurrences) {
      if (!document.connectionDefinitions.has(connection.definitionId)) {
        throw new ArisCommandError(
          'dangling-connection-definition',
          `Connection occurrence ${connection.id} references missing definition ${connection.definitionId}.`,
          command.commandId
        )
      }
      const source = findOccurrence(document, connection.sourceOccurrenceId)
      const target = findOccurrence(document, connection.targetOccurrenceId)
      if (!source || !target) {
        throw new ArisCommandError(
          'dangling-connection-endpoint',
          `Connection occurrence ${connection.id} references missing endpoint(s).`,
          command.commandId
        )
      }
      if (source.modelId !== model.id || target.modelId !== model.id) {
        throw new ArisCommandError(
          'connection-endpoint-model-mismatch',
          `Connection occurrence ${connection.id} endpoints are not in model ${model.id}.`,
          command.commandId
        )
      }
    }
  }
}

function nextNames(
  names: { readonly values: Readonly<Record<string, string>>; readonly fallback: string | null },
  localeId: string,
  value: string
) {
  const values = { ...names.values, [localeId]: value }
  return Object.freeze({
    values: Object.freeze(values),
    fallback: names.fallback ?? value
  })
}

function applySetLocalizedName(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly ownerKind: 'model' | 'objectDefinition' | 'connectionDefinition'
    readonly ownerId: string
    readonly localeId: string
    readonly value: string
  }

  if (payload.ownerKind === 'model') {
    const model = assertDefined(document.models.get(payload.ownerId), 'model', command)
    return {
      ...document,
      models: replaceMap(document.models, payload.ownerId, {
        ...model,
        names: nextNames(model.names, payload.localeId, payload.value)
      })
    }
  }
  if (payload.ownerKind === 'objectDefinition') {
    const definition = assertDefined(
      document.objectDefinitions.get(payload.ownerId),
      'object definition',
      command
    )
    return {
      ...document,
      objectDefinitions: replaceMap(document.objectDefinitions, payload.ownerId, {
        ...definition,
        names: nextNames(definition.names, payload.localeId, payload.value)
      })
    }
  }
  const definition = assertDefined(
    document.connectionDefinitions.get(payload.ownerId),
    'connection definition',
    command
  )
  return {
    ...document,
    connectionDefinitions: replaceMap(document.connectionDefinitions, payload.ownerId, {
      ...definition,
      names: nextNames(definition.names, payload.localeId, payload.value)
    })
  }
}

type AttributeOwnerKind = 'model' | 'objectDefinition' | 'connectionDefinition'

function readOwnerAttributes(
  document: ArisWorkingDocument,
  ownerKind: AttributeOwnerKind,
  ownerId: string
): readonly ArisAttribute[] {
  if (ownerKind === 'model') {
    const model = assertDefined(document.models.get(ownerId), 'model', {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    })
    return model.attributes
  }
  if (ownerKind === 'objectDefinition') {
    const definition = assertDefined(document.objectDefinitions.get(ownerId), 'object definition', {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    })
    return definition.attributes
  }
  const definition = assertDefined(
    document.connectionDefinitions.get(ownerId),
    'connection definition',
    {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    }
  )
  return definition.attributes
}

function writeOwnerAttributes(
  document: ArisWorkingDocument,
  ownerKind: AttributeOwnerKind,
  ownerId: string,
  attributes: readonly ArisAttribute[]
): ArisWorkingDocument {
  if (ownerKind === 'model') {
    const model = assertDefined(document.models.get(ownerId), 'model', {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    })
    return { ...document, models: replaceMap(document.models, ownerId, { ...model, attributes }) }
  }
  if (ownerKind === 'objectDefinition') {
    const definition = assertDefined(document.objectDefinitions.get(ownerId), 'object definition', {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    })
    return {
      ...document,
      objectDefinitions: replaceMap(document.objectDefinitions, ownerId, {
        ...definition,
        attributes
      })
    }
  }
  const definition = assertDefined(
    document.connectionDefinitions.get(ownerId),
    'connection definition',
    {
      commandId: '',
      baseRevision: 0,
      kind: 'setAttribute',
      affectedSourceIds: [],
      before: null,
      after: null,
      origin: 'user'
    }
  )
  return {
    ...document,
    connectionDefinitions: replaceMap(document.connectionDefinitions, ownerId, {
      ...definition,
      attributes
    })
  }
}

function updateAttributes(
  attributes: readonly ArisAttribute[],
  attributeType: string,
  values: readonly { readonly localeId: string | null; readonly text: string }[]
): readonly ArisAttribute[] {
  const index = attributes.findIndex((attribute) => attribute.type === attributeType)
  const next = attributes.slice()
  const attribute = { type: attributeType, values }
  if (index >= 0) next[index] = attribute
  else next.push(attribute)
  return Object.freeze(next)
}

function applySetAttribute(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly ownerKind: AttributeOwnerKind
    readonly ownerId: string
    readonly attributeType: string
    readonly values: readonly { readonly localeId: string | null; readonly text: string }[]
  }
  const attributes = readOwnerAttributes(document, payload.ownerKind, payload.ownerId)
  return writeOwnerAttributes(
    document,
    payload.ownerKind,
    payload.ownerId,
    updateAttributes(attributes, payload.attributeType, payload.values)
  )
}

function applyAddAttributeValue(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly ownerKind: AttributeOwnerKind
    readonly ownerId: string
    readonly attributeType: string
    readonly value: { readonly localeId: string | null; readonly text: string }
  }
  const attributes = readOwnerAttributes(document, payload.ownerKind, payload.ownerId)
  const index = attributes.findIndex((attribute) => attribute.type === payload.attributeType)

  if (index >= 0) {
    const attribute = attributes[index]
    const values = attribute.values.slice()
    const valueIndex = values.findIndex((value) => value.localeId === payload.value.localeId)
    if (valueIndex >= 0) {
      // Replace-on-conflict keeps each locale unique.
      values[valueIndex] = payload.value
    } else {
      values.push(payload.value)
    }
    const next = attributes.slice()
    next[index] = Object.freeze({ type: payload.attributeType, values: Object.freeze(values) })
    return writeOwnerAttributes(document, payload.ownerKind, payload.ownerId, Object.freeze(next))
  }

  const next: ArisAttribute[] = [
    ...attributes,
    { type: payload.attributeType, values: Object.freeze([payload.value]) }
  ]
  return writeOwnerAttributes(document, payload.ownerKind, payload.ownerId, Object.freeze(next))
}

function applyRemoveAttributeValue(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly ownerKind: AttributeOwnerKind
    readonly ownerId: string
    readonly attributeType: string
    readonly localeId: string | null
  }
  const attributes = readOwnerAttributes(document, payload.ownerKind, payload.ownerId)
  const index = attributes.findIndex((attribute) => attribute.type === payload.attributeType)
  if (index < 0) {
    throw new ArisCommandError(
      'missing-attribute',
      `Attribute ${payload.attributeType} not found on ${payload.ownerKind} ${payload.ownerId}.`,
      command.commandId
    )
  }

  const attribute = attributes[index]
  const remaining = attribute.values.filter((value) => value.localeId !== payload.localeId)
  const next = attributes.slice()
  if (remaining.length === 0) {
    next.splice(index, 1)
  } else {
    next[index] = Object.freeze({ type: payload.attributeType, values: Object.freeze(remaining) })
  }
  return writeOwnerAttributes(document, payload.ownerKind, payload.ownerId, Object.freeze(next))
}

function applyMoveOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly occurrenceId: string
    readonly x: number
    readonly y: number
  }
  assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
  return updateOccurrence(document, payload.occurrenceId, (occurrence) =>
    Object.freeze({
      ...occurrence,
      bounds: Object.freeze({ ...occurrence.bounds, x: payload.x, y: payload.y })
    })
  )
}

function applyResizeOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly occurrenceId: string
    readonly width: number
    readonly height: number
  }
  assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
  return updateOccurrence(document, payload.occurrenceId, (occurrence) =>
    Object.freeze({
      ...occurrence,
      bounds: Object.freeze({ ...occurrence.bounds, width: payload.width, height: payload.height })
    })
  )
}

function applyRestyleOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly occurrenceId: string
    readonly style: Partial<ArisOccurrenceStyle>
  }
  assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
  return updateOccurrence(document, payload.occurrenceId, (occurrence) =>
    Object.freeze({
      ...occurrence,
      style: Object.freeze({ ...occurrence.style, ...payload.style })
    })
  )
}

function applySetOccurrenceSymbol(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly occurrenceId: string; readonly symbol: string }
  assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
  return updateOccurrence(document, payload.occurrenceId, (occurrence) =>
    Object.freeze({
      ...occurrence,
      symbol: payload.symbol,
      style: Object.freeze({ ...occurrence.style, symbol: payload.symbol })
    })
  )
}

function applySetAttributeOccurrencePlacement(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly occurrenceId: string
    readonly attributeType: string
    readonly placement: ArisAttributeOccurrence
  }
  assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
  return updateOccurrence(document, payload.occurrenceId, (occurrence) => {
    const index = occurrence.attributeOccurrences.findIndex(
      (attribute) => attribute.attributeType === payload.attributeType
    )
    const next = occurrence.attributeOccurrences.slice()
    if (index >= 0) {
      next[index] = payload.placement
    } else {
      next.push(payload.placement)
    }
    return Object.freeze({ ...occurrence, attributeOccurrences: Object.freeze(next) })
  })
}

function applySetConnectionRoute(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly connectionOccurrenceId: string
    readonly route: readonly ArisPoint[]
  }
  assertDefined(
    findConnectionOccurrence(document, payload.connectionOccurrenceId),
    'connection occurrence',
    command
  )
  return updateConnectionOccurrence(document, payload.connectionOccurrenceId, (occurrence) =>
    Object.freeze({ ...occurrence, route: Object.freeze([...payload.route]) })
  )
}

function applyReconnectConnection(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly connectionOccurrenceId: string
    readonly sourceOccurrenceId?: string
    readonly targetOccurrenceId?: string
  }
  assertDefined(
    findConnectionOccurrence(document, payload.connectionOccurrenceId),
    'connection occurrence',
    command
  )
  return updateConnectionOccurrence(document, payload.connectionOccurrenceId, (occurrence) =>
    Object.freeze({
      ...occurrence,
      sourceOccurrenceId: payload.sourceOccurrenceId ?? occurrence.sourceOccurrenceId,
      targetOccurrenceId: payload.targetOccurrenceId ?? occurrence.targetOccurrenceId
    })
  )
}

function applyCreateDefinition(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisObjectDefinition
  if (document.objectDefinitions.has(payload.id)) {
    throw new ArisCommandError(
      'duplicate-id',
      `Object definition ${payload.id} already exists.`,
      command.commandId
    )
  }
  return {
    ...document,
    objectDefinitions: replaceMap(document.objectDefinitions, payload.id, payload)
  }
}

function applyCreateOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisObjectOccurrence
  assertDefined(document.models.get(payload.modelId), 'model', command)
  assertDefined(document.objectDefinitions.get(payload.definitionId), 'object definition', command)
  return updateModel(document, payload.modelId, (model) =>
    Object.freeze({ ...model, occurrences: Object.freeze([...model.occurrences, payload]) })
  )
}

function applyCreateConnectionDefinition(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisConnectionDefinition
  if (document.connectionDefinitions.has(payload.id)) {
    throw new ArisCommandError(
      'duplicate-id',
      `Connection definition ${payload.id} already exists.`,
      command.commandId
    )
  }
  return {
    ...document,
    connectionDefinitions: replaceMap(document.connectionDefinitions, payload.id, payload)
  }
}

function applyCreateConnectionOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisConnectionOccurrence
  assertDefined(document.models.get(payload.modelId), 'model', command)
  assertDefined(
    document.connectionDefinitions.get(payload.definitionId),
    'connection definition',
    command
  )
  assertDefined(findOccurrence(document, payload.sourceOccurrenceId), 'source occurrence', command)
  assertDefined(findOccurrence(document, payload.targetOccurrenceId), 'target occurrence', command)
  return updateModel(document, payload.modelId, (model) =>
    Object.freeze({
      ...model,
      connectionOccurrences: Object.freeze([...model.connectionOccurrences, payload])
    })
  )
}

function applyDeleteOccurrence(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly occurrenceId: string }
  for (const [modelId, model] of document.models) {
    const index = model.occurrences.findIndex(
      (occurrence) => occurrence.id === payload.occurrenceId
    )
    if (index >= 0) {
      const next = model.occurrences.slice()
      next.splice(index, 1)
      return {
        ...document,
        models: replaceMap(document.models, modelId, { ...model, occurrences: Object.freeze(next) })
      }
    }
  }
  throw new ArisCommandError(
    'missing-occurrence',
    `Occurrence ${payload.occurrenceId} not found.`,
    command.commandId
  )
}

function applyDeleteDefinition(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly definitionId: string } | ArisObjectDefinition
  const definitionId = 'definitionId' in payload ? payload.definitionId : payload.id
  if (!document.objectDefinitions.has(definitionId)) {
    throw new ArisCommandError(
      'missing-definition',
      `Object definition ${definitionId} not found.`,
      command.commandId
    )
  }
  return { ...document, objectDefinitions: deleteMap(document.objectDefinitions, definitionId) }
}

function applyDeleteConnection(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly connectionOccurrenceId: string }
  for (const [modelId, model] of document.models) {
    const index = model.connectionOccurrences.findIndex(
      (occurrence) => occurrence.id === payload.connectionOccurrenceId
    )
    if (index >= 0) {
      const next = model.connectionOccurrences.slice()
      next.splice(index, 1)
      return {
        ...document,
        models: replaceMap(document.models, modelId, {
          ...model,
          connectionOccurrences: Object.freeze(next)
        })
      }
    }
  }
  throw new ArisCommandError(
    'missing-connection',
    `Connection occurrence ${payload.connectionOccurrenceId} not found.`,
    command.commandId
  )
}

function applyDeleteConnectionDefinition(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly definitionId: string } | ArisConnectionDefinition
  const definitionId = 'definitionId' in payload ? payload.definitionId : payload.id
  if (!document.connectionDefinitions.has(definitionId)) {
    throw new ArisCommandError(
      'missing-connection-definition',
      `Connection definition ${definitionId} not found.`,
      command.commandId
    )
  }
  return {
    ...document,
    connectionDefinitions: deleteMap(document.connectionDefinitions, definitionId)
  }
}

function applyAddLane(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisLane
  assertDefined(document.models.get(payload.modelId), 'model', command)
  return updateModel(document, payload.modelId, (model) =>
    Object.freeze({ ...model, lanes: Object.freeze([...model.lanes, payload]) })
  )
}

function applyEditLane(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisLane
  const found = assertDefined(findLane(document, payload.id), 'lane', command)
  if (found.modelId !== payload.modelId) {
    throw new ArisCommandError(
      'lane-model-mismatch',
      `Lane ${payload.id} cannot move between models.`,
      command.commandId
    )
  }
  return updateModel(document, payload.modelId, (model) => {
    const next = model.lanes.map((lane) => (lane.id === payload.id ? payload : lane))
    return Object.freeze({ ...model, lanes: Object.freeze(next) })
  })
}

function applyDeleteLane(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly laneId: string }
  const found = assertDefined(findLane(document, payload.laneId), 'lane', command)
  return updateModel(document, found.modelId, (model) => {
    const next = model.lanes.filter((lane) => lane.id !== payload.laneId)
    return Object.freeze({ ...model, lanes: Object.freeze(next) })
  })
}

function applyAddFreeText(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisFreeText
  assertDefined(document.models.get(payload.modelId), 'model', command)
  return updateModel(document, payload.modelId, (model) =>
    Object.freeze({ ...model, freeText: Object.freeze([...model.freeText, payload]) })
  )
}

function applyEditFreeText(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as ArisFreeText
  const found = assertDefined(findFreeText(document, payload.id), 'free text', command)
  if (found.modelId !== payload.modelId) {
    throw new ArisCommandError(
      'free-text-model-mismatch',
      `Free text ${payload.id} cannot move between models.`,
      command.commandId
    )
  }
  return updateModel(document, payload.modelId, (model) => {
    const next = model.freeText.map((item) => (item.id === payload.id ? payload : item))
    return Object.freeze({ ...model, freeText: Object.freeze(next) })
  })
}

function applyDeleteFreeText(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as { readonly freeTextId: string }
  const found = assertDefined(findFreeText(document, payload.freeTextId), 'free text', command)
  return updateModel(document, found.modelId, (model) => {
    const next = model.freeText.filter((item) => item.id !== payload.freeTextId)
    return Object.freeze({ ...model, freeText: Object.freeze(next) })
  })
}

function applySetModelAssignment(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const payload = command.after as {
    readonly objectDefinitionId: string
    readonly modelId: string
    readonly action: 'add' | 'remove'
  }
  const definition = assertDefined(
    document.objectDefinitions.get(payload.objectDefinitionId),
    'object definition',
    command
  )
  const linked = new Set(definition.linkedModelIds)
  if (payload.action === 'add') linked.add(payload.modelId)
  else linked.delete(payload.modelId)
  return {
    ...document,
    objectDefinitions: replaceMap(document.objectDefinitions, payload.objectDefinitionId, {
      ...definition,
      linkedModelIds: Object.freeze([...linked])
    })
  }
}

function applyTransaction(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  const normalized = normalizeCommand(command, command.baseRevision)
  const payload = normalized.after as { readonly commands: readonly ArisEditCommand[] }
  let current = document
  for (const subcommand of payload.commands) {
    current = applyChange(current, subcommand)
  }
  return current
}

const APPLIERS: Readonly<
  Record<
    ArisCommandKind,
    (document: ArisWorkingDocument, command: ArisEditCommand) => ArisWorkingDocument
  >
> = Object.freeze({
  setLocalizedName: applySetLocalizedName,
  setAttribute: applySetAttribute,
  addAttributeValue: applyAddAttributeValue,
  removeAttributeValue: applyRemoveAttributeValue,
  moveOccurrence: applyMoveOccurrence,
  resizeOccurrence: applyResizeOccurrence,
  restyleOccurrence: applyRestyleOccurrence,
  setOccurrenceSymbol: applySetOccurrenceSymbol,
  setAttributeOccurrencePlacement: applySetAttributeOccurrencePlacement,
  createDefinition: applyCreateDefinition,
  createOccurrence: applyCreateOccurrence,
  createConnectionDefinition: applyCreateConnectionDefinition,
  createConnectionOccurrence: applyCreateConnectionOccurrence,
  setConnectionRoute: applySetConnectionRoute,
  reconnectConnection: applyReconnectConnection,
  deleteOccurrence: applyDeleteOccurrence,
  deleteDefinition: applyDeleteDefinition,
  deleteConnection: applyDeleteConnection,
  deleteConnectionDefinition: applyDeleteConnectionDefinition,
  addLane: applyAddLane,
  editLane: applyEditLane,
  deleteLane: applyDeleteLane,
  addFreeText: applyAddFreeText,
  editFreeText: applyEditFreeText,
  deleteFreeText: applyDeleteFreeText,
  setModelAssignment: applySetModelAssignment,
  transaction: applyTransaction
})

function validatePreconditions(command: ArisEditCommand, document: ArisWorkingDocument): void {
  assertRevision(command, document)
  switch (command.kind) {
    case 'moveOccurrence':
    case 'resizeOccurrence':
    case 'restyleOccurrence':
    case 'setOccurrenceSymbol':
    case 'setAttributeOccurrencePlacement': {
      const payload = command.after as { readonly occurrenceId: string }
      assertDefined(findOccurrence(document, payload.occurrenceId), 'occurrence', command)
      break
    }
    case 'setConnectionRoute':
    case 'reconnectConnection': {
      const payload = command.after as { readonly connectionOccurrenceId: string }
      assertDefined(
        findConnectionOccurrence(document, payload.connectionOccurrenceId),
        'connection occurrence',
        command
      )
      break
    }
    case 'setLocalizedName':
    case 'setAttribute':
    case 'addAttributeValue':
    case 'removeAttributeValue': {
      const payload = command.after as { readonly ownerKind: string; readonly ownerId: string }
      if (payload.ownerKind === 'model')
        assertDefined(document.models.get(payload.ownerId), 'model', command)
      else if (payload.ownerKind === 'objectDefinition')
        assertDefined(document.objectDefinitions.get(payload.ownerId), 'object definition', command)
      else if (payload.ownerKind === 'connectionDefinition')
        assertDefined(
          document.connectionDefinitions.get(payload.ownerId),
          'connection definition',
          command
        )
      break
    }
    case 'createOccurrence':
    case 'addLane':
    case 'addFreeText': {
      const payload = command.after as { readonly modelId: string }
      assertDefined(document.models.get(payload.modelId), 'model', command)
      break
    }
    case 'editLane':
    case 'deleteLane': {
      const payload = command.after as { readonly id: string } | { readonly laneId: string }
      const laneId = 'laneId' in payload ? payload.laneId : payload.id
      assertDefined(findLane(document, laneId), 'lane', command)
      break
    }
    case 'editFreeText':
    case 'deleteFreeText': {
      const payload = command.after as { readonly id: string } | { readonly freeTextId: string }
      const freeTextId = 'freeTextId' in payload ? payload.freeTextId : payload.id
      assertDefined(findFreeText(document, freeTextId), 'free text', command)
      break
    }
    case 'createConnectionOccurrence': {
      const payload = command.after as ArisConnectionOccurrence
      assertDefined(document.models.get(payload.modelId), 'model', command)
      assertDefined(
        document.connectionDefinitions.get(payload.definitionId),
        'connection definition',
        command
      )
      assertDefined(
        findOccurrence(document, payload.sourceOccurrenceId),
        'source occurrence',
        command
      )
      assertDefined(
        findOccurrence(document, payload.targetOccurrenceId),
        'target occurrence',
        command
      )
      break
    }
    case 'setModelAssignment': {
      const payload = command.after as { readonly objectDefinitionId: string }
      assertDefined(
        document.objectDefinitions.get(payload.objectDefinitionId),
        'object definition',
        command
      )
      break
    }
    case 'transaction': {
      const payload = command.after as { readonly commands: readonly ArisEditCommand[] }
      for (const subcommand of payload.commands) validatePreconditions(subcommand, document)
      break
    }
  }
}

function validatePostconditions(document: ArisWorkingDocument, command: ArisEditCommand): void {
  try {
    validateDocument(document, command)
  } catch (error) {
    if (error instanceof ArisCommandError) throw error
    throw new ArisCommandError('post-validation-failed', String(error), command.commandId)
  }
}

/**
 * Apply a command without bumping the revision. Used internally by the
 * command stack so multi-object transactions and undo/redo stay atomic.
 */
export function applyChange(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  validatePreconditions(command, document)
  const next = APPLIERS[command.kind](document, command)
  validatePostconditions(next, command)
  return Object.freeze(next)
}

/**
 * Apply a command and bump the revision by one.
 */
export function applyCommand(
  document: ArisWorkingDocument,
  command: ArisEditCommand
): ArisWorkingDocument {
  return Object.freeze({ ...applyChange(document, command), revision: document.revision + 1 })
}

function extractDefinitionId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'definitionId' in payload) {
    return (payload as { readonly definitionId: string }).definitionId
  }
  return (payload as { readonly id: string }).id
}

function extractOccurrenceId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'occurrenceId' in payload) {
    return (payload as { readonly occurrenceId: string }).occurrenceId
  }
  return (payload as { readonly id: string }).id
}

function extractConnectionOccurrenceId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'connectionOccurrenceId' in payload) {
    return (payload as { readonly connectionOccurrenceId: string }).connectionOccurrenceId
  }
  return (payload as { readonly id: string }).id
}

function extractLaneId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'laneId' in payload) {
    return (payload as { readonly laneId: string }).laneId
  }
  return (payload as { readonly id: string }).id
}

function extractFreeTextId(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'freeTextId' in payload) {
    return (payload as { readonly freeTextId: string }).freeTextId
  }
  return (payload as { readonly id: string }).id
}

/**
 * Compute the inverse of a command so undo can restore the prior state.
 */
export function invertCommand(command: ArisEditCommand): ArisEditCommand {
  switch (command.kind) {
    case 'createDefinition':
      return {
        ...command,
        kind: 'deleteDefinition',
        before: command.after,
        after: { definitionId: (command.after as ArisObjectDefinition).id }
      }
    case 'createOccurrence':
      return {
        ...command,
        kind: 'deleteOccurrence',
        before: command.after,
        after: { occurrenceId: (command.after as ArisObjectOccurrence).id }
      }
    case 'createConnectionDefinition':
      return {
        ...command,
        kind: 'deleteConnectionDefinition',
        before: command.after,
        after: { definitionId: (command.after as ArisConnectionDefinition).id }
      }
    case 'createConnectionOccurrence':
      return {
        ...command,
        kind: 'deleteConnection',
        before: command.after,
        after: { connectionOccurrenceId: (command.after as ArisConnectionOccurrence).id }
      }
    case 'addLane':
      return {
        ...command,
        kind: 'deleteLane',
        before: command.after,
        after: { laneId: (command.after as ArisLane).id }
      }
    case 'addFreeText':
      return {
        ...command,
        kind: 'deleteFreeText',
        before: command.after,
        after: { freeTextId: (command.after as ArisFreeText).id }
      }
    case 'deleteDefinition':
      return {
        ...command,
        kind: 'createDefinition',
        before: command.after,
        after: command.before
      }
    case 'deleteOccurrence':
      return {
        ...command,
        kind: 'createOccurrence',
        before: command.after,
        after: command.before
      }
    case 'deleteConnection':
      return {
        ...command,
        kind: 'createConnectionOccurrence',
        before: command.after,
        after: command.before
      }
    case 'deleteConnectionDefinition':
      return {
        ...command,
        kind: 'createConnectionDefinition',
        before: command.after,
        after: command.before
      }
    case 'deleteLane':
      return {
        ...command,
        kind: 'addLane',
        before: command.after,
        after: command.before
      }
    case 'deleteFreeText':
      return {
        ...command,
        kind: 'addFreeText',
        before: command.after,
        after: command.before
      }
    case 'addAttributeValue':
    case 'removeAttributeValue': {
      const original = command.after as {
        readonly ownerKind: AttributeOwnerKind
        readonly ownerId: string
        readonly attributeType: string
      }
      return {
        ...command,
        kind: 'setAttribute',
        before: command.after,
        after: {
          ownerKind: original.ownerKind,
          ownerId: original.ownerId,
          attributeType: original.attributeType,
          values: command.before as readonly {
            readonly localeId: string | null
            readonly text: string
          }[]
        }
      }
    }
    case 'transaction': {
      const payload = command.after as { readonly commands: readonly ArisEditCommand[] }
      const inverted = [...payload.commands]
        .reverse()
        .map((subcommand) => invertCommand(subcommand))
      return { ...command, after: { commands: Object.freeze(inverted) } }
    }
    default:
      return { ...command, before: command.after, after: command.before }
  }
}

export {
  extractDefinitionId,
  extractOccurrenceId,
  extractConnectionOccurrenceId,
  extractLaneId,
  extractFreeTextId
}

/**
 * Adjust a command's `baseRevision` to a target revision. For transactions the
 * same target is applied recursively to all subcommands so internal
 * preconditions remain consistent.
 */
export function normalizeCommand(command: ArisEditCommand, revision: number): ArisEditCommand {
  if (command.kind !== 'transaction') {
    return { ...command, baseRevision: revision }
  }
  const payload = command.after as { readonly commands: readonly ArisEditCommand[] }
  return {
    ...command,
    baseRevision: revision,
    after: {
      commands: Object.freeze(
        payload.commands.map((subcommand) => normalizeCommand(subcommand, revision))
      )
    }
  }
}
