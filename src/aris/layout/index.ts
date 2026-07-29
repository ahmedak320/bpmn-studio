/**
 * OrbitPM ARIS Studio Lite — clean layout engine (plan §12.4, §13.2, §14.4,
 * §19.2 step 7, §19.4).
 *
 * This package is a pure function of its input: a graph plus node sizes goes
 * in, coordinates plus routes come out. It has no dependency on the ARIS
 * working model, the source semantic index, the writer or the renderer, so it
 * can be wired to any of them by a thin adapter.
 *
 * ## Wiring seam
 *
 * ```ts
 * import { cleanLayoutRevision, sourceLayoutRevision } from '@/aris/layout'
 *
 * const graph: ArisLayoutGraphInput = {
 *   id: modelId,
 *   nodes: [
 *     // role: 'function' | 'event' | 'rule' | 'satellite' | 'other'
 *     { id: occurrenceId, role: 'function', size: { width, height },
 *       sourcePosition: { x, y }, label: { width, height }, laneId }
 *   ],
 *   edges: [
 *     { id: cxnOccId, source, target, kind: 'control-flow',
 *       sourceRoute: [{ x, y }, ...] }
 *   ],
 *   lanes: [{ id, orientation: 'horizontal' }]
 * }
 *
 * const working = cleanLayoutRevision(graph)   // mode: 'clean'
 * const original = sourceLayoutRevision(graph) // mode: 'source'
 * ```
 *
 * The adapter's only responsibilities are: map `OT_FUNC`/`OT_EVT`/`OT_RULE`
 * (and value-chain activities) to a `role`, map every other object type to
 * `'satellite'`, and mark a connection `'control-flow'` when it is one of the
 * EPC flow types (`CT_ACTIV_*`, `CT_CRT_*`, `CT_LEADS_TO_*`,
 * `CT_IS_PREDEC_OF_*`) and `'satellite'` otherwise.
 */

export type {
  ArisLayoutAcceptance,
  ArisLayoutAnnotationInput,
  ArisLayoutAnnotationPlacement,
  ArisLayoutEdgeClass,
  ArisLayoutEdgeInput,
  ArisLayoutEdgeKind,
  ArisLayoutEdgeRoute,
  ArisLayoutGraphInput,
  ArisLayoutLaneBand,
  ArisLayoutLaneInput,
  ArisLayoutLabelBox,
  ArisLayoutMetrics,
  ArisLayoutMode,
  ArisLayoutNodeInput,
  ArisLayoutNodePlacement,
  ArisLayoutNodeRole,
  ArisLayoutOptions,
  ArisLayoutOrientation,
  ArisLayoutPoint,
  ArisLayoutRect,
  ArisLayoutRejectionCode,
  ArisLayoutRejectionFinding,
  ArisLayoutRejectionMessageKey,
  ArisLayoutResult,
  ArisLayoutRevision,
  ArisLayoutRuleOperator,
  ArisLayoutSize,
  ArisLayoutSpacing,
  ArisLayoutSplitMergePair
} from './types'

export { cleanLayout, measureLayoutResult } from './cleanLayout'
export { placeAnnotations } from './annotations'
export type { ArisLayoutAnnotationInputSet } from './annotations'
export { cleanLayoutRevision, resetToSourceLayout, sourceLayoutRevision } from './modes'
export {
  ARIS_LAYOUT_REJECTION_CODES,
  DEFAULT_MAX_EMPTY_BAND_RATIO,
  arisLayoutRejectionMessageKey,
  evaluateLayoutAcceptance
} from './rejection'
export { analyzeLayout } from './metrics'
export type {
  DetachedEndpoint,
  EdgeShapeHit,
  LayoutAnalysis,
  LayoutDefects,
  LayoutMeasurementInput,
  OverlapPair
} from './metrics'
export {
  classifyEdges,
  detectSourceOrientation,
  findConnectedComponents,
  findStronglyConnectedComponents,
  separateGraphs
} from './graph'
export {
  LAYOUT_EPSILON,
  pointOnRectBoundary,
  rectsOverlap,
  segmentIntersectsRectInterior,
  segmentsProperlyCross
} from './geometry'
