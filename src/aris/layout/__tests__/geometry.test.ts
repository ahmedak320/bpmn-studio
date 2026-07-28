import { describe, expect, it } from 'vitest'

import {
  LAYOUT_EPSILON,
  boundsOfPoints,
  freeIntervals,
  intersectIntervals,
  largestInteriorGap,
  nearestValueInIntervals,
  pointInRectInterior,
  pointOnRectBoundary,
  polylineLength,
  rectIntersectionArea,
  rectsOverlap,
  segmentInsideRectLength,
  segmentIntersectsRectInterior,
  segmentLength,
  segmentsProperlyCross,
  unionRect
} from '../geometry'

describe('rectangle primitives', () => {
  it('computes an intersection area that can be checked by hand', () => {
    // 10x10 at the origin against 10x10 at (5,5) share the 5x5 square (5,5)-(10,10).
    expect(rectIntersectionArea(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 }
    )).toBe(25)
  })

  it('reports zero area for rectangles that only touch', () => {
    expect(rectIntersectionArea(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 }
    )).toBe(0)
    expect(rectsOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 }
    )).toBe(false)
  })

  it('reports an overlap for rectangles that share area', () => {
    expect(rectsOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 9.5, y: 0, width: 10, height: 10 }
    )).toBe(true)
  })

  it('unions two rectangles into their bounding box', () => {
    expect(unionRect(
      { x: 0, y: 0, width: 10, height: 4 },
      { x: 20, y: -6, width: 5, height: 5 }
    )).toEqual({ x: 0, y: -6, width: 25, height: 10 })
  })

  it('bounds a point set', () => {
    expect(boundsOfPoints([
      { x: 3, y: 7 },
      { x: -2, y: 11 },
      { x: 5, y: 1 }
    ])).toEqual({ x: -2, y: 1, width: 7, height: 10 })
    expect(boundsOfPoints([])).toBeNull()
  })
})

describe('point classification', () => {
  const rect = { x: 0, y: 0, width: 100, height: 50 }

  it('accepts a point on the outline and rejects one inside or outside', () => {
    expect(pointOnRectBoundary({ x: 50, y: 0 }, rect)).toBe(true)
    expect(pointOnRectBoundary({ x: 100, y: 25 }, rect)).toBe(true)
    expect(pointOnRectBoundary({ x: 0, y: 50 }, rect)).toBe(true)
    expect(pointOnRectBoundary({ x: 50, y: 25 }, rect)).toBe(false)
    expect(pointOnRectBoundary({ x: 101, y: 25 }, rect)).toBe(false)
  })

  it('honours an explicit tolerance', () => {
    expect(pointOnRectBoundary({ x: 50, y: -0.4 }, rect)).toBe(false)
    expect(pointOnRectBoundary({ x: 50, y: -0.4 }, rect, 0.5)).toBe(true)
  })

  it('detects strict interior points', () => {
    expect(pointInRectInterior({ x: 50, y: 25 }, rect)).toBe(true)
    expect(pointInRectInterior({ x: 50, y: 0 }, rect)).toBe(false)
  })
})

