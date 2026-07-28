/**
 * Pure `ArisEditCommand` builders for every canvas authoring gesture.
 *
 * Nothing here touches diagram-js or the DOM: given a document snapshot and a
 * gesture, each function returns the command that expresses it. Keeping this
 * layer pure is what lets the bridge dry-run a command before it reaches the
 * diagram-js command stack, and what lets the tests assert on `before`/`after`
 * payloads directly.
 *
 * Two invariants are enforced here rather than downstream:
 *
 * 1. Every geometry value passes through `geometry.ts`, so command payloads are
 *    always canonical integers (see that module for why).
 * 2. Every reversible command carries a complete `before` snapshot, because
 *    `invertCommand` in `src/aris/model/commands.ts` inverts the default kinds
 *    by swapping `before` and `after`.
 */

import type {
  ArisAttribute,
  ArisAttributeValue,
  ArisBounds,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisConnectionStyle,
  ArisFreeText,
  ArisLane,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisPoint,
  ArisWorkingDocument
} from '../model/types'
import type { ArisEditCommand, ArisCommandKind } from '../model/commands'
import { toCanonicalBounds, toCanonicalNumber, toCanonicalRoute } from './geometry'
import { EMPTY_LOCALIZED_VALUE, localizedValue } from './emptyDocument'

/** Everything a command needs beyond its payload. */
export interface ArisCommandContext {
  readonly commandId: string
  readonly baseRevision: number
  readonly origin?: ArisEditCommand['origin']
}

function build(
  context: ArisCommandContext,
  kind: ArisCommandKind,
  affectedSourceIds: readonly string[],
  before: unknown,
  after: unknown
): ArisEditCommand {
  return Object.freeze({
    commandId: context.commandId,
    baseRevision: context.baseRevision,
    kind,
    affectedSourceIds: Object.freeze([...affectedSourceIds]),
    before,
    after,
    origin: context.origin ?? 'user'
  })
}

export const DEFAULT_OCCURRENCE_STYLE: ArisOccurrenceStyle = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})

export const DEFAULT_CONNECTION_STYLE: ArisConnectionStyle = Object.freeze({
  color: null,
  width: null,
  lineStyle: null,
  srcArrow: null,
  tgtArrow: null,
  fontStyleSheetId: null,
  zOrder: null
})

// ---------------------------------------------------------------------------
// Lookup helpers (the working document stores occurrences per model)
// ---------------------------------------------------------------------------

export function findOccurrence(
  document: ArisWorkingDocument,
  occurrenceId: string
): ArisObjectOccurrence | undefined {
  for (const model of document.models.values()) {
    const found = model.occurrences.find((occurrence) => occurrence.id === occurrenceId)
    if (found) return found
  }
  return undefined
}

export function findConnectionOccurrence(
  document: ArisWorkingDocument,
  connectionOccurrenceId: string
): ArisConnectionOccurrence | undefined {
  for (const model of document.models.values()) {
    const found = model.connectionOccurrences.find((connection) => connection.id === connectionOccurrenceId)
    if (found) return found
  }
  return undefined
}

export function findLane(document: ArisWorkingDocument, laneId: string): ArisLane | undefined {
  for (const model of document.models.values()) {
    const found = model.lanes.find((lane) => lane.id === laneId)
    if (found) return found
  }
  return undefined
}

export function findFreeText(document: ArisWorkingDocument, freeTextId: string): ArisFreeText | undefined {
  for (const model of document.models.values()) {
    const found = model.freeText.find((text) => text.id === freeTextId)
    if (found) return found
  }
  return undefined
}

export function requireOccurrence(document: ArisWorkingDocument, occurrenceId: string): ArisObjectOccurrence {
  const occurrence = findOccurrence(document, occurrenceId)
  if (!occurrence) throw new Error(`Unknown object occurrence ${occurrenceId}.`)
  return occurrence
}

export function requireConnectionOccurrence(
  document: ArisWorkingDocument,
  connectionOccurrenceId: string
): ArisConnectionOccurrence {
  const connection = findConnectionOccurrence(document, connectionOccurrenceId)
  if (!connection) throw new Error(`Unknown connection occurrence ${connectionOccurrenceId}.`)
  return connection
}

