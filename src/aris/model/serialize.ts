import type { ArisEditCommand } from './commands'
import type {
  ArisConnectionDefinition,
  ArisModel,
  ArisObjectDefinition,
  ArisStyle,
  ArisWorkingDocument
} from './types'

export interface SerializedArisWorkingDocument {
  readonly database: ArisWorkingDocument['database']
  readonly models: [string, ArisModel][]
  readonly objectDefinitions: [string, ArisObjectDefinition][]
  readonly connectionDefinitions: [string, ArisConnectionDefinition][]
  readonly styleCatalog: { readonly styles: [string, ArisStyle][] }
  readonly revision: number
}

export interface SerializedCommandStack {
  readonly document: SerializedArisWorkingDocument
  readonly undoCommands: ArisEditCommand[]
  readonly redoCommands: ArisEditCommand[]
}

function mapToEntries<K, V>(map: ReadonlyMap<K, V>): [K, V][] {
  return [...map.entries()]
}

function entriesToMap<K, V>(entries: [K, V][]): ReadonlyMap<K, V> {
  return Object.freeze(new Map(entries))
}

/**
 * Convert a working document into a plain JSON-serializable object.
 *
 * The attached `sourceIndex` is deliberately not serialized here; it is
 * immutable source material and should be stored/reloaded alongside the
 * document by the caller (for example through `LosslessAmlDocument`).
 */
export function serializeDocument(document: ArisWorkingDocument): SerializedArisWorkingDocument {
  return Object.freeze({
    database: document.database,
    models: mapToEntries(document.models),
    objectDefinitions: mapToEntries(document.objectDefinitions),
    connectionDefinitions: mapToEntries(document.connectionDefinitions),
    styleCatalog: {
      styles: mapToEntries(document.styleCatalog.styles)
    },
    revision: document.revision
  })
}

/**
 * Rebuild a working document from its serialized form.
 *
 * The caller must re-attach the original `sourceIndex` because the source
 * index is kept separately from the editable working state.
 */
export function deserializeDocument(
  serialized: SerializedArisWorkingDocument,
  sourceIndex: ArisWorkingDocument['sourceIndex']
): ArisWorkingDocument {
  return Object.freeze({
    database: serialized.database,
    models: entriesToMap(serialized.models),
    objectDefinitions: entriesToMap(serialized.objectDefinitions),
    connectionDefinitions: entriesToMap(serialized.connectionDefinitions),
    styleCatalog: Object.freeze({ styles: entriesToMap(serialized.styleCatalog.styles) }),
    sourceIndex,
    revision: serialized.revision
  })
}

/**
 * Serialize a command stack so it can be persisted as plain JSON.
 */
export function serializeCommandStack(stack: {
  readonly document: ArisWorkingDocument
  readonly undoStack: readonly ArisEditCommand[]
  readonly redoStack: readonly ArisEditCommand[]
}): SerializedCommandStack {
  return Object.freeze({
    document: serializeDocument(stack.document),
    undoCommands: [...stack.undoStack],
    redoCommands: [...stack.redoStack]
  })
}

/**
 * Deserialize a command stack. The original `sourceIndex` must be supplied
 * separately because it is not part of the editable working state payload.
 */
export function deserializeCommandStack(
  serialized: SerializedCommandStack,
  sourceIndex: ArisWorkingDocument['sourceIndex']
): {
  readonly document: ArisWorkingDocument
  readonly undoStack: readonly ArisEditCommand[]
  readonly redoStack: readonly ArisEditCommand[]
} {
  return Object.freeze({
    document: deserializeDocument(serialized.document, sourceIndex),
    undoStack: Object.freeze(serialized.undoCommands),
    redoStack: Object.freeze(serialized.redoCommands)
  })
}
