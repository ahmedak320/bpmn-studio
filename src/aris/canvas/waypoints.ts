/**
 * Waypoint derivation for connection occurrences.
 *
 * ARIS stores an explicit route on `CxnOcc` (its `Position` children). When the
 * route is present and still belongs to untouched source geometry, the canvas
 * renders every point verbatim — endpoints included. When it is absent or has
 * become authored geometry, the canvas derives a route docked to descriptor
 * ports. The derived route is *not* written back to the model.
 */

import type { ArisBounds, ArisPoint } from '../model/types'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The descriptor port subset routing needs, deliberately independent of the symbol registry. */
export interface ConnectionPort {
  readonly name: string
  readonly nx: number
  readonly ny: number
}

function center(rect: Rect): ArisPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * Intersect the segment from a rectangle's centre toward `towards` with the
 * rectangle's border. Returns the centre when the target coincides with it.
 */
export function dockPoint(rect: Rect, towards: ArisPoint): ArisPoint {
  const origin = center(rect)
  const dx = towards.x - origin.x
  const dy = towards.y - origin.y
  if (dx === 0 && dy === 0) return origin

  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  // Scale the direction vector until it touches the nearer of the two borders.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: origin.x + dx * scale, y: origin.y + dy * scale }
}

interface DockedPort {
  readonly name: string
  readonly point: ArisPoint
}

function descriptorPortPoint(rect: Rect, port: ConnectionPort): ArisPoint {
  return {
    x: rect.x + rect.width * port.nx,
    y: rect.y + rect.height * port.ny
  }
}

/**
 * Pick the descriptor port facing `towards`.
 *
 * Cardinal ports win for a cardinal direction; descriptor-specific normalized
 * coordinates then put the endpoint on the real silhouette (for example the
 * inset side of a chevron) instead of assuming every symbol is a rectangle.
 */
export function dockDescriptorPort(
  rect: Rect,
  towards: ArisPoint,
  ports: readonly ConnectionPort[]
): DockedPort {
  const origin = center(rect)
  const dx = towards.x - origin.x
  const dy = towards.y - origin.y
  const preferredName = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : dy >= 0 ? 'S' : 'N'
  const usable = ports.filter((port) => port.name.toUpperCase() !== 'CENTER')
  const preferred = usable.find((port) => port.name.toUpperCase() === preferredName)
  const candidates = preferred ? [preferred] : usable
  if (candidates.length === 0) {
    return { name: preferredName, point: dockPoint(rect, towards) }
  }
  const selected = candidates.reduce((best, candidate) => {
    const bestPoint = descriptorPortPoint(rect, best)
    const candidatePoint = descriptorPortPoint(rect, candidate)
    const bestDistance = squaredDistance(bestPoint, towards)
    const candidateDistance = squaredDistance(candidatePoint, towards)
    return candidateDistance < bestDistance ? candidate : best
  })
  return { name: selected.name.toUpperCase(), point: descriptorPortPoint(rect, selected) }
}

