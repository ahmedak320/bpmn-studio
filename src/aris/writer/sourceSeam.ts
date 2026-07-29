import type { SpanLike, WriterSpan } from './spans'
import { toWriterSpan } from './spans'

/**
 * The single seam between the writer and the ARIS semantic index.
 *
 * The writer does not import `ArisSourceIndex` or any of its record types. Those types describe
 * a rich parsed model that is still evolving; binding the writer to them would mean every index
 * reshape becomes a writer change. Instead the writer declares the *minimum structural shape*
 * it needs below and adapts once, here. `ArisSourceIndex` satisfies these interfaces
 * structurally today, and any future index that keeps `sourceId` + `rawAttributes` + a
 * `{start,end}.offset` span will keep satisfying them.
 *
 * Everything the writer does downstream of this file is expressed in {@link WriterSpan} and the
 * writer's own `WriterSourceView`, which is built directly from the lossless tokenizer.
 */

export interface SourceRecordLike {
  readonly sourceId: string | null
  readonly elementName?: string
  readonly path?: string
  readonly span?: SpanLike
  readonly rawAttributes?: Readonly<Record<string, string>>
}

/**
 * Any collection shape the index uses for records: an id-keyed map or a plain array. Declaring
 * both means the writer does not care which member of the index is a map and which is a list.
 */
export type SourceRecordCollection =
  ReadonlyMap<string, SourceRecordLike> | readonly SourceRecordLike[]

export interface SourceIndexLike {
  readonly models?: SourceRecordCollection
  readonly objectDefinitions?: SourceRecordCollection
  readonly objectOccurrences?: SourceRecordCollection
  readonly connectionDefinitions?: SourceRecordCollection
  readonly connectionOccurrences?: SourceRecordCollection
  readonly groups?: SourceRecordCollection
  readonly lanes?: SourceRecordCollection
  readonly freeText?: SourceRecordCollection
  readonly attachments?: SourceRecordCollection
  readonly languages?: SourceRecordCollection
}

export interface SourceDocumentLike {
  readonly index: SourceIndexLike
}

/** Facts the writer needs from an already-built semantic index. */
export interface WriterSourceFacts {
  /** Every id declared by the indexed records, for collision-checked allocation. */
  readonly declaredIds: readonly string[]
  /** Raw `LocaleId` tokens declared by `<Language>` records, in index order. */
  readonly localeIds: readonly string[]
  /** Byte spans of the indexed records, keyed by source id. */
  readonly spansById: ReadonlyMap<string, WriterSpan>
}

function toRecords(collection: SourceRecordCollection | undefined): readonly SourceRecordLike[] {
  if (!collection) return []
  return collection instanceof Map
    ? [...collection.values()]
    : (collection as readonly SourceRecordLike[])
}

const RECORD_MEMBERS: readonly (keyof SourceIndexLike)[] = Object.freeze([
  'groups',
  'models',
  'objectDefinitions',
  'objectOccurrences',
  'connectionDefinitions',
  'connectionOccurrences',
  'lanes',
  'freeText',
  'attachments'
])

/**
 * Adapt a semantic index (or anything shaped like one) into the flat facts the writer uses.
 *
 * Missing members are tolerated: the writer's own `WriterSourceView` is the authority on the
 * document's bytes, and this adapter only contributes convenience inputs. That tolerance is
 * deliberate — it is what stops an index reshape from breaking the writer.
 */
export function adaptSourceIndex(index: SourceIndexLike): WriterSourceFacts {
  const ids: string[] = []
  const spansById = new Map<string, WriterSpan>()

  RECORD_MEMBERS.forEach((member) => {
    toRecords(index[member]).forEach((record) => {
      if (record.sourceId === null || record.sourceId === undefined) return
      ids.push(record.sourceId)
      if (record.span && !spansById.has(record.sourceId)) {
        spansById.set(record.sourceId, toWriterSpan(record.span))
      }
    })
  })

  const localeIds: string[] = []
  toRecords(index.languages).forEach((record) => {
    const localeId = record.rawAttributes?.LocaleId
    if (typeof localeId === 'string' && localeId.length > 0) localeIds.push(localeId)
  })

  return Object.freeze({
    declaredIds: Object.freeze(ids),
    localeIds: Object.freeze(localeIds),
    spansById
  })
}

/** Convenience for callers holding a whole `SemanticArisDocument`-shaped value. */
export function adaptSourceDocument(document: SourceDocumentLike): WriterSourceFacts {
  return adaptSourceIndex(document.index)
}
