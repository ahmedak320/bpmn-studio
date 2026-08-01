/**
 * `ArisAuthoring` — one named function per Plan Section 11.4 operation.
 *
 * Everything here goes through `ArisCommandBridge`, so every operation is a
 * single undo step, is validated by the ARIS command system before anything
 * mutates, and is exportable from the ARIS command stack.
 *
 * | Section 11.4 operation                          | Function                       |
 * | ----------------------------------------------- | ------------------------------ |
 * | create definition and occurrence                | `createObject`                 |
 * | create another occurrence of an existing definition | `createAdditionalOccurrence` |
 * | rename definition                               | `renameDefinition`             |
 * | edit definition attributes                      | `setDefinitionAttribute`       |
 * | move occurrence                                 | `moveOccurrence`               |
 * | resize occurrence                               | `resizeOccurrence`             |
 * | restyle occurrence                              | `restyleOccurrence`            |
 * | create typed connection definition and occurrence | `connect`                    |
 * | reroute connection                              | `rerouteConnection`            |
 * | add lane / edit lane                            | `addLane` / `editLane`         |
 * | add free text / edit free text                  | `addFreeText` / `editFreeText` |
 * | add/remove linked-model assignment              | `addModelAssignment` / `removeModelAssignment` |
 * | add/download/remove attachment                  | `addAttachment` / `downloadAttachment` / `removeAttachment` |
 * | delete occurrence                               | `deleteOccurrence`             |
 * | delete unused definition (separate confirmation) | `requestDeleteDefinition` + `confirmDeleteDefinition` |
 * | copy/paste preserving or cloning identity       | `ArisClipboard.copy` / `.paste` |
 */

import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type { Connection, Shape } from 'diagram-js/lib/model/Types'

import type { ArisEditCommand } from '../model/commands'
import type {
  ArisAttributeValue,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisOccurrenceStyle,
  ArisPoint
} from '../model/types'
import { resolveArisSymbol } from '../symbols'
import { ArisCanvasCommandError, ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore, type ArisCommandThunk } from './documentStore'
import { ArisModeling } from './arisModeling'
import {
  addAttachmentCommand,
  downloadAttachment as readAttachment,
  listAttachments,
  removeAttachmentCommand,
  type ArisAttachment,
  type ArisAttachmentDownload
} from './attachments'
import {
  addFreeTextCommand,
  addLaneCommand,
  countConnectionOccurrencesOfDefinition,
  countOccurrencesOfDefinition,
  createDefinitionCommand,
  createOccurrenceCommand,
  deleteConnectionDefinitionCommand,
  deleteDefinitionCommand,
  deleteOccurrenceCommand,
  editFreeTextCommand,
  editLaneCommand,
  findOccurrence,
  moveOccurrenceCommand,
  requireObjectDefinition,
  requireOccurrence,
  resizeOccurrenceCommand,
  restyleOccurrenceCommand,
  setAttributeCommand,
  setConnectionRouteCommand,
  setDefinitionTypeCommand,
  setLocalizedNameCommand,
  setModelAssignmentCommand,
  setOccurrenceSymbolCommand,
  transactionCommand
} from './commandFactory'
import { DEFAULT_LOCALE_ID } from './emptyDocument'
import { ARIS_RULE_SYMBOLS, isSupportedObjectType, type ArisRuleOperator } from './vocabulary'

export interface CreateObjectOptions {
  readonly objectType: string
  readonly symbolNum?: string
  readonly name?: string
  readonly localeId?: string
  readonly position: { readonly x: number; readonly y: number }
  readonly size?: { readonly width: number; readonly height: number }
}

export interface CreateObjectResult {
  readonly definitionId: string
  readonly occurrenceId: string
  readonly commands: readonly ArisEditCommand[]
}

export interface ChangeObjectTypeTarget {
  readonly objectType: string
  readonly symbolNum: string
  readonly catalogId?: string
}

/** What the UI must confirm before an object definition disappears. */
export interface DeleteDefinitionRequest {
  readonly definitionId: string
  readonly objectType: string
  readonly name: string
  readonly occurrenceCount: number
  readonly connectionDefinitionCount: number
  /** `true` when no occurrence anywhere still uses the definition. */
  readonly unused: boolean
  /** `false` when occurrences remain; deleting is refused until they are gone. */
  readonly deletable: boolean
}

export class ArisAuthoring {
  static $inject = ['arisCommandBridge', 'arisDocumentStore', 'modeling', 'elementRegistry']

