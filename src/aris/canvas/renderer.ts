/**
 * `ArisRenderer` — draws ARIS elements from the symbol registry.
 *
 * ## Seam: `src/aris/symbols/`
 *
 * All shape geometry comes from `resolveArisSymbol({ modelType, objectType,
 * symbolNum })`. This module authors *no* geometry of its own; it only maps the
 * descriptor's `viewBox` onto the occurrence's bounds and emits the primitives
 * verbatim. The only shapes drawn here without a descriptor are the non-object
 * canvas furniture the registry does not model: lane bands, free text, external
 * captions, and the connection polyline.
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
import type { ArisDrawingElement, ArisSymbolDescriptor } from '../symbols/types'
import { arisBusinessObject, type ArisBusinessObject } from './elements'
import { svgAppend, svgElement } from './svg'

const DEFAULT_STROKE = '#334155'
const DEFAULT_FILL = '#ffffff'
const LANE_STROKE = '#94a3b8'
const FREE_TEXT_STROKE = '#cbd5e1'
const CONNECTION_STROKE = '#475569'

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
 * Re-emit one authored primitive at the occurrence's size.
 *
 * Path data is the single case the registry expresses in its own coordinate
 * space that cannot be scaled attribute-by-attribute, so the group carries the
 * scale transform and paths are emitted untouched inside it.
 */
function drawPrimitive(primitive: ArisDrawingElement, scale: Scale): SVGElement | null {
  const stroke = primitive.stroke ?? DEFAULT_STROKE
  const strokeWidth = primitive.strokeWidth ?? 1.5
  switch (primitive.kind) {
    case 'rect':
      return svgElement('rect', {
        x: round(mapX(scale, primitive.x)),
        y: round(mapY(scale, primitive.y)),
        width: round(primitive.width * scale.sx),
        height: round(primitive.height * scale.sy),
        ...(primitive.rx === undefined ? {} : { rx: round(primitive.rx * scale.sx) }),
        ...(primitive.ry === undefined ? {} : { ry: round(primitive.ry * scale.sy) }),
        fill: primitive.fill ?? DEFAULT_FILL,
        stroke,
        'stroke-width': strokeWidth
      })
    case 'circle': {
      const radius = round(primitive.r * Math.min(scale.sx, scale.sy))
      return svgElement('circle', {
        cx: round(mapX(scale, primitive.cx)),
        cy: round(mapY(scale, primitive.cy)),
        r: radius,
        fill: primitive.fill ?? DEFAULT_FILL,
        stroke,
        'stroke-width': strokeWidth
      })
    }
    case 'polygon':
      return svgElement('polygon', {
        points: primitive.points
          .map((point) => `${round(mapX(scale, point.x))},${round(mapY(scale, point.y))}`)
          .join(' '),
        fill: primitive.fill ?? DEFAULT_FILL,
        stroke,
        'stroke-width': strokeWidth
      })
    case 'line':
      return svgElement('line', {
        x1: round(mapX(scale, primitive.x1)),
        y1: round(mapY(scale, primitive.y1)),
        x2: round(mapX(scale, primitive.x2)),
        y2: round(mapY(scale, primitive.y2)),
        stroke,
        'stroke-width': strokeWidth
      })
    case 'path':
      return svgElement('path', {
        d: primitive.d,
        transform: `translate(${round(scale.tx * scale.sx)},${round(scale.ty * scale.sy)}) scale(${round(scale.sx)},${round(scale.sy)})`,
        fill: primitive.fill ?? 'none',
        stroke,
        'stroke-width': strokeWidth
      })
    default:
      return null
  }
}

function drawCaption(text: string, width: number, height: number): SVGElement {
  const node = svgElement('text', {
    x: round(width / 2),
    y: round(height / 2),
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    'font-size': 12,
    fill: '#0f172a',
    'data-aris-caption': 'true'
  })
  node.textContent = text
  return node
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
      for (const primitive of resolution.descriptor.drawing.elements) {
        const node = drawPrimitive(primitive, scale)
        if (node) svgAppend(group, node)
      }
      if (businessObject.name) {
        svgAppend(group, drawCaption(businessObject.name, shape.width, shape.height))
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
      svgAppend(group, drawCaption(businessObject.text, shape.width, shape.height))
      svgAppend(parentGfx, group)
      return group
    }

    if (businessObject.kind === 'label') {
      svgAppend(group, drawCaption(businessObject.text, shape.width, shape.height))
      svgAppend(parentGfx, group)
      return group
    }

    svgAppend(parentGfx, group)
    return group
  }

  drawConnection(parentGfx: SVGElement, connection: Connection): SVGElement {
    const line = createLine(connection.waypoints, {
      stroke: CONNECTION_STROKE,
      strokeWidth: 1.5,
      fill: 'none'
    })
    const businessObject = arisBusinessObject(connection)
    if (businessObject?.kind === 'connection') {
      line.setAttribute('data-aris-connection-type', businessObject.connectionType)
    }
    parentGfx.appendChild(line)
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
