/**
 * Source-faithful visual renderer — Plan Section 12 (Phase 9).
 *
 * These are the headless, testable render-model types `buildRenderModel.ts` produces. Nothing
 * here touches the DOM, SVG, or diagram-js: it is pure data plus pure functions that turn ARIS
 * source records into it.
 *
 * Every type here preserves the ARIS source reference (id, path, geometry, style) alongside
 * whatever OrbitPM computed from it, per Section 12.2's "preserve source symbol reference, id,
 * geometry, and style" rule.
 *
 * See `buildRenderModel.ts` for exactly what is and is not wired into the live canvas today:
 * in short, the shell consumes this module's fidelity findings (Section 12.3) for the fidelity
 * rail; the canvas and layout lanes derive on-screen geometry independently and share only
 * `textWrap.ts`'s `measureTextWidth`.
 */

import type {
  ArisSymbolDescriptor,
  ArisSymbolFidelityFinding,
  ArisSymbolResolutionRequest
} from '../symbols'

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface RenderPoint {
  readonly x: number
  readonly y: number
}

/** Axis-aligned bounds in ARIS model logical units (the source coordinate space). */
export interface RenderBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// ---------------------------------------------------------------------------------------------
// Pen / brush / color
// ---------------------------------------------------------------------------------------------

export type RenderPenStyle = 'solid' | 'dash' | 'dot' | 'dashdot' | 'dashdotdot' | 'invisible'

export interface ResolvedPen {
  /** CSS hex color (`#rrggbb`), or `undefined` when the source specified no override. */
  readonly color: string | undefined
  readonly style: RenderPenStyle
  /** Line width in source logical units. */
  readonly width: number
  /** SVG-compatible dash pattern, or `null` for a solid/invisible line. */
  readonly dasharray: string | null
  readonly visible: boolean
  /** The raw source style values this was resolved from, unchanged. */
  readonly source: {
    readonly color: string | null
    readonly style: string | null
    readonly width: number | null
  } | null
}

export type RenderBrushFill = 'solid' | 'transparent' | 'unsupported-pattern'

export interface ResolvedBrush {
  /** CSS fill: a hex color, or `'none'` for transparent/unsupported brushes. */
  readonly fill: string | 'none'
  readonly kind: RenderBrushFill
  readonly source: {
    readonly color: string | null
    readonly color2: string | null
    readonly brushType: string | null
  } | null
}

// ---------------------------------------------------------------------------------------------
// Fonts and text
// ---------------------------------------------------------------------------------------------

export type RenderTextDirection = 'ltr' | 'rtl'

export interface ResolvedFont {
  /** CSS font-family stack, safe-font-first. */
  readonly fontFamily: string
  /** The literal ARIS face name that was requested. */
  readonly requestedFaceName: string | null
  /** Whether the requested face was found in the OrbitPM safe-font allowlist. */
  readonly faceAvailable: boolean
  readonly sizePx: number
  readonly weight: number
  readonly italic: boolean
  readonly underline: boolean
  readonly strikeOut: boolean
  readonly color: string | undefined
  readonly locale: 'en' | 'ar' | undefined
  readonly direction: RenderTextDirection
}

export interface RenderTextLine {
  readonly text: string
  /** Estimated width in px at the resolved font size, using deterministic metrics. */
  readonly width: number
}

export interface RenderTextBlock {
  readonly rawText: string
  readonly lines: readonly RenderTextLine[]
  readonly direction: RenderTextDirection
  /** True when measured content required more than one line. */
  readonly wrapped: boolean
  readonly font: ResolvedFont
}

// ---------------------------------------------------------------------------------------------
// Fidelity findings — Plan Section 12.3
// ---------------------------------------------------------------------------------------------

export type ArisRenderFidelityKind =
  | 'missing-font'
  | 'missing-template'
  | 'unknown-custom-symbol'
  | 'substituted-visual-resource'
  | 'unsupported-pen-effect'
  | 'unsupported-brush-effect'
  | 'unsupported-ole-rendering'
  | 'text-wrap-difference'
  | 'missing-reference-export'

export interface ArisRenderFidelityFinding {
  readonly kind: ArisRenderFidelityKind
  /** i18n dictionary key for the fidelity-report UI. Never a hardcoded display string. */
  readonly messageKey: string
  readonly modelId: string | null
  /** The render element/connection/lane/free-text/attachment id this finding is about, if any. */
  readonly elementId: string | null
  readonly sourceId: string | null
  /** Structured interpolation parameters for the i18n message — never free English text. */
  readonly params: Readonly<Record<string, string | number>>
}

export const ARIS_RENDER_FIDELITY_KINDS: readonly ArisRenderFidelityKind[] = Object.freeze([
  'missing-font',
  'missing-template',
  'unknown-custom-symbol',
  'substituted-visual-resource',
  'unsupported-pen-effect',
  'unsupported-brush-effect',
  'unsupported-ole-rendering',
  'text-wrap-difference',
  'missing-reference-export'
])

// ---------------------------------------------------------------------------------------------
// Render elements
// ---------------------------------------------------------------------------------------------

/** Source material preserved verbatim alongside every rendered element. */
export interface RenderSourceAnchor {
  readonly sourceId: string | null
  readonly path: string
  readonly modelId: string | null
}

