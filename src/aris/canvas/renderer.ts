/**
 * `ArisRenderer` — draws ARIS elements from the symbol registry.
 *
 * ## Seam: `src/aris/symbols/`
 *
 * All shape *geometry* comes from `resolveArisSymbol({ modelType, objectType,
 * symbolNum })`. This module authors no geometry of its own; it only maps the
 * descriptor's `viewBox` onto the occurrence's bounds and emits the primitives.
 * The only shapes drawn here without a descriptor are the non-object canvas
 * furniture the registry does not model: lane bands, free text, external
 * captions, connection labels, and the connection polyline.
 *
 * ## Occurrence style (plan §12.2)
 *
 * Geometry and paint are separate concerns. The registry decides *what shape*;
 * the occurrence's own pen and brush decide *how it is painted* — "use source
 * symbol/style data when present". `ArisOccurrenceStyleView` therefore overrides
 * the descriptor's authored colours whenever the occurrence carries one, which
 * is what makes `restyleOccurrence` a visible edit rather than a stored one.
 *
 * A DMT descriptor assigns paint roles explicitly. The source brush can replace
 * only the accent band/tile; the white card, white icon, caption and outline
 * retain their semantic paint. Icons use a centered uniform transform while
 * surfaces stretch to the imported occurrence bounds.
 *
 * Any fidelity finding the registry reports is attached to the rendered group
 * as `data-aris-fidelity` so the Phase 9 fidelity report can collect it without
 * re-resolving every symbol.
 */

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer'
import type Canvas from 'diagram-js/lib/core/Canvas'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types'
import { createLine, updateLine } from 'diagram-js/lib/util/RenderUtil'

import {
  isDmtSymbolDescriptor,
  resolveArisCatalogSymbol,
  resolveArisSymbol,
  type DmtBox,
  type DmtSemanticPart,
  type DmtSymbolDescriptor
} from '../symbols'
import { amlColorRefToCss } from '../source/semanticIndex'
import type { ArisDrawingElement, ArisSymbolDescriptor } from '../symbols/types'
import { bidiTextAttrs } from './bidi'
import { ARIS_DOCUMENT_CHANGED } from './commandBridge'
import type { ArisCanvasSync } from './canvasSync'
import type { ArisDocumentStore } from './documentStore'
import { DEFAULT_LOCALE_ID } from './emptyDocument'
import {
  arisBusinessObject,
  type ArisBusinessObject,
  type ArisConnectionLabelBusinessObject,
  type ArisFreeTextBusinessObject,
  type ArisLabelFont,
  type ArisOccurrenceAttributeLabel,
  type ArisOccurrenceBusinessObject,
  type ArisOccurrenceStyleView,
  type ArisElementLike
} from './elements'
import { readLocalized } from './localization'
import { buildPrintFrame, drawPrintFrame } from './printFrame'
import { derivedRaciLabelText, type ArisRaciTuple } from './raci'
import { svgAppend, svgElement } from './svg'
import {
  ARIS_LABEL_LINE_HEIGHT,
  labelFontWeight,
  layoutAnchoredLines,
  layoutLabelLines,
  normalizeLabelParagraphs,
  preferResolvedFont,
  resolveAttributePlacementFont,
  resolveConnectionPlacementFont,
  resolveFreeTextFont,
  resolveOccurrenceCaptionFont,
  wrapLabelLines,
  type ArisLabelAnchor,
  type ArisLabelLayout,
  type ArisResolvedLabelFont
} from './typography'
import type { ArisFreeText, ArisWorkingDocument } from '../model/types'

const DEFAULT_STROKE = '#334155'
const DEFAULT_FILL = '#ffffff'
const LANE_STROKE = '#94a3b8'
const FREE_TEXT_STROKE = '#cbd5e1'
/**
 * Fallback stroke for a connection whose occurrence carries no source `Pen` colour. Every one of
 * AnimalWF's 93 CxnOcc decodes a pen (`Color="0"` = black), so this only ever paints a
 * from-scratch connection. `#000000` (not a slate grey) for print parity with the reference PDF,
 * which renders every connector near-black (Wave 9 P2, fixplan §5.5).
 */
const CONNECTION_STROKE = '#000000'
/**
 * ARIS's logical pen "Width" is unitless in the source (`Pen Width="1"` etc.) but the reference
 * PDF prints logical width 1 at ≈0.265 mm — ≈2.646 canvas units at this document's 42 % print
 * scale (measured at 300 DPI against the original). Every SOURCE-authored pen width (connection
 * `Pen Width`, occurrence stroke override, `GfxObj` frame pen) is multiplied by this constant
 * before becoming an SVG `stroke-width`; a primitive's own descriptor-authored width is already
 * visually calibrated and is never scaled (Wave 9 P2, fixplan §5.4, plan §0 ground truth).
 */
export const ARIS_PEN_UNIT = 2.646

/** The AML attribute type that carries an OLE definition's embedded picture as a base64 PNG. */
const AT_IMAGE_FILE_BLOB = 'AT_IMAGE_FILE_BLOB'

/**
 * The raw `AT_IMAGE_FILE_BLOB` value (a base64 PNG) an OLE definition carries,
 * read from the source index the working document already retains (V5+ P11).
 * Returns the first non-empty value, or `null` when the definition has none.
 * This only reads the source bytes — it never rewrites them, so the export
 * stays byte-verbatim; `oleImage.ts` validates and caps the value before it is
 * ever painted.
 */
function resolveOleImageBlobValue(
  document: ArisWorkingDocument,
  definitionId: string
): string | null {
  for (const attribute of document.sourceIndex.attributes) {
    if (attribute.parsed.ownerSourceId !== definitionId) continue
    if (attribute.parsed.attributeType !== AT_IMAGE_FILE_BLOB) continue
    for (const value of attribute.parsed.values) {
      if (value.text.trim() !== '') return value.text
    }
  }
  return null
}

const CAPTION_FILL = '#0f172a'
const CAPTION_FONT_SIZE = 12
/** Fill of the marker a `SymbolFlag="SYMBOL"` placement draws in place of text. */
const ATTRIBUTE_SYMBOL_FILL = '#e2e8f0'
const ATTRIBUTE_SYMBOL_STROKE = '#475569'

