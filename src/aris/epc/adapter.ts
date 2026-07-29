import type { EpcEdge, EpcGraph, EpcLocalizedNames, EpcNode } from './types'

/**
 * The single adapter seam (see the module doc in `types.ts`). Everything below is a
 * *structural* description of the shapes this function needs — it is not imported from
 * `src/aris/model` or `src/aris/source`. Any object with these fields works, including the
 * real `ArisModel` / `ArisObjectDefinition` / `ArisObjectOccurrence` /
 * `ArisConnectionDefinition` / `ArisConnectionOccurrence` types in `src/aris/model/types.ts`
 * (verified structurally compatible as of this module's authoring — `names.values`,
 * `linkedModelIds`, `definitionId`, `sourceOccurrenceId`/`targetOccurrenceId` all match).
 * If those types move, only this file needs to change.
 */

export interface EpcAdapterLocalizedValue {
  readonly values: Readonly<Record<string, string>>
}

export interface EpcAdapterObjectDefinition {
  readonly id: string
  readonly type: string
  readonly names: EpcAdapterLocalizedValue
  readonly linkedModelIds?: readonly string[]
}

export interface EpcAdapterObjectOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly symbol?: string | null
}

export interface EpcAdapterConnectionDefinition {
  readonly id: string
  readonly type: string
}

export interface EpcAdapterConnectionOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly names?: EpcAdapterLocalizedValue
}

export interface EpcAdapterModel {
  readonly modelId: string
  readonly objectOccurrences: readonly EpcAdapterObjectOccurrence[]
  readonly objectDefinitionById: ReadonlyMap<string, EpcAdapterObjectDefinition>
  readonly connectionOccurrences: readonly EpcAdapterConnectionOccurrence[]
  readonly connectionDefinitionById: ReadonlyMap<string, EpcAdapterConnectionDefinition>
}

function toLocalizedNames(value: EpcAdapterLocalizedValue | undefined): EpcLocalizedNames {
  if (!value) return {}
  return Object.freeze({ ...value.values })
}

/**
 * Converts one model's occurrence/definition arrays into an `EpcGraph`. Occurrences that
 * reference a missing definition, and connection occurrences that reference a missing
 * connection definition or a missing endpoint occurrence, are skipped rather than thrown —
 * this module never mutates or throws prose; callers that want strict validation of
 * dangling references should look at `checkTypedConnections` / the source accounting layer,
 * which own that concern.
 */
export function toEpcGraph(input: EpcAdapterModel): EpcGraph {
  const nodes: EpcNode[] = []
  for (const occurrence of input.objectOccurrences) {
    const definition = input.objectDefinitionById.get(occurrence.definitionId)
    if (!definition) continue
    nodes.push(
      Object.freeze({
        id: occurrence.id,
        objectType: definition.type,
        symbolType: occurrence.symbol ?? null,
        names: toLocalizedNames(definition.names),
        linkedModelIds: definition.linkedModelIds
          ? Object.freeze([...definition.linkedModelIds])
          : undefined
      })
    )
  }

  const edges: EpcEdge[] = []
  for (const occurrence of input.connectionOccurrences) {
    const definition = input.connectionDefinitionById.get(occurrence.definitionId)
    if (!definition) continue
    edges.push(
      Object.freeze({
        id: occurrence.id,
        source: occurrence.sourceOccurrenceId,
        target: occurrence.targetOccurrenceId,
        connectionType: definition.type,
        names: occurrence.names ? toLocalizedNames(occurrence.names) : undefined
      })
    )
  }

  return Object.freeze({
    modelId: input.modelId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges)
  })
}