function squaredDistance(a: ArisPoint, b: ArisPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** A small rectangular loop for a connection whose endpoints are the same shape. */
export function selfLoopWaypoints(
  rect: Rect,
  offset = 40,
  ports: readonly ConnectionPort[] = []
): readonly ArisPoint[] {
  const source = dockDescriptorPort(
    rect,
    { x: rect.x + rect.width + offset, y: rect.y + rect.height / 2 },
    ports
  ).point
  const target = dockDescriptorPort(
    rect,
    { x: rect.x + rect.width / 2, y: rect.y - offset },
    ports
  ).point
  const right = Math.max(source.x, rect.x + rect.width) + offset
  const top = Math.min(target.y, rect.y) - offset
  return Object.freeze([
    source,
    { x: right, y: source.y },
    { x: right, y: top },
    { x: target.x, y: top },
    target
  ])
}

function isOrthogonal(from: ArisPoint, to: ArisPoint): boolean {
  return from.x === to.x || from.y === to.y
}

function elbowFromPort(port: DockedPort, towards: ArisPoint): ArisPoint {
  return port.name === 'E' || port.name === 'W'
    ? { x: towards.x, y: port.point.y }
    : { x: port.point.x, y: towards.y }
}

function elbowToPort(from: ArisPoint, port: DockedPort): ArisPoint {
  return port.name === 'E' || port.name === 'W'
    ? { x: from.x, y: port.point.y }
    : { x: port.point.x, y: from.y }
}

function compact(points: readonly ArisPoint[]): readonly ArisPoint[] {
  const result: ArisPoint[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (previous && previous.x === point.x && previous.y === point.y) continue
    result.push(point)
  }
  return Object.freeze(result)
}

/**
 * The shortest horizontal/vertical route between two boxes, used once a block has
 * been moved (its stored route no longer matches the geometry).
 *
 * - Boxes that share a horizontal span: one straight vertical line, at the middle
 *   of the shared span, from the facing bottom/top edges.
 * - Boxes that share a vertical span: one straight horizontal line, at the middle
 *   of the shared span, from the facing right/left edges.
 * - Otherwise one elbow: leave the source at its centre height (or centre column)
 *   toward the target, then enter the target's top/bottom (or left/right) edge.
 *   The longer centre-to-centre axis decides which way to leave first.
 *
 * Every segment is horizontal or vertical; there are no diagonals and no interior
 * guides, so a moved block always gets the clean connection, not a stale detour.
 */
export function cleanConnectionWaypoints(source: Rect, target: Rect): readonly ArisPoint[] {
  const sourceRight = source.x + source.width
  const sourceBottom = source.y + source.height
  const targetRight = target.x + target.width
  const targetBottom = target.y + target.height

  const sharedX0 = Math.max(source.x, target.x)
  const sharedX1 = Math.min(sourceRight, targetRight)
  const sharedY0 = Math.max(source.y, target.y)
  const sharedY1 = Math.min(sourceBottom, targetBottom)

  if (sharedX1 > sharedX0) {
    const x = (sharedX0 + sharedX1) / 2
    if (target.y >= sourceBottom) return Object.freeze([{ x, y: sourceBottom }, { x, y: target.y }])
    if (targetBottom <= source.y) return Object.freeze([{ x, y: source.y }, { x, y: targetBottom }])
  }
  if (sharedY1 > sharedY0) {
    const y = (sharedY0 + sharedY1) / 2
    if (target.x >= sourceRight) return Object.freeze([{ x: sourceRight, y }, { x: target.x, y }])
    if (targetRight <= source.x) return Object.freeze([{ x: source.x, y }, { x: targetRight, y }])
  }

  const sourceCx = source.x + source.width / 2
  const sourceCy = source.y + source.height / 2
  const targetCx = target.x + target.width / 2
  const targetCy = target.y + target.height / 2
  const dx = targetCx - sourceCx
  const dy = targetCy - sourceCy
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Leave sideways at the source's centre height, then drop/rise into the target.
    const startX = dx >= 0 ? sourceRight : source.x
    const enterY = target.y >= sourceCy ? target.y : targetBottom
    return Object.freeze([
      { x: startX, y: sourceCy },
      { x: targetCx, y: sourceCy },
      { x: targetCx, y: enterY }
    ])
  }
  // Leave vertically at the source's centre column, then run sideways into the target.
  const startY = dy >= 0 ? sourceBottom : source.y
  const enterX = target.x >= sourceCx ? target.x : targetRight
  return Object.freeze([
    { x: sourceCx, y: startY },
    { x: sourceCx, y: targetCy },
    { x: enterX, y: targetCy }
  ])
}

/**
 * Compute the waypoints diagram-js should render for a connection.
 *
 * `route` is the ARIS-stored route. Untouched imported routes are immutable
 * presentation records: every point, including both endpoints, is copied
 * verbatim. Authored or moved routes use their interior points as guides and
 * dock to descriptor ports, inserting only the elbows required to remain
 * orthogonal.
 */
export function connectionWaypoints(
  source: ArisBounds,
  target: ArisBounds,
  route: readonly ArisPoint[],
  options: {
    readonly selfLoop?: boolean
    readonly preserveRoute?: boolean
    readonly reroute?: boolean
    readonly sourcePorts?: readonly ConnectionPort[]
    readonly targetPorts?: readonly ConnectionPort[]
  } = {}
): readonly ArisPoint[] {
  const preserveRoute = options.preserveRoute ?? true
  if (preserveRoute && route.length > 0) return Object.freeze([...route])

  if (options.selfLoop) {
    return selfLoopWaypoints(source, 40, options.sourcePorts)
  }

  // The caller marks a stored route that still belongs to the imported geometry
  // while a block has moved. Its points describe the old positions, so the clean
  // route replaces it. Authored routes are not marked and keep their guides.
  if (options.reroute) return cleanConnectionWaypoints(source, target)

  const interior = route.length > 2 ? route.slice(1, -1) : []
  const sourceTowards = interior[0] ?? route[1] ?? center(target)
  const targetTowards = interior[interior.length - 1] ?? route[0] ?? center(source)
  const sourcePort = dockDescriptorPort(source, sourceTowards, options.sourcePorts ?? [])
  const targetPort = dockDescriptorPort(target, targetTowards, options.targetPorts ?? [])

  if (interior.length === 0) {
    const points: ArisPoint[] = [sourcePort.point]
    if (!isOrthogonal(sourcePort.point, targetPort.point)) {
      points.push(elbowFromPort(sourcePort, targetPort.point))
    }
    points.push(targetPort.point)
    return compact(points)
  }

  const points: ArisPoint[] = [sourcePort.point]
  if (!isOrthogonal(sourcePort.point, interior[0] as ArisPoint)) {
    points.push(elbowFromPort(sourcePort, interior[0] as ArisPoint))
  }
  points.push(...interior)
  const lastInterior = interior[interior.length - 1] as ArisPoint
  if (!isOrthogonal(lastInterior, targetPort.point)) {
    points.push(elbowToPort(lastInterior, targetPort))
  }
  points.push(targetPort.point)
  return compact(points)
}
