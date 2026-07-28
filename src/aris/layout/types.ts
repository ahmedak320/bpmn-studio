/**
 * Input/output seam for the OrbitPM ARIS clean-layout engine (plan §12.4, §14.4).
 *
 * This module is intentionally self-contained: the layout engine consumes a
 * *minimal* graph description (identity, role, size, optional source geometry)
 * and produces coordinates plus routes. It never imports the working ARIS
 * model, the source semantic index, or the writer, so the adapter that maps
 * `ArisModel` -> `ArisLayoutGraphInput` can be written independently and can
 * change without touching a single line of geometry code.
 *
 * Coordinate convention
 * ---------------------
 * All rectangles are axis-aligned, `x`/`y` is the **top-left** corner, and
 * `y` grows downward — the same convention AML `<Position>`/`<Size>` uses.
 * All values are plain numbers in one consistent unit; the engine never
 * assumes pixels, millimetres or AML units, and derives its own spacing from
 * the control-flow node sizes it is handed.
 */

/** Reading direction of the control flow. */
export type ArisLayoutOrientation = 'top-to-bottom' | 'left-to-right'

/**
 * Semantic role of a node. `function`, `event` and `rule` form the EPC
 * control flow; `satellite` is any attached metadata object (owner, system,
 * data, policy, requirement, business rule); `other` is a control-flow member
 * whose EPC role is not one of the three (for example a value-added-chain
 * activity in `MT_VAL_ADD_CHN_DGM`).
 */
export type ArisLayoutNodeRole = 'function' | 'event' | 'rule' | 'satellite' | 'other'

/** Operator carried by an `OT_RULE` node. */
export type ArisLayoutRuleOperator = 'and' | 'or' | 'xor'

/** Whether an edge belongs to the control flow or attaches a satellite. */
export type ArisLayoutEdgeKind = 'control-flow' | 'satellite'

/** Result of step 4 of §14.4. */
export type ArisLayoutEdgeClass = 'forward' | 'back' | 'self-loop' | 'satellite'

export interface ArisLayoutPoint {
  readonly x: number
  readonly y: number
}

export interface ArisLayoutSize {
  readonly width: number
  readonly height: number
}

/** Axis-aligned rectangle, `x`/`y` = top-left corner. */
export interface ArisLayoutRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Space the renderer needs for a node's caption. The engine reserves it
 * *minimally* (§14.4 step 11): a caption that fits inside the shape reserves
 * nothing at all; only an overflowing caption grows the node's occupied box.
 */
export interface ArisLayoutLabelBox {
  readonly width: number
  readonly height: number
}

export interface ArisLayoutNodeInput {
  readonly id: string
  readonly role: ArisLayoutNodeRole
  /** Only meaningful when `role === 'rule'`. */
  readonly operator?: ArisLayoutRuleOperator
  readonly size: ArisLayoutSize
  /**
   * Top-left corner in the *source* layout. Used only to derive the source
   * orientation (§14.4 step 5) and to build a source-layout revision. The
   * engine never writes back to it.
   */
  readonly sourcePosition?: ArisLayoutPoint
  readonly label?: ArisLayoutLabelBox
  readonly laneId?: string
}

export interface ArisLayoutEdgeInput {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: ArisLayoutEdgeKind
  /** Imported route points, used only by the source-layout revision. */
  readonly sourceRoute?: readonly ArisLayoutPoint[]
}

export interface ArisLayoutLaneInput {
  readonly id: string
  readonly orientation: 'horizontal' | 'vertical'
  /** Optional stable ordering hint; ties fall back to input order. */
  readonly order?: number
}

/** One model's graph. `id` is only used to stamp the produced revision. */
export interface ArisLayoutGraphInput {
  readonly id: string
  readonly nodes: readonly ArisLayoutNodeInput[]
  readonly edges: readonly ArisLayoutEdgeInput[]
  readonly lanes?: readonly ArisLayoutLaneInput[]
}

/** Spacing knobs. Every field is optional; defaults are derived from sizes. */
export interface ArisLayoutSpacing {
  /** Distance between two consecutive rank bands, along the flow axis. */
  readonly rankGap?: number
  /** Distance between two neighbouring nodes inside one rank band. */
  readonly crossGap?: number
  /** Distance between two disconnected components. */
  readonly componentGap?: number
  /** Distance between two return channels outside the control-flow box. */
  readonly channelGap?: number
  /** Distance between two satellite trunk corridors. */
  readonly corridorGap?: number
  /** Outer margin around the whole canvas. */
  readonly margin?: number
  /** Gap between a shape and its reserved caption box. */
  readonly labelGap?: number
}

export interface ArisLayoutOptions {
  readonly spacing?: ArisLayoutSpacing
  /** Force an orientation instead of deriving it from `sourcePosition`. */
  readonly orientation?: ArisLayoutOrientation
  /** Maximum accept/repair rounds (§14.4 steps 12-13). Default 6. */
  readonly maxIterations?: number
  /** Largest empty band tolerated before `extreme-whitespace` is reported. */
  readonly maxEmptyBandRatio?: number
}

