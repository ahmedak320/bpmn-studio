/**
 * Exact geometric primitives used by the layout metrics (plan §19.2 step 7).
 *
 * Everything here is a closed-form computation on axis-aligned rectangles and
 * straight segments — there is no sampling, no rasterization and no tolerance
 * beyond an explicit epsilon, so every metric can be checked against a
 * hand-computed answer.
 */

import type { ArisLayoutPoint, ArisLayoutRect } from './types'

/** Coordinates closer than this are considered identical. */
export const LAYOUT_EPSILON = 1e-6

export function rectRight(rect: ArisLayoutRect): number {
  return rect.x + rect.width
}

export function rectBottom(rect: ArisLayoutRect): number {
  return rect.y + rect.height
}

export function rectCenter(rect: ArisLayoutRect): ArisLayoutPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function rectArea(rect: ArisLayoutRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

/** Area shared by two rectangles. Touching edges yield exactly `0`. */
export function rectIntersectionArea(a: ArisLayoutRect, b: ArisLayoutRect): number {
  const width = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)
  const height = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y)
  if (width <= 0 || height <= 0) return 0
  return width * height
}

/**
 * True when two rectangles share positive area. `tolerance` shrinks both
 * rectangles first, so shapes that merely touch are never reported.
 */
export function rectsOverlap(a: ArisLayoutRect, b: ArisLayoutRect, tolerance = LAYOUT_EPSILON): boolean {
  const width = Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)
  const height = Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y)
  return width > tolerance && height > tolerance
}

/** Smallest rectangle containing both inputs. */
export function unionRect(a: ArisLayoutRect, b: ArisLayoutRect): ArisLayoutRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(rectRight(a), rectRight(b)) - x,
    height: Math.max(rectBottom(a), rectBottom(b)) - y
  }
}

/** Smallest rectangle containing every input point. */
export function boundsOfPoints(points: readonly ArisLayoutPoint[]): ArisLayoutRect | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** True when `point` lies on the rectangle outline within `tolerance`. */
export function pointOnRectBoundary(
  point: ArisLayoutPoint,
  rect: ArisLayoutRect,
  tolerance = LAYOUT_EPSILON
): boolean {
  const withinX = point.x >= rect.x - tolerance && point.x <= rectRight(rect) + tolerance
  const withinY = point.y >= rect.y - tolerance && point.y <= rectBottom(rect) + tolerance
  if (!withinX || !withinY) return false
  const onVerticalEdge =
    Math.abs(point.x - rect.x) <= tolerance || Math.abs(point.x - rectRight(rect)) <= tolerance
  const onHorizontalEdge =
    Math.abs(point.y - rect.y) <= tolerance || Math.abs(point.y - rectBottom(rect)) <= tolerance
  return onVerticalEdge || onHorizontalEdge
}

/** True when `point` is strictly inside the rectangle. */
export function pointInRectInterior(
  point: ArisLayoutPoint,
  rect: ArisLayoutRect,
  tolerance = LAYOUT_EPSILON
): boolean {
  return (
    point.x > rect.x + tolerance &&
    point.x < rectRight(rect) - tolerance &&
    point.y > rect.y + tolerance &&
    point.y < rectBottom(rect) - tolerance
  )
}

export function segmentLength(a: ArisLayoutPoint, b: ArisLayoutPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function polylineLength(points: readonly ArisLayoutPoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += segmentLength(points[index - 1] as ArisLayoutPoint, points[index] as ArisLayoutPoint)
  }
  return total
}

/**
 * Liang-Barsky clip of segment `a`->`b` against `rect` shrunk by `tolerance`.
 * Returns the length of the part of the segment that lies strictly inside.
 * A segment that only runs along an edge, or only touches a corner, yields 0.
 */
export function segmentInsideRectLength(
  a: ArisLayoutPoint,
  b: ArisLayoutPoint,
  rect: ArisLayoutRect,
  tolerance = LAYOUT_EPSILON
): number {
  const minX = rect.x + tolerance
  const maxX = rectRight(rect) - tolerance
  const minY = rect.y + tolerance
  const maxY = rectBottom(rect) - tolerance
  if (minX >= maxX || minY >= maxY) return 0

  const dx = b.x - a.x
  const dy = b.y - a.y
  let enter = 0
  let exit = 1

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < LAYOUT_EPSILON) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > exit) return false
      if (r > enter) enter = r
    } else {
      if (r < enter) return false
      if (r < exit) exit = r
    }
    return true
  }

  if (!clip(-dx, a.x - minX)) return 0
  if (!clip(dx, maxX - a.x)) return 0
  if (!clip(-dy, a.y - minY)) return 0
  if (!clip(dy, maxY - a.y)) return 0
  if (exit <= enter) return 0
  return (exit - enter) * Math.hypot(dx, dy)
}

