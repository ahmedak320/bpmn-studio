/**
 * Waypoint derivation for connection occurrences.
 *
 * ARIS stores an explicit route on `CxnOcc` (its `Position` children). When the
 * route is present the canvas renders it verbatim — that is the Section 12.4
 * "Source Layout" contract. When it is absent (a freshly authored connection),
 * the canvas derives a direct route docked to both shape borders so the edge is
 * still drawable; the derived route is *not* written back to the model, so an
 * authored connection stays route-free until the user reroutes it or the clean
 * layout lane assigns one.
 */

import type { ArisBounds, ArisPoint } from '../model/types'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
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

/** A small rectangular loop for a connection whose endpoints are the same shape. */
export function selfLoopWaypoints(rect: Rect, offset = 40): readonly ArisPoint[] {
  const right = rect.x + rect.width
  const top = rect.y
  const midY = rect.y + rect.height / 2
  return Object.freeze([
    { x: right, y: midY },
    { x: right + offset, y: midY },
    { x: right + offset, y: top - offset },
    { x: rect.x + rect.width / 2, y: top - offset },
    { x: rect.x + rect.width / 2, y: top }
  ])
}

/**
 * Compute the waypoints diagram-js should render for a connection.
 *
 * `route` is the ARIS-stored route. Its interior points are honoured; the first
 * and last points are always re-docked to the current shape borders so a moved
 * shape never leaves a dangling edge.
 */
export function connectionWaypoints(
  source: ArisBounds,
  target: ArisBounds,
  route: readonly ArisPoint[],
  options: { readonly selfLoop?: boolean } = {}
): readonly ArisPoint[] {
  if (options.selfLoop) {
    return route.length >= 2 ? Object.freeze([...route]) : selfLoopWaypoints(source)
  }

  const interior = route.length > 2 ? route.slice(1, -1) : []
  if (interior.length === 0) {
    return Object.freeze([dockPoint(source, center(target)), dockPoint(target, center(source))])
  }
  return Object.freeze([
    dockPoint(source, interior[0]),
    ...interior,
    dockPoint(target, interior[interior.length - 1])
  ])
}
