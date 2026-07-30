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
export const ARIS_CONNECTION_LABEL_PREFIX = 'cxnlabel:'

/**
 * The occurrence-local visual style the renderer paints over the symbol's own
 * appearance (plan §12.2, "use source symbol/style data when present").
 *
 * The symbol registry stays the sole source of *geometry*; these four values
 * decide how that geometry is painted. Carrying them on the business object is
 * what makes `restyleOccurrence` visible: the renderer has no access to the
 * working document, so a style that never reaches the element never draws.
 */
export interface ArisOccurrenceStyleView {
  /** Brush colour for the symbol's body, as an ARIS or CSS colour, or `null`. */
  readonly fillColor: string | null
  /** Pen colour for the symbol's outline, as an ARIS or CSS colour, or `null`. */
  readonly strokeColor: string | null
  readonly strokeWidth: number | null
  /** `solid` | `dashed` | `dotted`, or `null` to keep the symbol's own line. */
  readonly lineStyle: string | null
}

/**
 * A non-`AT_NAME` attribute occurrence painted as read-only annotation *inside* the occurrence's
 * own group — the process-code / id numbering that ARIS draws beside a function symbol.
 *
 * Unlike the external `AT_NAME` caption (a first-class `ArisLabelBusinessObject`: selectable,
 * editable, independently movable), these are decoration: the rectangle is pre-resolved in the
 * occurrence's local coordinate space and the renderer only paints text into it. Keeping them on
 * the occurrence's group — not as separate label elements — means they never become spurious
 * edit/drag targets and never reach the derived export, which reads the working document's
 * `attributeOccurrences` directly and is never touched here.
 */
export interface ArisOccurrenceAttributeLabel {
  readonly attributeType: string
  readonly text: string
  /** Local rectangle (relative to the occurrence's own box) the text is centred in. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ArisOccurrenceBusinessObject {
  readonly kind: 'occurrence'
  readonly modelId: string
  readonly modelType: string
  readonly occurrenceId: string
  readonly definitionId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly name: string
  readonly style: ArisOccurrenceStyleView
  /** Read-only numbering/annotation placements drawn inside the occurrence's group. */
  readonly attributeLabels?: readonly ArisOccurrenceAttributeLabel[]
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

/** `TEXT` draws the attribute's text; `SYMBOL` draws its symbol instead. */
export type ArisAttributeSymbolFlag = 'TEXT' | 'SYMBOL'

/** The font an `<AttrOcc>`'s `FontSS.IdRef` resolved to, as far as the catalog knows it. */
export interface ArisLabelFont {
  readonly fontFamily: string | null
  readonly fontSize: number | null
  readonly fontWeight: string | null
  readonly textColor: string | null
}

/**
 * One `<AttrOcc>` child of a `<CxnOcc>` — a connection's own label placement.
 *
 * This is the connection-side twin of `ArisLabelBusinessObject`: both project a
 * single `ArisAttributeOccurrence` onto a diagram-js label element, and both are
 * painted by `ArisRenderer`. It is a *separate* kind rather than a nullable
 * `ownerOccurrenceId` on the object-side label because the two answer different
 * questions — an external caption resolves to the occurrence it names
 * (`resolveOwnerOccurrenceId`, §11.5), while a connection label belongs to a
 * connection occurrence and has no owning object at all.
 *
 * `symbolFlag` is load-bearing rather than decorative: `TEXT` paints the
 * attribute's value, `SYMBOL` paints the attribute's symbol and no text.
 */
export interface ArisConnectionLabelBusinessObject {
  readonly kind: 'connectionLabel'
  readonly modelId: string
  readonly ownerConnectionOccurrenceId: string
  readonly attributeType: string
  readonly symbolFlag: ArisAttributeSymbolFlag
  readonly alignment: string | null
  readonly port: string | null
  readonly orderNum: number | null
  readonly rotation: number | null
  readonly fontStyleSheetId: string | null
  readonly font: ArisLabelFont | null
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
  | ArisConnectionLabelBusinessObject
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

/**
 * Element id for one connection label placement.
 *
 * A `<CxnOcc>` may carry several `<AttrOcc>` children (28 of AnimalWF's carry
 * two), and nothing forbids two of the same `AttrTypeNum`, so the placement's
 * index inside the occurrence's own list — which every command preserves — is
 * part of the id. The attribute type stays in it so the id remains readable.
 */
export function connectionLabelElementId(
  connectionOccurrenceId: string,
  index: number,
  attributeType: string
): string {
  return `${ARIS_CONNECTION_LABEL_PREFIX}${connectionOccurrenceId}:${index}:${attributeType}`
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
    kind === 'connectionLabel' ||
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

export function isConnectionLabelElement(element: ArisElementLike): boolean {
  return arisBusinessObject(element)?.kind === 'connectionLabel'
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