/**
 * Per-`CxnDef.Type` truth table for the DEFAULT target arrow ARIS paints when a connection
 * occurrence carries no explicit `SrcArrow`/`TgtArrow` override (every one of the AnimalWF
 * export's 93 CxnOcc does: `SrcArrow="0" TgtArrow="0"` = default, so this set alone drives what
 * the reader sees). Verified type-by-type against the rendered ink of the original reference PDF
 * (`reference/AnimalWF/pdf/Register_Animal_Owner_Profile_Draft03.pdf`) — never against this tool's
 * own prior output. Membership is per TYPE, not per occurrence: each entry below was confirmed
 * either from a clean, non-overlapping connector in the original, or — where several connectors
 * share one ARIS-routed trunk — by elimination against a type already confirmed on that same trunk.
 *
 * KEPT (arrow at target): control flow (`CT_ACTIV_1`/`CT_CRT_1`/`CT_LEADS_TO_1`/`CT_LEADS_TO_2`/
 * `CT_IS_EVAL_BY_1`/`CT_IS_PREDEC_OF_1`), function outputs (`CT_CRT_OUT_TO`/`CT_HAS_OUT`), a
 * function reading/writing an existing entity record (`CT_READ_1` — confirmed WITH an arrow at
 * both its AnimalWF instances, "Economy License Details" and "Owner Registration Number"; a
 * plausible-looking guess before crop-verify would have been the opposite), and the RACI
 * informed/consulted family (`CT_MUST_BE_INFO_ABT_1` shows an arrow into the function at fn 05/14
 * in the original; `CT_DECID_ON`/`CT_MUST_BE_CONSLT_ABT_1` have zero AnimalWF occurrences, so are
 * aligned with that same I-row rather than left to guesswork) plus a business rule/policy driving
 * a function (`CT_AFFECTS` — the export's one instance shares its target function's entry trunk
 * with two already-arrow-less `CT_SUPP_3` inputs; the original still paints one arrow into that
 * function, so by elimination `CT_AFFECTS` — not the `CT_SUPP_3` pair — owns it).
 *
 * REMOVED (plain line, no marker): the RACI "R" carries-out role (`CT_EXEC_1`/`CT_EXEC_2`), an
 * external application system feeding a function (`CT_SUPP_3` — DED System/TAMM/Smart Hub/UAE
 * Pass, confirmed arrow-less at 4 independent AnimalWF instances), an entity type feeding a
 * function (`CT_IS_INP_FOR`), and a requirement referencing a function (`CT_REFS_TO_2` — confirmed
 * arrow-less at both its AnimalWF instances). These read as directional in ARIS's own type naming,
 * but the reference PDF paints every one of them as a plain, undirected line.
 *
 * Org-chart types (`CT_IS_COMPOUND_OF_1`, `CT_IS_ORG_MANAGER_1`, `CT_IS_TECH_SUPER_1`,
 * `CT_OCCUPIES_1`) have zero occurrences anywhere in the AnimalWF export — there is no reference
 * ink to confirm or refute them against — so they stay in the set unverified-by-reference rather
 * than guessed at.
 */
const DIRECTED_CONNECTION_TYPES = new Set([
  'CT_ACTIV_1',
  'CT_AFFECTS',
  'CT_CRT_1',
  'CT_CRT_OUT_TO',
  'CT_DECID_ON',
  'CT_HAS_OUT',
  'CT_IS_COMPOUND_OF_1', // unverified-by-reference: 0 AnimalWF occurrences
  'CT_IS_EVAL_BY_1',
  'CT_IS_ORG_MANAGER_1', // unverified-by-reference: 0 AnimalWF occurrences
  'CT_IS_PREDEC_OF_1',
  'CT_IS_TECH_SUPER_1', // unverified-by-reference: 0 AnimalWF occurrences
  'CT_LEADS_TO_1',
  'CT_LEADS_TO_2',
  'CT_MUST_BE_CONSLT_ABT_1',
  'CT_MUST_BE_INFO_ABT_1',
  'CT_OCCUPIES_1', // unverified-by-reference: 0 AnimalWF occurrences
  'CT_READ_1'
])

const CONNECTION_DASHARRAY_BY_STYLE: Readonly<Record<string, string | null>> = Object.freeze({
  '0': null,
  solid: null,
  '1': '8 4',
  dash: '8 4',
  dashed: '8 4',
  '2': '2 3',
  dot: '2 3',
  dotted: '2 3',
  '3': '8 3 2 3',
  dashdot: '8 3 2 3',
  '4': '8 3 2 3 2 3',
  dashdotdot: '8 3 2 3 2 3'
})

/** Render priority above diagram-js's `DefaultRenderer` (1000). */
export const ARIS_RENDER_PRIORITY = 1500

interface Scale {
  readonly sx: number
  readonly sy: number
  readonly tx: number
  readonly ty: number
}

function scaleFor(descriptor: ArisSymbolDescriptor, width: number, height: number): Scale {
  const { viewBox } = descriptor.drawing
  return {
    sx: viewBox.width === 0 ? 1 : width / viewBox.width,
    sy: viewBox.height === 0 ? 1 : height / viewBox.height,
    tx: -viewBox.minX,
    ty: -viewBox.minY
  }
}

function uniformScaleFor(
  descriptor: ArisSymbolDescriptor,
  width: number,
  height: number,
  sourceBox?: DmtBox
): Scale {
  const full = scaleFor(descriptor, width, height)
  const { viewBox } = descriptor.drawing
  const box =
    sourceBox ??
    ({
      x: viewBox.minX,
      y: viewBox.minY,
      width: viewBox.width,
      height: viewBox.height
    } satisfies DmtBox)
  const targetX = mapX(full, box.x)
  const targetY = mapY(full, box.y)
  const targetWidth = box.width * full.sx
  const targetHeight = box.height * full.sy
  const uniform = Math.min(
    box.width === 0 ? 1 : targetWidth / box.width,
    box.height === 0 ? 1 : targetHeight / box.height
  )
  const centeredX = targetX + (targetWidth - box.width * uniform) / 2
  const centeredY = targetY + (targetHeight - box.height * uniform) / 2
  return {
    sx: uniform,
    sy: uniform,
    tx: uniform === 0 ? 0 : centeredX / uniform - box.x,
    ty: uniform === 0 ? 0 : centeredY / uniform - box.y
  }
}

function mapX(scale: Scale, x: number): number {
  return (x + scale.tx) * scale.sx
}

