/**
 * Diagram-wide connection adornments.
 *
 * A normal renderer sees one connection at a time, which is too early to know
 * whether that connection crosses or shares a routed prefix/suffix with
 * another connection.  This service therefore snapshots every sequence-flow
 * waypoint after import and after each command batch, delegates the geometry
 * analysis to edgeVisuals, and paints one non-interactive SVG overlay into the
 * active diagram plane.  Painting into that plane (rather than diagram-js's
 * utility overlay layer) deliberately keeps the adornments in saveSVG output.
 */

import {
  analyzeEdgeVisuals,
  type EdgeVisualAnalysis,
  type Junction,
  type Point,
  type PolylineEdge
} from './edgeVisuals'

export const CONNECTION_HOP_RADIUS = 5
export const CONNECTION_JUNCTION_RADIUS = 3.5

const SVG_NS = 'http://www.w3.org/2000/svg'
const FLOW_TYPE = 'bpmn:SequenceFlow'
const FLOW_STROKE = 'hsl(225, 10%, 15%)'
const CANVAS_FILL = '#fff'
const EPSILON = 1e-7
const KEY_DECIMALS = 6

interface EventBusLike {
  on(event: string, callback: (event?: unknown) => void): void
}

interface ConnectionElementLike {
  id?: unknown
  type?: unknown
  waypoints?: unknown
  source?: { id?: unknown } | null
  target?: { id?: unknown } | null
}

interface ElementRegistryLike {
  getAll(): ConnectionElementLike[]
}

interface CanvasLayerLike {
  group: SVGElement
}

interface CanvasLike {
  getActiveLayer(): CanvasLayerLike | SVGElement | null
}

export type EdgeVisualAnalyzer = (edges: readonly PolylineEdge[]) => EdgeVisualAnalysis

interface PlannedHop {
  edgeId: string
  crossingEdgeId: string
  point: Point
  unit: Point
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function cleanNumber(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : value
}

function pointKey(point: Point): string {
  return `${cleanNumber(point.x).toFixed(KEY_DECIMALS)},${cleanNumber(point.y).toFixed(KEY_DECIMALS)}`
}

function svgNumber(value: number): string {
  const rounded = Number(cleanNumber(value).toFixed(KEY_DECIMALS))
  return String(rounded)
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Point>
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
}

function copyPoints(waypoints: readonly Point[]): Point[] {
  return waypoints.map(({ x, y }) => ({ x: cleanNumber(x), y: cleanNumber(y) }))
}

function makeSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }
  return element
}

function activeLayerGroup(layer: CanvasLayerLike | SVGElement | null): SVGElement | null {
  if (!layer) return null
  if ('group' in layer && layer.group) return layer.group
  return layer as SVGElement
}

function segmentUnitAt(edge: PolylineEdge, point: Point): Point | null {
  for (let index = 0; index + 1 < edge.waypoints.length; index += 1) {
    const first = edge.waypoints[index]
    const second = edge.waypoints[index + 1]
    const dx = second.x - first.x
    const dy = second.y - first.y
    const length = Math.hypot(dx, dy)
    if (length <= EPSILON) continue
    const area = (point.x - first.x) * dy - (point.y - first.y) * dx
    if (Math.abs(area) > EPSILON * Math.max(1, length)) continue
    const projection = (point.x - first.x) * dx + (point.y - first.y) * dy
    if (projection < -EPSILON || projection > length * length + EPSILON) continue
    let ux = dx / length
    let uy = dy / length
    // Canonical direction makes the bridge stable even when an edge is
    // reconnected in the opposite waypoint order.
    if (ux < -EPSILON || (Math.abs(ux) <= EPSILON && uy < 0)) {
      ux = -ux
      uy = -uy
    }
    return { x: ux, y: uy }
  }
  return null
}

function planHops(
  analysis: EdgeVisualAnalysis,
  edgesById: ReadonlyMap<string, PolylineEdge>
): PlannedHop[] {
  const planned = new Map<string, PlannedHop>()
  const crossings = [...analysis.crossings].sort(
    (a, b) =>
      compareNumbers(a.point.x, b.point.x) ||
      compareNumbers(a.point.y, b.point.y) ||
      compareStrings(a.overEdgeId, b.overEdgeId) ||
      compareStrings(a.underEdgeId, b.underEdgeId)
  )

  for (const crossing of crossings) {
    const edge = edgesById.get(crossing.overEdgeId)
    const unit = edge ? segmentUnitAt(edge, crossing.point) : null
    // Keep this guard so a malformed/custom analyzer cannot paint a
    // disconnected bridge.
    if (!edge || !unit) continue
    const key = `${pointKey(crossing.point)}\u0000${crossing.overEdgeId}`
    if (planned.has(key)) continue
    planned.set(key, {
      edgeId: crossing.overEdgeId,
      crossingEdgeId: crossing.underEdgeId,
      point: { ...crossing.point },
      unit
    })
  }

  return [...planned.values()]
}