describe('segment length', () => {
  it('matches the 3-4-5 triangle', () => {
    expect(segmentLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('sums a polyline', () => {
    // (0,0)->(0,10)->(10,10)->(10,0) is 10 + 10 + 10.
    expect(polylineLength([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 }
    ])).toBe(30)
  })
})

describe('segment against rectangle', () => {
  const rect = { x: 5, y: 0, width: 10, height: 10 }

  it('clips a horizontal segment to the exact interior length', () => {
    // The segment y=5 from x=0 to x=20 is inside for x in [5,15]. The default
    // tolerance shrinks the rectangle by LAYOUT_EPSILON on each side, so the
    // exact answer is 10 - 2*LAYOUT_EPSILON.
    expect(segmentInsideRectLength({ x: 0, y: 5 }, { x: 20, y: 5 }, rect)).toBeCloseTo(
      10 - 2 * LAYOUT_EPSILON,
      9
    )
    expect(segmentIntersectsRectInterior({ x: 0, y: 5 }, { x: 20, y: 5 }, rect)).toBe(true)
  })

  it('treats a segment running along an edge as outside', () => {
    expect(segmentInsideRectLength({ x: 0, y: 0 }, { x: 20, y: 0 }, rect)).toBe(0)
    expect(segmentIntersectsRectInterior({ x: 0, y: 0 }, { x: 20, y: 0 }, rect)).toBe(false)
  })

  it('clips a diagonal segment to the exact interior length', () => {
    // (0,0)->(10,10) crosses {2,2,6,6} from (2,2) to (8,8): 6*sqrt(2), less
    // the LAYOUT_EPSILON the rectangle is shrunk by on each side.
    expect(
      segmentInsideRectLength({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 2, y: 2, width: 6, height: 6 })
    ).toBeCloseTo((6 - 2 * LAYOUT_EPSILON) * Math.SQRT2, 9)
  })

  it('returns zero when the segment stops before the rectangle', () => {
    expect(segmentInsideRectLength({ x: 0, y: 5 }, { x: 4, y: 5 }, rect)).toBe(0)
  })

  it('handles a segment fully inside', () => {
    expect(segmentInsideRectLength({ x: 6, y: 5 }, { x: 14, y: 5 }, rect)).toBe(8)
  })
})

describe('segment against segment', () => {
  it('detects a proper crossing', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: -5 },
      { x: 5, y: 5 }
    )).toBe(true)
  })

  it('does not count a T junction', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 }
    )).toBe(false)
  })

  it('does not count a shared endpoint', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 }
    )).toBe(false)
  })

  it('does not count a collinear overlap', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 15, y: 0 }
    )).toBe(false)
  })

  it('does not count segments that miss each other', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: -5 },
      { x: 20, y: 5 }
    )).toBe(false)
  })

  it('detects a crossing of two diagonals', () => {
    expect(segmentsProperlyCross(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 }
    )).toBe(true)
  })
})

describe('interval algebra', () => {
  it('computes the complement of overlapping blocked ranges', () => {
    expect(freeIntervals({ min: 0, max: 100 }, [
      { min: 10, max: 20 },
      { min: 15, max: 30 },
      { min: 50, max: 60 }
    ])).toEqual([
      { min: 0, max: 10 },
      { min: 30, max: 50 },
      { min: 60, max: 100 }
    ])
  })

  it('intersects two interval lists', () => {
    expect(intersectIntervals(
      [
        { min: 0, max: 10 },
        { min: 20, max: 40 }
      ],
      [
        { min: 5, max: 25 },
        { min: 30, max: 50 }
      ]
    )).toEqual([
      { min: 5, max: 10 },
      { min: 20, max: 25 },
      { min: 30, max: 40 }
    ])
  })

  it('picks the value nearest to the preferred one', () => {
    expect(nearestValueInIntervals([{ min: 0, max: 10 }, { min: 90, max: 100 }], 8)).toBe(8)
    expect(nearestValueInIntervals([{ min: 0, max: 10 }, { min: 90, max: 100 }], 40)).toBe(10)
    expect(nearestValueInIntervals([{ min: 0, max: 10 }, { min: 90, max: 100 }], 80)).toBe(90)
    expect(nearestValueInIntervals([], 5)).toBeNull()
  })

  it('keeps the requested clearance from an interval edge', () => {
    expect(nearestValueInIntervals([{ min: 0, max: 10 }], 40, 2)).toBe(8)
  })

  it('measures the largest interior gap and ignores the outer margins', () => {
    // Covered 0-10, 40-50, 90-100 leaves interior gaps of 30 and 40.
    expect(largestInteriorGap({ min: 0, max: 100 }, [
      { min: 0, max: 10 },
      { min: 40, max: 50 },
      { min: 90, max: 100 }
    ])).toBe(40)
  })

  it('ignores a gap that touches the bounds', () => {
    expect(largestInteriorGap({ min: 0, max: 100 }, [{ min: 40, max: 60 }])).toBe(0)
  })
})
