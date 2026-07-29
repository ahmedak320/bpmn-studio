/**
 * The seam between `src/aris/chat` (plan §18) and the real ARIS model layer.
 *
 * `src/aris/chat` declares its own structural document shape and its own patch
 * command vocabulary, deliberately without importing `src/aris/model`. The real
 * `ArisWorkingDocument` already satisfies `ArisChatWorkingDocument` structurally,
 * so the only thing missing is the translation of one `ArisChatCommand` into one
 * `ArisEditCommand` — `modelCommandMapping.ts` documents the mapping; this file
 * performs it, for all fifteen plan §18.3 commands.
 *
 * Three rules are load-bearing:
 *
 *  - A command kind this seam cannot express THROWS. `applySafeCommandsAtomically`
 *    treats any throw as "this command could not be applied" and aborts the whole
 *    batch with the document untouched, which is precisely the §18.8 guarantee
 *    that an invalid patch changes nothing. Silently skipping would break it.
 *  - Every `ArisEditCommand` is built against the document it will actually be
 *    applied to, so `baseRevision` always matches and a stale proposal is rejected
 *    by the model layer rather than by a hopeful check here.
 *  - Every `ArisEditCommand` carries its `before` pre-image, because that is what
 *    `invertCommand` in `src/aris/model/commands.ts` undoes with. A command
 *    translated with `before: null` applies and then cannot be reverted, which is
 *    how a chat-applied batch used to end up outside the undo history in practice
 *    even though it sat on it (`buildDirect` below, plan §18.5 step 7 / §18.8).
 *
 * ## Creation commands: id allocation and canonical placement
 *
 * `addMetadataDefinition`, `addMetadataOccurrence`, `addMetadataConnection`,
 * `addCoreObject` and `addCoreConnection` each mint one or more new records. The
 * ids an AI proposal carries for these (`payload.definitionId`,
 * `payload.occurrenceId`, …) are treated as PLACEHOLDERS — correlation tokens a
 * proposal uses to reference "the thing I am about to create" from a later
 * command in the same batch (e.g. `addCoreConnection.payload.sourceOccurrenceId`
 * naming the `occurrenceId` an earlier `addCoreObject` in the same proposal just
 * proposed) — never the id that ends up in the document. The real id is always
 * allocated locally by `src/aris/writer/ids.ts`'s collision-checked, source-style
 * allocator (`createArisIdAllocator`), seeded from every id already in the
 * document. `ArisChatIdAllocationContext.idMap` remembers each placeholder's real
 * id so later commands in the same batch resolve their cross-references to it
 * instead of the placeholder string, which never appears in the resulting
 * document. An id that is not a known placeholder is assumed to already resolve
 * in the document (an existing definition/occurrence a new record attaches to)
 * and is passed through unchanged; the model layer's own precondition checks
 * reject it if it does not.
 *
 * New occurrences need a position `addCoreObject`/`addMetadataOccurrence` do not
 * carry (the patch schema deliberately has no layout opinion). `canonicalBounds`
 * below places new occurrences in a simple deterministic stack below whatever is
 * already in the target model, sized from `src/aris/symbols`' own descriptor for
 * the object type/symbol — "canonical placement" in the sense that it is always
 * reproducible from the document and symbol registry alone, not that it is a
 * good layout (the user or a later layout pass can move it).
 *
 * `addMetadataConnection`, `addCoreObject` and `addCoreConnection` each become TWO model
 * commands (a `create*Definition` + a `create*Occurrence`). `addCoreObject` wraps its pair in
 * one `transaction` `ArisEditCommand` (`modelCommandMapping.ts`'s documented shape) because that
 * works: `createOccurrence`'s precondition in `src/aris/model/commands.ts` only checks that
 * `modelId` resolves, not `definitionId`, so it does not matter that the definition is only
 * folded into the document by the FIRST subcommand inside the same transaction.
 *
 * `addMetadataConnection`/`addCoreConnection` do NOT get the same treatment, because
 * `createConnectionOccurrence`'s precondition also demands `definitionId` resolve — and
 * `transaction`'s precondition check (`validatePreconditions`'s `case 'transaction'` in
 * `src/aris/model/commands.ts`) validates every subcommand against the document as it stood
 * BEFORE the transaction, never the one folded forward by an earlier subcommand in the same
 * transaction. Wrapping `createConnectionDefinition` + `createConnectionOccurrence` in one
 * `transaction` therefore always fails: the occurrence subcommand's precondition can never see
 * the definition the transaction itself is about to create. This is not a guess — `src/aris/
 * canvas/commandBridge.ts`'s module doc independently documents hitting the exact same wall for
 * the exact same command pair and describes the same workaround adopted here: apply the two as
 * an ORDERED PAIR of top-level commands (see `toArisEditCommands`, `applyOrderedModelCommands`)
 * rather than one `transaction`. `modelCommandMapping.ts` documents this same ordered-pair
 * reality and the precondition constraint behind it for `addMetadataConnection`/
 * `addCoreConnection`, distinct from `addCoreObject`'s literal `transaction` wrapper.
 *
 * `removeAttachment` targets the OrbitPM attachment feature
 * (`src/aris/canvas/attachments.ts`), which stores each attachment as one value
 * of the `AT_ORBITPM_ATTACHMENT` object-definition attribute rather than as a
 * dedicated `ArisCommandKind` — so it becomes a `setAttribute` command via that
 * module's own `removeAttachmentCommand`, unchanged. (`modelCommandMapping.ts`
 * documents this same `setAttribute` mapping. The chat lane only classifies and
 * schema-validates the command kind; only translation, this file's job,
 * performs it.)
 */