function planJunctions(junctions: readonly Junction[]): Junction[] {
  const planned = new Map<string, Junction>()
  const ordered = [...junctions].sort(
    (a, b) =>
      compareNumbers(a.point.x, b.point.x) ||
      compareNumbers(a.point.y, b.point.y) ||
      compareStrings(a.kind, b.kind) ||
      compareStrings(a.edgeIds.join('\u0000'), b.edgeIds.join('\u0000'))
  )

  for (const junction of ordered) {
    const key = pointKey(junction.point)
    const existing = planned.get(key)
    if (!existing) {
      planned.set(key, {
        point: { ...junction.point },
        kind: junction.kind,
        edgeIds: [...new Set(junction.edgeIds)].sort(compareStrings)
      })
      continue
    }
    if (existing.kind !== junction.kind) existing.kind = 'split-merge'
    existing.edgeIds = [...new Set([...existing.edgeIds, ...junction.edgeIds])].sort(compareStrings)
  }

  return [...planned.values()]
}

function offsetPoint(point: Point, unit: Point, amount: number): Point {
  return {
    x: point.x + unit.x * amount,
    y: point.y + unit.y * amount
  }
}

function maskPath(point: Point, unit: Point): string {
  const reach = CONNECTION_HOP_RADIUS + 1
  const start = offsetPoint(point, unit, -reach)
  const end = offsetPoint(point, unit, reach)
  return `M ${svgNumber(start.x)} ${svgNumber(start.y)} L ${svgNumber(end.x)} ${svgNumber(end.y)}`
}

/** A quadratic bridge aligned with the actual over-edge segment. */
function hopPath(point: Point, unit: Point): string {
  // Preserve the compact conventional SVG arc for ordinary horizontal BPMN
  // routes; vertical and diagonal custom routes use the equivalent quadratic.
  if (Math.abs(unit.y) <= EPSILON) {
    return `M ${svgNumber(point.x - CONNECTION_HOP_RADIUS)} ${svgNumber(
      point.y
    )} A ${CONNECTION_HOP_RADIUS} ${CONNECTION_HOP_RADIUS} 0 0 1 ${svgNumber(
      point.x + CONNECTION_HOP_RADIUS
    )} ${svgNumber(point.y)}`
  }
  const start = offsetPoint(point, unit, -CONNECTION_HOP_RADIUS)
  const end = offsetPoint(point, unit, CONNECTION_HOP_RADIUS)
  const normal = { x: -unit.y, y: unit.x }
  const control = offsetPoint(point, normal, CONNECTION_HOP_RADIUS)
  return `M ${svgNumber(start.x)} ${svgNumber(start.y)} Q ${svgNumber(
    control.x
  )} ${svgNumber(control.y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`
}

/**
 * Complete-waypoint cache plus lifecycle-owned SVG projection.
 *
 * The optional analyzer argument is a test seam only; bpmn-js DI supplies the
 * first three arguments and uses analyzeEdgeVisuals by default.
 */
export class OrgConnectionRenderer {
  static $inject = ['eventBus', 'canvas', 'elementRegistry']

  private readonly canvas: CanvasLike
  private readonly elementRegistry: ElementRegistryLike
  private readonly analyzer: EdgeVisualAnalyzer
  private readonly waypointCache = new Map<string, readonly Point[]>()
  private overlayRoot: SVGElement | null = null

  constructor(
    eventBus: EventBusLike,
    canvas: CanvasLike,
    elementRegistry: ElementRegistryLike,
    analyzer: EdgeVisualAnalyzer = analyzeEdgeVisuals
  ) {
    this.canvas = canvas
    this.elementRegistry = elementRegistry
    this.analyzer = analyzer

    eventBus.on('import.done', () => this.refresh())
    eventBus.on('commandStack.changed', () => this.refresh())
    eventBus.on('diagram.clear', () => this.clear())
  }

  /**
   * A defensive snapshot for diagnostics/tests.  Returning copies prevents a
   * caller from mutating the complete set used by the next visual analysis.
   */
  getWaypointCache(): ReadonlyMap<string, readonly Point[]> {
    return new Map(
      [...this.waypointCache].map(([id, waypoints]) => [id, copyPoints(waypoints)] as const)
    )
  }

