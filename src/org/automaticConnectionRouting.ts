/**
 * Conservative, diagram-wide connector repair for Lite.
 *
 * bpmn-js routes a connection around base BPMN shapes, but it cannot see the
 * external OrbitPM input/output/responsibility boxes painted by our renderer.
 * This installer runs inside the originating command's `postExecuted` phase,
 * so waypoint repairs join the same undo/redo action. It only replaces a route
 * when the candidate removes an obstacle/crossing or is materially simpler.
 */

import { executeModelingBatch, type ModelingBatchUpdate } from '../editor/modelingBatch'
import { routeOrthogonal, type RoutePoint, type RouteRect } from '../library/epcLayout'
import { analyzeEdgeVisuals, normalizePolyline, type PolylineEdge } from './edgeVisuals'
import {
  computeDecorLayout,
  decorationBoxes,
  detectElementFlowDirection,
  detectOrientation,
  type FlowDirection,
  type FlowOrientation
} from './decorExtents'
import { getOrgProps, type OrgElementLike } from './orgModel'
import { isCompletenessOn, isOrgStylingOn } from './orgSettings'

const FLOW_TYPE = 'bpmn:SequenceFlow'
const SHAPE_CLEARANCE = 7
const DECOR_CLEARANCE = 4
const EDGE_CLEARANCE = 4
const MATERIAL_LENGTH_IMPROVEMENT = 12
const EPSILON = 0.01

const ROUTING_POST_EVENTS = [
  'commandStack.shape.create.postExecuted',
  'commandStack.shape.move.postExecuted',
  'commandStack.shape.resize.postExecuted',
  'commandStack.shape.delete.postExecuted',
  'commandStack.elements.move.postExecuted',
  'commandStack.connection.create.postExecuted',
  'commandStack.connection.reconnectStart.postExecuted',
  'commandStack.connection.reconnectEnd.postExecuted',
  'commandStack.connection.updateWaypoints.postExecuted',
  'commandStack.element.updateLabel.postExecuted',
  'commandStack.element.updateProperties.postExecuted'
] as const

interface RoutingElement extends OrgElementLike {
  id?: string
  type?: string
  source?: RoutingElement | null
  target?: RoutingElement | null
  incoming?: RoutingElement[]
  outgoing?: RoutingElement[]
  waypoints?: RoutePoint[]
  labelTarget?: RoutingElement | null
}

interface RoutingEventBus {
  on(event: string, callback: (event?: unknown) => void): void
  off(event: string, callback: (event?: unknown) => void): void
}

interface RoutingRegistry {
  getAll(): RoutingElement[]
}

interface RoutingDirectionSource {
  getOrientation?(): FlowOrientation
  getDirectionFor?(element: RoutingElement): FlowDirection
  getFlipFor?(element: RoutingElement): boolean
}

export interface AutomaticRoutingModeler {
  get(name: string): unknown
}

interface ConnectionScore {
  collisions: number
  crossings: number
  bends: number
  length: number
}

function finitePoint(value: unknown): value is RoutePoint {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { x?: unknown }).x === 'number' &&
    Number.isFinite((value as { x: number }).x) &&
    typeof (value as { y?: unknown }).y === 'number' &&
    Number.isFinite((value as { y: number }).y)
  )
}

function finiteBounds(element: RoutingElement): RouteRect | null {
  if (
    !Number.isFinite(element.x) ||
    !Number.isFinite(element.y) ||
    !Number.isFinite(element.width) ||
    !Number.isFinite(element.height)
  ) {
    return null
  }
  return {
    x0: element.x as number,
    y0: element.y as number,
    x1: (element.x as number) + (element.width as number),
    y1: (element.y as number) + (element.height as number)
  }
}

function inflate(rect: RouteRect, amount: number): RouteRect {
  return {
    x0: rect.x0 - amount,
    y0: rect.y0 - amount,
    x1: rect.x1 + amount,
    y1: rect.y1 + amount
  }
}