export function requireObjectDefinition(
  document: ArisWorkingDocument,
  definitionId: string
): ArisObjectDefinition {
  const definition = document.objectDefinitions.get(definitionId)
  if (!definition) throw new Error(`Unknown object definition ${definitionId}.`)
  return definition
}

/** Count how many occurrences reference a definition, across every model. */
export function countOccurrencesOfDefinition(document: ArisWorkingDocument, definitionId: string): number {
  let count = 0
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) {
      if (occurrence.definitionId === definitionId) count += 1
    }
  }
  return count
}

/** Count how many connection occurrences reference a connection definition. */
export function countConnectionOccurrencesOfDefinition(
  document: ArisWorkingDocument,
  definitionId: string
): number {
  let count = 0
  for (const model of document.models.values()) {
    for (const connection of model.connectionOccurrences) {
      if (connection.definitionId === definitionId) count += 1
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Definitions and occurrences
// ---------------------------------------------------------------------------

export interface CreateDefinitionInput {
  readonly definitionId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly name?: string
  readonly localeId?: string
  readonly attributes?: readonly ArisAttribute[]
}

export function createDefinitionCommand(
  context: ArisCommandContext,
  input: CreateDefinitionInput
): ArisEditCommand {
  const definition: ArisObjectDefinition = Object.freeze({
    id: input.definitionId,
    type: input.objectType,
    defaultSymbol: input.symbolNum,
    names: input.name === undefined ? EMPTY_LOCALIZED_VALUE : localizedValue(input.name, input.localeId),
    attributes: Object.freeze([...(input.attributes ?? [])]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
  return build(context, 'createDefinition', [input.definitionId], null, definition)
}

export interface CreateOccurrenceInput {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly modelId: string
  readonly symbolNum: string
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly style?: Partial<ArisOccurrenceStyle>
}

export function createOccurrenceCommand(
  context: ArisCommandContext,
  input: CreateOccurrenceInput
): ArisEditCommand {
  const occurrence: ArisObjectOccurrence = Object.freeze({
    id: input.occurrenceId,
    definitionId: input.definitionId,
    modelId: input.modelId,
    symbol: input.symbolNum,
    bounds: toCanonicalBounds(input.bounds),
    style: Object.freeze({ ...DEFAULT_OCCURRENCE_STYLE, symbol: input.symbolNum, ...input.style }),
    attributeOccurrences: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
  return build(context, 'createOccurrence', [input.occurrenceId], null, occurrence)
}

export function moveOccurrenceCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string,
  position: { readonly x: number; readonly y: number }
): ArisEditCommand {
  const occurrence = requireOccurrence(document, occurrenceId)
  return build(
    context,
    'moveOccurrence',
    [occurrenceId],
    Object.freeze({ occurrenceId, x: occurrence.bounds.x, y: occurrence.bounds.y }),
    Object.freeze({
      occurrenceId,
      x: toCanonicalNumber(position.x, 'x'),
      y: toCanonicalNumber(position.y, 'y')
    })
  )
}

export function resizeOccurrenceCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string,
  size: { readonly width: number; readonly height: number }
): ArisEditCommand {
  const occurrence = requireOccurrence(document, occurrenceId)
  const canonical = toCanonicalBounds({ x: 0, y: 0, width: size.width, height: size.height })
  return build(
    context,
    'resizeOccurrence',
    [occurrenceId],
    Object.freeze({ occurrenceId, width: occurrence.bounds.width, height: occurrence.bounds.height }),
    Object.freeze({ occurrenceId, width: canonical.width, height: canonical.height })
  )
}

export function restyleOccurrenceCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string,
  style: Partial<ArisOccurrenceStyle>
): ArisEditCommand {
  const occurrence = requireOccurrence(document, occurrenceId)
  const before: Partial<ArisOccurrenceStyle> = {}
  for (const key of Object.keys(style) as (keyof ArisOccurrenceStyle)[]) {
    // Narrow assignment keeps the union member types intact.
    Object.assign(before, { [key]: occurrence.style[key] })
  }
  return build(
    context,
    'restyleOccurrence',
    [occurrenceId],
    Object.freeze({ occurrenceId, style: Object.freeze(before) }),
    Object.freeze({ occurrenceId, style: Object.freeze({ ...style }) })
  )
}

export function setOccurrenceSymbolCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string,
  symbolNum: string
): ArisEditCommand {
  const occurrence = requireOccurrence(document, occurrenceId)
  return build(
    context,
    'setOccurrenceSymbol',
    [occurrenceId],
    Object.freeze({ occurrenceId, symbol: occurrence.symbol }),
    Object.freeze({ occurrenceId, symbol: symbolNum })
  )
}

export function deleteOccurrenceCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  occurrenceId: string
): ArisEditCommand {
  const occurrence = requireOccurrence(document, occurrenceId)
  return build(context, 'deleteOccurrence', [occurrenceId], occurrence, Object.freeze({ occurrenceId }))
}

export function deleteDefinitionCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  definitionId: string
): ArisEditCommand {
  const definition = requireObjectDefinition(document, definitionId)
  return build(context, 'deleteDefinition', [definitionId], definition, Object.freeze({ definitionId }))
}

// ---------------------------------------------------------------------------
// Names and attributes
// ---------------------------------------------------------------------------

export type ArisNameOwnerKind = 'model' | 'objectDefinition' | 'connectionDefinition'

function readNames(
  document: ArisWorkingDocument,
  ownerKind: ArisNameOwnerKind,
  ownerId: string
): { readonly values: Readonly<Record<string, string>> } {
  if (ownerKind === 'model') {
    const model = document.models.get(ownerId)
    if (!model) throw new Error(`Unknown model ${ownerId}.`)
    return model.names
  }
  if (ownerKind === 'objectDefinition') {
    return requireObjectDefinition(document, ownerId).names
  }
  const definition = document.connectionDefinitions.get(ownerId)
  if (!definition) throw new Error(`Unknown connection definition ${ownerId}.`)
  return definition.names
}

export function setLocalizedNameCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  ownerKind: ArisNameOwnerKind,
  ownerId: string,
  localeId: string,
  value: string
): ArisEditCommand {
  const names = readNames(document, ownerKind, ownerId)
  const previous = names.values[localeId] ?? ''
  return build(
    context,
    'setLocalizedName',
    [ownerId],
    Object.freeze({ ownerKind, ownerId, localeId, value: previous }),
    Object.freeze({ ownerKind, ownerId, localeId, value })
  )
}

function readAttributes(
  document: ArisWorkingDocument,
  ownerKind: ArisNameOwnerKind,
  ownerId: string
): readonly ArisAttribute[] {
  if (ownerKind === 'model') {
    const model = document.models.get(ownerId)
    if (!model) throw new Error(`Unknown model ${ownerId}.`)
    return model.attributes
  }
  if (ownerKind === 'objectDefinition') {
    return requireObjectDefinition(document, ownerId).attributes
  }
  const definition = document.connectionDefinitions.get(ownerId)
  if (!definition) throw new Error(`Unknown connection definition ${ownerId}.`)
  return definition.attributes
}

export function readAttributeValues(
  document: ArisWorkingDocument,
  ownerKind: ArisNameOwnerKind,
  ownerId: string,
  attributeType: string
): readonly ArisAttributeValue[] {
  const attribute = readAttributes(document, ownerKind, ownerId).find(
    (candidate) => candidate.type === attributeType
  )
  return attribute?.values ?? Object.freeze([])
}

export function setAttributeCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  ownerKind: ArisNameOwnerKind,
  ownerId: string,
  attributeType: string,
  values: readonly ArisAttributeValue[]
): ArisEditCommand {
  const previous = readAttributeValues(document, ownerKind, ownerId, attributeType)
  return build(
    context,
    'setAttribute',
    [ownerId],
    Object.freeze({ ownerKind, ownerId, attributeType, values: Object.freeze([...previous]) }),
    Object.freeze({ ownerKind, ownerId, attributeType, values: Object.freeze([...values]) })
  )
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface CreateConnectionDefinitionInput {
  readonly definitionId: string
  readonly connectionType: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
}

export function createConnectionDefinitionCommand(
  context: ArisCommandContext,
  input: CreateConnectionDefinitionInput
): ArisEditCommand {
  const definition: ArisConnectionDefinition = Object.freeze({
    id: input.definitionId,
    type: input.connectionType,
    fromObjectDefinitionId: input.fromObjectDefinitionId,
    toObjectDefinitionId: input.toObjectDefinitionId,
    names: EMPTY_LOCALIZED_VALUE,
    attributes: Object.freeze([])
  })
  return build(context, 'createConnectionDefinition', [input.definitionId], null, definition)
}

export interface CreateConnectionOccurrenceInput {
  readonly connectionOccurrenceId: string
  readonly definitionId: string
  readonly modelId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly route?: readonly { readonly x: number; readonly y: number }[]
  readonly style?: Partial<ArisConnectionStyle>
}

export function createConnectionOccurrenceCommand(
  context: ArisCommandContext,
  input: CreateConnectionOccurrenceInput
): ArisEditCommand {
  const occurrence: ArisConnectionOccurrence = Object.freeze({
    id: input.connectionOccurrenceId,
    definitionId: input.definitionId,
    modelId: input.modelId,
    sourceOccurrenceId: input.sourceOccurrenceId,
    targetOccurrenceId: input.targetOccurrenceId,
    route: toCanonicalRoute(input.route ?? []),
    style: Object.freeze({ ...DEFAULT_CONNECTION_STYLE, ...input.style }),
    rawAttributes: Object.freeze({})
  })
  return build(context, 'createConnectionOccurrence', [input.connectionOccurrenceId], null, occurrence)
}

export function setConnectionRouteCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  connectionOccurrenceId: string,
  route: readonly { readonly x: number; readonly y: number }[]
): ArisEditCommand {
  const connection = requireConnectionOccurrence(document, connectionOccurrenceId)
  return build(
    context,
    'setConnectionRoute',
    [connectionOccurrenceId],
    Object.freeze({ connectionOccurrenceId, route: Object.freeze([...connection.route]) }),
    Object.freeze({ connectionOccurrenceId, route: toCanonicalRoute(route) })
  )
}