function mapY(scale: Scale, y: number): number {
  return (y + scale.ty) * scale.sy
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * An AML COLORREF (`cccccc`, `99`, `339900` — an unsigned `0xBBGGRR` integer
 * serialized without padding) or an already-CSS colour, as CSS.
 *
 * Source parsing normally turns AML colors into `#rrggbb` before the canvas sees them. The bare
 * spelling remains supported for older working documents and is decoded as Windows COLORREF.
 * Anything already carrying a `#`, including convention-catalog defaults and authoring edits, is
 * passed through untouched so RGB-authored defaults are never byte-swapped.
 */
export function occurrenceColorToCss(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-1') return undefined
  if (trimmed.startsWith('#')) return correctFunctionGreen(trimmed)
  if (!/^[0-9a-fA-F]{1,8}$/.test(trimmed)) return trimmed
  return correctFunctionGreen(amlColorRefToCss(trimmed) ?? undefined)
}

/**
 * Wave 9 P8 (fixplan §4.3): CMYK-appearance correction for the ARIS function green.
 *
 * Every function occurrence carries an explicit authored AML brush `Color="339900"` (78× on
 * ST_FUNC / ST_SYS_FUNC_ACT). That COLORREF byte-swaps to `#009933` — a gross outlier (RMSE 24
 * vs the sampled print, red channel off by 41) against the original's measured function green,
 * whose correct pre-CMYK sRGB is `#339933` (drift-model residual ≈ the ±5 anchor noise floor;
 * see p8-analysis §3/§5). This is a DISPLAY-only correction applied at the single shared colour
 * seam the canvas and the fidelity comparator both flow fills through: the decoded `#009933` is
 * produced ONLY by the `339900` function brush — that value appears 0× as any other authored
 * colour and `339900` decodes to nothing else — so keying the remap on it touches no other
 * element. The stored/exported AML keeps the authored raw `339900` (the derived export is
 * byte-addressed off the immutable original text); only the painted/compared colour is corrected.
 * The general COLORREF codec (`amlColorRefToCss`) is deliberately left unchanged.
 */
const FUNCTION_GREEN_DECODED = '#009933'
const FUNCTION_GREEN_CORRECTED = '#339933'

function correctFunctionGreen(css: string | undefined): string | undefined {
  return css !== undefined && css.toLowerCase() === FUNCTION_GREEN_DECODED
    ? FUNCTION_GREEN_CORRECTED
    : css
}

const DASHARRAY_BY_LINE_STYLE: Readonly<Record<string, string | null>> = Object.freeze({
  solid: null,
  dashed: '6 4',
  dotted: '2 3'
})

/** The occurrence style, resolved to CSS once per shape rather than per primitive. */
interface ResolvedOccurrencePaint {
  readonly fill: string | undefined
  readonly stroke: string | undefined
  readonly strokeWidth: number | undefined
  readonly dasharray: string | null | undefined
}

/** "The occurrence overrides nothing" — every primitive keeps the registry's paint. */
const EMPTY_PAINT: ResolvedOccurrencePaint = Object.freeze({
  fill: undefined,
  stroke: undefined,
  strokeWidth: undefined,
  dasharray: undefined
})

function resolvePaint(style: ArisOccurrenceStyleView | undefined): ResolvedOccurrencePaint {
  const lineStyle = style?.lineStyle?.trim().toLowerCase()
  return {
    fill: occurrenceColorToCss(style?.fillColor),
    stroke: occurrenceColorToCss(style?.strokeColor),
    // The occurrence's own source pen width, scaled to canvas units (Wave 9 P2). `undefined`
    // (no source override) still falls through to the descriptor's own calibrated width below.
    strokeWidth:
      typeof style?.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)
        ? style.strokeWidth * ARIS_PEN_UNIT
        : undefined,
    dasharray:
      lineStyle === undefined || lineStyle === ''
        ? undefined
        : (DASHARRAY_BY_LINE_STYLE[lineStyle] ?? null)
  }
}

/** A primitive that encloses an area, i.e. one the brush can colour. */
function isFilledPrimitive(primitive: ArisDrawingElement): boolean {
  if (primitive.kind === 'line') return false
  return primitive.fill !== 'none'
}

/**
 * Re-emit one authored primitive at the occurrence's size.
 *
 * Path data is the single case the registry expresses in its own coordinate
 * space that cannot be scaled attribute-by-attribute, so the group carries the
 * scale transform and paths are emitted untouched inside it.
 *
 * `paint` is the occurrence's own style. `accent` admits the brush and `pen`
 * admits source outline styling. White icon primitives admit neither.
 */
function drawPrimitive(
  primitive: ArisDrawingElement,
  scale: Scale,
  paint: ResolvedOccurrencePaint = EMPTY_PAINT,
  options: {
    readonly accent?: boolean
    readonly pen?: boolean
    readonly part?: string
  } = {}
): SVGElement | null {
  const stroke = options.pen
    ? (paint.stroke ?? primitive.stroke ?? DEFAULT_STROKE)
    : (primitive.stroke ?? DEFAULT_STROKE)
  const strokeWidth = options.pen
    ? (paint.strokeWidth ?? primitive.strokeWidth ?? 1.5)
    : (primitive.strokeWidth ?? 1.5)
  const dash = options.pen ? paint.dasharray : undefined
  const dashAttrs: Readonly<Record<string, string>> =
    dash === undefined || dash === null ? {} : { 'stroke-dasharray': dash }
  const semanticAttrs: Readonly<Record<string, string>> =
    options.part === undefined ? {} : { 'data-aris-part': options.part }
  const linecap = 'linecap' in primitive ? primitive.linecap : undefined
  const linecapAttrs: Readonly<Record<string, string>> =
    linecap === undefined ? {} : { 'stroke-linecap': linecap }
  const own = 'fill' in primitive ? primitive.fill : undefined
  const fillOf = (fallback: string): string =>
    options.accent && paint.fill !== undefined ? paint.fill : (own ?? fallback)
  switch (primitive.kind) {
    case 'rect':
      return svgElement('rect', {
        x: round(mapX(scale, primitive.x)),
        y: round(mapY(scale, primitive.y)),
        width: round(primitive.width * scale.sx),
        height: round(primitive.height * scale.sy),
        ...(primitive.rx === undefined ? {} : { rx: round(primitive.rx * scale.sx) }),
        ...(primitive.ry === undefined ? {} : { ry: round(primitive.ry * scale.sy) }),
        fill: fillOf(DEFAULT_FILL),
        stroke,
        'stroke-width': strokeWidth,
        ...semanticAttrs,
        ...dashAttrs
      })
    case 'circle': {
      const radius = round(primitive.r * Math.min(scale.sx, scale.sy))
      return svgElement('circle', {
        cx: round(mapX(scale, primitive.cx)),
        cy: round(mapY(scale, primitive.cy)),
        r: radius,
        fill: fillOf(DEFAULT_FILL),
        stroke,
        'stroke-width': strokeWidth,
        ...semanticAttrs,
        ...dashAttrs
      })
    }
    case 'polygon':
      return svgElement('polygon', {
        points: primitive.points
          .map((point) => `${round(mapX(scale, point.x))},${round(mapY(scale, point.y))}`)
          .join(' '),
        fill: fillOf(DEFAULT_FILL),
        stroke,
        'stroke-width': strokeWidth,
        ...semanticAttrs,
        ...dashAttrs
      })
    case 'line':
      return svgElement('line', {
        x1: round(mapX(scale, primitive.x1)),
        y1: round(mapY(scale, primitive.y1)),
        x2: round(mapX(scale, primitive.x2)),
        y2: round(mapY(scale, primitive.y2)),
        stroke,
        'stroke-width': strokeWidth,
        ...linecapAttrs,
        ...semanticAttrs,
        ...dashAttrs
      })
    case 'path': {
      // The `d` geometry is up/down-scaled by the group `transform: scale(sx,sy)`,
      // so a non-compensated width would paint by that factor. Divide the emitted
      // width by the transform scale: at zoom 1 the painted width equals the
      // authored user units (identical to the old non-scaling-stroke behaviour),
      // and it scales with zoom like the connection pens.
      const pathScale = Math.max(1e-6, (Math.abs(scale.sx) + Math.abs(scale.sy)) / 2)
      return svgElement('path', {
        d: primitive.d,
        transform: `translate(${round(scale.tx * scale.sx)},${round(scale.ty * scale.sy)}) scale(${round(scale.sx)},${round(scale.sy)})`,
        fill: fillOf('none'),
        stroke,
        'stroke-width': round(strokeWidth / pathScale),
        ...linecapAttrs,
        ...semanticAttrs,
        ...dashAttrs
      })
    }
    default:
      return null
  }
}

