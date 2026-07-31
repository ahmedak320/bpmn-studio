import { conventionDefaultFill } from '../conventions/catalog'
import type {
  ArisBounds,
  ArisDrawingElement,
  ArisPort,
  ArisSymbolDescriptor,
  ArisSymbolDrawing,
  ArisViewBox
} from './types'

// Wave 9 P4 (fixplan §4.3): measured hairline grey on the card/event/value-chain surface stroke.
const OUTLINE = '#c0c0c0'
const WHITE = '#ffffff'
const CARD_VIEW_BOX = Object.freeze({ minX: 0, minY: 0, width: 100, height: 60 })
// Wave 9 P4 (fixplan §4.3): the card surface's outer corners are slightly rounded in the
// original (the colored band's own outer corners follow the same curve — see cardTopStripPath /
// cardLeftBandPath below; its INNER seam against the caption area stays square).
const CARD_CORNER_RADIUS = 2

/**
 * Wave 9 P4 (fixplan §4.3): the original's green icon band is 17 % of a FUNCTION card's width and
 * 21 % of every other card's width — both currently render at a too-wide 25 %. `card()` passes
 * `bandWidth: FUNCTION_BAND_WIDTH` only for the two function descriptors; every other card
 * defaults to the satellite width.
 */
const FUNCTION_BAND_WIDTH = 17
const SATELLITE_BAND_WIDTH = 21

/**
 * The icon's own centering box, re-derived from whichever band width a family uses: a 12 % left
 * inset and an 80 % width (leaving an 8 % right-hand margin) — exactly the ratios the old,
 * single 25-wide-band CARD_ICON_BOX (x:3, width:20 of 25) already encoded. Reapplying the same
 * ratios keeps the icon centered inside its band and lets it re-center/shrink along with the band
 * instead of using a fixed absolute inset.
 */
function cardIconBox(bandWidth: number): DmtBox {
  return { x: bandWidth * 0.12, y: 7, width: bandWidth * 0.8, height: 46 }
}

const CARD_ICON_BOX = Object.freeze(cardIconBox(SATELLITE_BAND_WIDTH))
// Measured (fixplan §4.3): caption area starts just right of each family's band.
const CARD_CONTENT_BOX = Object.freeze({ x: 23, y: 4, width: 74, height: 53 })
const FUNCTION_CONTENT_BOX = Object.freeze({ x: 18, y: 4, width: 80, height: 53 })

export type DmtSilhouette =
  | 'card'
  | 'event-chevron'
  | 'operator-circle'
  | 'process-interface'
  | 'value-chain-start'
  | 'value-chain-successor'
  | 'unknown'

export type DmtIconId =
  | 'application-window'
  | 'application-window-down'
  | 'aris-model'
  | 'business-policy'
  | 'business-rule'
  | 'committee-team'
  | 'cube'
  | 'data-entity'
  | 'document'
  | 'double-chevron'
  | 'electronic-file'
  | 'email'
  | 'entity-type'
  | 'flag'
  | 'group'
  | 'information'
  | 'law-shield'
  | 'letter'
  | 'log'
  | 'measure'
  | 'mobile'
  | 'org-unit'
  | 'person'
  | 'position'
  | 'related-entity'
  | 'requirement'
  | 'risk'
  | 'service-level-shield'
  | 'unknown'

export type DmtOperator = 'AND' | 'OR' | 'XOR'
export type DmtPartId = 'silhouette' | 'surface' | 'accent' | 'icon' | 'operator'
export type DmtScalePolicy = 'stretch' | 'uniform'
export type DmtPaintRole = 'none' | 'accent'

export interface DmtBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DmtSemanticPart {
  readonly id: DmtPartId
  readonly elementIndexes: readonly number[]
  readonly scale: DmtScalePolicy
  readonly paintRole: DmtPaintRole
}

export interface DmtSymbolDescriptor extends ArisSymbolDescriptor {
  /** Presentation identity; unlike objectType:symbolNum this never collapses variants. */
  readonly catalogId: string
  readonly modelType: string
  readonly accessibleLabel: string
  readonly silhouette: DmtSilhouette
  readonly icon: DmtIconId
  readonly operator: DmtOperator | null
  /** SVG path in descriptor coordinates used for silhouette-aware hit testing/docking. */
  readonly hitPath: string
  readonly stretchPolicy: Readonly<{
    readonly surface: 'stretch'
    readonly icon: 'uniform'
    readonly stroke: 'non-scaling'
  }>
  readonly iconBox: DmtBox
  readonly contentBox: DmtBox
  readonly captionPolicy: 'content-box' | 'hidden'
  readonly semanticParts: readonly DmtSemanticPart[]
  /** False when objectType:symbolNum cannot safely round-trip this presentation yet. */
  readonly roundTripVerified: boolean
}

interface DrawingGroup {
  readonly id: DmtPartId
  readonly elements: readonly ArisDrawingElement[]
  readonly scale: DmtScalePolicy
  readonly paintRole: DmtPaintRole
}

interface DescriptorInput {
  readonly catalogId: string
  readonly modelType?: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly accessibleLabel: string
  readonly silhouette: DmtSilhouette
  readonly icon: DmtIconId
  readonly operator?: DmtOperator | null
  readonly hitPath: string
  readonly defaultBounds?: ArisBounds
  readonly viewBox?: ArisViewBox
  readonly iconBox?: DmtBox
  readonly contentBox?: DmtBox
  readonly captionPolicy?: 'content-box' | 'hidden'
  readonly groups: readonly DrawingGroup[]
  readonly ports?: readonly ArisPort[]
  readonly roundTripVerified?: boolean
  readonly canonicalKey?: boolean
}

function bodyFill(objectType: string, symbolNum: string, fallback: string): string {
  return conventionDefaultFill(objectType, symbolNum) ?? fallback
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    readonly fill?: string
    readonly stroke?: string
    readonly strokeWidth?: number
    readonly rx?: number
    readonly ry?: number
  } = {}
): ArisDrawingElement {
  return {
    kind: 'rect',
    x,
    y,
    width,
    height,
    rx: options.rx,
    ry: options.ry,
    fill: options.fill ?? WHITE,
    stroke: options.stroke ?? 'none',
    strokeWidth: options.strokeWidth ?? 0
  }
}

