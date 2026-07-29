/**
 * Copy/paste with **explicit definition identity** — Plan Section 11.4.
 *
 * In ARIS, a shape on a canvas is an *occurrence* of a *definition*. Pasting is
 * therefore ambiguous in a way that BPMN copy/paste is not, and the ambiguity
 * has to be resolved by the user rather than guessed:
 *
 * - `'shared-definition'` — the pasted shapes are **another occurrence of the
 *   same definition**. Renaming one renames all of them; deleting one leaves
 *   the definition alive. This is what "show this object again over here"
 *   means in ARIS.
 * - `'new-definition'` — the pasted shapes get **cloned definitions** with new
 *   ids and copied names/attributes. They are independent objects that merely
 *   start out looking the same.
 *
 * `paste` therefore *requires* the mode; there is no default. The two paths are
 * tested separately.
 *
 * Connections wholly inside the copied set are carried along. In shared mode
 * the existing connection definition is reused (its endpoint definitions are
 * unchanged); in clone mode one new connection definition is minted per
 * distinct (fromDefinition, toDefinition, type) triple.
 */

import type Clipboard from 'diagram-js/lib/features/clipboard/Clipboard'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type { Element } from 'diagram-js/lib/model/Types'

import type { ArisAttribute } from '../model/types'
import type { ArisModeling } from './arisModeling'
import { ArisCanvasCommandError, ArisCommandBridge } from './commandBridge'
import { ArisDocumentStore, type ArisCommandThunk } from './documentStore'
import {
  createConnectionDefinitionCommand,
  createConnectionOccurrenceCommand,
  createDefinitionCommand,
  createOccurrenceCommand,
  transactionCommand
} from './commandFactory'
import { arisBusinessObject } from './elements'
import { toCanonicalNumber } from './geometry'

export type ArisPasteIdentityMode = 'shared-definition' | 'new-definition'

export interface ArisClipboardOccurrence {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly nameFallback: string | null
  readonly localeValues: Readonly<Record<string, string>>
  readonly attributes: readonly ArisAttribute[]
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface ArisClipboardConnection {
  readonly connectionOccurrenceId: string
  readonly definitionId: string
  readonly connectionType: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
}

export interface ArisClipboardContent {
  readonly modelId: string
  readonly occurrences: readonly ArisClipboardOccurrence[]
  readonly connections: readonly ArisClipboardConnection[]
}

export interface ArisPasteResult {
  readonly mode: ArisPasteIdentityMode
  readonly occurrenceIds: readonly string[]
  readonly connectionOccurrenceIds: readonly string[]
  /** The definition each pasted occurrence points at, in the same order. */
  readonly definitionIds: readonly string[]
}

export class ArisClipboard {
  static $inject = [
    'clipboard',
    'elementRegistry',
    'arisCommandBridge',
    'arisDocumentStore',
    'modeling'
  ]

  constructor(
    private readonly clipboard: Clipboard,
    private readonly elementRegistry: ElementRegistry,
    private readonly bridge: ArisCommandBridge,
    private readonly store: ArisDocumentStore,
    private readonly modeling: ArisModeling
  ) {}