  /** Rebuild the full cache, analyze it as one set, and replace the overlay. */
  refresh(): void {
    let edges: PolylineEdge[]
    try {
      edges = this.collectEdges()
    } catch {
      this.clear()
      return
    }

    this.waypointCache.clear()
    for (const edge of edges) this.waypointCache.set(edge.id, copyPoints(edge.waypoints))

    let analysis: EdgeVisualAnalysis
    try {
      analysis = this.analyzer(
        edges.map((edge) => ({
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          waypoints: copyPoints(edge.waypoints)
        }))
      )
    } catch {
      this.removeOverlay()
      return
    }

    try {
      this.render(edges, analysis)
    } catch {
      // Connection adornments are informative only; a missing/detached canvas
      // must never break import or a modeling command.
      this.removeOverlay()
    }
  }

  /** Remove all cached geometry and painted connection visuals. */
  clear(): void {
    this.waypointCache.clear()
    this.removeOverlay()
  }

  private collectEdges(): PolylineEdge[] {
    const byId = new Map<string, PolylineEdge>()
    for (const element of this.elementRegistry.getAll()) {
      if (element.type !== FLOW_TYPE || typeof element.id !== 'string') continue
      if (!Array.isArray(element.waypoints)) continue
      const waypoints = element.waypoints.filter(isPoint).map(({ x, y }) => ({ x, y }))
      if (waypoints.length < 2) continue
      byId.set(element.id, {
        id: element.id,
        sourceId: typeof element.source?.id === 'string' ? element.source.id : undefined,
        targetId: typeof element.target?.id === 'string' ? element.target.id : undefined,
        waypoints
      })
    }
    return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id))
  }

  private render(edges: readonly PolylineEdge[], analysis: EdgeVisualAnalysis): void {
    this.removeOverlay()
    const layer = activeLayerGroup(this.canvas.getActiveLayer())
    if (!layer) return

    const root = makeSvgElement('g', {
      class: 'orbitpm-connection-visuals',
      'data-org-edge-visuals': 'true',
      'pointer-events': 'none',
      'aria-hidden': 'true'
    })
    const edgesById = new Map(edges.map((edge) => [edge.id, edge] as const))
    const hops = planHops(analysis, edgesById)

    // Knock out the stock straight segment first.  All masks precede all arcs
    // so adjacent crossings cannot erase a previously drawn hop.
    for (const hop of hops) {
      root.appendChild(
        makeSvgElement('path', {
          class: 'orbitpm-connection-hop-mask',
          'data-org-edge-hop-mask': 'true',
          d: maskPath(hop.point, hop.unit),
          fill: 'none',
          stroke: CANVAS_FILL,
          'stroke-width': 5,
          'stroke-linecap': 'round'
        })
      )
    }

    for (const hop of hops) {
      root.appendChild(
        makeSvgElement('path', {
          class: 'orbitpm-connection-hop',
          'data-org-edge-visual': 'hop',
          'data-edge-id': hop.edgeId,
          'data-crossing-edge-id': hop.crossingEdgeId,
          'data-crossing-x': svgNumber(hop.point.x),
          'data-crossing-y': svgNumber(hop.point.y),
          'data-radius': CONNECTION_HOP_RADIUS,
          d: hopPath(hop.point, hop.unit),
          fill: 'none',
          stroke: FLOW_STROKE,
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        })
      )
    }

    // Junctions are last by design: a shared-route dot has visual precedence
    // over every crossing adornment.
    for (const junction of planJunctions(analysis.junctions)) {
      root.appendChild(
        makeSvgElement('circle', {
          class: `orbitpm-connection-junction orbitpm-connection-junction--${junction.kind}`,
          'data-org-edge-visual': 'junction',
          'data-junction-kind': junction.kind,
          'data-edge-ids': junction.edgeIds.join(','),
          cx: svgNumber(junction.point.x),
          cy: svgNumber(junction.point.y),
          r: CONNECTION_JUNCTION_RADIUS,
          fill: FLOW_STROKE,
          stroke: CANVAS_FILL,
          'stroke-width': 1
        })
      )
    }

    layer.appendChild(root)
    this.overlayRoot = root
  }

  private removeOverlay(): void {
    if (!this.overlayRoot) return
    try {
      this.overlayRoot.remove()
    } finally {
      this.overlayRoot = null
    }
  }
}

/** Standalone DI declaration; OrgRenderModule may register this service inline. */
export const OrgConnectionRendererModule: {
  __init__: string[]
  orgConnectionRenderer: [string, typeof OrgConnectionRenderer]
} = {
  __init__: ['orgConnectionRenderer'],
  orgConnectionRenderer: ['type', OrgConnectionRenderer]
}
