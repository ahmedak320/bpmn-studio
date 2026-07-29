/**
 * Deterministic identifier allocation for canvas-authored ARIS records.
 *
 * Ids must be stable across runs so that revision patches are byte-identical,
 * so no randomness or clock is used. The factory is seeded from the working
 * document it will write into: it scans the existing ids for the `<prefix>.<n>`
 * shape and continues after the highest `n` it finds, which keeps ids unique
 * even after a document is reloaded from a serialized revision.
 */

import type { ArisWorkingDocument } from '../model/types'

export type ArisIdKind =
  | 'objectDefinition'
  | 'objectOccurrence'
  | 'connectionDefinition'
  | 'connectionOccurrence'
  | 'model'
  | 'lane'
  | 'freeText'
  | 'command'

const PREFIXES: Readonly<Record<ArisIdKind, string>> = Object.freeze({
  objectDefinition: 'ObjDef',
  objectOccurrence: 'ObjOcc',
  connectionDefinition: 'CxnDef',
  connectionOccurrence: 'CxnOcc',
  model: 'Model',
  lane: 'Lane',
  freeText: 'FFText',
  command: 'cmd'
})

export interface ArisIdFactory {
  readonly next: (kind: ArisIdKind) => string
  /** Register an externally created id so it is never handed out again. */
  readonly reserve: (id: string) => void
  readonly peek: (kind: ArisIdKind) => number
}

function parseSequence(prefix: string, id: string): number | null {
  if (!id.startsWith(`${prefix}.`)) return null
  const tail = id.slice(prefix.length + 1)
  if (!/^\d+$/u.test(tail)) return null
  return Number.parseInt(tail, 10)
}

/**
 * Create an id factory. `namespace` is prepended to every generated id so two
 * canvases editing sibling documents cannot collide.
 */
export function createArisIdFactory(namespace = ''): ArisIdFactory {
  const counters = new Map<ArisIdKind, number>()
  const prefixOf = (kind: ArisIdKind): string => `${namespace}${PREFIXES[kind]}`

  const reserve = (id: string): void => {
    for (const kind of Object.keys(PREFIXES) as ArisIdKind[]) {
      const sequence = parseSequence(prefixOf(kind), id)
      if (sequence === null) continue
      const current = counters.get(kind) ?? 0
      if (sequence >= current) counters.set(kind, sequence + 1)
    }
  }

  return Object.freeze({
    next: (kind: ArisIdKind): string => {
      const current = counters.get(kind) ?? 1
      counters.set(kind, current + 1)
      return `${prefixOf(kind)}.${current}`
    },
    reserve,
    peek: (kind: ArisIdKind): number => counters.get(kind) ?? 1
  })
}

/** Seed a factory with every id already present in a working document. */
export function seedIdFactory(
  factory: ArisIdFactory,
  document: ArisWorkingDocument
): ArisIdFactory {
  for (const id of document.objectDefinitions.keys()) factory.reserve(id)
  for (const id of document.connectionDefinitions.keys()) factory.reserve(id)
  for (const [modelId, model] of document.models) {
    factory.reserve(modelId)
    for (const occurrence of model.occurrences) factory.reserve(occurrence.id)
    for (const connection of model.connectionOccurrences) factory.reserve(connection.id)
    for (const lane of model.lanes) factory.reserve(lane.id)
    for (const text of model.freeText) factory.reserve(text.id)
  }
  return factory
}
