/**
 * Default metadata layer registry.
 *
 * Phase 10 requires these layers enabled by default:
 *   owners; responsible parties; consulted/informed parties; inputs; outputs;
 *   systems; business rules; policies; requirements; process codes; ARIS IDs;
 *   model assignments.
 *
 * Satellites remain real selectable objects. The layer only decides which
 * category a satellite relationship belongs to; it never flattens a satellite
 * into a string on its owning function.
 */

import type { ArisObjectDefinition } from '../model/types'
import type { ArisMetadataCategory, ArisMetadataSatellite } from './seam'

export type ArisMetadataLayerVisibility = Readonly<Record<ArisMetadataCategory, boolean>>

export const DEFAULT_METADATA_LAYERS: readonly ArisMetadataCategory[] = [
  'owner',
  'responsible',
  'consulted',
  'informed',
  'input',
  'output',
  'system',
  'businessRule',
  'policy',
  'requirement',
  'processCode',
  'arisId',
  'modelAssignment',
]

export const METADATA_CATEGORY_LABEL_KEYS: Readonly<Record<ArisMetadataCategory, string>> = {
  owner: 'aris.details.category.owner',
  responsible: 'aris.details.category.responsible',
  consulted: 'aris.details.category.consulted',
  informed: 'aris.details.category.informed',
  input: 'aris.details.category.input',
  output: 'aris.details.category.output',
  system: 'aris.details.category.system',
  businessRule: 'aris.details.category.businessRule',
  policy: 'aris.details.category.policy',
  requirement: 'aris.details.category.requirement',
  processCode: 'aris.details.category.processCode',
  arisId: 'aris.details.category.arisId',
  modelAssignment: 'aris.details.category.modelAssignment',
  other: 'aris.details.category.other',
}

export interface ArisMetadataLayer {
  readonly category: ArisMetadataCategory
  readonly enabled: boolean
  readonly count: number
}

export interface ArisMetadataSummary {
  readonly layers: readonly ArisMetadataLayer[]
  readonly satellitesByCategory: ReadonlyMap<ArisMetadataCategory, ReadonlyArray<ArisMetadataSatellite>>
}

/** Builds a summary of all metadata layers for a single model. */
export function summarizeMetadata(
  satellites: ReadonlyMap<string, ArisMetadataSatellite>,
  visibility: ArisMetadataLayerVisibility
): ArisMetadataSummary {
  const byCategory = new Map<ArisMetadataCategory, ArisMetadataSatellite[]>()
  for (const satellite of satellites.values()) {
    const list = byCategory.get(satellite.category) ?? []
    list.push(satellite)
    byCategory.set(satellite.category, list)
  }

  const layers: ArisMetadataLayer[] = DEFAULT_METADATA_LAYERS.map((category) => ({
    category,
    enabled: visibility[category] ?? true,
    count: byCategory.get(category)?.length ?? 0,
  }))

  return {
    layers,
    satellitesByCategory: byCategory,
  }
}

export function defaultMetadataVisibility(): ArisMetadataLayerVisibility {
  const visibility = {} as Record<ArisMetadataCategory, boolean>
  for (const category of DEFAULT_METADATA_LAYERS) {
    visibility[category] = true
  }
  visibility.other = false
  return visibility
}

export function toggleLayerVisibility(
  visibility: ArisMetadataLayerVisibility,
  category: ArisMetadataCategory,
  enabled: boolean
): ArisMetadataLayerVisibility {
  return { ...visibility, [category]: enabled }
}

/** Extracts a process code (AT_ID) and ARIS ID from a function definition. */
export function extractProcessCodes(def: ArisObjectDefinition): { readonly processCode: string | null; readonly arisId: string | null } {
  const idAttr = def.attributes.find((a) => a.type === 'AT_ID')
  const rawId = def.rawAttributes['AT_ID'] ?? null
  const text = idAttr?.values[0]?.text ?? rawId
  const processCode = text ? text.trim() : null
  return {
    processCode,
    arisId: def.id,
  }
}

/** Returns model assignment IDs attached to a definition. */
export function extractModelAssignments(def: ArisObjectDefinition): readonly string[] {
  return def.linkedModelIds
}
