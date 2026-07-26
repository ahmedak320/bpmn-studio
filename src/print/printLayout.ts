// Print band-wrap engine (PURE — no DOM, no bpmn-js).
//
// A wide BPMN diagram printed onto one A4-landscape page shrinks every step to
// an unreadable sliver. Instead we keep the page landscape but slice the wide
// diagram into a stack of horizontal "bands" read in snake order (band 1 on
// top, band 2 below it, …). Each band is a vertical slice of the SAME diagram
// viewBox, so steps print far larger and the page is filled top-to-bottom.
//
// This module only decides WHERE to cut (the band rectangles, in diagram/SVG
// user units); PrintView renders one <svg viewBox=…> per band. Cuts prefer to
// land in the visual gaps BETWEEN shapes (so no box is sliced in half) but fall
// back to evenly-spaced "ideal" cuts when the diagram has no usable gap there.

/** A rectangle in diagram (SVG user-space) coordinates. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The chosen band layout. `scale` is the mm-per-px actually achieved (info). */
export interface BandPlan {
  bands: Rect[]
  wrapped: boolean
  scale: number
}

// --- page geometry constants (A4 landscape, minus print margins) -----------

/** Usable page width in mm (A4 landscape 297mm minus ~12mm margins each side). */
export const PAGE_W_MM = 273
/** Usable page height in mm (A4 landscape 210mm minus margins). */
export const PAGE_H_MM = 186
/** Vertical space reserved for the print header (title + folder + owner). */
export const HEADER_MM = 28
/** Vertical gap left between stacked bands, in mm. */
export const GAP_MM = 6
/** Never stack more than this many bands (readability / page-count guard). */
export const MAX_BANDS = 6
/** A gap between shapes must be at least this wide (px) to be a snap target. */
export const MIN_GAP_PX = 12
/** A cut may snap to a gap centre within this fraction of the ideal band width. */
export const SNAP_TOLERANCE = 0.15
/** Only add a band if it grows the scale by at least this (relative) fraction. */
export const MIN_GAIN = 0.08

interface Interval {
  start: number
  end: number
}

interface Gap {
  start: number
  end: number
  center: number
}

/**
 * Decide how many horizontal bands to wrap a diagram into and exactly where to
 * cut them. See the module header for the why.
 */
export function computeBandPlan(opts: {
  shapes: Rect[]
  viewbox: Rect
  pageWmm?: number
  pageHmm?: number
  headerMm?: number
  gapMm?: number
  maxBands?: number
}): BandPlan {
  const {
    shapes,
    viewbox,
    pageWmm = PAGE_W_MM,
    pageHmm = PAGE_H_MM,
    headerMm = HEADER_MM,
    gapMm = GAP_MM,
    maxBands = MAX_BANDS
  } = opts

  // Degenerate viewbox → nothing to slice, render as one band.
  if (viewbox.width <= 0 || viewbox.height <= 0) {
    return { bands: [{ ...viewbox }], wrapped: false, scale: 0 }
  }

  const availH = pageHmm - headerMm

  // For each candidate band-count N, the largest uniform scale (mm-per-px) that
  // fits both the band width onto the page width AND the N stacked bands (plus
  // the (N-1) inter-band gaps) into the available height.
  const candidates: { n: number; scale: number }[] = []
  for (let n = 1; n <= maxBands; n++) {
    const bandW = viewbox.width / n
    if (bandW <= 0) continue
    const wScale = pageWmm / bandW
    const hAvail = availH - (n - 1) * gapMm
    if (hAvail <= 0) continue
    const hScale = hAvail / (n * viewbox.height)
    const scaleN = Math.min(wScale, hScale)
    if (scaleN <= 0) continue
    candidates.push({ n, scale: scaleN })
  }

  if (candidates.length === 0) {
    return { bands: [{ ...viewbox }], wrapped: false, scale: 0 }
  }

  // Prefer the FEWEST bands whose scale is within MIN_GAIN of the best possible
  // scale — i.e. only pay for an extra band when it meaningfully enlarges steps.
  const globalMax = candidates.reduce((m, c) => Math.max(m, c.scale), 0)
  const threshold = (1 - MIN_GAIN) * globalMax
  const chosen =
    candidates.find((c) => c.scale >= threshold) ?? candidates[0]
  const N = chosen.n

  if (N === 1) {
    return { bands: [{ ...viewbox }], wrapped: false, scale: chosen.scale }
  }

  const bandW = viewbox.width / N
  const gaps = deriveGaps(shapes, viewbox)

  // Place the N-1 internal cuts, left → right, snapping to a nearby gap centre
  // when possible while keeping the cuts strictly increasing and well-spaced.
  const snapTol = SNAP_TOLERANCE * bandW
  const minSpacing = 0.4 * bandW
  const vbLeft = viewbox.x
  const vbRight = viewbox.x + viewbox.width

  const cuts: number[] = [vbLeft]
  for (let k = 1; k < N; k++) {
    const ideal = vbLeft + k * bandW
    let cut = ideal
    const nearest = nearestGap(gaps, ideal)
    if (nearest && Math.abs(nearest.center - ideal) <= snapTol) {
      const snapped = nearest.center
      const prev = cuts[cuts.length - 1]
      if (snapped >= prev + minSpacing && snapped <= vbRight - minSpacing) {
        cut = snapped
      }
    }
    cuts.push(cut)
  }
  cuts.push(vbRight)

  // Consecutive slices; they tile [viewbox.x, viewbox.x+width] exactly because
  // the first and last cut are the viewbox edges and widths telescope.
  const bands: Rect[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    bands.push({
      x: cuts[i],
      y: viewbox.y,
      width: cuts[i + 1] - cuts[i],
      height: viewbox.height
    })
  }

  return { bands, wrapped: true, scale: chosen.scale }
}

/**
 * Project every shape onto the x-axis, merge overlapping intervals, and return
 * the usable (>= MIN_GAP_PX) empty spans BETWEEN consecutive occupied intervals,
 * clipped to the viewbox x-range.
 */
function deriveGaps(shapes: Rect[], viewbox: Rect): Gap[] {
  const vbLeft = viewbox.x
  const vbRight = viewbox.x + viewbox.width

  const intervals: Interval[] = shapes
    .map((s) => ({ start: s.x, end: s.x + s.width }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start)

  const merged: Interval[] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end)
    } else {
      merged.push({ start: iv.start, end: iv.end })
    }
  }

  const gaps: Gap[] = []
  for (let i = 0; i + 1 < merged.length; i++) {
    const start = Math.max(merged[i].end, vbLeft)
    const end = Math.min(merged[i + 1].start, vbRight)
    if (end - start >= MIN_GAP_PX) {
      gaps.push({ start, end, center: (start + end) / 2 })
    }
  }
  return gaps
}

/** The gap whose centre is closest to `x`, or null when there are none. */
function nearestGap(gaps: Gap[], x: number): Gap | null {
  let best: Gap | null = null
  let bestDist = Infinity
  for (const g of gaps) {
    const d = Math.abs(g.center - x)
    if (d < bestDist) {
      bestDist = d
      best = g
    }
  }
  return best
}