function circle(
  cx: number,
  cy: number,
  r: number,
  options: {
    readonly fill?: string
    readonly stroke?: string
    readonly strokeWidth?: number
  } = {}
): ArisDrawingElement {
  return {
    kind: 'circle',
    cx,
    cy,
    r,
    fill: options.fill ?? 'none',
    stroke: options.stroke ?? WHITE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function path(
  d: string,
  options: {
    readonly fill?: string
    readonly stroke?: string
    readonly strokeWidth?: number
  } = {}
): ArisDrawingElement {
  return {
    kind: 'path',
    d,
    fill: options.fill ?? 'none',
    stroke: options.stroke ?? WHITE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function polygon(
  points: readonly { readonly x: number; readonly y: number }[],
  options: {
    readonly fill?: string
    readonly stroke?: string
    readonly strokeWidth?: number
  } = {}
): ArisDrawingElement {
  return {
    kind: 'polygon',
    points,
    fill: options.fill ?? WHITE,
    stroke: options.stroke ?? 'none',
    strokeWidth: options.strokeWidth ?? 0
  }
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: { readonly stroke?: string; readonly strokeWidth?: number } = {}
): ArisDrawingElement {
  return {
    kind: 'line',
    x1,
    y1,
    x2,
    y2,
    stroke: options.stroke ?? WHITE,
    strokeWidth: options.strokeWidth ?? 2
  }
}

function standardPorts(): readonly ArisPort[] {
  return Object.freeze([
    { name: 'NW', nx: 0, ny: 0 },
    { name: 'N', nx: 0.5, ny: 0 },
    { name: 'NE', nx: 1, ny: 0 },
    { name: 'E', nx: 1, ny: 0.5 },
    { name: 'SE', nx: 1, ny: 1 },
    { name: 'S', nx: 0.5, ny: 1 },
    { name: 'SW', nx: 0, ny: 1 },
    { name: 'W', nx: 0, ny: 0.5 },
    { name: 'CENTER', nx: 0.5, ny: 0.5 }
  ])
}

function chevronPorts(leftX: number): readonly ArisPort[] {
  return Object.freeze([
    { name: 'NW', nx: leftX, ny: 0 },
    { name: 'N', nx: 0.5, ny: 0 },
    { name: 'NE', nx: 0.88, ny: 0 },
    { name: 'E', nx: 1, ny: 0.5 },
    { name: 'SE', nx: 0.88, ny: 1 },
    { name: 'S', nx: 0.5, ny: 1 },
    { name: 'SW', nx: leftX, ny: 1 },
    { name: 'W', nx: leftX, ny: 0.5 },
    { name: 'CENTER', nx: 0.5, ny: 0.5 }
  ])
}

function drawingFrom(
  viewBox: ArisViewBox,
  groups: readonly DrawingGroup[]
): {
  readonly drawing: ArisSymbolDrawing
  readonly semanticParts: readonly DmtSemanticPart[]
} {
  const elements: ArisDrawingElement[] = []
  const semanticParts: DmtSemanticPart[] = []
  for (const group of groups) {
    const start = elements.length
    elements.push(...group.elements)
    semanticParts.push(
      Object.freeze({
        id: group.id,
        elementIndexes: Object.freeze(
          Array.from({ length: group.elements.length }, (_, index) => start + index)
        ),
        scale: group.scale,
        paintRole: group.paintRole
      })
    )
  }
  return {
    drawing: Object.freeze({
      viewBox: Object.freeze(viewBox),
      elements: Object.freeze(elements)
    }),
    semanticParts: Object.freeze(semanticParts)
  }
}

function describe(input: DescriptorInput): DmtSymbolDescriptor {
  const modelType = input.modelType ?? 'MT_EEPC'
  const { drawing, semanticParts } = drawingFrom(input.viewBox ?? CARD_VIEW_BOX, input.groups)
  const triple = `${modelType}:${input.objectType}:${input.symbolNum}`
  return Object.freeze({
    key: input.canonicalKey === false ? `${triple}#${input.catalogId}` : triple,
    catalogId: input.catalogId,
    modelType,
    objectType: input.objectType,
    symbolNum: input.symbolNum,
    labelKey: input.labelKey,
    accessibleLabel: input.accessibleLabel,
    silhouette: input.silhouette,
    icon: input.icon,
    operator: input.operator ?? null,
    hitPath: input.hitPath,
    stretchPolicy: Object.freeze({
      surface: 'stretch',
      icon: 'uniform',
      stroke: 'non-scaling'
    }),
    iconBox: Object.freeze(input.iconBox ?? CARD_ICON_BOX),
    contentBox: Object.freeze(input.contentBox ?? CARD_CONTENT_BOX),
    captionPolicy: input.captionPolicy ?? 'content-box',
    semanticParts,
    roundTripVerified: input.roundTripVerified ?? true,
    defaultBounds: Object.freeze(input.defaultBounds ?? { width: 100, height: 60 }),
    ports: Object.freeze(input.ports ?? standardPorts()),
    drawing
  })
}

/**
 * The accent "top strip" spans the card's full width, independent of the per-family band width.
 * Only its outer corners (top-left, top-right) sit on the card's true perimeter and follow the
 * same `CARD_CORNER_RADIUS` curve as the surface rect beneath it — its bottom edge is an interior
 * seam against the caption area and stays square (fixplan §4.3: "do not round the inner edge").
 */
function cardTopStripPath(): string {
  const r = CARD_CORNER_RADIUS
  const left = 0.75
  const top = 0.75
  const right = 99.25
  const bottom = 3.75
  return (
    `M ${left + r} ${top} L ${right - r} ${top} A ${r} ${r} 0 0 1 ${right} ${top + r} ` +
    `L ${right} ${bottom} L ${left} ${bottom} L ${left} ${top + r} ` +
    `A ${r} ${r} 0 0 1 ${left + r} ${top} Z`
  )
}

/**
 * The accent "left band" spans the card's full height at the family's `bandWidth`. Only its outer
 * corners (top-left, bottom-left) follow the card's rounded perimeter — its right edge (where it
 * meets the white caption area) is an interior seam and stays square.
 */
function cardLeftBandPath(bandWidth: number): string {
  const r = CARD_CORNER_RADIUS
  const left = 0.75
  const top = 0.75
  const right = left + bandWidth
  const bottom = 59.25
  return (
    `M ${left + r} ${top} L ${right} ${top} L ${right} ${bottom} L ${left + r} ${bottom} ` +
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r} L ${left} ${top + r} ` +
    `A ${r} ${r} 0 0 1 ${left + r} ${top} Z`
  )
}

function cardGroups(
  accent: string,
  iconElements: readonly ArisDrawingElement[],
  bandWidth: number
): DrawingGroup[] {
  return [
    {
      id: 'surface',
      scale: 'stretch',
      paintRole: 'none',
      elements: [
        rect(0.75, 0.75, 98.5, 58.5, {
          fill: WHITE,
          stroke: OUTLINE,
          strokeWidth: 1.5,
          rx: CARD_CORNER_RADIUS,
          ry: CARD_CORNER_RADIUS
        })
      ]
    },
    {
      id: 'accent',
      scale: 'stretch',
      paintRole: 'accent',
      elements: [
        path(cardTopStripPath(), { fill: accent, stroke: 'none', strokeWidth: 0 }),
        path(cardLeftBandPath(bandWidth), { fill: accent, stroke: 'none', strokeWidth: 0 })
      ]
    },
    {
      id: 'icon',
      scale: 'uniform',
      paintRole: 'none',
      elements: iconElements
    }
  ]
}

function personIcon(): readonly ArisDrawingElement[] {
  // Wave 9 P9 (fixplan §4.5): the original ARIS role/person glyph is a filled-white
  // head-and-shoulders BUST silhouette (a round head over a wide rounded shoulder cap),
  // not a geometric circle-plus-slab. The head stays a `circle` primitive so the
  // renderer.dmt person test can still measure its radius.
  return [
    circle(13, 20, 4.3, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
    path('M 5 43 C 5 34 8.5 30.5 13 30.5 C 17.5 30.5 21 34 21 43 Z', {
      fill: WHITE,
      stroke: 'none',
      strokeWidth: 0
    })
  ]
}

function multiPersonIcon(centers: readonly number[]): readonly ArisDrawingElement[] {
  const elements: ArisDrawingElement[] = []
  for (const cx of centers) {
    elements.push(circle(cx, 22, 2.8, { fill: WHITE, stroke: 'none', strokeWidth: 0 }))
    elements.push(
      path(`M ${cx - 4} 37 C ${cx - 4} 30 ${cx + 4} 30 ${cx + 4} 37 Z`, {
        fill: WHITE,
        stroke: 'none',
        strokeWidth: 0
      })
    )
  }
  return elements
}

function iconGeometry(icon: DmtIconId): readonly ArisDrawingElement[] {
  switch (icon) {
    case 'double-chevron':
      // Wave 9 P4 (fixplan §4.3): the original badge is two SMALL FILLED fast-forward triangles
      // (≈half the size of the old 6-point chevron-arrow polygons this replaces), calibrated
      // against `cmp-zoom-funcbadge.png`. Exactly 2 polygons — renderer.dmt.test.ts pins the count.
      return [
        polygon([
          { x: 6, y: 24 },
          { x: 12, y: 30 },
          { x: 6, y: 36 }
        ]),
        polygon([
          { x: 13, y: 24 },
          { x: 19, y: 30 },
          { x: 13, y: 36 }
        ])
      ]
    case 'application-window':
      // Wave 9 P9 (fixplan §4.2): ST_APPL_SYS = filled-white window with a title bar carrying
      // three dots (top-right) and a small circle badge at the bottom-right corner — NO arrow
      // (that is the ST_SYS_FUNC_ACT split below). The first rect stays a 16×23 window so the
      // renderer.dmt window-ratio pin holds. Verified vs orig-1.png (UAE Pass / TAMM satellites).
      return [
        rect(5, 17, 16, 23, { fill: 'none', stroke: WHITE, strokeWidth: 1.8 }),
        line(5, 22, 21, 22, { strokeWidth: 1.8 }),
        circle(14, 19.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(16.6, 19.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(19.2, 19.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(20, 39, 2.3, { fill: WHITE, stroke: 'none', strokeWidth: 0 })
      ]
    case 'application-window-down':
      // Wave 9 P9 (fixplan §4.2): ST_SYS_FUNC_ACT = the same window + title dots, but with a
      // DOWN-arrow dropping into a small tray bracket (a "download" glyph) instead of the badge.
      // This is the NEW icon that keeps the system-function distinct from the application system.
      return [
        rect(4, 15, 15, 15, { fill: 'none', stroke: WHITE, strokeWidth: 1.8 }),
        line(4, 20, 19, 20, { strokeWidth: 1.8 }),
        circle(12.5, 17.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(15, 17.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(17.5, 17.5, 0.85, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        path('M 12 25 L 12 37 M 8 33 L 12 37.5 L 16 33', { strokeWidth: 2.2 }),
        path('M 7 39.5 L 7 42.5 L 17 42.5 L 17 39.5', { strokeWidth: 2.2 })
      ]
    case 'flag':
      // Wave 9 P9 (fixplan §4.1/§4.2): the event pennant = a full-height pole carrying a SMALL
      // solid waving pennant in its top third (was an oversized waving banner). Verified vs the
      // pink "Service terminated" event in orig-1.png / cmp-zoom-eventtip.png.
      return [
        line(8, 16, 8, 43, { strokeWidth: 2 }),
        path(
          'M 8 16.5 C 11 14.6 13.5 17.6 16.5 15.7 C 18.6 14.5 20 16.2 21 15.4 L 21 23.6 C 20 24.4 18.6 22.7 16.5 23.9 C 13.5 25.8 11 22.8 8 24.7 Z',
          {
            fill: WHITE,
            stroke: 'none',
            strokeWidth: 0
          }
        )
      ]
    case 'org-unit':
      return multiPersonIcon([7, 13, 19])
    case 'position':
      return [
        polygon([
          { x: 5, y: 18 },
          { x: 21, y: 18 },
          { x: 13, y: 30 }
        ]),
        polygon([
          { x: 5, y: 42 },
          { x: 21, y: 42 },
          { x: 13, y: 30 }
        ])
      ]
    case 'group':
      return [
        ...multiPersonIcon([9, 16]),
        line(5, 17, 5, 43, { strokeWidth: 1.6 }),
        path('M 5 18 L 18 21 L 5 27 Z', { fill: WHITE, stroke: 'none', strokeWidth: 0 })
      ]
    case 'committee-team':
      return [
        ...multiPersonIcon([7, 13, 19]),
        path('M 4 42 L 22 42 L 19 46 L 7 46 Z', {
          fill: WHITE,
          stroke: 'none',
          strokeWidth: 0
        })
      ]
    case 'person':
      return personIcon()
    case 'related-entity':
      return [
        ...personIcon(),
        path('M 5 15 L 5 10 L 9 10 C 12 10 12 14 9 14 L 5 14 M 9 14 L 12 17', {
          strokeWidth: 1.4
        }),
        path('M 14 10 L 14 17 L 21 17 M 14 13.5 L 19 13.5 M 14 10 L 21 10', {
          strokeWidth: 1.4
        })
      ]
    case 'business-rule':
      return [
        path('M 7 14 L 20 14 L 20 43 L 7 43 Z M 10 20 L 17 20 M 10 25 L 17 25 M 10 30 L 17 30', {
          strokeWidth: 1.7
        }),
        path('M 7 14 C 3 14 3 20 7 20 M 20 43 C 24 43 24 37 20 37', { strokeWidth: 1.7 })
      ]
    case 'business-policy':
      return [
        path('M 7 14 L 20 14 L 20 43 L 7 43 Z M 10 20 L 17 20 M 10 25 L 17 25', {
          strokeWidth: 1.7
        }),
        path('M 10 34 L 12.5 37 L 18 30', { strokeWidth: 2.2 })
      ]
    case 'service-level-shield':
    case 'law-shield':
      // Wave 9 P9 (fixplan §4.2): filled-white heraldic shield with raised shoulders and a small
      // central top NOTCH, tapering to a rounded point. Verified vs the Reference-Laws shields in
      // orig-1.png / cmp-reflaws.png. Shared by the law/SLA presentations and (P9 swap) the
      // business-rule presentation the imported law rows resolve to.
      return [
        path(
          'M 5 17 Q 7 15.8 10 16.5 Q 12 17 13 18.2 Q 14 17 16 16.5 Q 19 15.8 21 17 L 21 30 C 21 36.5 17.5 40.5 13 43 C 8.5 40.5 5 36.5 5 30 Z',
          {
            fill: WHITE,
            stroke: 'none',
            strokeWidth: 0
          }
        )
      ]
    case 'risk':
      return [
        path('M 13 13 L 23 43 L 3 43 Z', { strokeWidth: 2 }),
        line(13, 23, 13, 33, { strokeWidth: 2.4 }),
        circle(13, 38, 1.3, { fill: WHITE, stroke: 'none', strokeWidth: 0 })
      ]
    case 'measure':
      return [
        path('M 4 38 A 9 9 0 0 1 22 38 L 18 38 A 5 5 0 0 0 8 38 Z', {
          fill: WHITE,
          stroke: 'none',
          strokeWidth: 0
        }),
        line(13, 38, 19, 28, { strokeWidth: 2 })
      ]
    case 'cube':
      return [
        polygon([
          { x: 13, y: 13 },
          { x: 22, y: 20 },
          { x: 13, y: 27 },
          { x: 4, y: 20 }
        ]),
        path('M 4 20 L 4 35 L 13 43 L 13 27 Z M 22 20 L 22 35 L 13 43 L 13 27', {
          fill: 'none',
          strokeWidth: 1.7
        })
      ]
    case 'data-entity':
    case 'entity-type':
      // Wave 9 P9 (fixplan §4.2): every ST_ENT_TYPE occurrence (Owner Registration Number,
      // Economy License Details) resolves to this art — the original is a CARD (behind, upper
      // right) with a filled price-TAG (front, lower left, pointed right, eyelet hole), NOT the
      // stacked-boxes glyph that read as a printer. Verified vs orig-1.png. The eyelet is punched
      // with an opposite-wound subpath (nonzero fill rule); if it fails to punch the tag simply
      // renders solid — still reads as a tag.
      return [
        rect(9.5, 14, 11.5, 12, { fill: 'none', stroke: WHITE, strokeWidth: 1.6 }),
        path(
          'M 4 27 L 13.5 27 L 17.5 32 L 13.5 37 L 4 37 Z M 14.1 32 A 1.1 1.1 0 1 0 11.9 32 A 1.1 1.1 0 1 0 14.1 32 Z',
          { fill: WHITE, stroke: 'none', strokeWidth: 0 }
        )
      ]
    case 'requirement':
      return [
        path(
          'M 7 43 L 7 28 C 7 25 10 25 10 28 L 10 20 C 10 17 13 17 13 20 L 13 28 L 15 19 C 16 16 19 17 18 20 L 17 29 L 20 23 C 22 21 24 23 22 26 L 19 37 C 18 42 13 45 7 43 Z',
          {
            fill: WHITE,
            stroke: 'none',
            strokeWidth: 0
          }
        )
      ]
    case 'information':
      return [
        circle(13, 29, 10, { strokeWidth: 1.7 }),
        circle(13, 23, 1.4, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        line(13, 28, 13, 36, { strokeWidth: 2.4 })
      ]
    case 'document':
      return [
        path(
          'M 6 14 L 17 14 L 22 20 L 22 44 L 6 44 Z M 17 14 L 17 20 L 22 20 M 9 26 L 19 26 M 9 31 L 19 31 M 9 36 L 17 36',
          {
            strokeWidth: 1.5
          }
        )
      ]
    case 'email':
      // Wave 9 P9 (fixplan §4.2): ST_EMAIL_1 = envelope (body + flap V) with an @ badge at the
      // bottom-right. Verified vs the grey "E-mail" satellite in orig-1.png.
      return [
        rect(4, 18, 16, 13, { fill: 'none', stroke: WHITE, strokeWidth: 1.6 }),
        path('M 4.5 18.5 L 12 25 L 19.5 18.5', { strokeWidth: 1.6 }),
        circle(17.5, 34.5, 4.3, { fill: 'none', stroke: WHITE, strokeWidth: 1.5 }),
        circle(17.5, 34.5, 1.6, { fill: 'none', stroke: WHITE, strokeWidth: 1.2 }),
        path('M 19.1 34.5 C 19.1 37 21.8 36.8 21.8 34 C 21.8 30.8 19 30 17 31', {
          strokeWidth: 1.2
        })
      ]
    case 'mobile':
      // Wave 9 P9 (fixplan §4.2): ST_INFO_CARR_HANDY = filled-white smartphone — a chunky white
      // bezel (thick-stroked rounded rect) whose accent screen shows through, with a top speaker
      // slit and a bottom home button. Verified vs the grey "SMS" satellite in orig-1.png.
      return [
        rect(8.5, 13, 9, 31, { fill: 'none', stroke: WHITE, strokeWidth: 2.4, rx: 2, ry: 2 }),
        line(11, 16.5, 15.5, 16.5, { strokeWidth: 1.3 }),
        line(11.5, 40.5, 14.5, 40.5, { strokeWidth: 1.6 })
      ]
    case 'log':
      return [
        path('M 5 14 L 16 14 L 22 20 L 22 44 L 5 44 Z M 16 14 L 16 20 L 22 20', {
          strokeWidth: 1.4
        }),
        rect(7, 19, 5, 6, { fill: 'none', stroke: WHITE, strokeWidth: 1.2 }),
        line(8, 30, 19, 30, { strokeWidth: 1.2 }),
        line(8, 35, 19, 35, { strokeWidth: 1.2 }),
        line(8, 40, 17, 40, { strokeWidth: 1.2 })
      ]
    case 'aris-model':
      return [
        rect(4, 15, 8, 7, { fill: WHITE }),
        rect(15, 34, 8, 7, { fill: WHITE }),
        rect(4, 34, 8, 7, { fill: WHITE }),
        line(8, 22, 8, 29, { strokeWidth: 1.4 }),
        line(8, 29, 19, 29, { strokeWidth: 1.4 }),
        line(8, 29, 8, 34, { strokeWidth: 1.4 }),
        line(19, 29, 19, 34, { strokeWidth: 1.4 })
      ]
    case 'letter':
      return [
        rect(7, 14, 15, 21, { fill: 'none', stroke: WHITE, strokeWidth: 1.4 }),
        path('M 7 15 L 14.5 24 L 22 15', { strokeWidth: 1.4 }),
        rect(4, 23, 15, 21, { fill: 'none', stroke: WHITE, strokeWidth: 1.4 }),
        path('M 4 24 L 11.5 33 L 19 24', { strokeWidth: 1.4 })
      ]
    case 'electronic-file':
      return [
        path('M 3 21 L 10 21 L 12 17 L 22 17 L 22 43 L 3 43 Z', {
          strokeWidth: 1.7
        }),
        circle(14, 34, 4, { strokeWidth: 1.4 }),
        path('M 18 34 L 18 39', { strokeWidth: 1.4 })
      ]
    case 'unknown':
      return [path('M 8 23 C 8 15 19 15 19 23 C 19 29 13 29 13 35 M 13 41 L 13 43')]
  }
}

interface CardInput {
  readonly catalogId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly accessibleLabel: string
  readonly icon: DmtIconId
  readonly fallbackAccent: string
  readonly defaultBounds?: ArisBounds
  readonly roundTripVerified?: boolean
  readonly canonicalKey?: boolean
  /** Wave 9 P4 (fixplan §4.3): omit for the satellite width; the two function cards pass 17. */
  readonly bandWidth?: number
}

function card(input: CardInput): DmtSymbolDescriptor {
  const accent = bodyFill(input.objectType, input.symbolNum, input.fallbackAccent)
  const bandWidth = input.bandWidth ?? SATELLITE_BAND_WIDTH
  const contentBox = bandWidth === FUNCTION_BAND_WIDTH ? FUNCTION_CONTENT_BOX : CARD_CONTENT_BOX
  return describe({
    ...input,
    silhouette: 'card',
    hitPath: 'M 0.75 0.75 H 99.25 V 59.25 H 0.75 Z',
    defaultBounds: input.defaultBounds,
    iconBox: cardIconBox(bandWidth),
    contentBox,
    groups: cardGroups(accent, iconGeometry(input.icon), bandWidth)
  })
}

function eventShape(): DmtSymbolDescriptor {
  const accent = bodyFill('OT_EVT', 'ST_EV', '#edbbdc')
  // ARIS's ARIS-EPC event is a horizontal hexagon pointed *outward* on BOTH
  // sides (convex left and right), with a straight vertical pink/white divider
  // at ~25 %. The old descriptor had a concave notch on the left (final vertex
  // at x=11 pulled inward) and a chevron-pointed divider; both now mirror the
  // right point so the left edge protrudes to the tip at x=0.75 (see fidelity
  // plan §4.1).
  const outline = [
    { x: 11, y: 0.75 },
    { x: 88, y: 0.75 },
    { x: 99.25, y: 30 },
    { x: 88, y: 59.25 },
    { x: 11, y: 59.25 },
    { x: 0.75, y: 30 }
  ]
  // W docks at the convex left tip (x≈0), NW/SW at the top/bottom-left corners.
  const eventPorts: readonly ArisPort[] = Object.freeze([
    { name: 'NW', nx: 0.11, ny: 0 },
    { name: 'N', nx: 0.5, ny: 0 },
    { name: 'NE', nx: 0.88, ny: 0 },
    { name: 'E', nx: 1, ny: 0.5 },
    { name: 'SE', nx: 0.88, ny: 1 },
    { name: 'S', nx: 0.5, ny: 1 },
    { name: 'SW', nx: 0.11, ny: 1 },
    { name: 'W', nx: 0.0075, ny: 0.5 },
    { name: 'CENTER', nx: 0.5, ny: 0.5 }
  ])
  return describe({
    catalogId: 'epc.event',
    objectType: 'OT_EVT',
    symbolNum: 'ST_EV',
    labelKey: 'aris.symbol.event',
    accessibleLabel: 'Event',
    silhouette: 'event-chevron',
    icon: 'flag',
    hitPath: 'M 11 0.75 H 88 L 99.25 30 L 88 59.25 H 11 L 0.75 30 Z',
    iconBox: { x: 3, y: 7, width: 21, height: 46 },
    // Measured (fixplan §4.1 remainder): x27.5 w64.5 (centre 60%), was x29 w60.
    contentBox: { x: 27.5, y: 4, width: 64.5, height: 53 },
    ports: eventPorts,
    groups: [
      {
        id: 'surface',
        scale: 'stretch',
        paintRole: 'none',
        elements: [polygon(outline, { fill: WHITE, stroke: OUTLINE, strokeWidth: 1.5 })]
      },
      {
        id: 'accent',
        scale: 'stretch',
        paintRole: 'accent',
        elements: [
          polygon(
            [
              { x: 11, y: 0.75 },
              { x: 25, y: 0.75 },
              { x: 25, y: 59.25 },
              { x: 11, y: 59.25 },
              { x: 0.75, y: 30 }
            ],
            { fill: accent }
          )
        ]
      },
      {
        id: 'icon',
        scale: 'uniform',
        paintRole: 'none',
        elements: iconGeometry('flag')
      }
    ]
  })
}

function processInterfaceShape(): DmtSymbolDescriptor {
  const accent = bodyFill('OT_FUNC', 'ST_PRCS_IF', '#808080')
  const compactFlag = [
    line(7, 7, 7, 32, { strokeWidth: 1.8 }),
    path('M 7 8 C 11 5 15 12 20 8 L 20 21 C 15 25 11 18 7 22 Z', {
      fill: WHITE,
      stroke: 'none',
      strokeWidth: 0
    })
  ]
  return describe({
    catalogId: 'epc.process-interface',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_PRCS_IF',
    labelKey: 'aris.symbol.processInterface',
    accessibleLabel: 'Process interface',
    silhouette: 'process-interface',
    icon: 'flag',
    hitPath: 'M 0.75 0.75 H 84 L 96 20 V 41 L 86 59 H 12 L 0.75 40 Z',
    iconBox: { x: 3, y: 3, width: 20, height: 32 },
    contentBox: { x: 27, y: 3, width: 58, height: 32 },
    groups: [
      {
        id: 'silhouette',
        scale: 'stretch',
        paintRole: 'accent',
        elements: [
          polygon(
            [
              { x: 12, y: 20 },
              { x: 86, y: 20 },
              { x: 99, y: 40 },
              { x: 86, y: 59 },
              { x: 12, y: 59 },
              { x: 1, y: 40 }
            ],
            { fill: accent }
          )
        ]
      },
      {
        id: 'surface',
        scale: 'stretch',
        paintRole: 'none',
        elements: [
          polygon(
            [
              { x: 0.75, y: 0.75 },
              { x: 84, y: 0.75 },
              { x: 96, y: 19.5 },
              { x: 84, y: 38 },
              { x: 0.75, y: 38 }
            ],
            { fill: WHITE, stroke: OUTLINE, strokeWidth: 1.5 }
          )
        ]
      },
      {
        id: 'accent',
        scale: 'stretch',
        paintRole: 'accent',
        elements: [
          polygon(
            [
              { x: 0.75, y: 0.75 },
              { x: 22, y: 0.75 },
              { x: 34, y: 19.5 },
              { x: 22, y: 38 },
              { x: 0.75, y: 38 }
            ],
            { fill: accent }
          )
        ]
      },
      {
        id: 'icon',
        scale: 'uniform',
        paintRole: 'none',
        elements: compactFlag
      }
    ]
  })
}

function ruleShape(operator: DmtOperator): DmtSymbolDescriptor {
  const symbolNum =
    operator === 'AND' ? 'ST_OPR_AND_1' : operator === 'OR' ? 'ST_OPR_OR_1' : 'ST_OPR_XOR_1'
  const labelKey =
    operator === 'AND'
      ? 'aris.symbol.and'
      : operator === 'OR'
        ? 'aris.symbol.or'
        : 'aris.symbol.xor'
  // Wave 9 P3 (fixplan §4.4): the original's grey circle fills its box exactly and its X/AND/OR
  // marks are bold — pixel-measured on `cmp-gate-merge.png` (a 210px-diameter circle shows a
  // ~23.5px horizontal cross-section through each X arm well clear of the centre crossing and the
  // tip caps; perpendicular stroke width = 23.5 * sin(45°) ≈ 16.6px ≈ 7.9% of the circle's
  // diameter). Applied to the real 141-canvas-unit AnimalWF box that ratio is ≈11.2 canvas units
  // — `strokeWidth` here is a literal canvas-unit width (renderer.ts `drawPrimitive` emits
  // `primitive.strokeWidth` unscaled with `vector-effect: non-scaling-stroke`), so 11 lands in the
  // fixplan's calibrated 10–12 range. AND/OR keep their authored geometry (unowned by this lane)
  // but pick up the same stroke weight for cross-operator family consistency.
  const mark =
    operator === 'AND'
      ? [path('M 33 57 L 50 39 L 67 57', { strokeWidth: 11 })]
      : operator === 'OR'
        ? [path('M 33 41 L 50 59 L 67 41', { strokeWidth: 11 })]
        : [line(30, 30, 70, 70, { strokeWidth: 11 }), line(70, 30, 30, 70, { strokeWidth: 11 })]
  return describe({
    catalogId: `decision.${operator.toLowerCase()}`,
    objectType: 'OT_RULE',
    symbolNum,
    labelKey,
    accessibleLabel: `${operator} decision`,
    silhouette: 'operator-circle',
    icon: 'unknown',
    operator,
    // r 50 = the viewBox's own half-width, so the hit-test arc traces the same box-filling circle
    // drawn below (was r 45, one unit short of the drawn r 44 circle it was meant to describe).
    hitPath: 'M 50 0 A 50 50 0 1 1 49.999 0 Z',
    defaultBounds: { width: 80, height: 80 },
    viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
    iconBox: { x: 25, y: 25, width: 50, height: 50 },
    contentBox: { x: 0, y: 0, width: 0, height: 0 },
    captionPolicy: 'hidden',
    groups: [
      {
        id: 'silhouette',
        scale: 'uniform',
        paintRole: 'accent',
        elements: [
          // r 44 -> 50: the circle now fills the box exactly (matches the original) instead of
          // stopping 6 units short of it; connections dock to the rectangular shape path
          // (renderer.ts `getShapePath`), so this also closes the visible arrow-to-circle gap.
          circle(50, 50, 50, {
            fill: bodyFill('OT_RULE', symbolNum, '#5e5e5e'),
            stroke: 'none',
            strokeWidth: 0
          })
        ]
      },
      { id: 'operator', scale: 'uniform', paintRole: 'none', elements: mark }
    ]
  })
}

function valueChainShape(start: boolean): DmtSymbolDescriptor {
  const catalogId = start ? 'vacd.start-chain' : 'vacd.successor-chain'
  const outer = start
    ? [
        { x: 0.75, y: 0.75 },
        { x: 88, y: 0.75 },
        { x: 99.25, y: 30 },
        { x: 88, y: 59.25 },
        { x: 0.75, y: 59.25 }
      ]
    : [
        { x: 0.75, y: 0.75 },
        { x: 88, y: 0.75 },
        { x: 99.25, y: 30 },
        { x: 88, y: 59.25 },
        { x: 0.75, y: 59.25 },
        { x: 12, y: 30 }
      ]
  const accentShape = start
    ? [
        { x: 0.75, y: 0.75 },
        { x: 24, y: 0.75 },
        { x: 35, y: 30 },
        { x: 24, y: 59.25 },
        { x: 0.75, y: 59.25 }
      ]
    : [
        { x: 0.75, y: 0.75 },
        { x: 24, y: 0.75 },
        { x: 35, y: 30 },
        { x: 24, y: 59.25 },
        { x: 0.75, y: 59.25 },
        { x: 12, y: 30 }
      ]
  const accent = bodyFill('OT_FUNC', 'ST_VAL_ADD_CHN_SML_1', '#298a25')
  return describe({
    catalogId,
    modelType: 'MT_VAL_ADD_CHN_DGM',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_VAL_ADD_CHN_SML_1',
    labelKey: start ? 'aris.symbol.valueAddedChainStart' : 'aris.symbol.valueAddedChain',
    accessibleLabel: start ? 'Start value-added chain' : 'Successor value-added chain',
    silhouette: start ? 'value-chain-start' : 'value-chain-successor',
    icon: 'double-chevron',
    hitPath: start
      ? 'M 0.75 0.75 H 88 L 99.25 30 L 88 59.25 H 0.75 Z'
      : 'M 0.75 0.75 H 88 L 99.25 30 L 88 59.25 H 0.75 L 12 30 Z',
    iconBox: { x: 3, y: 7, width: 21, height: 46 },
    contentBox: { x: 29, y: 4, width: 60, height: 53 },
    ports: chevronPorts(start ? 0 : 0.12),
    roundTripVerified: !start,
    canonicalKey: !start,
    groups: [
      {
        id: 'surface',
        scale: 'stretch',
        paintRole: 'none',
        elements: [polygon(outer, { fill: WHITE, stroke: OUTLINE, strokeWidth: 1.5 })]
      },
      {
        id: 'accent',
        scale: 'stretch',
        paintRole: 'accent',
        elements: [polygon(accentShape, { fill: accent })]
      },
      {
        id: 'icon',
        scale: 'uniform',
        paintRole: 'none',
        elements: iconGeometry('double-chevron')
      }
    ]
  })
}

export const ARIS_SYMBOL_DESCRIPTORS: readonly DmtSymbolDescriptor[] = Object.freeze([
  card({
    catalogId: 'epc.function',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_FUNC',
    labelKey: 'aris.symbol.function',
    accessibleLabel: 'Function',
    icon: 'double-chevron',
    fallbackAccent: '#339933',
    defaultBounds: { width: 100, height: 70 },
    bandWidth: FUNCTION_BAND_WIDTH
  }),
  card({
    catalogId: 'epc.system-function',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_SYS_FUNC_ACT',
    labelKey: 'aris.symbol.systemFunction',
    accessibleLabel: 'System function',
    icon: 'application-window-down',
    fallbackAccent: '#339933',
    defaultBounds: { width: 100, height: 70 },
    bandWidth: FUNCTION_BAND_WIDTH
  }),
  processInterfaceShape(),
  eventShape(),
  ruleShape('AND'),
  ruleShape('XOR'),
  ruleShape('OR'),
  valueChainShape(false),
  valueChainShape(true),
  card({
    catalogId: 'organization.org-unit',
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.organizationalUnit',
    accessibleLabel: 'Organizational unit',
    icon: 'org-unit',
    fallbackAccent: '#ff9e00'
  }),
  card({
    catalogId: 'organization.position',
    objectType: 'OT_POS',
    symbolNum: 'ST_POS',
    labelKey: 'aris.symbol.position',
    accessibleLabel: 'Position',
    icon: 'position',
    fallbackAccent: '#f9b600'
  }),
  card({
    catalogId: 'organization.group',
    objectType: 'OT_GRP',
    symbolNum: 'ST_GRP_1',
    labelKey: 'aris.symbol.group',
    accessibleLabel: 'Group',
    icon: 'group',
    fallbackAccent: '#a17220'
  }),
  card({
    catalogId: 'organization.committee-team',
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.committeeTeam',
    accessibleLabel: 'Committee or team',
    icon: 'committee-team',
    fallbackAccent: '#996600',
    roundTripVerified: false,
    canonicalKey: false
  }),
  card({
    catalogId: 'organization.role',
    objectType: 'OT_PERS_TYPE',
    symbolNum: 'ST_EMPL_TYPE',
    labelKey: 'aris.symbol.personType',
    accessibleLabel: 'Role',
    icon: 'person',
    fallbackAccent: '#e19f2d'
  }),
  card({
    catalogId: 'organization.external-person',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.externalPerson',
    accessibleLabel: 'External person or entity',
    icon: 'person',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'organization.related-entity',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.relatedEntity',
    accessibleLabel: 'Related entity',
    icon: 'related-entity',
    fallbackAccent: '#c2bcae',
    roundTripVerified: false,
    canonicalKey: false
  }),
  card({
    catalogId: 'organization.internal-person',
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS',
    labelKey: 'aris.symbol.internalPerson',
    accessibleLabel: 'Internal person',
    icon: 'person',
    fallbackAccent: '#ffda33'
  }),
  card({
    catalogId: 'governance.business-rule',
    objectType: 'OT_BUSINESS_RULE',
    symbolNum: 'ST_BUSINESS_RULE',
    labelKey: 'aris.symbol.businessRule',
    accessibleLabel: 'Business rule',
    // Wave 9 P9 (fixplan §4.2): the imported Reference-Laws rows (OT_BUSINESS_RULE:ST_BUSINESS_RULE
    // occurrences — the قرار… law cards + "Animal Registration Handbook") resolve to THIS
    // presentation, and the original paints them as filled-white SHIELDS, not the scroll the old
    // `business-rule` art drew. Moved the shared shield art (`law-shield`) onto this presentation.
    icon: 'law-shield',
    fallbackAccent: '#d52929'
  }),
  card({
    catalogId: 'governance.business-policy',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.policy',
    accessibleLabel: 'Business policy',
    icon: 'business-policy',
    fallbackAccent: '#d52929'
  }),
  card({
    catalogId: 'governance.sla',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.sla',
    accessibleLabel: 'Service-level agreement',
    icon: 'service-level-shield',
    fallbackAccent: '#d52929',
    roundTripVerified: false,
    canonicalKey: false
  }),
  card({
    catalogId: 'governance.law-regulation',
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.lawRegulation',
    accessibleLabel: 'Law or regulation',
    icon: 'law-shield',
    fallbackAccent: '#d52929',
    roundTripVerified: false,
    canonicalKey: false
  }),
  card({
    catalogId: 'governance.risk',
    objectType: 'OT_RISK',
    symbolNum: 'ST_RISK_1',
    labelKey: 'aris.symbol.risk',
    accessibleLabel: 'Risk',
    icon: 'risk',
    fallbackAccent: '#b10000'
  }),
  card({
    catalogId: 'performance.measure',
    objectType: 'OT_PERF',
    symbolNum: 'ST_PERFORM',
    labelKey: 'aris.symbol.performance',
    accessibleLabel: 'Measure or KPI',
    icon: 'measure',
    fallbackAccent: '#1c7ca7'
  }),
  card({
    catalogId: 'service.product-service',
    objectType: 'OT_SERVICE',
    symbolNum: 'ST_SERVICE',
    labelKey: 'aris.symbol.productService',
    accessibleLabel: 'Product or service',
    icon: 'cube',
    fallbackAccent: '#78684a'
  }),
  card({
    catalogId: 'technology.application-system',
    objectType: 'OT_APPL_SYS',
    symbolNum: 'ST_APPL_SYS',
    labelKey: 'aris.symbol.applicationSystem',
    accessibleLabel: 'Application system',
    icon: 'application-window',
    fallbackAccent: '#0a568a'
  }),
  card({
    catalogId: 'data.data-entity',
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.dataEntity',
    accessibleLabel: 'Data entity',
    icon: 'data-entity',
    fallbackAccent: '#cc3300'
  }),
  card({
    catalogId: 'data.entity-type',
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.entityType',
    accessibleLabel: 'Entity type',
    icon: 'entity-type',
    fallbackAccent: '#cc3300',
    roundTripVerified: false,
    canonicalKey: false
  }),
  card({
    catalogId: 'data.requirement',
    objectType: 'OT_REQUIREMENT',
    symbolNum: 'ST_REQUIREMENT',
    labelKey: 'aris.symbol.requirement',
    accessibleLabel: 'Requirement',
    icon: 'requirement',
    fallbackAccent: '#f7d5d5'
  }),
  card({
    catalogId: 'information.generic',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_1',
    labelKey: 'aris.symbol.infoCarrier',
    accessibleLabel: 'Generic information carrier',
    icon: 'information',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.document',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_DOC',
    labelKey: 'aris.symbol.document',
    accessibleLabel: 'Document',
    icon: 'document',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.email',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_EMAIL_1',
    labelKey: 'aris.symbol.email',
    accessibleLabel: 'E-mail',
    icon: 'email',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.sms',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_HANDY',
    labelKey: 'aris.symbol.mobile',
    accessibleLabel: 'SMS',
    icon: 'mobile',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.log',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LOG',
    labelKey: 'aris.symbol.log',
    accessibleLabel: 'Log',
    icon: 'log',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.aris-model',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'DMT_UNVERIFIED_ARIS_MODEL',
    labelKey: 'aris.symbol.infoCarrier',
    accessibleLabel: 'ARIS model carrier',
    icon: 'aris-model',
    fallbackAccent: '#aaaaaa',
    roundTripVerified: false
  }),
  card({
    catalogId: 'information.letter',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LETTER',
    labelKey: 'aris.symbol.letter',
    accessibleLabel: 'Letter',
    icon: 'letter',
    fallbackAccent: '#aaaaaa'
  }),
  card({
    catalogId: 'information.electronic-file',
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_EDOC',
    labelKey: 'aris.symbol.eDocument',
    accessibleLabel: 'Electronic file or folder',
    icon: 'electronic-file',
    fallbackAccent: '#999999'
  })
])

export const DMT_SYMBOL_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    ARIS_SYMBOL_DESCRIPTORS.map((descriptor) => [
      descriptor.catalogId,
      [
        descriptor.catalogId,
        descriptor.silhouette,
        descriptor.icon,
        descriptor.operator ?? '-',
        descriptor.hitPath,
        descriptor.drawing.elements.length
      ].join('|')
    ])
  )
)

export function isDmtSymbolDescriptor(
  descriptor: ArisSymbolDescriptor
): descriptor is DmtSymbolDescriptor {
  return 'catalogId' in descriptor && 'semanticParts' in descriptor
}

/** Mapping from source object type to the verified imported/default presentation. */
export const ARIS_OBJECT_TYPE_DEFAULT_SYMBOL: Readonly<Record<string, string>> = Object.freeze({
  OT_FUNC: 'ST_FUNC',
  OT_EVT: 'ST_EV',
  OT_RULE: 'ST_OPR_AND_1',
  OT_ENT_TYPE: 'ST_ENT_TYPE',
  OT_INFO_CARR: 'ST_INFO_CARR_EDOC',
  OT_BUSINESS_RULE: 'ST_BUSINESS_RULE',
  OT_PERF: 'ST_PERFORM',
  OT_APPL_SYS: 'ST_APPL_SYS',
  OT_PERS: 'ST_PERS_EXT',
  OT_REQUIREMENT: 'ST_REQUIREMENT',
  OT_POLICY: 'ST_BUSINESS_POLICY',
  OT_PERS_TYPE: 'ST_EMPL_TYPE',
  OT_ORG_UNIT: 'ST_ORG_UNIT_1',
  OT_POS: 'ST_POS',
  OT_GRP: 'ST_GRP_1',
  OT_RISK: 'ST_RISK_1',
  OT_SERVICE: 'ST_SERVICE'
})
