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
 * The brush colours the symbol's *body* — its first filled primitive — and never
 * its accents: flooding every filled primitive would erase the detail that
 * distinguishes one symbol from another (an information-carrier's inner band, a
 * person's head), turning restyle into vandalism.
 *
 * Any fidelity finding the registry reports is attached to the rendered group
 * as `data-aris-fidelity` so the Phase 9 fidelity report can collect it without
 * re-resolving every symbol.
 */

import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Connection, Element, Shape } from 'diagram-js/lib/model/Types'
import { createLine, updateLine } from 'diagram-js/lib/util/RenderUtil'

import { resolveArisSymbol } from '../symbols'
import { amlColorRefToCss } from '../source/semanticIndex'
import type { ArisDrawingElement, ArisSymbolDescriptor } from '../symbols/types'
import {
  arisBusinessObject,
  type ArisBusinessObject,
  type ArisConnectionLabelBusinessObject,
  type ArisLabelFont,
  type ArisOccurrenceAttributeLabel,
  type ArisOccurrenceStyleView
} from './elements'
import { ensureArrowMarker, svgAppend, svgElement } from './svg'

const DEFAULT_STROKE = '#334155'
const DEFAULT_FILL = '#ffffff'
const LANE_STROKE = '#94a3b8'
const FREE_TEXT_STROKE = '#cbd5e1'
const CONNECTION_STROKE = '#475569'
const CAPTION_FILL = '#0f172a'
const CAPTION_FONT_SIZE = 12
/** Fill of the marker a `SymbolFlag="SYMBOL"` placement draws in place of text. */
const ATTRIBUTE_SYMBOL_FILL = '#e2e8f0'
const ATTRIBUTE_SYMBOL_STROKE = '#475569'

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
  if (trimmed.startsWith('#')) return trimmed
  if (!/^[0-9a-fA-F]{1,8}$/.test(trimmed)) return trimmed
  return amlColorRefToCss(trimmed) ?? undefined
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
    strokeWidth:
      typeof style?.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)
        ? style.strokeWidth
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
 * `paint` is the occurrence's own style. `body` marks the one primitive the
 * brush colour applies to; the pen colour, width and dash apply to all of them.
 */
function drawPrimitive(
  primitive: ArisDrawingElement,
  scale: Scale,
  paint: ResolvedOccurrencePaint = EMPTY_PAINT,
  body = false
): SVGElement | null {
  const stroke = paint.stroke ?? primitive.stroke ?? DEFAULT_STROKE
  const strokeWidth = paint.strokeWidth ?? primitive.strokeWidth ?? 1.5
  const dash = paint.dasharray
  const dashAttrs: Readonly<Record<string, string>> =
    dash === undefined || dash === null ? {} : { 'stroke-dasharray': dash }
  const own = 'fill' in primitive ? primitive.fill : undefined
  const fillOf = (fallback: string): string =>
    body && paint.fill !== undefined ? paint.fill : (own ?? fallback)
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
        ...dashAttrs
      })
    case 'path':
      return svgElement('path', {
        d: primitive.d,
        transform: `translate(${round(scale.tx * scale.sx)},${round(scale.ty * scale.sy)}) scale(${round(scale.sx)},${round(scale.sy)})`,
        fill: fillOf('none'),
        stroke,
        'stroke-width': strokeWidth,
        ...dashAttrs
      })
    default:
      return null
  }
}

function isArabicText(text: string): boolean {
  return /\p{Script=Arabic}/u.test(text)
}

function rtlTextAttrs(text: string): Readonly<Record<string, string>> {
  return isArabicText(text) ? { direction: 'rtl', 'unicode-bidi': 'plaintext' } : {}
}

function drawCaption(
  text: string,
  width: number,
  height: number,
  font: ArisLabelFont | null = null
): SVGElement {
  const node = svgElement('text', {
    x: round(width / 2),
    y: round(height / 2),
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'font-size': font?.fontSize ?? CAPTION_FONT_SIZE,
    ...(font?.fontFamily ? { 'font-family': font.fontFamily } : {}),
    ...(font?.fontWeight ? { 'font-weight': font.fontWeight } : {}),
    fill: occurrenceColorToCss(font?.textColor) ?? CAPTION_FILL,
    'data-aris-caption': 'true',
    ...rtlTextAttrs(text)
  })
  node.textContent = text
  return node
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
  font: ArisLabelFont | null
): SVGElement {
  const { anchor, x } = alignmentAnchor(alignment, width)
  const node = svgElement('text', {
    x,
    y: round(height / 2),
    'text-anchor': anchor,
    'dominant-baseline': 'middle',
    'font-size': font?.fontSize ?? CAPTION_FONT_SIZE,
    ...(font?.fontFamily ? { 'font-family': font.fontFamily } : {}),
    ...(font?.fontWeight ? { 'font-weight': font.fontWeight } : {}),
    fill: occurrenceColorToCss(font?.textColor) ?? CAPTION_FILL,
    'data-aris-caption': 'true',
    ...rtlTextAttrs(text)
  })
  node.textContent = text
  return node
}