/**
 * The SVG attributes every painted text shares for its font, with the
 * `FontStyleSheet`-resolved values winning over the 12-unit canvas fallback
 * only when the source actually named them (an authored diagram has no font
 * style sheet and keeps the canvas default).
 */
function fontTextAttrs(
  font: ArisLabelFont | ArisResolvedLabelFont | null
): Readonly<Record<string, string | number>> {
  const fontStyle = font !== null && 'fontStyle' in font && font.fontStyle ? font.fontStyle : null
  return {
    'font-size': font?.fontSize ?? CAPTION_FONT_SIZE,
    ...(font?.fontFamily ? { 'font-family': font.fontFamily } : {}),
    ...(font?.fontWeight ? { 'font-weight': font.fontWeight } : {}),
    ...(fontStyle ? { 'font-style': fontStyle } : {}),
    fill: occurrenceColorToCss(font?.textColor) ?? CAPTION_FILL
  }
}

/**
 * One laid-out line block as an SVG `<text>`: a single line keeps the
 * historical shape (the text node carries the content directly), multiple
 * lines become one `<tspan>` each — horizontally anchored, vertically
 * centred, each carrying its own bidi attributes so Arabic lines reorder
 * correctly inside a mixed block.
 */
function drawLineBlockText(
  layout: ArisLabelLayout,
  anchor: string,
  font: ArisLabelFont | ArisResolvedLabelFont | null,
  extraAttrs: Readonly<Record<string, string>> = {}
): SVGElement {
  const lines = layout.lines
  const first = lines[0]
  if (lines.length <= 1) {
    const node = svgElement('text', {
      x: first?.x ?? 0,
      y: first?.y ?? 0,
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      ...fontTextAttrs(font),
      ...extraAttrs,
      ...bidiTextAttrs(first?.text ?? '')
    })
    node.textContent = first?.text ?? ''
    return node
  }
  const node = svgElement('text', {
    x: first?.x ?? 0,
    y: (first!.y + lines[lines.length - 1]!.y) / 2,
    'text-anchor': anchor,
    ...fontTextAttrs(font),
    ...extraAttrs
  })
  for (const line of lines) {
    const tspan = svgElement('tspan', {
      x: line.x,
      y: line.y,
      'dominant-baseline': 'middle',
      ...bidiTextAttrs(line.text)
    })
    tspan.textContent = line.text
    svgAppend(node, tspan)
  }
  return node
}

/** Monotonic id source for the per-caption clip paths (document-unique). */
let captionClipSeq = 0

function drawCaption(
  text: string,
  width: number,
  height: number,
  font: ArisLabelFont | ArisResolvedLabelFont | null = null,
  box?: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>
): SVGElement {
  const region = box ?? { x: 0, y: 0, width, height }
  const fontSize = font?.fontSize ?? CAPTION_FONT_SIZE
  // Wrap within the caption's box: the reference PDFs set function/event
  // names over 2–3 centred lines inside the content box (V8).
  const lines = wrapLabelLines(text, region.width, fontSize, labelFontWeight(font?.fontWeight))
  const layout = layoutLabelLines(lines, region, fontSize, 'middle')
  const textNode = drawLineBlockText(layout, 'middle', font, {
    'data-aris-caption': 'true',
    ...(box === undefined ? {} : { 'data-aris-part': 'content' })
  })
  // Hard-stop overflow: clip the caption to the FULL shape bounds (never the
  // content box, so a legitimately-larger caption is never trimmed early). The
  // `<clipPath>` lives inside the returned group so the PDF-export SVG clone
  // carries the clip with it. The `<text>` keeps `data-aris-caption` — the
  // inline editor locates the caption by that marker (see directEdit.ts).
  const clipId = `aris-caption-clip-${(captionClipSeq += 1)}`
  const clipPath = svgElement('clipPath', { id: clipId })
  svgAppend(clipPath, svgElement('rect', { x: 0, y: 0, width, height }))
  const clipped = svgElement('g', { 'clip-path': `url(#${clipId})` })
  svgAppend(clipped, clipPath, textNode)
  return clipped
}

function partByElementIndex(
  descriptor: DmtSymbolDescriptor,
  elementIndex: number
): DmtSemanticPart | undefined {
  return descriptor.semanticParts.find((part) => part.elementIndexes.includes(elementIndex))
}

function scaleForPart(
  descriptor: DmtSymbolDescriptor,
  part: DmtSemanticPart,
  width: number,
  height: number
): Scale {
  if (part.scale === 'stretch') return scaleFor(descriptor, width, height)
  return uniformScaleFor(
    descriptor,
    width,
    height,
    part.id === 'icon' ? descriptor.iconBox : undefined
  )
}

function contentBoxAtSize(descriptor: DmtSymbolDescriptor, width: number, height: number): DmtBox {
  const scale = scaleFor(descriptor, width, height)
  return {
    x: mapX(scale, descriptor.contentBox.x),
    y: mapY(scale, descriptor.contentBox.y),
    width: descriptor.contentBox.width * scale.sx,
    height: descriptor.contentBox.height * scale.sy
  }
}

/**
 * `Alignment` as an SVG `text-anchor` plus the x it anchors at.
 *
 * ARIS writes `LEFT` / `CENTER` / `RIGHT`; every one of AnimalWF's 123
 * connection placements is `CENTER`, but the other two are ordinary ARIS
 * settings and a renderer that ignored them would silently centre a
 * left-aligned label.
 */
function alignmentAnchor(
  alignment: string | null,
  width: number
): { readonly anchor: string; readonly x: number } {
  switch ((alignment ?? '').trim().toUpperCase()) {
    case 'LEFT':
      return { anchor: 'start', x: 0 }
    case 'RIGHT':
      return { anchor: 'end', x: round(width) }
    default:
      return { anchor: 'middle', x: round(width / 2) }
  }
}

/**
 * The text a connection label draws, honouring its `Alignment` and the font its
 * `FontSS.IdRef` resolved to.
 *
 * The font style sheet supplies only what the working style catalog knows about
 * it; an unresolved sheet keeps the canvas's own caption font rather than
 * guessing a face that was never named (§12.3 would rather report a missing
 * font than invent one).
 */