function isContainer(type: string | undefined): boolean {
  return (
    type === 'bpmn:Process' ||
    type === 'bpmn:Collaboration' ||
    type === 'bpmn:Participant' ||
    type === 'bpmn:Lane' ||
    type === 'bpmn:Group'
  )
}

function relativeLabelBox(
  element: RoutingElement
): { x: number; y: number; w: number; h: number } | null {
  const label = element.label
  if (
    !label ||
    !Number.isFinite(label.x) ||
    !Number.isFinite(label.y) ||
    !Number.isFinite(label.width) ||
    !Number.isFinite(label.height) ||
    !Number.isFinite(element.x) ||
    !Number.isFinite(element.y)
  ) {
    return null
  }
  return {
    x: label.x - (element.x as number),
    y: label.y - (element.y as number),
    w: label.width,
    h: label.height
  }
}

function segmentHitsRect(a: RoutePoint, b: RoutePoint, rect: RouteRect): boolean {
  if (Math.abs(a.x - b.x) <= EPSILON) {
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    return a.x > rect.x0 && a.x < rect.x1 && lo < rect.y1 && hi > rect.y0
  }
  if (Math.abs(a.y - b.y) <= EPSILON) {
    const lo = Math.min(a.x, b.x)
    const hi = Math.max(a.x, b.x)
    return a.y > rect.y0 && a.y < rect.y1 && lo < rect.x1 && hi > rect.x0
  }
  // Non-orthogonal hand-edited routes are considered unsafe; the replacement
  // route will always be rectilinear.
  return true
}

function routeLength(points: readonly RoutePoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    )
  }
  return total
}

function edgeOf(connection: RoutingElement, waypoints: readonly RoutePoint[]): PolylineEdge {
  return {
    id: connection.id as string,
    sourceId: connection.source?.id,
    targetId: connection.target?.id,
    waypoints
  }
}

function routeScore(
  connection: RoutingElement,
  waypoints: readonly RoutePoint[],
  obstacles: readonly RouteRect[],
  otherEdges: readonly PolylineEdge[]
): ConnectionScore {
  const normalized = normalizePolyline(waypoints)
  let collisions = 0
  for (let index = 1; index < normalized.length; index += 1) {
    const a = normalized[index - 1]
    const b = normalized[index]
    for (const obstacle of obstacles) {
      if (segmentHitsRect(a, b, obstacle)) collisions += 1
    }
  }
  const edge = edgeOf(connection, normalized)
  const crossings = analyzeEdgeVisuals([...otherEdges, edge]).crossings.filter(
    (crossing) => crossing.overEdgeId === edge.id || crossing.underEdgeId === edge.id
  ).length
  return {
    collisions,
    crossings,
    bends: Math.max(0, normalized.length - 2),
    length: routeLength(normalized)
  }
}

function shouldReplace(current: ConnectionScore, candidate: ConnectionScore): boolean {
  if (candidate.collisions !== current.collisions) {
    return candidate.collisions < current.collisions
  }
  if (candidate.crossings !== current.crossings) {
    return candidate.crossings < current.crossings
  }
  if (candidate.bends !== current.bends) return candidate.bends < current.bends
  return candidate.length + MATERIAL_LENGTH_IMPROVEMENT < current.length
}

function sameRoute(left: readonly RoutePoint[], right: readonly RoutePoint[]): boolean {
  const a = normalizePolyline(left)
  const b = normalizePolyline(right)
  return (
    a.length === b.length &&
    a.every(
      (point, index) =>
        Math.abs(point.x - b[index].x) <= EPSILON && Math.abs(point.y - b[index].y) <= EPSILON
    )
  )
}

