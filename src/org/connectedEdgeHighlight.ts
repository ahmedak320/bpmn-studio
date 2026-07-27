/**
 * Paint the edges connected to the single selected BPMN activity on an upper
 * canvas layer. The stock connection graphics stay untouched: re-rendering a
 * highlighted copy above the diagram also keeps shared/overlapping routed
 * segments visible.
 */

import { isActivityType } from './decorExtents'
import { PALETTE } from './palette'

export const CONNECTED_EDGE_HIGHLIGHT_LAYER = 'orbitpm-connected-edge-highlights'
export const CONNECTED_EDGE_HIGHLIGHT_LAYER_INDEX = 1
export const CONNECTED_EDGE_HIGHLIGHT_WIDTH = 4
export const CONNECTED_EDGE_HIGHLIGHT_COLORS = Object.freeze([
  PALETTE.edgeHighlightStroke,
  '#db2777',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2'
] as const)

const OVERLAP_DASH_PATTERNS = Object.freeze([
  '',
  '10 6',
  '3 5',
  '14 5 3 5',
  '7 4 2 4',
  '2 3'
] as const)

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface ConnectedEdgeLike {
  id?: unknown
  waypoints?: unknown
  [key: string]: unknown
}

interface ActivityBusinessObjectLike {
  $instanceOf?: (type: string) => boolean
}

export interface ConnectedActivityLike {
  type?: unknown
  businessObject?: ActivityBusinessObjectLike | null
  incoming?: readonly ConnectedEdgeLike[] | null
  outgoing?: readonly ConnectedEdgeLike[] | null
  waypoints?: unknown
  labelTarget?: unknown
}

interface SelectionChangedEventLike {
  newSelection?: unknown
}

interface EventBusLike {
  on(event: string, callback: (event?: unknown) => void): void
}

interface SelectionLike {
  get(): unknown[]
}

interface CanvasLike {
  getLayer(name: string, index?: number): SVGElement
}

interface GraphicsFactoryLike {
  drawConnection(
    parentGfx: SVGElement,
    connection: ConnectedEdgeLike,
    attrs?: Record<string, unknown>
  ): SVGElement | null | undefined
}

function isActivityElement(value: unknown): value is ConnectedActivityLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as ConnectedActivityLike

  // These diagram-js traits identify connections and external labels even if
  // a malformed/custom element happens to expose an activity-looking type.
  if (candidate.waypoints != null || candidate.labelTarget != null) return false

  const businessObject = candidate.businessObject
  if (typeof businessObject?.$instanceOf === 'function') {
    try {
      if (businessObject.$instanceOf('bpmn:Activity')) return true
    } catch {
      // Structural type fallback below keeps the pure helper safe for fakes
      // and partially hydrated elements.
    }
  }

  return typeof candidate.type === 'string' && isActivityType(candidate.type)
}

function appendUniqueEdges(
  result: ConnectedEdgeLike[],
  candidates: readonly ConnectedEdgeLike[] | null | undefined,
  seenIds: Set<string>,
  seenObjects: Set<object>
): void {
  if (!Array.isArray(candidates)) return

  for (const edge of candidates) {
    if (!edge || typeof edge !== 'object') continue

    const id = typeof edge.id === 'string' ? edge.id : undefined
    if (id ? seenIds.has(id) : seenObjects.has(edge)) continue

    if (id) seenIds.add(id)
    seenObjects.add(edge)
    result.push(edge)
  }
}

/**
 * Return the stable incoming-then-outgoing union for exactly one selected
 * activity. Empty, multiple, connection, label, event, gateway, and root
 * selections intentionally return no edges. IDs deduplicate self-loops even
 * when a caller supplies distinct wrapper objects for the same connection.
 */
export function connectedEdgesForSelection(
  selection: readonly unknown[] | null | undefined
): ConnectedEdgeLike[] {
  if (!Array.isArray(selection) || selection.length !== 1) return []
  const activity = selection[0]
  if (!isActivityElement(activity)) return []

  const edges: ConnectedEdgeLike[] = []
  const seenIds = new Set<string>()
  const seenObjects = new Set<object>()
  appendUniqueEdges(edges, activity.incoming, seenIds, seenObjects)
  appendUniqueEdges(edges, activity.outgoing, seenIds, seenObjects)
  return edges
}

