/**
 * The DMT bottom legend — a catalog-driven symbol sheet plus the RACI key
 * (plan Wave 6, V5+: "the bottom legend block … + the RACI legend").
 *
 * The paired AnimalWF PDFs stamp this block from an embedded OLE image. That
 * image is out of this lane's scope (safe OLE decode is a named TODO in
 * `printFrame.ts`), so the legend is composed here from the convention
 * catalog instead: the same 19 presentations the DMT sheet lists, in the
 * sheet's own column arrangement, each drawn from its shared symbol
 * descriptor — never from palette widget artwork (plan: "Do not reconstruct
 * this particular imported legend from current palette widgets"; descriptors
 * are the shared contract, widgets are not).
 *
 * Symbol names come from the registered `aris.symbol.*` dictionaries in both
 * languages, mirroring the sheet's Arabic-over-English pairing; RACI row
 * labels go through `arisPrintFrameText` so registration is mechanical.
 *
 * This module is deliberately self-contained: it reads descriptors and the
 * i18n dictionaries but imports nothing from `renderer.ts`, so the renderer
 * can orchestrate the print frame without an import cycle.
 */

import { ar, en } from '../../i18n/dictionaries'
import type { Key } from '../../i18n'
import { conventionSymbolByCatalogId } from '../conventions/catalog'
import { isDmtSymbolDescriptor, resolveArisCatalogSymbol } from '../symbols'
import type { ArisDrawingElement, ArisSymbolDescriptor } from '../symbols/types'
import { arisPrintFrameText, type ArisPrintFrameMessageKey } from './printFrameI18n'
import { svgAppend, svgElement } from './svg'

export interface PrintFrameRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One symbol cell of the legend: what to draw and its bilingual caption. */
export interface ArisLegendTile {
  readonly catalogId: string
  readonly nameEn: string
  readonly nameAr: string
  readonly bounds: PrintFrameRect
}

/** One row of the RACI key: the badge letter and its label. */
export interface ArisLegendRaciRow {
  readonly letter: 'R' | 'A' | 'C' | 'I'
  readonly label: string
}

/** The laid-out legend: symbol tiles plus the RACI key block. */
export interface ArisLegendModel {
  readonly bounds: PrintFrameRect
  readonly tiles: readonly ArisLegendTile[]
  readonly raci: {
    readonly bounds: PrintFrameRect
    readonly rows: readonly ArisLegendRaciRow[]
  }
}

/**
 * The DMT legend set, in the reference sheet's column arrangement (left to
 * right, top to bottom inside a column): Event; the process interfaces and
 * functions; the information carriers; systems and data; organization; and
 * governance with Service. 19 presentations, per the lane contract.
 */
const LEGEND_COLUMNS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['epc.event']),
  Object.freeze(['epc.process-interface', 'epc.function', 'epc.system-function']),
  Object.freeze([
    'information.document',
    'information.email',
    'information.sms',
    'information.letter'
  ]),
  Object.freeze([
    'technology.application-system',
    'performance.measure',
    'data.requirement',
    'governance.risk'
  ]),
  Object.freeze([
    'organization.committee-team',
    'organization.related-entity',
    'organization.external-person',
    'organization.role'
  ]),
  Object.freeze([
    'governance.business-rule',
    'governance.law-regulation',
    'service.product-service'
  ])
])

const RACI_ROWS: readonly {
  readonly letter: 'R' | 'A' | 'C' | 'I'
  readonly labelKey: ArisPrintFrameMessageKey
}[] = Object.freeze([
  Object.freeze({ letter: 'R', labelKey: 'aris.printFrame.raci.responsible' }),
  Object.freeze({ letter: 'A', labelKey: 'aris.printFrame.raci.approval' }),
  Object.freeze({ letter: 'C', labelKey: 'aris.printFrame.raci.consulted' }),
  Object.freeze({ letter: 'I', labelKey: 'aris.printFrame.raci.informed' })
])

/** The RACI key block takes the right-most share of the legend. */
const RACI_WIDTH_RATIO = 0.22
/** Air around the legend content, as a fraction of the legend height. */
const LEGEND_INSET_RATIO = 0.08

const LEGEND_FRAME_FILL = '#ffffff'
const LEGEND_FRAME_STROKE = '#c8c8c8'
const LEGEND_TEXT_FILL = '#1a1a1a'
const LEGEND_RACI_STROKE = '#d52929'

function legendName(catalogId: string): { readonly nameEn: string; readonly nameAr: string } {
  const entry = conventionSymbolByCatalogId(catalogId)
  const key = entry?.labelKey as Key | undefined
  const nameEn = (key && en[key]) || entry?.accessibleLabel || catalogId
  const nameAr = (key && ar[key]) || ''
  return Object.freeze({ nameEn, nameAr })
}

/**
 * Lay the legend out inside `bounds`: a symbol grid on the left and the RACI
 * key on the right, cells sized from the available extent rather than fixed
 * constants so an imported 3800×622 block and a computed authored block both
 * fill their frame.
 */