  constructor(
    private readonly bridge: ArisCommandBridge,
    private readonly store: ArisDocumentStore,
    private readonly modeling: ArisModeling,
    private readonly elementRegistry: ElementRegistry
  ) {}

  // -- create ---------------------------------------------------------------

  /** Create a definition and its first occurrence in one undo step. */
  createObject(options: CreateObjectOptions): CreateObjectResult {
    if (!isSupportedObjectType(options.objectType)) {
      throw new ArisCanvasCommandError(
        'unsupported-object-type',
        `${options.objectType} is not authorable.`
      )
    }
    const model = this.store.document.models.get(this.store.activeModelId)
    const modelType = model?.type ?? 'MT_EEPC'
    const resolution = resolveArisSymbol({
      modelType,
      objectType: options.objectType,
      symbolNum: options.symbolNum ?? ''
    })
    const symbolNum = options.symbolNum ?? resolution.descriptor.symbolNum
    const size = options.size ?? resolution.descriptor.defaultBounds
    const definitionId = this.store.nextId('objectDefinition')
    const occurrenceId = this.store.nextId('objectOccurrence')
    const modelId = this.store.activeModelId

    const commands = this.bridge.execute('create-object', (_document, context) =>
      transactionCommand(context, [
        createDefinitionCommand(context, {
          definitionId,
          objectType: options.objectType,
          symbolNum,
          name: options.name,
          localeId: options.localeId
        }),
        createOccurrenceCommand(context, {
          occurrenceId,
          definitionId,
          modelId,
          symbolNum,
          bounds: {
            x: options.position.x,
            y: options.position.y,
            width: size.width,
            height: size.height
          }
        })
      ])
    )
    return Object.freeze({ definitionId, occurrenceId, commands })
  }

  /** Create an AND/OR/XOR rule with its native symbol. */
  createRule(
    operator: ArisRuleOperator,
    position: { readonly x: number; readonly y: number },
    name?: string
  ): CreateObjectResult {
    return this.createObject({
      objectType: 'OT_RULE',
      symbolNum: ARIS_RULE_SYMBOLS[operator],
      position,
      name
    })
  }

  /**
   * Place **another occurrence of an existing definition**.
   *
   * The definition is untouched: the two shapes are the same ARIS object shown
   * twice, which is the distinction `ArisClipboard`'s paste modes also expose.
   */
  createAdditionalOccurrence(options: {
    readonly definitionId: string
    readonly position: { readonly x: number; readonly y: number }
    readonly symbolNum?: string
    readonly size?: { readonly width: number; readonly height: number }
  }): string {
    const document = this.store.document
    const definition = requireObjectDefinition(document, options.definitionId)
    const model = document.models.get(this.store.activeModelId)
    const modelType = model?.type ?? 'MT_EEPC'
    const symbolNum = options.symbolNum ?? definition.defaultSymbol ?? ''
    const resolution = resolveArisSymbol({ modelType, objectType: definition.type, symbolNum })
    const size = options.size ?? resolution.descriptor.defaultBounds
    const occurrenceId = this.store.nextId('objectOccurrence')
    const modelId = this.store.activeModelId
    const definitionId = options.definitionId
    const effectiveSymbol = symbolNum.length > 0 ? symbolNum : resolution.descriptor.symbolNum

    this.bridge.execute('create-occurrence', (_document, context) =>
      createOccurrenceCommand(context, {
        occurrenceId,
        definitionId,
        modelId,
        symbolNum: effectiveSymbol,
        bounds: {
          x: options.position.x,
          y: options.position.y,
          width: size.width,
          height: size.height
        }
      })
    )
    return occurrenceId
  }

  // -- edit -----------------------------------------------------------------

  renameDefinition(definitionId: string, name: string, localeId = DEFAULT_LOCALE_ID): void {
    this.bridge.execute('rename-definition', (document, context) =>
      setLocalizedNameCommand(context, document, 'objectDefinition', definitionId, localeId, name)
    )
  }

  renameModel(modelId: string, name: string, localeId = DEFAULT_LOCALE_ID): void {
    this.bridge.execute('rename-model', (document, context) =>
      setLocalizedNameCommand(context, document, 'model', modelId, localeId, name)
    )
  }

  setDefinitionAttribute(
    definitionId: string,
    attributeType: string,
    values: readonly ArisAttributeValue[]
  ): void {
    this.bridge.execute('set-attribute', (document, context) =>
      setAttributeCommand(
        context,
        document,
        'objectDefinition',
        definitionId,
        attributeType,
        values
      )
    )
  }