function decorationObstacles(
  elements: readonly RoutingElement[],
  orientation: FlowOrientation,
  directionSource: RoutingDirectionSource | undefined
): Map<string, RouteRect[]> {
  const result = new Map<string, RouteRect[]>()
  if (!isOrgStylingOn()) return result

  for (const element of elements) {
    if (
      typeof element.id !== 'string' ||
      element.waypoints ||
      element.labelTarget ||
      isContainer(element.type) ||
      !finiteBounds(element)
    ) {
      continue
    }
    const direction =
      directionSource?.getDirectionFor?.(element) ??
      detectElementFlowDirection(element, orientation)
    const layout = computeDecorLayout({
      props: getOrgProps(element),
      elementType: element.type ?? '',
      width: element.width as number,
      height: element.height as number,
      orientation,
      direction,
      flipCrossAxis: directionSource?.getFlipFor?.(element),
      completenessOn: isCompletenessOn(),
      labelBox: relativeLabelBox(element)
    })
    const boxes = decorationBoxes(layout).map(({ box }) =>
      inflate(
        {
          x0: (element.x as number) + box.x,
          y0: (element.y as number) + box.y,
          x1: (element.x as number) + box.x + box.w,
          y1: (element.y as number) + box.y + box.h
        },
        DECOR_CLEARANCE
      )
    )
    if (boxes.length > 0) result.set(element.id, boxes)
  }
  return result
}

function edgeRectangles(edges: readonly PolylineEdge[], connection: RoutingElement): RouteRect[] {
  const result: RouteRect[] = []
  for (const edge of edges) {
    if (
      edge.id === connection.id ||
      edge.sourceId === connection.source?.id ||
      edge.targetId === connection.target?.id
    ) {
      continue
    }
    for (let index = 1; index < edge.waypoints.length; index += 1) {
      const a = edge.waypoints[index - 1]
      const b = edge.waypoints[index]
      result.push({
        x0: Math.min(a.x, b.x) - EDGE_CLEARANCE,
        y0: Math.min(a.y, b.y) - EDGE_CLEARANCE,
        x1: Math.max(a.x, b.x) + EDGE_CLEARANCE,
        y1: Math.max(a.y, b.y) + EDGE_CLEARANCE
      })
    }
  }
  return result
}

/**
 * Pure planning boundary used by the modeler installer and focused tests.
 */