export function buildArisLegend(bounds: PrintFrameRect): ArisLegendModel {
  const inset = Math.round(bounds.height * LEGEND_INSET_RATIO)
  const raciWidth = Math.round(bounds.width * RACI_WIDTH_RATIO)
  const gridX = bounds.x + inset
  const gridWidth = bounds.width - raciWidth - inset * 3
  const rows = Math.max(...LEGEND_COLUMNS.map((column) => column.length))
  const cellWidth = gridWidth / LEGEND_COLUMNS.length
  const cellHeight = (bounds.height - inset * 2) / rows

  const tiles: ArisLegendTile[] = []
  LEGEND_COLUMNS.forEach((column, columnIndex) => {
    column.forEach((catalogId, rowIndex) => {
      tiles.push(
        Object.freeze({
          ...legendName(catalogId),
          catalogId,
          bounds: Object.freeze({
            x: gridX + columnIndex * cellWidth,
            y: bounds.y + inset + rowIndex * cellHeight,
            width: cellWidth,
            height: cellHeight
          })
        })
      )
    })
  })

  return Object.freeze({
    bounds,
    tiles: Object.freeze(tiles),
    raci: Object.freeze({
      bounds: Object.freeze({
        x: gridX + gridWidth + inset,
        y: bounds.y + inset,
        width: raciWidth,
        height: bounds.height - inset * 2
      }),
      rows: Object.freeze(
        RACI_ROWS.map((row) =>
          Object.freeze({
            letter: row.letter,
            label: arisPrintFrameText(row.labelKey)
          })
        )
      )
    })
  })
}

// --- symbol painting ---------------------------------------------------------

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

function paintPrimitive(
  primitive: ArisDrawingElement,
  scale: Scale,
  part?: string
): SVGElement | null {
  const stroke = primitive.stroke ?? '#1a1a1a'
  const strokeWidth = primitive.strokeWidth ?? 1.5
  const partAttr: Readonly<Record<string, string>> =
    part === undefined ? {} : { 'data-aris-part': part }
  const fill = 'fill' in primitive ? (primitive.fill ?? 'none') : 'none'
  switch (primitive.kind) {
    case 'rect':
      return svgElement('rect', {
        x: round(mapX(scale, primitive.x)),
        y: round(mapY(scale, primitive.y)),
        width: round(primitive.width * scale.sx),
        height: round(primitive.height * scale.sy),
        ...(primitive.rx === undefined ? {} : { rx: round(primitive.rx * scale.sx) }),
        ...(primitive.ry === undefined ? {} : { ry: round(primitive.ry * scale.sy) }),
        fill,
        stroke,
        'stroke-width': strokeWidth,
        'vector-effect': 'non-scaling-stroke',
        ...partAttr
      })
    case 'circle':
      return svgElement('circle', {
        cx: round(mapX(scale, primitive.cx)),
        cy: round(mapY(scale, primitive.cy)),
        r: round(primitive.r * Math.min(scale.sx, scale.sy)),
        fill,
        stroke,
        'stroke-width': strokeWidth,
        'vector-effect': 'non-scaling-stroke',
        ...partAttr
      })
    case 'polygon':
      return svgElement('polygon', {
        points: primitive.points
          .map((point) => `${round(mapX(scale, point.x))},${round(mapY(scale, point.y))}`)
          .join(' '),
        fill,
        stroke,
        'stroke-width': strokeWidth,
        'vector-effect': 'non-scaling-stroke',
        ...partAttr
      })
    case 'line':
      return svgElement('line', {
        x1: round(mapX(scale, primitive.x1)),
        y1: round(mapY(scale, primitive.y1)),
        x2: round(mapX(scale, primitive.x2)),
        y2: round(mapY(scale, primitive.y2)),
        stroke,
        'stroke-width': strokeWidth,
        'vector-effect': 'non-scaling-stroke',
        ...partAttr
      })
    case 'path':
      return svgElement('path', {
        d: primitive.d,
        transform: `translate(${round(scale.tx * scale.sx)},${round(scale.ty * scale.sy)}) scale(${round(scale.sx)},${round(scale.sy)})`,
        fill,
        stroke,
        'stroke-width': strokeWidth,
        'vector-effect': 'non-scaling-stroke',
        ...partAttr
      })
    default:
      return null
  }
}

/**
 * One catalog presentation at a given size. The slot keeps the descriptor's
 * own aspect ratio (a uniform scale), so icons and surfaces stay proportional
 * without any occurrence paint — the canonical catalog appearance the sheet
 * shows. `null` when the catalog row has no resolvable descriptor.
 */