import {
  createConnectionDefinitionCommand,
  createConnectionOccurrenceCommand,
  createOccurrenceCommand,
  deleteConnectionCommand,
  deleteDefinitionCommand,
  deleteOccurrenceCommand,
  readAttributeValues,
  reconnectConnectionCommand,
  requireConnectionOccurrence,
  setAttributeCommand,
  setLocalizedNameCommand,
  setModelAssignmentCommand,
  transactionCommand
} from '../canvas/commandFactory'
import type { ArisCommandContext } from '../canvas/commandFactory'
import type { ArisCommandThunk } from '../canvas/documentStore'
import { removeAttachmentCommand } from '../canvas/attachments'
import { resolveArisSymbol, resolveDefaultSymbol } from '../symbols'
import {
  applyCommand as applyModelCommand,
  normalizeCommand,
  type ArisEditCommand
} from '../model/commands'
import type {
  ArisBounds,
  ArisLocalizedValue,
  ArisModel,
  ArisPoint,
  ArisWorkingDocument
} from '../model/types'
import { createArisIdAllocator, type ArisIdAllocator, type RandomSource } from '../writer/ids'
import { localeLang } from '../../library/amlParse'
import type { ArisChatApplyHost } from '../chat/applyEngine'
import { DEFAULT_GAP_SCAN_CONFIG, scanArisChatGaps, type ArisChatGap } from '../chat/gapScanner'
import type {
  ArisChatInterviewHost,
  ArisChatProposalTargetVerification
} from '../chat/interviewLoop'
import {
  ARIS_CHAT_COMMAND_KINDS,
  type ArisChatCommand,
  type ArisPatchProposalV1
} from '../chat/patchSchema'
import { detectLocaleIds } from './arisChatProposal'

/** Raised when a patch command has no `src/aris/model` counterpart in this shell. */
export class ArisChatUnsupportedCommandError extends Error {
  readonly kind: string

  constructor(kind: string) {
    super(`Patch command "${kind}" has no model-layer counterpart in this shell build.`)
    this.name = 'ArisChatUnsupportedCommandError'
    this.kind = kind
  }
}

/** All fifteen plan §18.3 patch command kinds translate at this seam. */
export const ARIS_CHAT_SUPPORTED_COMMAND_KINDS: ReadonlySet<ArisChatCommand['kind']> =
  Object.freeze(new Set<ArisChatCommand['kind']>(ARIS_CHAT_COMMAND_KINDS))

// --- id allocation (creation commands only) --------------------------------------------------

/**
 * Per-batch id-allocation state: a collision-checked allocator plus a memory of which real id
 * each AI-proposed placeholder id resolved to, so a later command in the same batch that
 * references an earlier command's placeholder gets the SAME real id.
 */
export interface ArisChatIdAllocationContext {
  readonly allocator: ArisIdAllocator
  readonly idMap: Map<string, string>
}