  /** Snapshot the selected occurrences (and their internal edges). */
  copy(elements: readonly Element[]): ArisClipboardContent {
    const document = this.store.document
    const modelId = this.store.activeModelId
    const model = document.models.get(modelId)
    if (!model) throw new ArisCanvasCommandError('missing-model', `Unknown model ${modelId}.`)

    const selectedIds = new Set<string>()
    for (const element of elements) {
      const businessObject = arisBusinessObject(element)
      if (businessObject?.kind === 'occurrence') selectedIds.add(businessObject.occurrenceId)
    }

    const occurrences = model.occurrences
      .filter((occurrence) => selectedIds.has(occurrence.id))
      .map((occurrence) => {
        const definition = document.objectDefinitions.get(occurrence.definitionId)
        return Object.freeze({
          occurrenceId: occurrence.id,
          definitionId: occurrence.definitionId,
          objectType: definition?.type ?? 'OT_UNKNOWN',
          symbolNum: occurrence.symbol,
          nameFallback: definition?.names.fallback ?? null,
          localeValues: Object.freeze({ ...(definition?.names.values ?? {}) }),
          attributes: Object.freeze([...(definition?.attributes ?? [])]),
          bounds: occurrence.bounds
        })
      })

    const connections = model.connectionOccurrences
      .filter(
        (connection) =>
          selectedIds.has(connection.sourceOccurrenceId) &&
          selectedIds.has(connection.targetOccurrenceId)
      )
      .map((connection) =>
        Object.freeze({
          connectionOccurrenceId: connection.id,
          definitionId: connection.definitionId,
          connectionType:
            document.connectionDefinitions.get(connection.definitionId)?.type ?? 'CT_UNKNOWN',
          sourceOccurrenceId: connection.sourceOccurrenceId,
          targetOccurrenceId: connection.targetOccurrenceId
        })
      )

    const content: ArisClipboardContent = Object.freeze({
      modelId,
      occurrences: Object.freeze(occurrences),
      connections: Object.freeze(connections)
    })
    this.clipboard.set(content)
    return content
  }

  get(): ArisClipboardContent | null {
    const content = this.clipboard.get() as ArisClipboardContent | undefined
    return content ?? null
  }

  isEmpty(): boolean {
    const content = this.get()
    return content === null || content.occurrences.length === 0
  }