/** True when the segment enters the rectangle's interior. */
export function segmentIntersectsRectInterior(
  a: ArisLayoutPoint,
  b: ArisLayoutPoint,
  rect: ArisLayoutRect,
  tolerance = LAYOUT_EPSILON
): boolean {
  return segmentInsideRectLength(a, b, rect, tolerance) > tolerance
}

function cross(
  origin: ArisLayoutPoint,
  first: ArisLayoutPoint,
  second: ArisLayoutPoint
): number {
  return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
}

/**
 * True only for a **proper** crossing: the two segments meet at exactly one
 * point that is strictly interior to both. Shared endpoints, T-junctions and
 * collinear overlaps are deliberately not crossings.
 */
export function segmentsProperlyCross(
  a1: ArisLayoutPoint,
  a2: ArisLayoutPoint,
  b1: ArisLayoutPoint,
  b2: ArisLayoutPoint,
  tolerance = LAYOUT_EPSILON
): boolean {
  const d1 = cross(a1, a2, b1)
  const d2 = cross(a1, a2, b2)
  const d3 = cross(b1, b2, a1)
  const d4 = cross(b1, b2, a2)
  // Scale the tolerance with the segment lengths so it stays a distance test.
  const scaleA = Math.max(segmentLength(a1, a2), tolerance)
  const scaleB = Math.max(segmentLength(b1, b2), tolerance)
  const tolA = tolerance * scaleA
  const tolB = tolerance * scaleB
  if (Math.abs(d1) <= tolA || Math.abs(d2) <= tolA) return false
  if (Math.abs(d3) <= tolB || Math.abs(d4) <= tolB) return false
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Deterministic 1-D interval type used by the free-corridor search. */
export interface Interval {
  readonly min: number
  readonly max: number
}

/** Complement of `blocked` inside `[min, max]`, sorted, non-overlapping. */
export function freeIntervals(
  bounds: Interval,
  blocked: readonly Interval[]
): readonly Interval[] {
  const sorted = [...blocked]
    .filter((interval) => interval.max > interval.min)
    .sort((left, right) => left.min - right.min || left.max - right.max)
  const result: Interval[] = []
  let cursor = bounds.min
  for (const interval of sorted) {
    if (interval.min > cursor) result.push({ min: cursor, max: Math.min(interval.min, bounds.max) })
    cursor = Math.max(cursor, interval.max)
    if (cursor >= bounds.max) break
  }
  if (cursor < bounds.max) result.push({ min: cursor, max: bounds.max })
  return result.filter((interval) => interval.max - interval.min > LAYOUT_EPSILON)
}

/** Pairwise intersection of two sorted, non-overlapping interval lists. */
export function intersectIntervals(
  left: readonly Interval[],
  right: readonly Interval[]
): readonly Interval[] {
  const result: Interval[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const a = left[leftIndex] as Interval
    const b = right[rightIndex] as Interval
    const min = Math.max(a.min, b.min)
    const max = Math.min(a.max, b.max)
    if (max - min > LAYOUT_EPSILON) result.push({ min, max })
    if (a.max < b.max) leftIndex += 1
    else rightIndex += 1
  }
  return result
}

/**
 * Value inside one of `intervals` nearest to `preferred`, keeping at least
 * `clearance` from both ends of the chosen interval when it is wide enough.
 * Returns `null` when no interval can host the value.
 */
export function nearestValueInIntervals(
  intervals: readonly Interval[],
  preferred: number,
  clearance = 0
): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const interval of intervals) {
    const width = interval.max - interval.min
    if (width <= LAYOUT_EPSILON) continue
    const pad = Math.min(clearance, (width - LAYOUT_EPSILON) / 2)
    const min = interval.min + pad
    const max = interval.max - pad
    const candidate = Math.min(Math.max(preferred, min), max)
    const distance = Math.abs(candidate - preferred)
    if (distance < bestDistance - LAYOUT_EPSILON) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * Largest gap in `[bounds.min, bounds.max]` not covered by any of `covered`.
 * Gaps touching the outer bounds are ignored — those are the canvas margin,
 * not unexplained interior whitespace.
 */
export function largestInteriorGap(bounds: Interval, covered: readonly Interval[]): number {
  const free = freeIntervals(bounds, covered)
  let largest = 0
  for (const interval of free) {
    if (interval.min <= bounds.min + LAYOUT_EPSILON) continue
    if (interval.max >= bounds.max - LAYOUT_EPSILON) continue
    largest = Math.max(largest, interval.max - interval.min)
  }
  return largest
}