function collectExistingIds(document: ArisWorkingDocument): string[] {
  const ids: string[] = []
  for (const id of document.models.keys()) ids.push(id)
  for (const id of document.objectDefinitions.keys()) ids.push(id)
  for (const id of document.connectionDefinitions.keys()) ids.push(id)
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) ids.push(occurrence.id)
    for (const connection of model.connectionOccurrences) ids.push(connection.id)
    for (const lane of model.lanes) ids.push(lane.id)
    for (const freeText of model.freeText) ids.push(freeText.id)
  }
  return ids
}

/** Build a one-shot id-allocation context seeded only from `document` (no cross-call memory). */
function defaultIdContext(
  document: ArisWorkingDocument,
  random?: RandomSource
): ArisChatIdAllocationContext {
  return {
    allocator: createArisIdAllocator({ existingIds: collectExistingIds(document), random }),
    idMap: new Map<string, string>()
  }
}

/** Resolve (and, on first sight, allocate) the real id a placeholder id maps to. */
function resolvePlaceholderId(
  idContext: ArisChatIdAllocationContext,
  placeholderId: string,
  allocate: () => string
): string {
  const existing = idContext.idMap.get(placeholderId)
  if (existing !== undefined) return existing
  const real = allocate()
  idContext.idMap.set(placeholderId, real)
  return real
}

/** Resolve a reference id: the real id a known placeholder mapped to, or the id unchanged. */
function resolveReferenceId(idContext: ArisChatIdAllocationContext, id: string): string {
  return idContext.idMap.get(id) ?? id
}

// --- localized names (creation commands only) ------------------------------------------------

/**
 * Remap an AI-proposed localized-name map onto the document's own locale convention.
 *
 * `detectLocaleIds` (from `arisChatProposal.ts`) resolves the document's actual English/Arabic
 * locale ids, which for real imported AML is the raw unexpanded internal-DTD entity reference
 * (`"&LocaleId.AEar;"`), not a numeric LCID. A proposal's `names.values` keys are classified with
 * the same `localeLang` and rewritten onto those real ids; a key that classifies as neither
 * English nor Arabic is assumed to already be a locale id the document understands and is passed
 * through unchanged.
 */
function buildLocalizedValue(
  document: ArisWorkingDocument,
  names: { readonly values: Readonly<Record<string, string>>; readonly fallback: string | null }
): ArisLocalizedValue {
  const locales = detectLocaleIds(document)
  const values: Record<string, string> = {}
  for (const [key, text] of Object.entries(names.values)) {
    const lang = localeLang(key)
    const realKey = lang === 'en' ? locales.en : lang === 'ar' ? locales.ar : key
    values[realKey] = text
  }
  return Object.freeze({ values: Object.freeze(values), fallback: names.fallback })
}

// --- canonical placement (occurrence-creating commands only) ---------------------------------

const CANONICAL_PLACEMENT_ORIGIN = 100
const CANONICAL_PLACEMENT_MARGIN = 80

function nextCanonicalPosition(model: ArisModel): { readonly x: number; readonly y: number } {
  if (model.occurrences.length === 0) {
    return { x: CANONICAL_PLACEMENT_ORIGIN, y: CANONICAL_PLACEMENT_ORIGIN }
  }
  const x = Math.min(...model.occurrences.map((occurrence) => occurrence.bounds.x))
  const bottom = Math.max(
    ...model.occurrences.map((occurrence) => occurrence.bounds.y + occurrence.bounds.height)
  )
  return { x, y: bottom + CANONICAL_PLACEMENT_MARGIN }
}

/** Deterministic symbol + bounds for a new occurrence, from the document and symbol registry alone. */
function canonicalOccurrencePlacement(
  model: ArisModel,
  objectType: string,
  requestedSymbol: string | null
): { readonly symbolNum: string; readonly bounds: ArisBounds } {
  const descriptor = requestedSymbol
    ? resolveArisSymbol({ modelType: model.type, objectType, symbolNum: requestedSymbol })
        .descriptor
    : resolveDefaultSymbol(objectType)
  const position = nextCanonicalPosition(model)
  return {
    symbolNum: requestedSymbol ?? descriptor.symbolNum,
    bounds: {
      x: position.x,
      y: position.y,
      width: descriptor.defaultBounds.width,
      height: descriptor.defaultBounds.height
    }
  }
}

