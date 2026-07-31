import { conventionDefaultFill } from '../conventions/catalog'
import type {
  ArisBounds,
  ArisDrawingElement,
  ArisPort,
  ArisSymbolDescriptor,
  ArisSymbolDrawing,
  ArisViewBox
} from './types'

const OUTLINE = '#c4c7c9'
const WHITE = '#ffffff'
const CARD_VIEW_BOX = Object.freeze({ minX: 0, minY: 0, width: 100, height: 60 })
const CARD_ICON_BOX = Object.freeze({ x: 3, y: 7, width: 20, height: 46 })
const CARD_CONTENT_BOX = Object.freeze({ x: 27, y: 4, width: 70, height: 53 })

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

function cardGroups(accent: string, iconElements: readonly ArisDrawingElement[]): DrawingGroup[] {
  return [
    {
      id: 'surface',
      scale: 'stretch',
      paintRole: 'none',
      elements: [
        rect(0.75, 0.75, 98.5, 58.5, {
          fill: WHITE,
          stroke: OUTLINE,
          strokeWidth: 1.5
        })
      ]
    },
    {
      id: 'accent',
      scale: 'stretch',
      paintRole: 'accent',
      elements: [
        rect(0.75, 0.75, 98.5, 3, { fill: accent }),
        rect(0.75, 0.75, 25, 58.5, { fill: accent })
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
  return [
    circle(13, 21, 4, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
    path('M 7 43 C 7 33 19 33 19 43 Z', { fill: WHITE, stroke: 'none', strokeWidth: 0 })
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
      return [
        polygon([
          { x: 5, y: 18 },
          { x: 11, y: 30 },
          { x: 5, y: 42 },
          { x: 9, y: 42 },
          { x: 15, y: 30 },
          { x: 9, y: 18 }
        ]),
        polygon([
          { x: 12, y: 18 },
          { x: 18, y: 30 },
          { x: 12, y: 42 },
          { x: 16, y: 42 },
          { x: 22, y: 30 },
          { x: 16, y: 18 }
        ])
      ]
    case 'application-window':
      return [
        rect(5, 17, 16, 23, { fill: 'none', stroke: WHITE, strokeWidth: 1.8 }),
        line(5, 22, 21, 22, { strokeWidth: 1.8 }),
        circle(8, 19.5, 0.8, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        circle(11, 19.5, 0.8, { fill: WHITE, stroke: 'none', strokeWidth: 0 }),
        path('M 9 34 L 13 29 L 17 34 M 13 29 L 13 38', { strokeWidth: 1.8 })
      ]
    case 'flag':
      return [
        line(8, 17, 8, 42, { strokeWidth: 2 }),
        path('M 8 18 C 13 14 16 22 21 17 L 21 31 C 16 36 13 27 8 32 Z', {
          fill: WHITE,
          stroke: 'none',
          strokeWidth: 0
        })
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
      return [
        path('M 13 14 L 22 18 L 21 31 C 20 38 13 43 13 43 C 13 43 6 38 5 31 L 4 18 Z', {
          fill: WHITE,
          stroke: 'none',
          strokeWidth: 0
        })
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
      return [
        path('M 4 36 L 22 36 L 22 43 L 4 43 Z M 7 31 L 19 31 L 19 36 L 7 36 Z', {
          strokeWidth: 1.7
        }),
        line(8, 39.5, 17, 39.5, { strokeWidth: 1.2 })
      ]
    case 'entity-type':
      return [
        rect(4, 16, 18, 27, { fill: 'none', stroke: WHITE, strokeWidth: 1.6 }),
        line(4, 24, 22, 24, { strokeWidth: 1.4 }),
        line(10, 16, 10, 43, { strokeWidth: 1.4 })
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
      return [
        rect(4, 18, 18, 22, { fill: 'none', stroke: WHITE, strokeWidth: 1.5 }),
        path('M 4 19 L 13 29 L 22 19', { strokeWidth: 1.5 }),
        circle(17, 35, 3.5, { strokeWidth: 1.3 }),
        path('M 20.5 35 L 20.5 39', { strokeWidth: 1.3 })
      ]
    case 'mobile':
      return [
        rect(8, 13, 10, 32, { fill: 'none', stroke: WHITE, strokeWidth: 1.8, rx: 1.5, ry: 1.5 }),
        line(10, 18, 16, 18, { strokeWidth: 1.3 }),
        circle(13, 41, 1, { fill: WHITE, stroke: 'none', strokeWidth: 0 })
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
}

function card(input: CardInput): DmtSymbolDescriptor {
  const accent = bodyFill(input.objectType, input.symbolNum, input.fallbackAccent)
  return describe({
    ...input,
    silhouette: 'card',
    hitPath: 'M 0.75 0.75 H 99.25 V 59.25 H 0.75 Z',
    defaultBounds: input.defaultBounds,
    groups: cardGroups(accent, iconGeometry(input.icon))
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
    contentBox: { x: 29, y: 4, width: 60, height: 53 },
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
    fallbackAccent: '#009933',
    defaultBounds: { width: 100, height: 70 }
  }),
  card({
    catalogId: 'epc.system-function',
    objectType: 'OT_FUNC',
    symbolNum: 'ST_SYS_FUNC_ACT',
    labelKey: 'aris.symbol.systemFunction',
    accessibleLabel: 'System function',
    icon: 'application-window',
    fallbackAccent: '#009933',
    defaultBounds: { width: 100, height: 70 }
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
    icon: 'business-rule',
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