export function reconnectConnectionCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  connectionOccurrenceId: string,
  endpoints: { readonly sourceOccurrenceId?: string; readonly targetOccurrenceId?: string }
): ArisEditCommand {
  const connection = requireConnectionOccurrence(document, connectionOccurrenceId)
  return build(
    context,
    'reconnectConnection',
    [connectionOccurrenceId],
    Object.freeze({
      connectionOccurrenceId,
      sourceOccurrenceId: connection.sourceOccurrenceId,
      targetOccurrenceId: connection.targetOccurrenceId
    }),
    Object.freeze({
      connectionOccurrenceId,
      sourceOccurrenceId: endpoints.sourceOccurrenceId ?? connection.sourceOccurrenceId,
      targetOccurrenceId: endpoints.targetOccurrenceId ?? connection.targetOccurrenceId
    })
  )
}

export function deleteConnectionCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  connectionOccurrenceId: string
): ArisEditCommand {
  const connection = requireConnectionOccurrence(document, connectionOccurrenceId)
  return build(
    context,
    'deleteConnection',
    [connectionOccurrenceId],
    connection,
    Object.freeze({ connectionOccurrenceId })
  )
}

export function deleteConnectionDefinitionCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  definitionId: string
): ArisEditCommand {
  const definition = document.connectionDefinitions.get(definitionId)
  if (!definition) throw new Error(`Unknown connection definition ${definitionId}.`)
  return build(
    context,
    'deleteConnectionDefinition',
    [definitionId],
    definition,
    Object.freeze({ definitionId })
  )
}