function requireModel(document: ArisWorkingDocument, modelId: string): ArisModel {
  const model = document.models.get(modelId)
  if (!model) throw new Error(`Unknown model ${modelId}.`)
  return model
}

// --- translation -------------------------------------------------------------------------------

/**
 * Translate one patch command into the ORDERED list of model commands that perform it.
 *
 * Fourteen of the fifteen kinds produce exactly one `ArisEditCommand`. `addMetadataConnection`
 * and `addCoreConnection` produce TWO, applied one at a time rather than wrapped in a
 * `transaction` — see this file's module doc for why a `transaction` cannot express that pair.
 * `applyOrderedModelCommands` applies whatever this function returns correctly regardless of
 * length; callers that know a kind always produces one command may use `toArisEditCommand`
 * instead.
 *
 * `idContext` supplies the allocator/placeholder-map state creation commands need. It defaults to
 * a fresh, one-shot context seeded only from `document` when omitted, which is safe for a single
 * standalone call (e.g. a unit test translating one command in isolation) but does NOT remember
 * placeholder ids across separate calls — a caller translating a whole batch (as
 * `createArisChatApplyHost` does) must pass the SAME `idContext` (constant `idMap`, allocator
 * refreshed against each call's document) across every command in that batch so cross-references
 * between newly created records resolve correctly.
 */
export function toArisEditCommands(
  document: ArisWorkingDocument,
  command: ArisChatCommand,
  origin: ArisEditCommand['origin'] = 'ai-auto',
  idContext: ArisChatIdAllocationContext = defaultIdContext(document)
): readonly ArisEditCommand[] {
  switch (command.kind) {
    case 'setLocalizedName':
    case 'setAttribute':
    case 'addAttributeValue':
    case 'setAssignment':
    case 'setRoute':
    case 'reconnect':
    case 'deleteConnection':
    case 'deleteOccurrence':
    case 'deleteDefinition':
      return [translateDirect(document, command, origin)]
    case 'addMetadataDefinition':
      return [translateAddMetadataDefinition(document, command, origin, idContext)]
    case 'addMetadataOccurrence':
      return [translateAddMetadataOccurrence(document, command, origin, idContext)]
    case 'addMetadataConnection':
    case 'addCoreConnection':
      return translateAddConnectionPair(document, command, origin, idContext)
    case 'addCoreObject':
      return [translateAddCoreObject(document, command, origin, idContext)]
    case 'removeAttachment':
      return [
        removeAttachmentCommand(
          { commandId: command.commandId, baseRevision: document.revision, origin },
          document,
          command.payload.ownerId,
          command.payload.attachmentId
        )
      ]
    default: {
      const exhaustive: never = command
      throw new ArisChatUnsupportedCommandError((exhaustive as ArisChatCommand).kind)
    }
  }
}

/**
 * Translate one patch command into the SINGLE model command that performs it.
 *
 * Throws for `addMetadataConnection`/`addCoreConnection`, the two kinds that always produce two
 * commands — use `toArisEditCommands` (plural) for those, applied via `applyOrderedModelCommands`.
 */
export function toArisEditCommand(
  document: ArisWorkingDocument,
  command: ArisChatCommand,
  origin: ArisEditCommand['origin'] = 'ai-auto',
  idContext: ArisChatIdAllocationContext = defaultIdContext(document)
): ArisEditCommand {
  const commands = toArisEditCommands(document, command, origin, idContext)
  if (commands.length !== 1) {
    throw new Error(
      `Patch command "${command.kind}" translates into ${commands.length} model commands; ` +
        'use toArisEditCommands (plural) and applyOrderedModelCommands instead of ' +
        'toArisEditCommand for this kind.'
    )
  }
  return commands[0]!
}

/**
 * Apply an ordered list of model commands to `document`, folding each result into the next.
 *
 * Every command after the first is renumbered to the CURRENT folded revision before it applies
 * (`normalizeCommand`, also used by `src/aris/model/commandStack.ts`'s own redo), so callers do
 * not need to predict how many revisions the earlier commands in the list consume.
 */
export function applyOrderedModelCommands(
  document: ArisWorkingDocument,
  commands: readonly ArisEditCommand[]
): ArisWorkingDocument {
  let current = document
  for (const command of commands) {
    current = applyModelCommand(current, normalizeCommand(command, current.revision))
  }
  return current
}