function makeHighlightWrapper(edge: ConnectedEdgeLike): SVGElement {
  const wrapper = document.createElementNS(SVG_NS, 'g')
  wrapper.setAttribute('class', 'orbitpm-connected-edge-highlight')
  wrapper.setAttribute('data-org-connected-edge-highlight', 'true')
  wrapper.setAttribute('data-edge-id', typeof edge.id === 'string' ? edge.id : '')
  wrapper.setAttribute('pointer-events', 'none')
  wrapper.setAttribute('aria-hidden', 'true')
  return wrapper
}

function routePointAt(edge: ConnectedEdgeLike, fraction: number): { x: number; y: number } | null {
  if (!Array.isArray(edge.waypoints)) return null
  const points = edge.waypoints.filter((value): value is { x: number; y: number } =>
    Boolean(
      value &&
      typeof value === 'object' &&
      Number.isFinite((value as { x?: number }).x) &&
      Number.isFinite((value as { y?: number }).y)
    )
  )
  if (points.length < 2) return null
  const lengths: number[] = []
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    )
    lengths.push(length)
    total += length
  }
  if (total <= 0) return null
  let remaining = total * Math.max(0, Math.min(1, fraction))
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (remaining <= length || index === lengths.length - 1) {
      const ratio = length > 0 ? remaining / length : 0
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio
      }
    }
    remaining -= length
  }
  return null
}

function appendIdentityBead(
  wrapper: SVGElement,
  edge: ConnectedEdgeLike,
  index: number,
  color: string
): void {
  const fraction = 0.28 + (index % 5) * 0.11
  const point = routePointAt(edge, fraction)
  if (!point) return
  const bead = document.createElementNS(SVG_NS, 'circle')
  bead.setAttribute('data-org-highlight-identity', 'true')
  bead.setAttribute('cx', String(point.x))
  bead.setAttribute('cy', String(point.y))
  bead.setAttribute('r', '3.25')
  bead.setAttribute('fill', color)
  bead.setAttribute('stroke', '#ffffff')
  bead.setAttribute('stroke-width', '1.5')
  wrapper.appendChild(bead)
}

function appendArrowMarker(
  wrapper: SVGElement,
  edge: ConnectedEdgeLike,
  index: number,
  color: string
): string {
  const rawId = typeof edge.id === 'string' ? edge.id : `edge-${index}`
  const markerId = `orbitpm-highlight-arrow-${rawId}-${index}`.replace(/[^A-Za-z0-9_.:-]/g, '_')
  const defs = document.createElementNS(SVG_NS, 'defs')
  const marker = document.createElementNS(SVG_NS, 'marker')
  marker.setAttribute('id', markerId)
  marker.setAttribute('viewBox', '0 0 20 20')
  marker.setAttribute('refX', '11')
  marker.setAttribute('refY', '10')
  marker.setAttribute('markerWidth', '10')
  marker.setAttribute('markerHeight', '10')
  marker.setAttribute('orient', 'auto')
  const arrow = document.createElementNS(SVG_NS, 'path')
  arrow.setAttribute('d', 'M 1 5 L 11 10 L 1 15 Z')
  arrow.setAttribute('fill', color)
  arrow.setAttribute('stroke', color)
  arrow.setAttribute('stroke-width', '1')
  marker.appendChild(arrow)
  defs.appendChild(marker)
  wrapper.appendChild(defs)
  return markerId
}

/**
 * bpmn-js DI service. Selection events use their event snapshot; model/route
 * events query the selection service again so reconnects, waypoint changes,
 * undo/redo, and imports repaint from live element geometry.
 */
export class ConnectedEdgeHighlight {
  static $inject = ['eventBus', 'canvas', 'graphicsFactory', 'selection']

