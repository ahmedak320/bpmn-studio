/**
 * The clean-layout rejection gate — plan §14.4 (tail) and §19.4.
 *
 * A layout is rejected when it exhibits any of:
 *
 * * shape overlap,
 * * label/satellite overlap,
 * * an edge passing through an unrelated shape,
 * * a detached endpoint,
 * * a missing, duplicate or zero-length edge,
 * * unexplained extreme whitespace.
 *
 * Findings are structured data with stable i18n message keys — never English
 * prose — exactly like `ArisExcelIssue.messageKey` and the symbol fidelity
 * findings. The UI resolves `messageKey` through `src/i18n` and formats
 * `values`, which only ever contains numbers.
 */

import type {
  ArisLayoutAcceptance,
  ArisLayoutMetrics,
  ArisLayoutRejectionCode,
  ArisLayoutRejectionFinding,
  ArisLayoutRejectionMessageKey
} from './types'
import type { LayoutDefects } from './metrics'

export const ARIS_LAYOUT_REJECTION_CODES = Object.freeze([
  'shape-overlap',
  'label-satellite-overlap',
  'edge-through-unrelated-shape',
  'detached-endpoint',
  'missing-edge',
  'duplicate-edge',
  'zero-length-edge',
  'extreme-whitespace'
] as const satisfies readonly ArisLayoutRejectionCode[])

export function arisLayoutRejectionMessageKey(
  code: ArisLayoutRejectionCode
): ArisLayoutRejectionMessageKey {
  return `aris.layout.rejection.${code}`
}

/** Default share of the canvas an unexplained empty band may occupy. */
export const DEFAULT_MAX_EMPTY_BAND_RATIO = 0.25

/** Subjects are deduplicated and sorted so a finding is order-independent. */
function finding(
  code: ArisLayoutRejectionCode,
  subjects: readonly string[],
  values: Readonly<Record<string, number>>
): ArisLayoutRejectionFinding {
  const unique = [...new Set(subjects)].sort()
  return {
    code,
    messageKey: arisLayoutRejectionMessageKey(code),
    subjects: unique,
    values
  }
}

export interface AcceptanceOptions {
  /** Largest empty band tolerated, as a fraction of the canvas extent. */
  readonly maxEmptyBandRatio?: number
}

/**
 * Decide whether a measured layout may be emitted. The clean-layout engine
 * runs this on its own output and iterates rather than returning a rejected
 * layout (§14.4 steps 12-13).
 */
export function evaluateLayoutAcceptance(
  metrics: ArisLayoutMetrics,
  defects: LayoutDefects,
  options: AcceptanceOptions = {}
): ArisLayoutAcceptance {
  const maxEmptyBandRatio = options.maxEmptyBandRatio ?? DEFAULT_MAX_EMPTY_BAND_RATIO
  const findings: ArisLayoutRejectionFinding[] = []

  if (defects.shapeOverlaps.length > 0) {
    const subjects = defects.shapeOverlaps.flatMap((pair) => [pair.a, pair.b])
    const worst = defects.shapeOverlaps.reduce((highest, pair) => Math.max(highest, pair.area), 0)
    findings.push(
      finding('shape-overlap', subjects, {
        pairs: defects.shapeOverlaps.length,
        largestOverlapArea: worst
      })
    )
  }

  if (defects.labelSatelliteOverlaps.length > 0) {
    const subjects = defects.labelSatelliteOverlaps.flatMap((pair) => [pair.a, pair.b])
    const worst = defects.labelSatelliteOverlaps.reduce(
      (highest, pair) => Math.max(highest, pair.area),
      0
    )
    findings.push(
      finding('label-satellite-overlap', subjects, {
        pairs: defects.labelSatelliteOverlaps.length,
        largestOverlapArea: worst
      })
    )
  }

  if (defects.edgeShapeHits.length > 0) {
    const subjects = defects.edgeShapeHits.flatMap((hit) => [hit.edgeId, hit.nodeId])
    findings.push(
      finding('edge-through-unrelated-shape', subjects, { hits: defects.edgeShapeHits.length })
    )
  }

  if (defects.detachedEndpoints.length > 0) {
    const subjects = defects.detachedEndpoints.flatMap((entry) => [entry.edgeId, entry.nodeId])
    findings.push(
      finding('detached-endpoint', subjects, { endpoints: defects.detachedEndpoints.length })
    )
  }

  if (defects.missingEdgeIds.length > 0) {
    findings.push(
      finding('missing-edge', defects.missingEdgeIds, { edges: defects.missingEdgeIds.length })
    )
  }

  if (defects.duplicateEdgeIds.length > 0) {
    findings.push(
      finding('duplicate-edge', defects.duplicateEdgeIds, {
        edges: defects.duplicateEdgeIds.length
      })
    )
  }

  if (defects.zeroLengthEdgeIds.length > 0) {
    findings.push(
      finding('zero-length-edge', defects.zeroLengthEdgeIds, {
        edges: defects.zeroLengthEdgeIds.length
      })
    )
  }

  const worstBand = Math.max(metrics.largestEmptyBandXRatio, metrics.largestEmptyBandYRatio)
  if (worstBand > maxEmptyBandRatio) {
    findings.push(
      finding('extreme-whitespace', [], {
        largestEmptyBandXRatio: metrics.largestEmptyBandXRatio,
        largestEmptyBandYRatio: metrics.largestEmptyBandYRatio,
        limit: maxEmptyBandRatio
      })
    )
  }

  findings.sort(
    (left, right) =>
      ARIS_LAYOUT_REJECTION_CODES.indexOf(left.code) -
      ARIS_LAYOUT_REJECTION_CODES.indexOf(right.code)
  )
  return { accepted: findings.length === 0, findings }
}