/** The nine patch kinds whose model command is a single, already-shaped edit. */
type ArisChatDirectCommand = Extract<
  ArisChatCommand,
  {
    kind:
      | 'setLocalizedName'
      | 'setAttribute'
      | 'addAttributeValue'
      | 'setAssignment'
      | 'setRoute'
      | 'reconnect'
      | 'deleteConnection'
      | 'deleteOccurrence'
      | 'deleteDefinition'
  }
>

/**
 * Build the model command for one of the nine direct kinds, WITH its `before` pre-image.
 *
 * `before` is not decoration. `invertCommand` in `src/aris/model/commands.ts` computes an undo by
 * swapping `before` and `after` (or, for the delete kinds, by re-creating the record it finds in
 * `before`), so a command translated with `before: null` applies perfectly and then throws on the
 * first revert — which is exactly how a chat-applied batch used to become un-undoable while
 * diagram-js still showed Undo as available. Every builder below is therefore the *document-aware*
 * one from `src/aris/canvas/commandFactory.ts`, the same builder a canvas gesture uses, so a
 * chat-applied edit and a hand-drawn edit are byte-identical entries on one history.
 *
 * `setRoute` is built by hand rather than through `setConnectionRouteCommand` only so its `after`
 * route keeps the exact points the patch proposed (the factory rounds them to the canvas grid);
 * its `before` is read from the document the same way.
 */
function buildDirect(
  document: ArisWorkingDocument,
  command: ArisChatDirectCommand,
  context: ArisCommandContext
): ArisEditCommand {
  switch (command.kind) {
    case 'setLocalizedName': {
      const { ownerKind, ownerId, localeId, value } = command.payload
      return setLocalizedNameCommand(context, document, ownerKind, ownerId, localeId, value)
    }
    case 'setAttribute': {
      const { ownerKind, ownerId, attributeType, values } = command.payload
      return setAttributeCommand(context, document, ownerKind, ownerId, attributeType, values)
    }
    case 'addAttributeValue': {
      const { ownerKind, ownerId, attributeType } = command.payload
      // `invertCommand` turns this into a `setAttribute` back to `before`, so `before` must be the
      // owner's complete prior value list for this attribute type, not just the added value.
      return {
        commandId: context.commandId,
        baseRevision: context.baseRevision,
        kind: 'addAttributeValue',
        affectedSourceIds: [ownerId],
        before: Object.freeze([
          ...readAttributeValues(document, ownerKind, ownerId, attributeType)
        ]),
        after: command.payload,
        origin: context.origin ?? 'user'
      }
    }
    case 'setAssignment': {
      const { objectDefinitionId, modelId, action } = command.payload
      return setModelAssignmentCommand(context, objectDefinitionId, modelId, action)
    }
    case 'setRoute': {
      const { connectionOccurrenceId, route } = command.payload
      const connection = requireConnectionOccurrence(document, connectionOccurrenceId)
      return {
        commandId: context.commandId,
        baseRevision: context.baseRevision,
        kind: 'setConnectionRoute',
        affectedSourceIds: [connectionOccurrenceId],
        before: Object.freeze({
          connectionOccurrenceId,
          route: Object.freeze([...connection.route])
        }),
        after: Object.freeze({
          connectionOccurrenceId,
          route: Object.freeze(route.map((point): ArisPoint => ({ x: point.x, y: point.y })))
        }),
        origin: context.origin ?? 'user'
      }
    }
    case 'reconnect': {
      const { connectionOccurrenceId, sourceOccurrenceId, targetOccurrenceId } = command.payload
      return reconnectConnectionCommand(context, document, connectionOccurrenceId, {
        ...(sourceOccurrenceId === undefined ? {} : { sourceOccurrenceId }),
        ...(targetOccurrenceId === undefined ? {} : { targetOccurrenceId })
      })
    }
    case 'deleteConnection':
      return deleteConnectionCommand(context, document, command.payload.connectionOccurrenceId)
    case 'deleteOccurrence':
      return deleteOccurrenceCommand(context, document, command.payload.occurrenceId)
    case 'deleteDefinition':
      return deleteDefinitionCommand(context, document, command.payload.definitionId)
    default: {
      const exhaustive: never = command
      throw new ArisChatUnsupportedCommandError((exhaustive as ArisChatCommand).kind)
    }
  }
}