  private readonly canvas: CanvasLike
  private readonly graphicsFactory: GraphicsFactoryLike
  private readonly selection: SelectionLike
  private wrappers: SVGElement[] = []

  constructor(
    eventBus: EventBusLike,
    canvas: CanvasLike,
    graphicsFactory: GraphicsFactoryLike,
    selection: SelectionLike
  ) {
    this.canvas = canvas
    this.graphicsFactory = graphicsFactory
    this.selection = selection

    eventBus.on('selection.changed', (event) => {
      const next = (event as SelectionChangedEventLike | undefined)?.newSelection
      this.refresh(Array.isArray(next) ? next : this.readSelection())
    })
    eventBus.on('commandStack.changed', () => this.refresh())
    eventBus.on('import.done', () => this.refresh())
    eventBus.on('diagram.clear', () => this.clear())
  }

  /** Repaint from an explicit event snapshot or the current selection. */
  refresh(selection: readonly unknown[] = this.readSelection()): void {
    this.clear()
    const edges = connectedEdgesForSelection(selection)
    if (edges.length === 0) return

    let layer: SVGElement
    try {
      layer = this.canvas.getLayer(
        CONNECTED_EDGE_HIGHLIGHT_LAYER,
        CONNECTED_EDGE_HIGHLIGHT_LAYER_INDEX
      )
      layer.setAttribute('data-org-connected-edge-highlights', 'true')
      layer.setAttribute('pointer-events', 'none')
      layer.setAttribute('aria-hidden', 'true')
    } catch {
      return
    }

    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index]
      const wrapper = makeHighlightWrapper(edge)
      const color = CONNECTED_EDGE_HIGHLIGHT_COLORS[index % CONNECTED_EDGE_HIGHLIGHT_COLORS.length]
      const dash = OVERLAP_DASH_PATTERNS[index % OVERLAP_DASH_PATTERNS.length]
      wrapper.setAttribute('data-highlight-color', color)
      wrapper.setAttribute('data-highlight-pattern', dash || 'solid')
      try {
        layer.appendChild(wrapper)
        const path = this.graphicsFactory.drawConnection(wrapper, edge, {
          stroke: color,
          strokeWidth: CONNECTED_EDGE_HIGHLIGHT_WIDTH
        })
        // BpmnRenderer puts stroke-width in an inline style, which has
        // precedence over a presentation attribute. Append authoritative inline
        // declarations and mark the actual route so tests/assistive tooling do
        // not confuse it with marker-definition paths.
        if (path) {
          path.setAttribute('data-org-highlight-route', 'true')
          const markerId = appendArrowMarker(wrapper, edge, index, color)
          path.setAttribute('marker-end', `url(#${markerId})`)
          const existing = path.getAttribute('style') ?? ''
          path.setAttribute(
            'style',
            `${existing};stroke:${color} !important;` +
              `stroke-width:${CONNECTED_EDGE_HIGHLIGHT_WIDTH}px !important;` +
              (dash ? `stroke-dasharray:${dash} !important;stroke-dashoffset:${index * 2}px;` : '')
          )
          path.setAttribute('stroke-width', String(CONNECTED_EDGE_HIGHLIGHT_WIDTH))
        }
        appendIdentityBead(wrapper, edge, index, color)
        this.wrappers.push(wrapper)
      } catch {
        wrapper.remove()
      }
    }
  }

  /** Remove only visuals owned by this service; never mutate stock edges. */
  clear(): void {
    for (const wrapper of this.wrappers) {
      try {
        wrapper.remove()
      } catch {
        /* already detached by a canvas clear */
      }
    }
    this.wrappers = []
  }

  private readSelection(): unknown[] {
    try {
      const selected = this.selection.get()
      return Array.isArray(selected) ? selected : []
    } catch {
      return []
    }
  }
}

export const ConnectedEdgeHighlightModule: {
  __init__: string[]
  connectedEdgeHighlight: [string, typeof ConnectedEdgeHighlight]
} = {
  __init__: ['connectedEdgeHighlight'],
  connectedEdgeHighlight: ['type', ConnectedEdgeHighlight]
}