export interface ArisLayoutNodePlacement {
  readonly id: string
  readonly kind: 'control-flow' | 'satellite'
  readonly role: ArisLayoutNodeRole
  readonly rect: ArisLayoutRect
  /** Reserved caption box, or `null` when the caption fits inside `rect`. */
  readonly labelRect: ArisLayoutRect | null
  /** Index of the connected component (§14.4 step 2); satellites inherit their owner's. */
  readonly componentIndex: number
  /** Index of the strongly connected component (§14.4 step 3); `-1` for satellites. */
  readonly stronglyConnectedIndex: number
  /** Rank on the flow axis; `-1` for satellites. */
  readonly rank: number
  readonly laneId: string | null
}

export interface ArisLayoutEdgeRoute {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: ArisLayoutEdgeKind
  readonly classification: ArisLayoutEdgeClass
  /**
   * Orthogonal polyline. `points[0]` always lies on the *source* node's
   * boundary and the last point on the *target* node's boundary, whatever the
   * geometric direction of the route.
   */
  readonly points: readonly ArisLayoutPoint[]
}

/** Derived band a renderer can draw for an imported lane. Never a shape. */
export interface ArisLayoutLaneBand {
  readonly id: string
  readonly rect: ArisLayoutRect
  readonly orientation: 'horizontal' | 'vertical'
}

/** A split rule paired with its merge rule (§14.4 step 8). */
export interface ArisLayoutSplitMergePair {
  readonly splitId: string
  readonly mergeId: string | null
  readonly operator: ArisLayoutRuleOperator | null
  /** Branch entry node ids, left-to-right in the produced layout. */
  readonly branchEntryIds: readonly string[]
}

export interface ArisLayoutMetrics {
  /** Pairs of node rectangles with positive-area intersection. */
  readonly shapeOverlaps: number
  /**
   * Pairs involving a reserved caption box (caption vs shape, caption vs
   * caption) or a satellite shape. Satellite-vs-shape pairs are also counted
   * in `shapeOverlaps`; both must be zero for a layout to be accepted.
   */
  readonly labelSatelliteOverlaps: number
  /** (edge, unrelated shape) pairs where a segment enters the shape's interior. */
  readonly edgeShapeCrossings: number
  /** Unordered pairs of edges whose segments properly cross. */
  readonly edgeEdgeCrossings: number
  readonly bendCount: number
  readonly maxBendsPerEdge: number
  readonly routeLengthTotal: number
  readonly routeLengthMax: number
  readonly canvasArea: number
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly detachedEndpoints: number
  readonly missingEdges: number
  readonly duplicateEdges: number
  readonly zeroLengthEdges: number
  /** Largest fully empty vertical band, as a fraction of canvas width. */
  readonly largestEmptyBandXRatio: number
  /** Largest fully empty horizontal band, as a fraction of canvas height. */
  readonly largestEmptyBandYRatio: number
  /** Sum of shape areas divided by canvas area. */
  readonly shapeFillRatio: number
}

export type ArisLayoutRejectionCode =
  | 'shape-overlap'
  | 'label-satellite-overlap'
  | 'edge-through-unrelated-shape'
  | 'detached-endpoint'
  | 'missing-edge'
  | 'duplicate-edge'
  | 'zero-length-edge'
  | 'extreme-whitespace'

export type ArisLayoutRejectionMessageKey = `aris.layout.rejection.${ArisLayoutRejectionCode}`

/**
 * A structured, localizable rejection. It never carries English prose: the UI
 * resolves `messageKey` through `src/i18n` and formats `values` itself.
 */
export interface ArisLayoutRejectionFinding {
  readonly code: ArisLayoutRejectionCode
  readonly messageKey: ArisLayoutRejectionMessageKey
  /** Node ids / edge ids the finding is about, sorted, deduplicated. */
  readonly subjects: readonly string[]
  /** Numeric facts only — counts, ratios, coordinates. */
  readonly values: Readonly<Record<string, number>>
}

export interface ArisLayoutAcceptance {
  readonly accepted: boolean
  readonly findings: readonly ArisLayoutRejectionFinding[]
}

export interface ArisLayoutResult {
  readonly graphId: string
  readonly orientation: ArisLayoutOrientation
  readonly nodes: readonly ArisLayoutNodePlacement[]
  readonly edges: readonly ArisLayoutEdgeRoute[]
  readonly lanes: readonly ArisLayoutLaneBand[]
  readonly canvas: ArisLayoutRect
  readonly splitMergePairs: readonly ArisLayoutSplitMergePair[]
  readonly metrics: ArisLayoutMetrics
  readonly accepted: boolean
  readonly findings: readonly ArisLayoutRejectionFinding[]
  /** Number of accept/repair rounds actually performed (>= 1). */
  readonly iterations: number
}

export type ArisLayoutMode = 'source' | 'clean'

/**
 * The unit the working layout revision stores (plan §12.4). A clean layout is
 * always written as `mode: 'clean'`; `resetToSourceLayout` returns the
 * `mode: 'source'` revision rebuilt from the untouched input, which is why a
 * reset can never lose the imported geometry.
 */
export interface ArisLayoutRevision {
  readonly mode: ArisLayoutMode
  readonly graphId: string
  readonly orientation: ArisLayoutOrientation
  readonly nodes: readonly ArisLayoutNodePlacement[]
  readonly edges: readonly ArisLayoutEdgeRoute[]
  readonly lanes: readonly ArisLayoutLaneBand[]
  readonly canvas: ArisLayoutRect
}