/**
 * The nine patch commands whose payload shape is already identical to the model command's (see
 * `modelCommandMapping.ts`), so the payload is carried across unchanged — the one exception being
 * `setRoute`, whose points are narrowed to `ArisPoint`.
 *
 * The patch command's own `targetIds` stay the command's `affectedSourceIds`, because that is what
 * the derived AML export addresses records by; only `before` comes from the factory.
 */
function translateDirect(
  document: ArisWorkingDocument,
  command: ArisChatDirectCommand,
  origin: ArisEditCommand['origin']
): ArisEditCommand {
  const built = buildDirect(document, command, {
    commandId: command.commandId,
    baseRevision: document.revision,
    origin
  })
  return Object.freeze({ ...built, affectedSourceIds: command.targetIds })
}

function translateAddMetadataDefinition(
  document: ArisWorkingDocument,
  command: Extract<ArisChatCommand, { kind: 'addMetadataDefinition' }>,
  origin: ArisEditCommand['origin'],
  idContext: ArisChatIdAllocationContext
): ArisEditCommand {
  const { payload } = command
  const definitionId = resolvePlaceholderId(idContext, payload.definitionId, () =>
    idContext.allocator.allocateDefinitionId('ObjDef')
  )
  const names = buildLocalizedValue(document, payload.names)
  return {
    commandId: command.commandId,
    baseRevision: document.revision,
    kind: 'createDefinition',
    affectedSourceIds: [definitionId],
    before: null,
    after: {
      id: definitionId,
      type: payload.objectType,
      defaultSymbol: null,
      names,
      attributes: [],
      linkedModelIds: [],
      rawAttributes: {}
    },
    origin
  }
}

function translateAddMetadataOccurrence(
  document: ArisWorkingDocument,
  command: Extract<ArisChatCommand, { kind: 'addMetadataOccurrence' }>,
  origin: ArisEditCommand['origin'],
  idContext: ArisChatIdAllocationContext
): ArisEditCommand {
  const { payload } = command
  const modelId = resolveReferenceId(idContext, payload.modelId)
  const definitionId = resolveReferenceId(idContext, payload.definitionId)
  const occurrenceId = resolvePlaceholderId(idContext, payload.occurrenceId, () =>
    idContext.allocator.allocateOccurrenceId('ObjOcc', modelId)
  )
  const model = requireModel(document, modelId)
  const objectType = document.objectDefinitions.get(definitionId)?.type ?? 'OT_FUNC'
  const placement = canonicalOccurrencePlacement(model, objectType, payload.symbol)
  return createOccurrenceCommand(
    { commandId: command.commandId, baseRevision: document.revision, origin },
    {
      occurrenceId,
      definitionId,
      modelId,
      symbolNum: placement.symbolNum,
      bounds: placement.bounds
    }
  )
}

/**
 * Shared by `addMetadataConnection` and `addCoreConnection` — identical translation.
 *
 * Returns an ORDERED PAIR, not a `transaction` — see this file's module doc for why wrapping
 * `createConnectionDefinition` + `createConnectionOccurrence` in one `transaction` always fails
 * precondition validation. The occurrence command's `baseRevision` is one past the definition
 * command's, predicting the single revision bump `applyModelCommand` always performs; a caller
 * that folds these through anything other than a plain one-after-another apply (as
 * `applyOrderedModelCommands` does) must renumber it first.
 */
function translateAddConnectionPair(
  document: ArisWorkingDocument,
  command: Extract<ArisChatCommand, { kind: 'addMetadataConnection' | 'addCoreConnection' }>,
  origin: ArisEditCommand['origin'],
  idContext: ArisChatIdAllocationContext
): readonly ArisEditCommand[] {
  const { payload } = command
  const modelId = resolveReferenceId(idContext, payload.modelId)
  const fromObjectDefinitionId = resolveReferenceId(idContext, payload.fromObjectDefinitionId)
  const toObjectDefinitionId = resolveReferenceId(idContext, payload.toObjectDefinitionId)
  const sourceOccurrenceId = resolveReferenceId(idContext, payload.sourceOccurrenceId)
  const targetOccurrenceId = resolveReferenceId(idContext, payload.targetOccurrenceId)
  const connectionDefinitionId = resolvePlaceholderId(
    idContext,
    payload.connectionDefinitionId,
    () => idContext.allocator.allocateDefinitionId('CxnDef')
  )
  const connectionOccurrenceId = resolvePlaceholderId(
    idContext,
    payload.connectionOccurrenceId,
    () => idContext.allocator.allocateOccurrenceId('CxnOcc', modelId)
  )

  const definitionCommand = createConnectionDefinitionCommand(
    { commandId: `${command.commandId}#definition`, baseRevision: document.revision, origin },
    {
      definitionId: connectionDefinitionId,
      connectionType: payload.connectionType,
      fromObjectDefinitionId,
      toObjectDefinitionId
    }
  )
  const occurrenceCommand = createConnectionOccurrenceCommand(
    {
      commandId: `${command.commandId}#occurrence`,
      baseRevision: document.revision + 1,
      origin
    },
    {
      connectionOccurrenceId,
      definitionId: connectionDefinitionId,
      modelId,
      sourceOccurrenceId,
      targetOccurrenceId
    }
  )
  return [definitionCommand, occurrenceCommand]
}