// ---------------------------------------------------------------------------
// Lanes, free text, assignments
// ---------------------------------------------------------------------------

export interface AddLaneInput {
  readonly laneId: string
  readonly modelId: string
  readonly name?: string
  readonly laneType?: string | null
  readonly orientation?: 'horizontal' | 'vertical'
  readonly startBorder?: number
  readonly endBorder?: number
  readonly localeId?: string
}

export function addLaneCommand(context: ArisCommandContext, input: AddLaneInput): ArisEditCommand {
  const lane: ArisLane = Object.freeze({
    id: input.laneId,
    modelId: input.modelId,
    names: input.name === undefined ? EMPTY_LOCALIZED_VALUE : localizedValue(input.name, input.localeId),
    laneType: input.laneType ?? null,
    orientation: input.orientation ?? 'horizontal',
    startBorder: toCanonicalNumber(input.startBorder ?? 0, 'startBorder'),
    endBorder: toCanonicalNumber(input.endBorder ?? 0, 'endBorder')
  })
  return build(context, 'addLane', [input.laneId], null, lane)
}

export function editLaneCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  laneId: string,
  changes: {
    readonly name?: string
    readonly localeId?: string
    readonly laneType?: string | null
    readonly orientation?: 'horizontal' | 'vertical'
    readonly startBorder?: number
    readonly endBorder?: number
  }
): ArisEditCommand {
  const lane = findLane(document, laneId)
  if (!lane) throw new Error(`Unknown lane ${laneId}.`)
  const next: ArisLane = Object.freeze({
    ...lane,
    names: changes.name === undefined ? lane.names : localizedValue(changes.name, changes.localeId),
    laneType: changes.laneType === undefined ? lane.laneType : changes.laneType,
    orientation: changes.orientation ?? lane.orientation,
    startBorder:
      changes.startBorder === undefined ? lane.startBorder : toCanonicalNumber(changes.startBorder, 'startBorder'),
    endBorder: changes.endBorder === undefined ? lane.endBorder : toCanonicalNumber(changes.endBorder, 'endBorder')
  })
  return build(context, 'editLane', [laneId], lane, next)
}

