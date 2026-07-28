/**
 * The ARIS business objects attached to diagram-js elements.
 *
 * diagram-js elements are pure view state. Every one of ours carries a frozen
 * `businessObject` describing *which* ARIS record it projects, so that a
 * gesture can be translated back into an ARIS command without consulting the
 * element registry's ad-hoc properties.
 *
 * Element ids are derived from ARIS ids by a fixed prefix scheme so the mapping
 * is total and reversible in both directions.
 */

/**
 * The widest element shape we accept. `elementRegistry` hands back
 * `ElementLike`, `selection` hands back `Element`, and our own helpers are
 * called with both; a structural parameter keeps every call site honest without
 * casts.
 */
export type ArisElementLike = { readonly businessObject?: unknown } | null | undefined

export const ARIS_ROOT_PREFIX = 'model:'
export const ARIS_LANE_PREFIX = 'lane:'
export const ARIS_FREE_TEXT_PREFIX = 'text:'
export const ARIS_LABEL_PREFIX = 'label:'

export interface ArisOccurrenceBusinessObject {
  readonly kind: 'occurrence'
  readonly modelId: string
  readonly modelType: string
  readonly occurrenceId: string
  readonly definitionId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly name: string
}

export interface ArisConnectionBusinessObject {
  readonly kind: 'connection'
  readonly modelId: string
  readonly connectionOccurrenceId: string
  readonly definitionId: string
  readonly connectionType: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly name: string
}

export interface ArisLaneBusinessObject {
  readonly kind: 'lane'
  readonly modelId: string
  readonly laneId: string
  readonly orientation: string
  readonly name: string
}

export interface ArisFreeTextBusinessObject {
  readonly kind: 'freeText'
  readonly modelId: string
  readonly freeTextId: string
  readonly text: string
}

export interface ArisLabelBusinessObject {
  readonly kind: 'label'
  readonly modelId: string
  readonly ownerOccurrenceId: string
  readonly attributeType: string
  readonly text: string
}

export interface ArisModelBusinessObject {
  readonly kind: 'model'
  readonly modelId: string
  readonly modelType: string
  readonly name: string
}

export type ArisBusinessObject =
  | ArisOccurrenceBusinessObject
  | ArisConnectionBusinessObject
  | ArisLaneBusinessObject
  | ArisFreeTextBusinessObject
  | ArisLabelBusinessObject
  | ArisModelBusinessObject

export function rootElementId(modelId: string): string {
  return `${ARIS_ROOT_PREFIX}${modelId}`
}

export function laneElementId(laneId: string): string {
  return `${ARIS_LANE_PREFIX}${laneId}`
}

export function freeTextElementId(freeTextId: string): string {
  return `${ARIS_FREE_TEXT_PREFIX}${freeTextId}`
}

export function labelElementId(occurrenceId: string): string {
  return `${ARIS_LABEL_PREFIX}${occurrenceId}`
}

/** Read the ARIS business object off an element, or `null` for foreign elements. */
export function arisBusinessObject(element: ArisElementLike): ArisBusinessObject | null {
  if (!element) return null
  const candidate = (element as { businessObject?: unknown }).businessObject
  if (!candidate || typeof candidate !== 'object') return null
  const kind = (candidate as { kind?: unknown }).kind
  if (typeof kind !== 'string') return null
  if (
    kind === 'occurrence' ||
    kind === 'connection' ||
    kind === 'lane' ||
    kind === 'freeText' ||
    kind === 'label' ||
    kind === 'model'
  ) {
    return candidate as ArisBusinessObject
  }
  return null
}

export function isOccurrenceElement(element: ArisElementLike): boolean {
  return arisBusinessObject(element)?.kind === 'occurrence'
}

export function isConnectionElement(element: ArisElementLike): boolean {
  return arisBusinessObject(element)?.kind === 'connection'
}

export function isLabelElement(element: ArisElementLike): boolean {
  return arisBusinessObject(element)?.kind === 'label'
}

export function isModelRootElement(element: ArisElementLike): boolean {
  return arisBusinessObject(element)?.kind === 'model'
}

/**
 * Resolve a selected element to the occurrence it belongs to.
 *
 * External labels resolve to their owner — Section 11.5, "Resolve selected
 * external label to owner".
 */
export function resolveOwnerOccurrenceId(element: ArisElementLike): string | null {
  const businessObject = arisBusinessObject(element)
  if (!businessObject) return null
  if (businessObject.kind === 'occurrence') return businessObject.occurrenceId
  if (businessObject.kind === 'label') return businessObject.ownerOccurrenceId
  return null
}