  moveOccurrence(occurrenceId: string, position: { readonly x: number; readonly y: number }): void {
    this.bridge.execute('move-occurrence', (document, context) =>
      moveOccurrenceCommand(context, document, occurrenceId, position)
    )
  }

  resizeOccurrence(
    occurrenceId: string,
    size: { readonly width: number; readonly height: number }
  ): void {
    this.bridge.execute('resize-occurrence', (document, context) =>
      resizeOccurrenceCommand(context, document, occurrenceId, size)
    )
  }

  restyleOccurrence(occurrenceId: string, style: Partial<ArisOccurrenceStyle>): void {
    this.bridge.execute('restyle-occurrence', (document, context) =>
      restyleOccurrenceCommand(context, document, occurrenceId, style)
    )
  }

  setOccurrenceSymbol(occurrenceId: string, symbolNum: string): void {
    this.bridge.execute('set-symbol', (document, context) =>
      setOccurrenceSymbolCommand(context, document, occurrenceId, symbolNum)
    )
  }

  /**
   * Edit a **model**-scoped attribute (Section 11.4). Mirrors
   * `setDefinitionAttribute` with the `'model'` owner kind, taking the plain
   * `localeId → text` map the details panel builds rather than the internal
   * `ArisAttributeValue[]` shape.
   */
  setModelAttribute(modelId: string, attributeType: string, values: Record<string, string>): void {
    const attributeValues: readonly ArisAttributeValue[] = Object.entries(values).map(
      ([localeId, text]) => Object.freeze({ localeId, text })
    )
    this.bridge.execute('set-model-attribute', (document, context) =>
      setAttributeCommand(context, document, 'model', modelId, attributeType, attributeValues)
    )
  }

  /**
   * `true` when an occurrence can be safely replaced by a different object type.
   *
   * A cross-type replace rebuilds the object from only its type, symbol, bounds
   * and **primary-locale** name (see `replaceNewObject`), so it is only lossless
   * on a genuinely metadata-empty, freshly-placed shape. This gate therefore
   * requires all of:
   *
   * - its definition has exactly this one occurrence, and no connection
   *   definition touches it (replacing a shared or connected definition would
   *   silently rewrite the object everywhere it appears);
   * - the definition carries no attributes (attachments live here too), no
   *   linked-model assignments, no raw source attributes (e.g. `AT_ID`) and at
   *   most a single name locale — anything more would be dropped on rebuild;
   * - the occurrence carries no attribute occurrences, no raw attributes and no
   *   authored style beyond its symbol.
   *
   * Both `replaceNewObject` and the quick-pick's cross-type members gate on this.
   */
  canReplaceNewObject(occurrenceId: string): boolean {
    const document = this.store.document
    const occurrence = findOccurrence(document, occurrenceId)
    if (!occurrence) return false
    const definitionId = occurrence.definitionId
    if (countOccurrencesOfDefinition(document, definitionId) !== 1) return false
    for (const connectionDefinition of document.connectionDefinitions.values()) {
      if (
        connectionDefinition.fromObjectDefinitionId === definitionId ||
        connectionDefinition.toObjectDefinitionId === definitionId
      ) {
        return false
      }
    }
    const definition = document.objectDefinitions.get(definitionId)
    if (!definition) return false
    if (!isMetadataEmptyDefinition(definition)) return false
    if (!isMetadataEmptyOccurrence(occurrence)) return false
    return true
  }