export function planAutomaticConnectionRepairs(
  elements: readonly RoutingElement[],
  directionSource?: RoutingDirectionSource
): ModelingBatchUpdate[] {
  const orientation = directionSource?.getOrientation?.() ?? detectOrientation(elements)
  const decorations = decorationObstacles(elements, orientation, directionSource)
  const baseShapes = elements.filter(
    (element) =>
      typeof element.id === 'string' &&
      !element.waypoints &&
      !element.labelTarget &&
      !isContainer(element.type) &&
      finiteBounds(element)
  )
  const labelRects = elements
    .filter((element) => element.labelTarget && finiteBounds(element))
    .map((element) => inflate(finiteBounds(element) as RouteRect, DECOR_CLEARANCE))
  const connections = elements
    .filter(
      (element) =>
        element.type === FLOW_TYPE &&
        typeof element.id === 'string' &&
        Array.isArray(element.waypoints) &&
        element.waypoints.filter(finitePoint).length >= 2
    )
    .sort((a, b) => (a.id as string).localeCompare(b.id as string))

  const shapeBounds = baseShapes
    .map(finiteBounds)
    .filter((rect): rect is RouteRect => rect !== null)
  const allPoints = connections.flatMap((connection) =>
    (connection.waypoints ?? []).filter(finitePoint)
  )
  const allRects = [...shapeBounds, ...labelRects, ...decorations.values()].flat()
  const xs = [
    ...allPoints.map((point) => point.x),
    ...allRects.flatMap((rect) => [rect.x0, rect.x1])
  ]
  const ys = [
    ...allPoints.map((point) => point.y),
    ...allRects.flatMap((rect) => [rect.y0, rect.y1])
  ]
  if (xs.length === 0 || ys.length === 0) return []
  const grid: RouteRect = {
    x0: Math.min(...xs) - 40,
    y0: Math.min(...ys) - 40,
    x1: Math.max(...xs) + 40,
    y1: Math.max(...ys) + 40
  }

  const projected = new Map<string, PolylineEdge>(
    connections.map((connection) => [
      connection.id as string,
      edgeOf(connection, (connection.waypoints ?? []).filter(finitePoint))
    ])
  )
  const updates: ModelingBatchUpdate[] = []

  for (const connection of connections) {
    // A self-loop must leave and re-enter the same shape. Since endpoint
    // shapes are intentionally omitted from the ordinary obstacle set, the
    // generic shortest-path planner could otherwise "simplify" a valid loop
    // into a bend through the activity itself.
    if (connection.source?.id != null && connection.source.id === connection.target?.id) {
      continue
    }
    const current = (connection.waypoints ?? []).filter(finitePoint)
    const start = current[0]
    const end = current[current.length - 1]
    const endpointIds = new Set([connection.source?.id, connection.target?.id])
    const obstacles: RouteRect[] = [
      ...baseShapes
        .filter((shape) => !endpointIds.has(shape.id))
        .map((shape) => inflate(finiteBounds(shape) as RouteRect, SHAPE_CLEARANCE)),
      ...labelRects,
      ...baseShapes
        .filter((shape) => !endpointIds.has(shape.id))
        .flatMap((shape) => decorations.get(shape.id as string) ?? []),
      // Endpoint decorations remain obstacles even though their base shapes do
      // not; this is what keeps arrows out of adjacent input/output blocks.
      ...baseShapes
        .filter((shape) => endpointIds.has(shape.id))
        .flatMap((shape) => decorations.get(shape.id as string) ?? [])
    ]
    const otherEdges = [...projected.values()].filter((edge) => edge.id !== connection.id)
    const routeObstacles = [...obstacles, ...edgeRectangles(otherEdges, connection)]
    const candidate = normalizePolyline(
      routeOrthogonal(start, end, routeObstacles, grid, connection.id as string)
    )
    const currentScore = routeScore(connection, current, obstacles, otherEdges)
    const candidateScore = routeScore(connection, candidate, obstacles, otherEdges)
    if (!sameRoute(current, candidate) && shouldReplace(currentScore, candidateScore)) {
      updates.push({
        kind: 'waypoints',
        connection,
        waypoints: candidate.map((point) => ({ ...point }))
      })
      projected.set(connection.id as string, edgeOf(connection, candidate))
    }
  }
  return updates
}

/**
 * Install import and command listeners. Repairs triggered by a modeling
 * command are nested during `postExecuted`, matching label mirroring and
 * auto-size, so one Undo always reverts the user action and its routing.
 */
export function installAutomaticConnectionRouting(modeler: AutomaticRoutingModeler): () => void {
  const eventBus = modeler.get('eventBus') as RoutingEventBus
  const registry = modeler.get('elementRegistry') as RoutingRegistry
  let directionSource: RoutingDirectionSource | undefined
  try {
    directionSource = modeler.get('orgDecorSync') as RoutingDirectionSource
  } catch {
    /* optional in structural tests */
  }
  let applying = false

  const repair = (): void => {
    if (applying) return
    applying = true
    try {
      executeModelingBatch(
        modeler,
        planAutomaticConnectionRepairs(registry.getAll(), directionSource)
      )
    } catch {
      /* routing is a visual aid and must never break the originating command */
    } finally {
      applying = false
    }
  }

  eventBus.on('import.done', repair)
  for (const event of ROUTING_POST_EVENTS) eventBus.on(event, repair)

  return () => {
    try {
      eventBus.off('import.done', repair)
      for (const event of ROUTING_POST_EVENTS) eventBus.off(event, repair)
    } catch {
      /* modeler already destroyed */
    }
  }
}