function translateAddCoreObject(
  document: ArisWorkingDocument,
  command: Extract<ArisChatCommand, { kind: 'addCoreObject' }>,
  origin: ArisEditCommand['origin'],
  idContext: ArisChatIdAllocationContext
): ArisEditCommand {
  const { payload } = command
  const modelId = resolveReferenceId(idContext, payload.modelId)
  const definitionId = resolvePlaceholderId(idContext, payload.definitionId, () =>
    idContext.allocator.allocateDefinitionId('ObjDef')
  )
  const occurrenceId = resolvePlaceholderId(idContext, payload.occurrenceId, () =>
    idContext.allocator.allocateOccurrenceId('ObjOcc', modelId)
  )
  const model = requireModel(document, modelId)
  const names = buildLocalizedValue(document, payload.names)
  const placement = canonicalOccurrencePlacement(model, payload.objectType, payload.symbol)

  const definitionCommand: ArisEditCommand = {
    commandId: `${command.commandId}#definition`,
    baseRevision: document.revision,
    kind: 'createDefinition',
    affectedSourceIds: [definitionId],
    before: null,
    after: {
      id: definitionId,
      type: payload.objectType,
      defaultSymbol: placement.symbolNum,
      names,
      attributes: [],
      linkedModelIds: [],
      rawAttributes: {}
    },
    origin
  }
  const occurrenceCommand = createOccurrenceCommand(
    { commandId: `${command.commandId}#occurrence`, baseRevision: document.revision, origin },
    {
      occurrenceId,
      definitionId,
      modelId,
      symbolNum: placement.symbolNum,
      bounds: placement.bounds
    }
  )
  return transactionCommand(
    { commandId: command.commandId, baseRevision: document.revision, origin },
    [definitionCommand, occurrenceCommand],
    [definitionId, occurrenceId]
  )
}

/** Every id a patch command claims to touch still resolves in `document`. */
function targetsResolve(document: ArisWorkingDocument, targetIds: readonly string[]): boolean {
  return targetIds.every((id) => {
    if (document.models.has(id)) return true
    if (document.objectDefinitions.has(id)) return true
    if (document.connectionDefinitions.has(id)) return true
    for (const model of document.models.values()) {
      if (model.occurrences.some((occurrence) => occurrence.id === id)) return true
      if (model.connectionOccurrences.some((connection) => connection.id === id)) return true
    }
    return false
  })
}

export interface ArisChatHostOptions {
  /** Persist a draft revision (plan §18.5 step 5). Omit when the shell does not. */
  readonly saveDraftRevision?: ArisChatApplyHost<ArisWorkingDocument>['saveDraftRevision']
  readonly origin?: ArisEditCommand['origin']
  /** Deterministic id randomness for tests. Omit to use `crypto.getRandomValues`. */
  readonly randomIdSource?: RandomSource
}