  /**
   * Replace a freshly-placed occurrence with one of a different object type,
   * preserving its position, size and name, in one undo step.
   *
   * Guarded by `canReplaceNewObject`: the shape must be a genuinely
   * metadata-empty, unshared, unconnected occurrence, else this throws
   * `ArisCanvasCommandError('replace-not-safe')` rather than silently dropping
   * the definition's attributes, assignments, attachments, extra name locales or
   * the occurrence's authored style. The single transaction deletes
   * the old occurrence and its now-unused definition, then creates the new
   * definition (with the preserved name) and its occurrence at the same bounds.
   */
  replaceNewObject(
    occurrenceId: string,
    target: { readonly objectType: string; readonly symbolNum: string }
  ): CreateObjectResult {
    // The target object type comes from the convention variant family, which is
    // broader than the palette's `createObject` vocabulary (it includes types
    // such as `OT_ORG_UNIT`); the real gate here is `canReplaceNewObject`, not
    // the authorable-palette list.
    const document = this.store.document
    const occurrence = requireOccurrence(document, occurrenceId)
    const definitionId = occurrence.definitionId
    if (!this.canReplaceNewObject(occurrenceId)) {
      throw new ArisCanvasCommandError(
        'replace-not-safe',
        `Occurrence ${occurrenceId} cannot be replaced: its definition is shared or connected.`
      )
    }
    const definition = requireObjectDefinition(document, definitionId)
    const modelId = occurrence.modelId
    const bounds = occurrence.bounds
    // Preserve the definition's primary name (its first stored locale).
    const localeId = Object.keys(definition.names.values)[0]
    const name =
      localeId !== undefined
        ? definition.names.values[localeId]
        : (definition.names.fallback ?? undefined)
    const newDefinitionId = this.store.nextId('objectDefinition')
    const newOccurrenceId = this.store.nextId('objectOccurrence')

    const commands = this.bridge.execute('replace-object', (doc, context) =>
      transactionCommand(context, [
        deleteOccurrenceCommand(context, doc, occurrenceId),
        deleteDefinitionCommand(context, doc, definitionId),
        createDefinitionCommand(context, {
          definitionId: newDefinitionId,
          objectType: target.objectType,
          symbolNum: target.symbolNum,
          name: name ?? undefined,
          localeId
        }),
        createOccurrenceCommand(context, {
          occurrenceId: newOccurrenceId,
          definitionId: newDefinitionId,
          modelId,
          symbolNum: target.symbolNum,
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        })
      ])
    )
    return Object.freeze({
      definitionId: newDefinitionId,
      occurrenceId: newOccurrenceId,
      commands
    })
  }

  /** Change a definition's type everywhere while retaining its identity and metadata. */
  changeObjectType(occurrenceId: string, target: ChangeObjectTypeTarget): void {
    const document = this.store.document
    const occurrence = requireOccurrence(document, occurrenceId)
    const definition = requireObjectDefinition(document, occurrence.definitionId)

    if (definition.type === target.objectType) {
      if (occurrence.symbol !== target.symbolNum) {
        this.setOccurrenceSymbol(occurrenceId, target.symbolNum)
      }
      return
    }
    if (!isSupportedObjectType(target.objectType)) {
      throw new ArisCanvasCommandError(
        'unsupported-object-type',
        `${target.objectType} is not authorable.`
      )
    }
    if (this.canReplaceNewObject(occurrenceId)) {
      this.replaceNewObject(occurrenceId, target)
      return
    }

    const modelTypeOf = (modelId: string): string => document.models.get(modelId)?.type ?? 'MT_EEPC'
    const oldDescriptor = resolveArisSymbol({
      modelType: modelTypeOf(occurrence.modelId),
      objectType: definition.type,
      symbolNum: occurrence.symbol
    }).descriptor
    const newDescriptor = resolveArisSymbol({
      modelType: modelTypeOf(occurrence.modelId),
      objectType: target.objectType,
      symbolNum: target.symbolNum
    }).descriptor

    this.bridge.execute('change-object-type', (doc, context) => {
      const commands: ArisEditCommand[] = [
        setDefinitionTypeCommand(context, doc, definition.id, {
          type: target.objectType,
          defaultSymbol: target.symbolNum
        })
      ]
      for (const model of doc.models.values()) {
        for (const sibling of model.occurrences) {
          if (sibling.definitionId !== definition.id) continue
          commands.push(setOccurrenceSymbolCommand(context, doc, sibling.id, target.symbolNum))
          const bounds = sibling.bounds
          if (
            bounds.width === oldDescriptor.defaultBounds.width &&
            bounds.height === oldDescriptor.defaultBounds.height
          ) {
            commands.push(
              resizeOccurrenceCommand(context, doc, sibling.id, newDescriptor.defaultBounds)
            )
          }
        }
      }
      return transactionCommand(context, commands)
    })
  }

  // -- connections ----------------------------------------------------------

  /** Create a typed connection definition (if needed) plus its occurrence. */
  connect(
    sourceOccurrenceId: string,
    targetOccurrenceId: string,
    options: { readonly connectionType?: string } = {}
  ): string {
    const source = this.elementRegistry.get(sourceOccurrenceId) as Shape | undefined
    const target = this.elementRegistry.get(targetOccurrenceId) as Shape | undefined
    if (!source || !target) {
      throw new ArisCanvasCommandError('missing-endpoint', 'Both endpoints must be on the canvas.')
    }
    const connection = this.modeling.connect(source, target, options)
    return connection.id
  }