function drawLabelText(
  text: string,
  width: number,
  height: number,
  alignment: string | null,
  font: ArisLabelFont | ArisResolvedLabelFont | null
): SVGElement {
  const { anchor } = alignmentAnchor(alignment, width)
  const fontSize = font?.fontSize ?? CAPTION_FONT_SIZE
  // A connection label's box is auto-sized to its text, so wrapping against
  // it would fight the source placement; explicit paragraph breaks still
  // stack. The anchor stays the alignment's (CENTER straddles the route).
  const lines = wrapLabelLines(text, null, fontSize, labelFontWeight(font?.fontWeight))
  const layout = layoutLabelLines(
    lines,
    { x: 0, y: 0, width, height },
    fontSize,
    anchorLabel(anchor)
  )
  return drawLineBlockText(layout, anchor, font, { 'data-aris-caption': 'true' })
}

function anchorLabel(anchor: string): ArisLabelAnchor {
  return anchor === 'start' ? 'start' : anchor === 'end' ? 'end' : 'middle'
}

/**
 * A read-only attribute annotation (a function's process-code / id numbering) painted inside the
 * occurrence's own group, centred in its pre-resolved local rectangle. Marked
 * `data-aris-attribute-label` — distinct from the name caption's `data-aris-caption` — so it is
 * never mistaken for the editable caption. The placement's own `FontStyleSheet`
 * supplies the font (the AnimalWF numbering is bold Arial), not the canvas
 * fallback.
 */
function drawAttributeLabel(
  label: ArisOccurrenceAttributeLabel,
  font: ArisLabelFont | ArisResolvedLabelFont | null = null
): SVGElement {
  const fontSize = font?.fontSize ?? CAPTION_FONT_SIZE
  const lines = wrapLabelLines(label.text, null, fontSize, labelFontWeight(font?.fontWeight))
  const layout = layoutLabelLines(lines, label, fontSize, 'middle')
  return drawLineBlockText(layout, 'middle', font, {
    'data-aris-attribute-label': label.attributeType
  })
}

/**
 * The marker a `SymbolFlag="SYMBOL"` placement draws *instead of* its text.
 *
 * ARIS renders such a placement as the attribute's own glyph — a boolean
 * attribute's tick, for instance — rather than as its value. The registry keys
 * symbols by object type + `SymbolNum` and models no attribute glyphs at all, so
 * this is canvas furniture: an OrbitPM-authored neutral marker, never traced
 * from ARIS artwork (§12.2). It carries the attribute type so the placement
 * stays identifiable, and it deliberately emits no `<text>` — that difference is
 * the whole point of the flag.
 */
function drawAttributeSymbol(attributeType: string, width: number, height: number): SVGElement {
  const size = Math.max(2, Math.min(width, height))
  const cx = width / 2
  const cy = height / 2
  const group = svgElement('g', { 'data-aris-attribute-symbol': attributeType })
  svgAppend(
    group,
    svgElement('rect', {
      x: round(cx - size / 2),
      y: round(cy - size / 2),
      width: round(size),
      height: round(size),
      rx: round(size / 5),
      ry: round(size / 5),
      fill: ATTRIBUTE_SYMBOL_FILL,
      stroke: ATTRIBUTE_SYMBOL_STROKE,
      'stroke-width': 1
    })
  )
  svgAppend(
    group,
    svgElement('path', {
      d: `M${round(cx - size / 4)},${round(cy)}L${round(cx - size / 12)},${round(cy + size / 5)}L${round(cx + size / 4)},${round(cy - size / 5)}`,
      fill: 'none',
      stroke: ATTRIBUTE_SYMBOL_STROKE,
      'stroke-width': Math.max(1, round(size / 10))
    })
  )
  return group
}

/** Draw one connection label placement — text or symbol, per `SymbolFlag`. */
function drawConnectionLabel(
  businessObject: ArisConnectionLabelBusinessObject,
  group: SVGElement,
  width: number,
  height: number,
  font: ArisLabelFont | ArisResolvedLabelFont | null
): void {
  group.setAttribute('data-aris-attribute-type', businessObject.attributeType)
  group.setAttribute('data-aris-symbol-flag', businessObject.symbolFlag)
  if (businessObject.fontStyleSheetId !== null) {
    group.setAttribute('data-aris-font-ss', businessObject.fontStyleSheetId)
  }
  if (businessObject.symbolFlag === 'SYMBOL') {
    svgAppend(group, drawAttributeSymbol(businessObject.attributeType, width, height))
    return
  }
  svgAppend(
    group,
    drawLabelText(businessObject.text, width, height, businessObject.alignment, font)
  )
}

type ConnectionArrow = 'none' | 'open' | 'filled'

interface RenderedConnectionBusinessObject {
  readonly kind: 'connection'
  readonly connectionType: string
  readonly color?: string | null
  readonly width?: number | null
  readonly lineStyle?: string | null
  readonly srcArrow?: string | null
  readonly tgtArrow?: string | null
  readonly visible?: boolean
  readonly zOrder?: number | null
}

function sourceArrow(raw: string | null | undefined, fallback: ConnectionArrow): ConnectionArrow {
  const normalized = raw?.trim().toUpperCase()
  if (!normalized || normalized === '0' || normalized === 'DEFAULT') return fallback
  if (normalized === 'NONE' || normalized === 'NO' || normalized === 'ST_ARROW_NONE') return 'none'
  return normalized.includes('FILLED') ? 'filled' : 'open'
}

function arrowMarkerRoot(node: SVGElement): SVGElement {
  return node.ownerSVGElement ?? node
}

/**
 * Connection markers are keyed by source style, end, and color. The default DMT point is an open
 * chevron as shown in the process PDFs; an explicit `ST_ARROW_FILLED_*` occurrence override gets
 * the filled point instead.
 *
 * Geometry is calibrated against the measured original (pixel-probed at 300 DPI): an open stick-V
 * ≈34 units across the line × 16 units along it, tip touching the target edge. `refX` equals the
 * path's tip-length so the marker's reference point — where `marker-end`/`marker-start` place it —
 * lands exactly on the endpoint rather than short of or past it. The stroke that draws the V is
 * itself a pen, so it scales by `ARIS_PEN_UNIT` exactly like every other source pen width (Wave 9
 * P2) rather than the arbitrary hairline the marker's SIZE (Wave 9 P1) was calibrated against.
 */
function ensureConnectionArrowMarker(
  node: SVGElement,
  color: string,
  arrow: Exclude<ConnectionArrow, 'none'>,
  end: 'start' | 'end'
): string {
  const root = arrowMarkerRoot(node)
  const safeColor = color.replace(/[^a-zA-Z0-9]/g, '')
  const id = `aris-arrow-${arrow}-${end}-${safeColor}`
  if (root.querySelector(`#${id}`)) return id
  let defs = root.querySelector('defs')
  if (!defs) {
    defs = svgElement('defs')
    root.insertBefore(defs, root.firstChild)
  }
  const marker = svgElement('marker', {
    id,
    markerWidth: 18,
    markerHeight: 36,
    refX: 16,
    refY: 17,
    orient: 'auto-start-reverse',
    markerUnits: 'userSpaceOnUse'
  })
  marker.appendChild(
    arrow === 'filled'
      ? svgElement('path', {
          d: 'M0,0 L16,17 L0,34 z',
          fill: color,
          stroke: color,
          'stroke-width': ARIS_PEN_UNIT
        })
      : svgElement('path', {
          d: 'M0,0 L16,17 L0,34',
          fill: 'none',
          stroke: color,
          'stroke-width': ARIS_PEN_UNIT
        })
  )
  defs.appendChild(marker)
  return id
}

