import { describe, it, expect } from 'vitest'
import {
  computeBandPlan,
  PAGE_W_MM,
  PAGE_H_MM,
  HEADER_MM,
  GAP_MM,
  MAX_BANDS,
  MIN_GAP_PX,
  SNAP_TOLERANCE,
  MIN_GAIN,
  type Rect
} from '../printLayout'

/** Ten 200px boxes on a 300px pitch → 100px gaps between consecutive boxes. */
function chainShapes(): Rect[] {
  return Array.from({ length: 10 }, (_, i) => ({
    x: i * 300,
    y: 100,
    width: 200,
    height: 100
  }))
}

/** The empty spans between consecutive chain boxes, e.g. [200,300],[500,600]… */
function chainGaps(): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = []
  for (let i = 0; i < 9; i++) gaps.push({ start: i * 300 + 200, end: (i + 1) * 300 })
  return gaps
}

function tilesExactly(bands: Rect[], viewbox: Rect): void {
  expect(bands[0].x).toBeCloseTo(viewbox.x, 6)
  const last = bands[bands.length - 1]
  expect(last.x + last.width).toBeCloseTo(viewbox.x + viewbox.width, 6)
  for (let i = 0; i + 1 < bands.length; i++) {
    // no gap and no overlap between consecutive bands
    expect(bands[i + 1].x).toBeCloseTo(bands[i].x + bands[i].width, 6)
    expect(bands[i].width).toBeGreaterThan(0)
    expect(bands[i].y).toBe(viewbox.y)
    expect(bands[i].height).toBe(viewbox.height)
  }
}

describe('computeBandPlan', () => {
  it('(a) wraps a wide chain, tiles exactly, and cuts land inside shape gaps', () => {
    const viewbox: Rect = { x: 0, y: 0, width: 3000, height: 300 }
    const plan = computeBandPlan({ shapes: chainShapes(), viewbox })

    expect(plan.wrapped).toBe(true)
    expect(plan.bands.length).toBeGreaterThanOrEqual(2)
    tilesExactly(plan.bands, viewbox)

    // Every internal cut (band boundary) sits within one of the shape gaps.
    const gaps = chainGaps()
    for (let i = 0; i + 1 < plan.bands.length; i++) {
      const cut = plan.bands[i].x + plan.bands[i].width
      const inGap = gaps.some((g) => cut >= g.start && cut <= g.end)
      expect(inGap).toBe(true)
    }
  })

  it('(b) keeps a compact diagram on a single band', () => {
    const viewbox: Rect = { x: 0, y: 0, width: 900, height: 600 }
    const plan = computeBandPlan({ shapes: [{ x: 0, y: 0, width: 900, height: 600 }], viewbox })

    expect(plan.wrapped).toBe(false)
    expect(plan.bands).toHaveLength(1)
    expect(plan.bands[0]).toEqual(viewbox)
  })

  it('(c) falls back to ideal cuts when the diagram has no usable gap', () => {
    const viewbox: Rect = { x: 0, y: 0, width: 3000, height: 300 }
    // One continuous shape → no inter-shape gap anywhere.
    const plan = computeBandPlan({ shapes: [{ x: 0, y: 100, width: 3000, height: 100 }], viewbox })

    expect(plan.wrapped).toBe(true)
    tilesExactly(plan.bands, viewbox)

    // Ideal (evenly-spaced) cuts are kept: each boundary is at k*bandW.
    const bandW = viewbox.width / plan.bands.length
    for (let i = 0; i + 1 < plan.bands.length; i++) {
      const cut = plan.bands[i].x + plan.bands[i].width
      expect(cut).toBeCloseTo((i + 1) * bandW, 6)
    }
  })

  it('(d) prefers fewer bands when the extra band gain is below MIN_GAIN', () => {
    // 2000x530: N=2 has a strictly HIGHER raw scale than N=1, but only by a few
    // percent (< MIN_GAIN), so the plan stays on one band.
    const viewbox: Rect = { x: 0, y: 0, width: 2000, height: 530 }
    const availH = PAGE_H_MM - HEADER_MM
    const scale1 = Math.min(PAGE_W_MM / 2000, availH / 530)
    const scale2 = Math.min(PAGE_W_MM / 1000, (availH - GAP_MM) / (2 * 530))
    // sanity: two bands really would be (marginally) larger…
    expect(scale2).toBeGreaterThan(scale1)
    expect(scale2 / scale1 - 1).toBeLessThan(MIN_GAIN)

    const plan = computeBandPlan({ shapes: [], viewbox })
    expect(plan.wrapped).toBe(false)
    expect(plan.bands).toHaveLength(1)
  })

  it('(e) exports the page-geometry constants', () => {
    expect(PAGE_W_MM).toBe(273)
    expect(PAGE_H_MM).toBe(186)
    expect(HEADER_MM).toBe(28)
    expect(GAP_MM).toBe(6)
    expect(MAX_BANDS).toBe(6)
    expect(MIN_GAP_PX).toBe(12)
    expect(SNAP_TOLERANCE).toBe(0.15)
    expect(MIN_GAIN).toBe(0.08)
  })

  it('never exceeds MAX_BANDS', () => {
    const viewbox: Rect = { x: 0, y: 0, width: 100000, height: 200 }
    const plan = computeBandPlan({ shapes: [], viewbox })
    expect(plan.bands.length).toBeLessThanOrEqual(MAX_BANDS)
  })

  it('handles a degenerate (zero-size) viewbox as a single unwrapped band', () => {
    const viewbox: Rect = { x: 0, y: 0, width: 0, height: 0 }
    const plan = computeBandPlan({ shapes: [], viewbox })
    expect(plan.wrapped).toBe(false)
    expect(plan.bands).toHaveLength(1)
  })
})