export function deleteLaneCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  laneId: string
): ArisEditCommand {
  const lane = findLane(document, laneId)
  if (!lane) throw new Error(`Unknown lane ${laneId}.`)
  return build(context, 'deleteLane', [laneId], lane, Object.freeze({ laneId }))
}

export interface AddFreeTextInput {
  readonly freeTextId: string
  readonly modelId: string
  readonly text: string
  readonly localeId?: string
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly style?: Partial<ArisOccurrenceStyle>
}

export function addFreeTextCommand(context: ArisCommandContext, input: AddFreeTextInput): ArisEditCommand {
  const freeText: ArisFreeText = Object.freeze({
    id: input.freeTextId,
    modelId: input.modelId,
    definitionId: null,
    text: localizedValue(input.text, input.localeId),
    bounds: toCanonicalBounds(input.bounds),
    style: Object.freeze({ ...DEFAULT_OCCURRENCE_STYLE, ...input.style })
  })
  return build(context, 'addFreeText', [input.freeTextId], null, freeText)
}

export function editFreeTextCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  freeTextId: string,
  changes: {
    readonly text?: string
    readonly localeId?: string
    readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    readonly style?: Partial<ArisOccurrenceStyle>
  }
): ArisEditCommand {
  const freeText = findFreeText(document, freeTextId)
  if (!freeText) throw new Error(`Unknown free text ${freeTextId}.`)
  const bounds: ArisBounds = changes.bounds === undefined ? freeText.bounds : toCanonicalBounds(changes.bounds)
  const next: ArisFreeText = Object.freeze({
    ...freeText,
    text: changes.text === undefined ? freeText.text : localizedValue(changes.text, changes.localeId),
    bounds,
    style: changes.style === undefined ? freeText.style : Object.freeze({ ...freeText.style, ...changes.style })
  })
  return build(context, 'editFreeText', [freeTextId], freeText, next)
}

export function deleteFreeTextCommand(
  context: ArisCommandContext,
  document: ArisWorkingDocument,
  freeTextId: string
): ArisEditCommand {
  const freeText = findFreeText(document, freeTextId)
  if (!freeText) throw new Error(`Unknown free text ${freeTextId}.`)
  return build(context, 'deleteFreeText', [freeTextId], freeText, Object.freeze({ freeTextId }))
}

export function setModelAssignmentCommand(
  context: ArisCommandContext,
  objectDefinitionId: string,
  modelId: string,
  action: 'add' | 'remove'
): ArisEditCommand {
  return build(
    context,
    'setModelAssignment',
    [objectDefinitionId],
    Object.freeze({ objectDefinitionId, modelId, action: action === 'add' ? 'remove' : 'add' }),
    Object.freeze({ objectDefinitionId, modelId, action })
  )
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Group commands so they apply, undo and redo atomically.
 *
 * `applyTransaction` in the model lane normalizes every subcommand to the
 * transaction's own `baseRevision`, so callers build subcommands against the
 * *same* document snapshot rather than a running one.
 */
export function transactionCommand(
  context: ArisCommandContext,
  commands: readonly ArisEditCommand[],
  affectedSourceIds?: readonly string[]
): ArisEditCommand {
  const affected =
    affectedSourceIds ?? Object.freeze([...new Set(commands.flatMap((command) => command.affectedSourceIds))])
  return build(context, 'transaction', affected, null, Object.freeze({ commands: Object.freeze([...commands]) }))
}

export type { ArisPoint }