/**
 * The endpoint triple one connection label's owner connection forms, read off
 * the diagram-js element graph: the label's `labelTarget` is the connection,
 * whose `source`/`target` are the endpoint occurrence shapes. `null` whenever
 * the label is not anchored to an ARIS connection between two occurrences —
 * the RACI derivation stays silent there rather than guessing.
 */
function raciTupleForLabel(shape: Shape): ArisRaciTuple | null {
  const labelTarget = (shape as { readonly labelTarget?: unknown }).labelTarget
  const connection = arisBusinessObject(labelTarget as ArisElementLike)
  if (connection?.kind !== 'connection') return null
  const endpoints = labelTarget as { readonly source?: unknown; readonly target?: unknown }
  const source = arisBusinessObject(endpoints.source as ArisElementLike)
  const target = arisBusinessObject(endpoints.target as ArisElementLike)
  if (source?.kind !== 'occurrence' || target?.kind !== 'occurrence') return null
  return Object.freeze({
    connectionType: connection.connectionType,
    sourceObjectType: source.objectType,
    targetObjectType: target.objectType
  })
}

/**
 * The diagram-js layer the print frame (header band, bottom legend) draws
 * into, and its index below the base plane (0) so the page furniture always
 * stays behind the diagram content it frames.
 */
export const ARIS_PRINT_FRAME_LAYER = 'aris-print-frame'
export const ARIS_PRINT_FRAME_LAYER_INDEX = -100