  rerouteConnection(connectionOccurrenceId: string, route: readonly ArisPoint[]): void {
    this.bridge.execute('reroute', (document, context) =>
      setConnectionRouteCommand(context, document, connectionOccurrenceId, route)
    )
  }

  reconnect(
    connectionOccurrenceId: string,
    sourceOccurrenceId: string,
    targetOccurrenceId: string
  ): void {
    const connection = this.elementRegistry.get(connectionOccurrenceId) as Connection | undefined
    const source = this.elementRegistry.get(sourceOccurrenceId) as Shape | undefined
    const target = this.elementRegistry.get(targetOccurrenceId) as Shape | undefined
    if (!connection || !source || !target) {
      throw new ArisCanvasCommandError(
        'missing-endpoint',
        'Connection and both endpoints must be on the canvas.'
      )
    }
    this.modeling.reconnect(connection, source, target)
  }

  // -- lanes and free text ---------------------------------------------------

  addLane(
    options: {
      readonly name?: string
      readonly orientation?: 'horizontal' | 'vertical'
      readonly startBorder?: number
      readonly endBorder?: number
    } = {}
  ): string {
    const laneId = this.store.nextId('lane')
    const modelId = this.store.activeModelId
    this.bridge.execute('add-lane', (_document, context) =>
      addLaneCommand(context, {
        laneId,
        modelId,
        name: options.name,
        orientation: options.orientation,
        startBorder: options.startBorder,
        endBorder: options.endBorder
      })
    )
    return laneId
  }

  editLane(
    laneId: string,
    changes: {
      readonly name?: string
      readonly orientation?: 'horizontal' | 'vertical'
      readonly startBorder?: number
      readonly endBorder?: number
    }
  ): void {
    this.bridge.execute('edit-lane', (document, context) =>
      editLaneCommand(context, document, laneId, changes)
    )
  }

  addFreeText(options: {
    readonly text: string
    readonly bounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
    readonly localeId?: string
  }): string {
    const freeTextId = this.store.nextId('freeText')
    const modelId = this.store.activeModelId
    this.bridge.execute('add-free-text', (_document, context) =>
      addFreeTextCommand(context, {
        freeTextId,
        modelId,
        text: options.text,
        localeId: options.localeId,
        bounds: options.bounds
      })
    )
    return freeTextId
  }

  editFreeText(
    freeTextId: string,
    changes: {
      readonly text?: string
      readonly bounds?: {
        readonly x: number
        readonly y: number
        readonly width: number
        readonly height: number
      }
    }
  ): void {
    this.bridge.execute('edit-free-text', (document, context) =>
      editFreeTextCommand(context, document, freeTextId, changes)
    )
  }

  // -- linked-model assignments ---------------------------------------------

  addModelAssignment(definitionId: string, modelId: string): void {
    this.bridge.execute('add-assignment', (_document, context) =>
      setModelAssignmentCommand(context, definitionId, modelId, 'add')
    )
  }

  removeModelAssignment(definitionId: string, modelId: string): void {
    this.bridge.execute('remove-assignment', (_document, context) =>
      setModelAssignmentCommand(context, definitionId, modelId, 'remove')
    )
  }

  // -- attachments -----------------------------------------------------------

  addAttachment(definitionId: string, attachment: ArisAttachment): void {
    this.bridge.execute('add-attachment', (document, context) =>
      addAttachmentCommand(context, document, definitionId, attachment)
    )
  }

  removeAttachment(definitionId: string, attachmentId: string): void {
    this.bridge.execute('remove-attachment', (document, context) =>
      removeAttachmentCommand(context, document, definitionId, attachmentId)
    )
  }

  listAttachments(definitionId: string): readonly ArisAttachment[] {
    return listAttachments(this.store.document, definitionId)
  }

  downloadAttachment(definitionId: string, attachmentId: string): ArisAttachmentDownload {
    return readAttachment(this.store.document, definitionId, attachmentId)
  }

  // -- delete ----------------------------------------------------------------

  /** Delete one occurrence and every connection occurrence touching it. */
  deleteOccurrence(occurrenceId: string): void {
    const element = this.elementRegistry.get(occurrenceId) as Shape | undefined
    if (element) {
      this.modeling.removeElements([element])
      return
    }
    // Not rendered (e.g. in another model): go straight to the command.
    this.bridge.execute('delete-occurrence', (document, context) =>
      deleteOccurrenceCommand(context, document, occurrenceId)
    )
  }