export function drawLegendSymbol(
  catalogId: string,
  width: number,
  height: number
): SVGElement | null {
  const descriptor = resolveArisCatalogSymbol(catalogId)
  if (!descriptor) return null
  // Fit the viewBox uniformly inside the slot so nothing stretches.
  const fit = scaleFor(descriptor, width, height)
  const uniform = Math.min(fit.sx, fit.sy)
  const drawnWidth = descriptor.drawing.viewBox.width * uniform
  const drawnHeight = descriptor.drawing.viewBox.height * uniform
  const scale: Scale = {
    sx: uniform,
    sy: uniform,
    tx: (width - drawnWidth) / 2 / uniform - descriptor.drawing.viewBox.minX,
    ty: (height - drawnHeight) / 2 / uniform - descriptor.drawing.viewBox.minY
  }
  const dmt = isDmtSymbolDescriptor(descriptor) ? descriptor : null
  const group = svgElement('g', {
    'data-aris-legend-symbol': catalogId,
    'data-aris-catalog-id': dmt?.catalogId ?? catalogId
  })
  descriptor.drawing.elements.forEach((primitive, index) => {
    const part = dmt?.semanticParts.find((candidate) => candidate.elementIndexes.includes(index))
    const node = paintPrimitive(primitive, scale, part?.id)
    if (node) svgAppend(group, node)
  })
  return group
}

// --- drawing -----------------------------------------------------------------

function rtlAttrs(text: string): Readonly<Record<string, string>> {
  return /\p{Script=Arabic}/u.test(text) ? { direction: 'rtl', 'unicode-bidi': 'plaintext' } : {}
}

function drawText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  options: { readonly anchor?: string; readonly bold?: boolean; readonly fill?: string } = {}
): SVGElement {
  const node = svgElement('text', {
    x: round(x),
    y: round(y),
    'text-anchor': options.anchor ?? 'middle',
    'dominant-baseline': 'middle',
    'font-size': round(fontSize),
    'font-family': 'Arial, sans-serif',
    ...(options.bold ? { 'font-weight': 'bold' } : {}),
    fill: options.fill ?? LEGEND_TEXT_FILL,
    ...rtlAttrs(text)
  })
  node.textContent = text
  return node
}

/**
 * Append the legend to `parent` in canvas coordinates: the frame, one tile per
 * catalog presentation (symbol + Arabic name above + English name below, as
 * the sheet pairs them), and the red-keyed RACI block on the right.
 */
export function drawArisLegend(parent: SVGElement, legend: ArisLegendModel): void {
  const group = svgElement('g', {
    'data-aris-print-frame-legend': 'true',
    role: 'img',
    'aria-label': arisPrintFrameText('aris.printFrame.legendAria')
  })
  svgAppend(
    group,
    svgElement('rect', {
      x: round(legend.bounds.x),
      y: round(legend.bounds.y),
      width: round(legend.bounds.width),
      height: round(legend.bounds.height),
      rx: round(legend.bounds.height / 10),
      ry: round(legend.bounds.height / 10),
      fill: LEGEND_FRAME_FILL,
      stroke: LEGEND_FRAME_STROKE,
      'stroke-width': 2
    })
  )

  for (const tile of legend.tiles) {
    const nameSize = tile.bounds.height / 3.4
    // Arabic above, English below, symbol between — the sheet's pairing.
    const symbol = drawLegendSymbol(
      tile.catalogId,
      tile.bounds.width * 0.9,
      tile.bounds.height - nameSize * 2
    )
    if (symbol) {
      symbol.setAttribute(
        'transform',
        `translate(${round(tile.bounds.x + tile.bounds.width * 0.05)},${round(tile.bounds.y + nameSize)})`
      )
      svgAppend(group, symbol)
    }
    if (tile.nameAr) {
      svgAppend(
        group,
        drawText(
          tile.nameAr,
          tile.bounds.x + tile.bounds.width / 2,
          tile.bounds.y + nameSize / 2,
          nameSize * 0.62
        )
      )
    }
    svgAppend(
      group,
      drawText(
        tile.nameEn,
        tile.bounds.x + tile.bounds.width / 2,
        tile.bounds.y + tile.bounds.height - nameSize / 2,
        nameSize * 0.62
      )
    )
  }

  const raci = legend.raci
  const raciGroup = svgElement('g', { 'data-aris-print-frame-raci': 'true' })
  svgAppend(
    raciGroup,
    svgElement('rect', {
      x: round(raci.bounds.x),
      y: round(raci.bounds.y),
      width: round(raci.bounds.width),
      height: round(raci.bounds.height),
      rx: round(raci.bounds.height / 12),
      ry: round(raci.bounds.height / 12),
      fill: 'none',
      stroke: LEGEND_RACI_STROKE,
      'stroke-width': 2
    })
  )
  const rowHeight = raci.bounds.height / (raci.rows.length + 1)
  svgAppend(
    raciGroup,
    drawText(
      'RACI',
      raci.bounds.x + raci.bounds.width / 2,
      raci.bounds.y + rowHeight / 2,
      rowHeight * 0.42,
      {
        bold: true,
        fill: LEGEND_RACI_STROKE
      }
    )
  )
  raci.rows.forEach((row, index) => {
    const cy = raci.bounds.y + rowHeight * (index + 1.5)
    svgAppend(
      raciGroup,
      drawText(row.letter, raci.bounds.x + rowHeight * 0.55, cy, rowHeight * 0.42, { bold: true })
    )
    svgAppend(
      raciGroup,
      drawText(`${row.label} :`, raci.bounds.x + rowHeight * 0.95, cy, rowHeight * 0.34, {
        anchor: 'start'
      })
    )
  })
  svgAppend(group, raciGroup)
  svgAppend(parent, group)
}
