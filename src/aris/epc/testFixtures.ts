import type { EpcEdge, EpcGraph, EpcLocalizedNames, EpcNode } from './types'

/** Deep-freezes a plain object/array tree in place, for use in immutability tests. */
export function deepFreeze<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

export function names(en: string | undefined, ar?: string): EpcLocalizedNames {
  const out: Record<string, string> = {}
  if (en !== undefined) out.en = en
  if (ar !== undefined) out.ar = ar
  return Object.freeze(out)
}

export function node(
  id: string,
  objectType: string,
  opts: Partial<Omit<EpcNode, 'id' | 'objectType'>> = {}
): EpcNode {
  return deepFreeze({
    id,
    objectType,
    symbolType: opts.symbolType ?? null,
    names: opts.names ?? {},
    linkedModelIds: opts.linkedModelIds,
    locked: opts.locked
  })
}

export function edge(
  id: string,
  source: string,
  target: string,
  connectionType: string,
  opts: Partial<Omit<EpcEdge, 'id' | 'source' | 'target' | 'connectionType'>> = {}
): EpcEdge {
  return deepFreeze({ id, source, target, connectionType, names: opts.names })
}

export function graph(
  modelId: string,
  nodes: readonly EpcNode[],
  edges: readonly EpcEdge[]
): EpcGraph {
  return deepFreeze({ modelId, nodes: [...nodes], edges: [...edges] })
}