/**
 * A read-only attribute annotation (a function's process-code / id numbering) painted inside the
 * occurrence's own group, centred in its pre-resolved local rectangle. Marked
 * `data-aris-attribute-label` — distinct from the name caption's `data-aris-caption` — so it is
 * never mistaken for the editable caption.
 */
function drawAttributeLabel(label: ArisOccurrenceAttributeLabel): SVGElement {
  const node = svgElement('text', {
    x: round(label.x + label.width / 2),
    y: round(label.y + label.height / 2),
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'font-size': CAPTION_FONT_SIZE,
    fill: CAPTION_FILL,
    'data-aris-attribute-label': label.attributeType,
    ...rtlTextAttrs(label.text)
  })
  node.textContent = label.text
  return node
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
  height: number
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
    drawLabelText(businessObject.text, width, height, businessObject.alignment, businessObject.font)
  )
}

export class ArisRenderer extends BaseRenderer {
  static $inject = ['eventBus']

  constructor(eventBus: EventBus) {
    super(eventBus, ARIS_RENDER_PRIORITY)
  }

  canRender(element: Element): boolean {
    return arisBusinessObject(element) !== null
  }

  drawShape(parentGfx: SVGElement, shape: Shape): SVGElement {
    const businessObject = arisBusinessObject(shape) as ArisBusinessObject
    const group = svgElement('g', { 'data-aris-kind': businessObject.kind })

    if (businessObject.kind === 'occurrence') {
      const resolution = resolveArisSymbol({
        modelType: businessObject.modelType,
        objectType: businessObject.objectType,
        symbolNum: businessObject.symbolNum
      })
      group.setAttribute('data-aris-symbol', resolution.descriptor.key)
      if (resolution.fidelity.length > 0) {
        group.setAttribute(
          'data-aris-fidelity',
          resolution.fidelity.map((finding) => finding.kind).join(' ')
        )
      }
      const scale = scaleFor(resolution.descriptor, shape.width, shape.height)
      const paint = resolvePaint(businessObject.style)
      // The brush colours the body only — the first primitive that encloses an
      // area — so a restyle repaints the symbol without erasing its detail.
      const bodyIndex = resolution.descriptor.drawing.elements.findIndex(isFilledPrimitive)
      resolution.descriptor.drawing.elements.forEach((primitive, index) => {
        const node = drawPrimitive(primitive, scale, paint, index === bodyIndex)
        if (node) svgAppend(group, node)
      })
      if (businessObject.name) {
        svgAppend(group, drawCaption(businessObject.name, shape.width, shape.height))
      }
      for (const label of businessObject.attributeLabels ?? []) {
        svgAppend(group, drawAttributeLabel(label))
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
      const font = (
        businessObject as typeof businessObject & { readonly font?: ArisLabelFont | null }
      ).font
      svgAppend(
        group,
        svgElement('rect', {
          x: 0,
          y: 0,
          width: shape.width,
          height: shape.height,
          fill: 'none',
          stroke: FREE_TEXT_STROKE,
          'stroke-width': 1
        })
      )
      svgAppend(group, drawCaption(businessObject.text, shape.width, shape.height, font ?? null))
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'label') {
      svgAppend(group, drawCaption(businessObject.text, shape.width, shape.height))
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
      drawConnectionLabel(businessObject, group, shape.width, shape.height)
      svgAppend(parentGfx, group)
      return group
    }

    svgAppend(parentGfx, group)
    return group
  }

  drawConnection(parentGfx: SVGElement, connection: Connection): SVGElement {
    const businessObject = arisBusinessObject(connection)
    const stroke =
      businessObject?.kind === 'connection'
        ? (occurrenceColorToCss(
            (businessObject as typeof businessObject & { readonly color?: string | null }).color
          ) ?? CONNECTION_STROKE)
        : CONNECTION_STROKE
    const line = createLine(connection.waypoints, {
      stroke,
      strokeWidth: 1.5,
      fill: 'none'
    })
    if (businessObject?.kind === 'connection') {
      line.setAttribute('data-aris-connection-type', businessObject.connectionType)
    }
    // EPC control flow is directed; the arrowhead marks the target end. The marker is shared
    // per stroke colour across the whole diagram (see `ensureArrowMarker`).
    parentGfx.appendChild(line)
    line.setAttribute('marker-end', `url(#${ensureArrowMarker(parentGfx, stroke)})`)
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