export class ArisRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'arisDocumentStore', 'arisCanvasSync', 'canvas']

  private readonly documentStore: ArisDocumentStore | null
  private readonly canvasSync: ArisCanvasSync | null
  private readonly diagramCanvas: Canvas | null
  private printFrameVisibleFlag = true

  constructor(
    eventBus: EventBus,
    documentStore?: ArisDocumentStore,
    canvasSync?: ArisCanvasSync,
    canvas?: Canvas
  ) {
    super(eventBus, ARIS_RENDER_PRIORITY)
    this.documentStore = documentStore ?? null
    this.canvasSync = canvasSync ?? null
    this.diagramCanvas = canvas ?? null
    // The print frame is page furniture, not an element: it rebuilds whenever
    // the bridge announces a fresh projection (boot, edit, undo, model
    // switch, content-language switch) and is invisible to fit/selection.
    eventBus.on(ARIS_DOCUMENT_CHANGED, () => this.refreshPrintFrame())
  }

  /** Whether the print-frame header/legend furniture is drawn. */
  get printFrameVisible(): boolean {
    return this.printFrameVisibleFlag
  }

  /** Show or hide the print frame; the diagram content is unaffected. */
  setPrintFrameVisible(visible: boolean): void {
    if (this.printFrameVisibleFlag === visible) return
    this.printFrameVisibleFlag = visible
    this.refreshPrintFrame()
  }

  /**
   * Rebuild the print-frame layer from the working document. A no-op when the
   * renderer was constructed without the document services (unit tests draw
   * single shapes directly and have no model to frame).
   */
  private refreshPrintFrame(): void {
    if (!this.documentStore || !this.diagramCanvas) return
    const layer = this.diagramCanvas.getLayer(
      ARIS_PRINT_FRAME_LAYER,
      ARIS_PRINT_FRAME_LAYER_INDEX
    ) as SVGGElement
    while (layer.firstChild) layer.removeChild(layer.firstChild)
    if (!this.printFrameVisibleFlag) return
    const document = this.documentStore.document
    const model = document.models.get(this.documentStore.activeModelId)
    if (!model) return
    const localeId = this.canvasSync?.displayLocaleId
    const frame = buildPrintFrame(model, {
      ...(localeId === undefined ? {} : { localeId }),
      // The bound header values inherit their note's own FontStyleSheet font
      // (V8) instead of a band-ratio guess.
      resolveNoteFont: (note) =>
        resolveFreeTextFont(document, note.modelId, note.id, localeId ?? DEFAULT_LOCALE_ID),
      // The title-block logo is decoded (tier-1 P11) from the OLE definition's
      // AT_IMAGE_FILE_BLOB PNG, which the source index already retains as an
      // attribute value. We only read it; the AML bytes are never rewritten.
      resolveOleImage: (definitionId) => resolveOleImageBlobValue(document, definitionId)
    })
    drawPrintFrame(layer, frame, {
      modelName: readLocalized(model.names, localeId)
    })
  }

  /** The locale text is currently resolved in (the canvas content language). */
  private textLocaleId(): string {
    return this.canvasSync?.displayLocaleId ?? DEFAULT_LOCALE_ID
  }

  /**
   * The `FontStyleSheet`-resolved caption font of one occurrence, `null` when
   * the renderer was constructed without the document services — the caller
   * then keeps its historical fallback, so shape-only unit tests are
   * unaffected.
   */
  private occurrenceCaptionFont(
    businessObject: ArisOccurrenceBusinessObject
  ): ArisResolvedLabelFont | null {
    if (!this.documentStore) return null
    return resolveOccurrenceCaptionFont(
      this.documentStore.document,
      businessObject.modelId,
      businessObject.occurrenceId,
      this.textLocaleId()
    )
  }

  /** The resolved font of one non-`AT_NAME` placement (numbering, process code). */
  private attributeLabelFont(
    businessObject: ArisOccurrenceBusinessObject,
    attributeType: string
  ): ArisResolvedLabelFont | null {
    if (!this.documentStore) return null
    return resolveAttributePlacementFont(
      this.documentStore.document,
      businessObject.modelId,
      businessObject.occurrenceId,
      attributeType,
      this.textLocaleId()
    )
  }

  /** The resolved font of one connection label placement (relation text, RACI letter). */
  private connectionLabelFont(
    businessObject: ArisConnectionLabelBusinessObject
  ): ArisResolvedLabelFont | null {
    if (!this.documentStore) return preferResolvedFont(null, businessObject.font)
    return preferResolvedFont(
      resolveConnectionPlacementFont(
        this.documentStore.document,
        businessObject.fontStyleSheetId,
        this.textLocaleId()
      ),
      businessObject.font
    )
  }

  /** The free-text note's working record, when the document services are wired. */
  private workingFreeText(businessObject: ArisFreeTextBusinessObject): ArisFreeText | undefined {
    return this.documentStore?.document.models
      .get(businessObject.modelId)
      ?.freeText.find((note) => note.id === businessObject.freeTextId)
  }

  /** The free-text note's resolved font, over the business object's own. */
  private freeTextFont(
    businessObject: ArisFreeTextBusinessObject & {
      readonly font?: ArisLabelFont | null
    }
  ): ArisResolvedLabelFont | null {
    if (!this.documentStore) {
      return preferResolvedFont(null, businessObject.font ?? null)
    }
    return preferResolvedFont(
      resolveFreeTextFont(
        this.documentStore.document,
        businessObject.modelId,
        businessObject.freeTextId,
        this.textLocaleId()
      ),
      businessObject.font ?? null
    )
  }

  /**
   * The `<FFTextOcc>`'s own `Alignment`, read from the source record the
   * working note came from. Everything AnimalWF writes is `CENTER`; the other
   * two ordinary ARIS settings are honoured rather than silently centred.
   */
  private freeTextAlignment(note: ArisFreeText): string | null {
    const source = this.documentStore?.document.sourceIndex.freeTextOccurrences.find(
      (occurrence) => occurrence.sourceId === note.id
    )
    return source?.rawAttributes['Alignment'] ?? null
  }

  canRender(element: Element): boolean {
    return arisBusinessObject(element) !== null
  }

  drawShape(parentGfx: SVGElement, shape: Shape): SVGElement {
    const businessObject = arisBusinessObject(shape) as ArisBusinessObject
    const group = svgElement('g', { 'data-aris-kind': businessObject.kind })

    if (businessObject.kind === 'occurrence') {
      const selectedDescriptor =
        businessObject.catalogId === undefined
          ? null
          : resolveArisCatalogSymbol(businessObject.catalogId)
      const resolution =
        selectedDescriptor === null
          ? resolveArisSymbol({
              modelType: businessObject.modelType,
              objectType: businessObject.objectType,
              symbolNum: businessObject.symbolNum
            })
          : { descriptor: selectedDescriptor, fidelity: Object.freeze([]) }
      group.setAttribute('data-aris-symbol', resolution.descriptor.key)
      const dmtDescriptor = isDmtSymbolDescriptor(resolution.descriptor)
        ? resolution.descriptor
        : null
      group.setAttribute(
        'data-aris-catalog-id',
        dmtDescriptor?.catalogId ?? 'orbitpm.unknown-symbol'
      )
      group.setAttribute('data-aris-part', 'presentation')
      group.setAttribute('data-aris-icon', dmtDescriptor?.icon ?? 'unknown')
      group.setAttribute('data-aris-silhouette', dmtDescriptor?.silhouette ?? 'unknown')
      group.setAttribute('data-aris-operator', dmtDescriptor?.operator ?? 'none')
      group.setAttribute(
        'aria-label',
        businessObject.name
          ? `${dmtDescriptor?.accessibleLabel ?? 'Unknown ARIS symbol'}: ${businessObject.name}`
          : (dmtDescriptor?.accessibleLabel ?? 'Unknown ARIS symbol')
      )
      group.setAttribute('role', 'img')
      if (resolution.fidelity.length > 0) {
        group.setAttribute(
          'data-aris-fidelity',
          resolution.fidelity.map((finding) => finding.kind).join(' ')
        )
      }
      const paint = resolvePaint(businessObject.style)
      const fallbackScale = scaleFor(resolution.descriptor, shape.width, shape.height)
      const fallbackBodyIndex = resolution.descriptor.drawing.elements.findIndex(isFilledPrimitive)
      resolution.descriptor.drawing.elements.forEach((primitive, index) => {
        const part = dmtDescriptor === null ? undefined : partByElementIndex(dmtDescriptor, index)
        const scale =
          dmtDescriptor === null || part === undefined
            ? fallbackScale
            : scaleForPart(dmtDescriptor, part, shape.width, shape.height)
        const node = drawPrimitive(primitive, scale, paint, {
          accent:
            part?.paintRole === 'accent' || (dmtDescriptor === null && index === fallbackBodyIndex),
          pen: part?.id === 'surface' || part?.id === 'silhouette' || dmtDescriptor === null,
          part: part?.id ?? (index === fallbackBodyIndex ? 'silhouette' : 'icon')
        })
        if (node) svgAppend(group, node)
      })
      if (
        businessObject.name &&
        (dmtDescriptor === null || dmtDescriptor.captionPolicy === 'content-box')
      ) {
        svgAppend(
          group,
          drawCaption(
            businessObject.name,
            shape.width,
            shape.height,
            this.occurrenceCaptionFont(businessObject),
            dmtDescriptor === null
              ? undefined
              : contentBoxAtSize(dmtDescriptor, shape.width, shape.height)
          )
        )
      }
      for (const label of businessObject.attributeLabels ?? []) {
        svgAppend(
          group,
          drawAttributeLabel(label, this.attributeLabelFont(businessObject, label.attributeType))
        )
      }
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'lane') {
      svgAppend(
        group,
        svgElement('rect', {
          x: 0,
          y: 0,
          width: shape.width,
          height: shape.height,
          fill: 'none',
          stroke: LANE_STROKE,
          'stroke-width': 1,
          'stroke-dasharray': '6 4'
        })
      )
      if (businessObject.name) svgAppend(group, drawCaption(businessObject.name, shape.width, 24))
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'freeText') {
      const font = this.freeTextFont(businessObject)
      const note = this.workingFreeText(businessObject)
      const paragraphs = normalizeLabelParagraphs(businessObject.text)
      if (paragraphs.length === 0 && note !== undefined) {
        // A bound note (`AT_MODEL_AT`) carries no static text by construction:
        // the print-frame overlay paints the resolved model-attribute value at
        // the note's anchor, so the generic path paints nothing at all — no
        // empty bordered box (plan §"Geometry, labels": "Do not invent a
        // visible note border"). An empty static note renders empty, exactly
        // as ARIS renders it.
        svgAppend(parentGfx, group)
        return group
      }
      const fontSize = font?.fontSize ?? CAPTION_FONT_SIZE
      if (note !== undefined && !(note.bounds.width > 0) && !(note.bounds.height > 0)) {
        // An unsized `<FFTextOcc>` is an alignment-anchored auto-sized text,
        // not a top-left default box: the source `Position` is the text
        // block's anchor. The drawn element's local origin IS that position
        // (diagram-js translates the group to the note's coordinates), so the
        // block anchors at (0, 0) — its centre for AnimalWF's all-CENTER
        // notes.
        const { anchor } = alignmentAnchor(this.freeTextAlignment(note), 0)
        const lines = wrapLabelLines(
          businessObject.text,
          null,
          fontSize,
          labelFontWeight(font?.fontWeight)
        )
        const layout = layoutAnchoredLines(lines, { x: 0, y: 0 }, fontSize)
        svgAppend(group, drawLineBlockText(layout, anchor, font, { 'data-aris-caption': 'true' }))
        svgAppend(parentGfx, group)
        return group
      }
      if (note !== undefined && note.bounds.width > 0 && !(note.bounds.height > 0)) {
        // A note with an explicit `Size.dX>0` but no `Size.dY` (the
        // Reference-Laws title: `dX=544 dY=0 Alignment=CENTER`) auto-heights
        // instead of falling into the bordered/fixed-height box below: it
        // wraps to its own width and top-anchors at `Position`, with no
        // synthesized border or invented height (Wave 9 P6; fixplan §3.5).
        // `canvasSync`'s `freeTextBounds` already shifted the drawn shape's
        // `x` to this note's alignment anchor (CENTER/RIGHT box shift), so
        // the group's local origin is already the box's own top-left;
        // anchoring the text inside that box by the SAME alignment (via
        // `layoutLabelLines`'s box formula, box height = exactly the wrapped
        // line count so the block sits flush against the top edge) lands the
        // printed text back on the source `Position` — e.g. CENTER:
        // box.x + width/2 = (pos.x − dX/2) + dX/2 = pos.x.
        const alignment = this.freeTextAlignment(note)
        const { anchor } = alignmentAnchor(alignment, 0)
        const lines = wrapLabelLines(
          businessObject.text,
          shape.width,
          fontSize,
          labelFontWeight(font?.fontWeight)
        )
        const lineHeight = round(fontSize * ARIS_LABEL_LINE_HEIGHT)
        const layout = layoutLabelLines(
          lines,
          { x: 0, y: 0, width: shape.width, height: lines.length * lineHeight },
          fontSize,
          anchorLabel(anchor)
        )
        svgAppend(group, drawLineBlockText(layout, anchor, font, { 'data-aris-caption': 'true' }))
        svgAppend(parentGfx, group)
        return group
      }
      // A source pen is the only licence for a visible note border; the
      // canvas's old invented border is gone (plan: no invented borders).
      const noteStroke = occurrenceColorToCss(note?.style.strokeColor)
      if (note === undefined || noteStroke !== undefined) {
        svgAppend(
          group,
          svgElement('rect', {
            x: 0,
            y: 0,
            width: shape.width,
            height: shape.height,
            fill: 'none',
            stroke: noteStroke ?? FREE_TEXT_STROKE,
            'stroke-width': 1
          })
        )
      }
      svgAppend(
        group,
        drawCaption(businessObject.text, shape.width, shape.height, font, {
          x: 8,
          y: 2,
          width: shape.width - 16,
          height: shape.height - 4
        })
      )
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'label') {
      const font = this.documentStore
        ? resolveOccurrenceCaptionFont(
            this.documentStore.document,
            businessObject.modelId,
            businessObject.ownerOccurrenceId,
            this.textLocaleId()
          )
        : null
      svgAppend(group, drawCaption(businessObject.text, shape.width, shape.height, font))
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'connectionLabel') {
      // `Rotation` is degrees about the placement's own centre. AnimalWF writes
      // 0 for all 123, but ARIS exposes the setting and an ignored rotation
      // would draw a deliberately angled label flat.
      if (businessObject.rotation !== null && businessObject.rotation % 360 !== 0) {
        group.setAttribute(
          'transform',
          `rotate(${round(businessObject.rotation)} ${round(shape.width / 2)} ${round(shape.height / 2)})`
        )
      }
      const labelFont = this.connectionLabelFont(businessObject)
      drawConnectionLabel(businessObject, group, shape.width, shape.height, labelFont)
      // Tuple-safe RACI: an empty relationship-badge placement on an eligible
      // executor→Function connection shows the convention letter (R/A/C/I) at
      // the source placement, exactly as the paired PDFs paint it. A
      // source-authored value always wins; non-RACI placements stay untouched.
      const raciLetter = derivedRaciLabelText(businessObject, raciTupleForLabel(shape))
      if (raciLetter !== null) {
        group.setAttribute('data-aris-raci', raciLetter)
        svgAppend(
          group,
          drawLabelText(raciLetter, shape.width, shape.height, businessObject.alignment, labelFont)
        )
      }
      svgAppend(parentGfx, group)
      return group
    }

    svgAppend(parentGfx, group)
    return group
  }

  drawConnection(parentGfx: SVGElement, connection: Connection): SVGElement {
    const businessObject = arisBusinessObject(connection)
    const appearance =
      businessObject?.kind === 'connection'
        ? (businessObject as RenderedConnectionBusinessObject)
        : null
    const stroke = occurrenceColorToCss(appearance?.color) ?? CONNECTION_STROKE
    // Source `Pen Width` (default 1 when the occurrence carries none), scaled to canvas units
    // (Wave 9 P2 — ARIS_PEN_UNIT; fixplan §5.4).
    const strokeWidth =
      (typeof appearance?.width === 'number' &&
      Number.isFinite(appearance.width) &&
      appearance.width >= 0
        ? appearance.width
        : 1) * ARIS_PEN_UNIT
    const normalizedLineStyle = appearance?.lineStyle?.trim().toLowerCase() ?? 'solid'
    const dasharray = CONNECTION_DASHARRAY_BY_STYLE[normalizedLineStyle]
    const visible = appearance?.visible !== false && normalizedLineStyle !== 'invisible'
    const defaultTargetArrow: ConnectionArrow =
      appearance && DIRECTED_CONNECTION_TYPES.has(appearance.connectionType) ? 'open' : 'none'
    const srcArrow = sourceArrow(appearance?.srcArrow, 'none')
    const tgtArrow = sourceArrow(appearance?.tgtArrow, defaultTargetArrow)
    const line = createLine(connection.waypoints, {
      stroke,
      strokeWidth,
      fill: 'none'
    })
    if (dasharray) line.setAttribute('stroke-dasharray', dasharray)
    line.setAttribute('data-aris-visible', visible ? 'true' : 'false')
    line.setAttribute('data-aris-src-arrow', srcArrow)
    line.setAttribute('data-aris-tgt-arrow', tgtArrow)
    if (!visible) {
      line.setAttribute('visibility', 'hidden')
      line.setAttribute('pointer-events', 'none')
    }
    if (appearance) {
      line.setAttribute('data-aris-connection-type', appearance.connectionType)
      if (appearance.zOrder !== null && appearance.zOrder !== undefined) {
        line.setAttribute('data-aris-z-order', String(appearance.zOrder))
      }
    }
    parentGfx.appendChild(line)
    if (srcArrow !== 'none') {
      line.setAttribute(
        'marker-start',
        `url(#${ensureConnectionArrowMarker(parentGfx, stroke, srcArrow, 'start')})`
      )
    }
    if (tgtArrow !== 'none') {
      line.setAttribute(
        'marker-end',
        `url(#${ensureConnectionArrowMarker(parentGfx, stroke, tgtArrow, 'end')})`
      )
    }
    return line
  }

  getShapePath(shape: Shape): string {
    const { x, y, width, height } = shape
    return `M${x},${y}l${width},0l0,${height}l${-width},0z`
  }

  getConnectionPath(connection: Connection): string {
    return connection.waypoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
      .join('')
  }
}

export { updateLine }