  /**
   * Describe what deleting a definition would mean. **Nothing is deleted.**
   *
   * Section 11.4 requires a *separate* confirmation for definition deletion,
   * distinct from deleting an occurrence, because the two have completely
   * different consequences: removing the last shape leaves the object in the
   * database, whereas removing the definition destroys it everywhere.
   */
  requestDeleteDefinition(definitionId: string): DeleteDefinitionRequest {
    const document = this.store.document
    const definition = requireObjectDefinition(document, definitionId)
    const occurrenceCount = countOccurrencesOfDefinition(document, definitionId)
    let connectionDefinitionCount = 0
    for (const connectionDefinition of document.connectionDefinitions.values()) {
      if (
        connectionDefinition.fromObjectDefinitionId === definitionId ||
        connectionDefinition.toObjectDefinitionId === definitionId
      ) {
        connectionDefinitionCount += 1
      }
    }
    return Object.freeze({
      definitionId,
      objectType: definition.type,
      name: definition.names.fallback ?? '',
      occurrenceCount,
      connectionDefinitionCount,
      unused: occurrenceCount === 0,
      deletable: occurrenceCount === 0
    })
  }

  /**
   * Delete an unused definition after the caller confirmed the request.
   *
   * Refuses unless `confirmed` is `true` *and* the definition really is unused,
   * so a stale confirmation cannot delete a definition that gained occurrences
   * in the meantime.
   */
  confirmDeleteDefinition(definitionId: string, options: { readonly confirmed: boolean }): void {
    if (!options.confirmed) {
      throw new ArisCanvasCommandError(
        'not-confirmed',
        'Deleting a definition requires explicit confirmation.'
      )
    }
    const request = this.requestDeleteDefinition(definitionId)
    if (!request.deletable) {
      throw new ArisCanvasCommandError(
        'definition-in-use',
        `Definition ${definitionId} still has ${request.occurrenceCount} occurrence(s).`
      )
    }

    const document = this.store.document
    const orphanedConnectionDefinitions: string[] = []
    for (const [id, connectionDefinition] of document.connectionDefinitions) {
      if (
        connectionDefinition.fromObjectDefinitionId !== definitionId &&
        connectionDefinition.toObjectDefinitionId !== definitionId
      ) {
        continue
      }
      if (countConnectionOccurrencesOfDefinition(document, id) > 0) {
        throw new ArisCanvasCommandError(
          'connection-definition-in-use',
          `Connection definition ${id} still has occurrences.`
        )
      }
      orphanedConnectionDefinitions.push(id)
    }

    const thunks: ArisCommandThunk[] = orphanedConnectionDefinitions.map(
      (id): ArisCommandThunk =>
        (doc, context) =>
          deleteConnectionDefinitionCommand(context, doc, id)
    )
    thunks.push((doc, context) => deleteDefinitionCommand(context, doc, definitionId))
    this.bridge.execute('delete-definition', thunks)
  }

  /** The definition behind an occurrence, for panels and confirmations. */
  definitionIdOfOccurrence(occurrenceId: string): string {
    return requireOccurrence(this.store.document, occurrenceId).definitionId
  }
}

/**
 * `true` when a definition holds nothing a cross-type replace would drop:
 * `replaceNewObject` recreates it from only its type, symbol and primary-locale
 * name, so any attribute (attachments are stored as attributes too), linked-model
 * assignment, raw source attribute (e.g. `AT_ID`) or additional name locale is
 * metadata that would be silently lost.
 */
function isMetadataEmptyDefinition(definition: ArisObjectDefinition): boolean {
  return (
    definition.attributes.length === 0 &&
    definition.linkedModelIds.length === 0 &&
    Object.keys(definition.rawAttributes).length === 0 &&
    Object.keys(definition.names.values).length <= 1
  )
}

/**
 * `true` when an occurrence holds nothing a cross-type replace would drop: only
 * its bounds and symbol are carried over, so any attribute occurrence, raw
 * attribute or authored style value (anything beyond the intrinsic symbol) is
 * metadata that would be silently lost.
 */
function isMetadataEmptyOccurrence(occurrence: ArisObjectOccurrence): boolean {
  if (occurrence.attributeOccurrences.length > 0) return false
  if (Object.keys(occurrence.rawAttributes).length > 0) return false
  const style = occurrence.style
  return (
    style.fillColor === null &&
    style.strokeColor === null &&
    style.strokeWidth === null &&
    style.lineStyle === null &&
    style.fontStyleSheetId === null &&
    style.zOrder === null
  )
}