/** Build the §18.5/§18.6 apply host over the real working document. */
export function createArisChatApplyHost(
  options: ArisChatHostOptions = {}
): ArisChatApplyHost<ArisWorkingDocument> {
  // One placeholder->real id map for the whole host's lifetime, so a creation command proposed
  // (and possibly previewed) in one round resolves to the same real id if it is applied later in
  // the same session. The allocator itself is rebuilt from the CURRENT document on every call, so
  // it always collision-checks against everything actually in the document, including records
  // created earlier in the same batch (each call sees the document already folded forward — see
  // `applySequentially` in `../chat/applyEngine.ts`).
  const idMap = new Map<string, string>()
  return {
    getRevision: (document) => document.revision,
    applyCommand: (document, command) => {
      const idContext: ArisChatIdAllocationContext = {
        allocator: createArisIdAllocator({
          existingIds: collectExistingIds(document),
          random: options.randomIdSource
        }),
        idMap
      }
      const edits = toArisEditCommands(document, command, options.origin, idContext)
      return applyOrderedModelCommands(document, edits)
    },
    ...(options.saveDraftRevision ? { saveDraftRevision: options.saveDraftRevision } : {})
  }
}

/**
 * The part of `ArisCanvas` committing a chat batch needs: the live document and the command
 * bridge. Structural on purpose — the shell test can drive the real bridge without a React tree.
 */
export interface ArisChatGestureCanvas {
  readonly document: ArisWorkingDocument
  readonly bridge: {
    execute(label: string, thunks: readonly ArisCommandThunk[]): readonly ArisEditCommand[]
  }
}

/**
 * Commit a validated chat batch as ONE undoable canvas gesture (plan §18.5 step 7, §18.8).
 *
 * Everything goes through `ArisCommandBridge.execute`, which records the whole batch as a single
 * `aris.gesture` entry on diagram-js's command stack. That is what makes the rail's Undo and the
 * toolbar's Undo the same button: both end up in `ArisGestureHandler.revert`, which undoes exactly
 * as many ARIS commands as the gesture applied.
 *
 * The batch is translated eagerly against a scratch fold of the canvas document rather than one
 * chat command at a time, for two reasons:
 *
 *  - `addMetadataConnection`/`addCoreConnection` become TWO model commands, so a one-command-per-
 *    patch-command translation cannot express them at all (`toArisEditCommand` throws for them);
 *  - one `idMap` spans the whole batch, so a command that references a record an earlier command
 *    in the same batch created resolves to the id that record actually got.
 *
 * @returns the canvas document after the gesture, or `null` when nothing was applied — the bridge
 *   plans before it executes, so a rejection leaves both stacks untouched.
 */
export function applyArisChatCommandsAsGesture(
  canvas: ArisChatGestureCanvas,
  commands: readonly ArisChatCommand[],
  label: string,
  options: ArisChatHostOptions = {}
): ArisWorkingDocument | null {
  const origin = options.origin ?? 'ai-auto'
  const idMap = new Map<string, string>()
  try {
    const planned: ArisEditCommand[] = []
    let scratch = canvas.document
    for (const command of commands) {
      const idContext: ArisChatIdAllocationContext = {
        allocator: createArisIdAllocator({
          existingIds: collectExistingIds(scratch),
          ...(options.randomIdSource ? { random: options.randomIdSource } : {})
        }),
        idMap
      }
      for (const edit of toArisEditCommands(scratch, command, origin, idContext)) {
        const normalized = normalizeCommand(edit, scratch.revision)
        scratch = applyModelCommand(scratch, normalized)
        planned.push(normalized)
      }
    }
    if (planned.length === 0) return canvas.document
    canvas.bridge.execute(
      label,
      planned.map(
        (edit): ArisCommandThunk =>
          (document) =>
            normalizeCommand(edit, document.revision)
      )
    )
    return canvas.document
  } catch {
    return null
  }
}

/** Build the §18.2 interview host: the apply host plus gap scanning and target checks. */
export function createArisChatInterviewHost(
  options: ArisChatHostOptions = {}
): ArisChatInterviewHost<ArisWorkingDocument> {
  return {
    ...createArisChatApplyHost(options),
    scanGaps: (document) => scanArisChatGaps(document, DEFAULT_GAP_SCAN_CONFIG),
    verifyProposalTargets: (
      document,
      proposal: ArisPatchProposalV1
    ): ArisChatProposalTargetVerification => {
      if (proposal.baseRevision !== document.revision) return 'stale-revision'
      for (const command of proposal.commands) {
        if (!targetsResolve(document, command.targetIds)) return 'target-removed'
      }
      return 'ok'
    }
  }
}

/** Scan the live document for §18.1 gaps. */
export function scanArisGaps(document: ArisWorkingDocument): readonly ArisChatGap[] {
  return scanArisChatGaps(document, DEFAULT_GAP_SCAN_CONFIG)
}
