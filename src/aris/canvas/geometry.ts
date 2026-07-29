/**
 * Canonical geometry rounding for the ARIS canvas — Plan Section 11.4.
 *
 * ## Why every coordinate is an integer
 *
 * Revision payloads are persisted through `src/aris/packages/canonicalJson.ts`,
 * whose encoder rejects fractional numbers by design so that two runs producing
 * the same logical document produce byte-identical files. Every geometry value
 * that reaches an `ArisEditCommand` payload therefore has to be a safe integer.
 *
 * That is not a compromise: the AML source layer already parses `Pos.X`,
 * `Pos.Y`, `Size.dX` and `Size.dY` with `Number.parseInt(value, 10)`
 * (`src/aris/source/semanticIndex.ts`), so ARIS source coordinates are integral
 * to begin with. diagram-js, by contrast, hands us fractional values out of
 * drag, resize and bend-point gestures (snapping, zoom, and cropping all
 * produce sub-pixel results).
 *
 * The decision is therefore: **round to the nearest integer at the command
 * boundary**, never scale to fixed point. Rounding happens in exactly one
 * place — this module — and every command factory funnels through it.
 */

import type { ArisBounds, ArisPoint } from '../model/types'

/** Raised when a geometry value cannot be represented as a safe integer. */
export class ArisGeometryError extends Error {
  readonly code = 'non-canonical-geometry'

  constructor(message: string) {
    super(message)
    this.name = 'ArisGeometryError'
  }
}

/**
 * Round one coordinate to the canonical integer grid.
 *
 * `Math.round` is used rather than truncation so that a symmetric drag of
 * `+0.5` and `-0.5` does not bias the model toward the origin.
 */
export function toCanonicalNumber(value: number, label = 'coordinate'): number {
  if (!Number.isFinite(value)) {
    throw new ArisGeometryError(`Canvas ${label} ${String(value)} is not finite.`)
  }
  const rounded = Math.round(value)
  // `Math.round` of a huge float can still land outside the safe range.
  if (!Number.isSafeInteger(rounded)) {
    throw new ArisGeometryError(
      `Canvas ${label} ${String(value)} is outside the safe integer range.`
    )
  }
  // Normalize `-0` to `0`: canonical JSON encodes them identically, but the
  // in-memory `before`/`after` snapshots must compare equal too.
  return rounded === 0 ? 0 : rounded
}

/** Round a width/height pair, clamping to a strictly positive minimum. */
export function toCanonicalSize(
  width: number,
  height: number,
  minimum = 1
): { readonly width: number; readonly height: number } {
  return Object.freeze({
    width: Math.max(minimum, toCanonicalNumber(width, 'width')),
    height: Math.max(minimum, toCanonicalNumber(height, 'height'))
  })
}

/** Round a full bounds rectangle. */
export function toCanonicalBounds(bounds: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}): ArisBounds {
  const size = toCanonicalSize(bounds.width, bounds.height)
  return Object.freeze({
    x: toCanonicalNumber(bounds.x, 'x'),
    y: toCanonicalNumber(bounds.y, 'y'),
    width: size.width,
    height: size.height
  })
}

/** Round a single route/bend point. */
export function toCanonicalPoint(point: { readonly x: number; readonly y: number }): ArisPoint {
  return Object.freeze({
    x: toCanonicalNumber(point.x, 'x'),
    y: toCanonicalNumber(point.y, 'y')
  })
}

/** Round a whole connection route. */
export function toCanonicalRoute(
  points: readonly { readonly x: number; readonly y: number }[]
): readonly ArisPoint[] {
  return Object.freeze(points.map((point) => toCanonicalPoint(point)))
}

/**
 * Assert that an arbitrary payload contains only canonical numbers.
 *
 * This mirrors the rule enforced by `canonicalJson.ts` without importing it,
 * so the canvas lane can prove its payloads survive revision persistence
 * without taking a dependency on the packages lane.
 */
export function assertCanonicalNumbers(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ArisGeometryError(`Non-finite number at ${path}.`)
    }
    if (!Number.isInteger(value)) {
      throw new ArisGeometryError(`Non-integer number at ${path}.`)
    }
    if (!Number.isSafeInteger(value)) {
      throw new ArisGeometryError(`Unsafe integer at ${path}.`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCanonicalNumbers(entry, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertCanonicalNumbers(entry, `${path}.${key}`)
    }
  }
}

/** Bounding box of a set of rectangles, or `null` when the set is empty. */
export function unionBounds(rects: readonly ArisBounds[]): ArisBounds | null {
  if (rects.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return toCanonicalBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
}