  /**
   * Paste the clipboard content.
   *
   * @param options.mode required — see the module header. There is deliberately
   *   no default: silently picking one of the two identities is exactly the
   *   mistake this API exists to prevent.
   */
  paste(options: {
    readonly mode: ArisPasteIdentityMode
    readonly delta?: { readonly x: number; readonly y: number }
    readonly content?: ArisClipboardContent
  }): ArisPasteResult {
    const content = options.content ?? this.get()
    if (!content || content.occurrences.length === 0) {
      throw new ArisCanvasCommandError('empty-clipboard', 'Nothing to paste.')
    }
    const dx = toCanonicalNumber(options.delta?.x ?? 40, 'dx')
    const dy = toCanonicalNumber(options.delta?.y ?? 40, 'dy')
    const modelId = this.store.activeModelId
    const clone = options.mode === 'new-definition'

    const occurrenceIdMap = new Map<string, string>()
    const definitionIdMap = new Map<string, string>()
    const thunks: ArisCommandThunk[] = []
    const newOccurrenceIds: string[] = []
    const usedDefinitionIds: string[] = []

    for (const source of content.occurrences) {
      const occurrenceId = this.store.nextId('objectOccurrence')
      occurrenceIdMap.set(source.occurrenceId, occurrenceId)
      newOccurrenceIds.push(occurrenceId)

      const bounds = {
        x: source.bounds.x + dx,
        y: source.bounds.y + dy,
        width: source.bounds.width,
        height: source.bounds.height
      }

      if (!clone) {
        const definitionId = source.definitionId
        definitionIdMap.set(source.definitionId, definitionId)
        usedDefinitionIds.push(definitionId)
        thunks.push((_document, context) =>
          createOccurrenceCommand(context, {
            occurrenceId,
            definitionId,
            modelId,
            symbolNum: source.symbolNum,
            bounds
          })
        )
        continue
      }

      const alreadyCloned = definitionIdMap.has(source.definitionId)
      const definitionId =
        definitionIdMap.get(source.definitionId) ?? this.store.nextId('objectDefinition')
      definitionIdMap.set(source.definitionId, definitionId)
      usedDefinitionIds.push(definitionId)

      thunks.push((_document, context) => {
        const occurrenceCommand = createOccurrenceCommand(context, {
          occurrenceId,
          definitionId,
          modelId,
          symbolNum: source.symbolNum,
          bounds
        })
        if (alreadyCloned) return occurrenceCommand
        const definitionCommand = createDefinitionCommand(context, {
          definitionId,
          objectType: source.objectType,
          symbolNum: source.symbolNum,
          attributes: source.attributes
        })
        // Preserve every locale, not just the display fallback.
        const withNames = Object.freeze({
          ...definitionCommand,
          after: Object.freeze({
            ...(definitionCommand.after as Record<string, unknown>),
            names: Object.freeze({
              values: Object.freeze({ ...source.localeValues }),
              fallback: source.nameFallback
            })
          })
        })
        return transactionCommand(context, [withNames, occurrenceCommand])
      })
    }

    // Connection definitions: one per distinct (from, to, type) triple.
    const clonedConnectionDefinitionIds = new Map<string, string>()
    const definitionOfOccurrence = new Map(
      content.occurrences.map((entry) => [entry.occurrenceId, entry.definitionId])
    )
    const newConnectionIds: string[] = []

    for (const connection of content.connections) {
      const sourceOccurrenceId = occurrenceIdMap.get(connection.sourceOccurrenceId)
      const targetOccurrenceId = occurrenceIdMap.get(connection.targetOccurrenceId)
      if (!sourceOccurrenceId || !targetOccurrenceId) continue
      const connectionOccurrenceId = this.store.nextId('connectionOccurrence')
      newConnectionIds.push(connectionOccurrenceId)

      if (!clone) {
        const definitionId = connection.definitionId
        thunks.push((_document, context) =>
          createConnectionOccurrenceCommand(context, {
            connectionOccurrenceId,
            definitionId,
            modelId,
            sourceOccurrenceId,
            targetOccurrenceId
          })
        )
        continue
      }

      const fromDefinitionId = definitionIdMap.get(
        definitionOfOccurrence.get(connection.sourceOccurrenceId) ?? ''
      )
      const toDefinitionId = definitionIdMap.get(
        definitionOfOccurrence.get(connection.targetOccurrenceId) ?? ''
      )
      if (!fromDefinitionId || !toDefinitionId) continue

      const key = `${fromDefinitionId}|${toDefinitionId}|${connection.connectionType}`
      const known = clonedConnectionDefinitionIds.get(key)
      const definitionId = known ?? this.store.nextId('connectionDefinition')
      if (!known) {
        clonedConnectionDefinitionIds.set(key, definitionId)
        thunks.push((_document, context) =>
          createConnectionDefinitionCommand(context, {
            definitionId,
            connectionType: connection.connectionType,
            fromObjectDefinitionId: fromDefinitionId,
            toObjectDefinitionId: toDefinitionId
          })
        )
      }
      thunks.push((_document, context) =>
        createConnectionOccurrenceCommand(context, {
          connectionOccurrenceId,
          definitionId,
          modelId,
          sourceOccurrenceId,
          targetOccurrenceId
        })
      )
    }

    this.bridge.execute(`paste:${options.mode}`, thunks)

    return Object.freeze({
      mode: options.mode,
      occurrenceIds: Object.freeze(newOccurrenceIds),
      connectionOccurrenceIds: Object.freeze(newConnectionIds),
      definitionIds: Object.freeze(usedDefinitionIds)
    })
  }

  /**
   * Copy, then delete the copied occurrences.
   *
   * The delete is a normal delete gesture, so it is one undo step and it never
   * removes definitions (Section 11.4's separate confirmation still applies).
   */
  cut(elements: readonly Element[]): ArisClipboardContent {
    const content = this.copy(elements)
    const ids = new Set(content.occurrences.map((entry) => entry.occurrenceId))
    const toRemove = this.elementRegistry.filter((element) => {
      const businessObject = arisBusinessObject(element)
      return businessObject?.kind === 'occurrence' && ids.has(businessObject.occurrenceId)
    })
    if (toRemove.length > 0) this.modeling.removeElements(toRemove)
    return content
  }
}