export interface RenderAttributeOccurrence {
  readonly attributeType: string | null
  readonly port: string | null
  readonly orderNum: number | null
  readonly alignment: string | null
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly rotation: number | null
  readonly bounds: { readonly width: number; readonly height: number } | null
  /** `TEXT` draws the attribute's text at this placement; `SYMBOL` draws its symbol instead. */
  readonly symbolFlag: string | null
  readonly fontStyleSheetId: string | null
  readonly text: RenderTextBlock | null
}

export interface RenderElement {
  readonly id: string
  readonly anchor: RenderSourceAnchor
  readonly objectDefinitionId: string | null
  readonly objectType: string
  readonly symbolNum: string
  /** Exact, unmodified source bounds — Source Layout uses this directly. */
  readonly sourceBounds: RenderBounds
  readonly zOrder: number
  readonly symbol: ArisSymbolDescriptor
  /** Source material the symbol registry preserved unchanged (geometry/style/refs/GUIDs). */
  readonly symbolSource: ArisSymbolResolutionRequest['source']
  readonly pen: ResolvedPen | null
  readonly brush: ResolvedBrush | null
  readonly name: RenderTextBlock | null
  readonly attributeOccurrences: readonly RenderAttributeOccurrence[]
}

export interface RenderConnection {
  readonly id: string
  readonly anchor: RenderSourceAnchor
  readonly connectionDefinitionId: string | null
  readonly connectionType: string | null
  readonly fromElementId: string | null
  readonly toElementId: string | null
  readonly zOrder: number
  /** Exact, unmodified source route points, ordered by point index — never rewritten. */
  readonly sourceRoutePoints: readonly RenderPoint[]
  readonly pen: ResolvedPen | null
  readonly srcArrow: string | null
  readonly tgtArrow: string | null
  readonly visible: boolean
  /**
   * Label placements owned by this connection occurrence (`<AttrOcc>` children of `<CxnOcc>`).
   * AnimalWF carries 123 of them; they position a connection's label relative to its route and
   * are listed by plan §12.1 among the source visual inputs the renderer must read.
   */
  readonly attributeOccurrences: readonly RenderAttributeOccurrence[]
}

export interface RenderLane {
  readonly id: string
  readonly anchor: RenderSourceAnchor
  readonly laneType: string | null
  readonly orientation: string | null
  readonly startBorder: number | null
  readonly endBorder: number | null
  readonly pen: ResolvedPen | null
  readonly brush: ResolvedBrush | null
  readonly name: RenderTextBlock | null
}

/**
 * A free-text note that displays one of its model's attributes rather than static text.
 *
 * ARIS expresses this with `AT_MODEL_AT` (the attribute type to display) plus `AT_MODEL_AT_GUID`
 * (`<guid>;<typeNumber>`) on the `<FFTextDef>`, and no `AT_NAME` at all. 21 of AnimalWF's 69 notes
 * are of this kind, so a renderer that only reads `AT_NAME` draws them blank.
 */
export interface RenderFreeTextModelAttributeBinding {
  readonly attributeType: string
  readonly guid: string | null
  readonly typeNumber: number | null
}

export interface RenderFreeText {
  readonly id: string
  readonly anchor: RenderSourceAnchor
  readonly sourceBounds: RenderBounds
  readonly zOrder: number
  readonly text: RenderTextBlock | null
  /**
   * Set when the note is a model-attribute placeholder. `text` is then resolved from the owning
   * model's attribute of that type, so the note renders its live value instead of nothing.
   */
  readonly modelAttributeBinding: RenderFreeTextModelAttributeBinding | null
}

export type RenderAttachmentKind = 'ole'

export interface RenderAttachment {
  readonly id: string
  readonly anchor: RenderSourceAnchor
  readonly kind: RenderAttachmentKind
  readonly sourceBounds: RenderBounds
  readonly zOrder: number
  readonly attachmentDefinitionId: string | null
  readonly blobCount: number
}

export type RenderDrawOrderKind = 'element' | 'connection' | 'freeText' | 'attachment'

export interface RenderDrawOrderEntry {
  readonly kind: RenderDrawOrderKind
  readonly id: string
  readonly zOrder: number
}

export interface RenderModelBackground {
  readonly color: string | undefined
  /** `true` when the source used the "no override" sentinel (`BackColor="-1"`). */
  readonly isDefault: boolean
}

export interface RenderModelDocument {
  readonly modelId: string
  readonly modelType: string | null
  readonly background: RenderModelBackground
  readonly scale: number | null
  readonly printScale: number | null
  readonly gridSize: number | null
  readonly gridUse: boolean
  readonly templateGuid: string | null
  readonly elements: readonly RenderElement[]
  readonly connections: readonly RenderConnection[]
  readonly lanes: readonly RenderLane[]
  readonly freeText: readonly RenderFreeText[]
  readonly attachments: readonly RenderAttachment[]
  /** Every element/connection/free-text/attachment in this model, ordered for painting. */
  readonly drawOrder: readonly RenderDrawOrderEntry[]
}

export interface ArisRenderModelResult {
  readonly models: readonly RenderModelDocument[]
  readonly fidelity: readonly ArisRenderFidelityFinding[]
  readonly fidelityByKind: Readonly<Record<ArisRenderFidelityKind, number>>
}

export type { ArisSymbolFidelityFinding }
