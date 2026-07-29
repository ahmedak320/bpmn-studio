/**
 * Steps 6-8 and 11-12 of the clean-layout algorithm (plan §14.4) in flow space.
 *
 *  6. Place the primary flow on a stable spine.
 *  7. Place AND/OR/XOR branches symmetrically around the spine.
 *  8. Pair split and merge rules when the topology supports it.
 * 11. Reserve space for labels minimally (via `occupiedBoxOf`).
 * 12. Resolve collisions iteratively (per-rank separation sweep).
 *
 * Only control-flow nodes are ranked and only control-flow nodes contribute to
 * rank-band sizes and spacing defaults. That is the §13.2 guarantee: metadata
 * can never expand the core flow grid.
 */

import type {
  ArisLayoutEdgeInput,
  ArisLayoutNodeInput,
  ArisLayoutOrientation,
  ArisLayoutRuleOperator,
  ArisLayoutSplitMergePair
} from './types'
import { occupiedBoxOf, type OccupiedBox } from './axis'
import type { ConnectedComponents, DirectedAdjacency, EdgeClassification } from './graph'
import { LAYOUT_EPSILON } from './geometry'

/** Fully resolved spacing. Every value is a positive number. */
export interface ResolvedSpacing {
  readonly rankGap: number
  readonly crossGap: number
  readonly componentGap: number
  readonly channelGap: number
  readonly corridorGap: number
  readonly margin: number
  readonly labelGap: number
}

export interface ControlPlacement {
  readonly orientation: ArisLayoutOrientation
  readonly spacing: ResolvedSpacing
  readonly boxes: readonly OccupiedBox[]
  /** Rank of each control node; every value is >= 0. */
  readonly rankOf: readonly number[]
  /** Occupied-box centre across the flow axis. */
  readonly crossOf: readonly number[]
  /** Occupied-box centre along the flow axis. */
  readonly alongOf: readonly number[]
  readonly rankCount: number
  /** `rankNodes[r]` = control node indices in rank `r`, ascending. */
  readonly rankNodes: readonly (readonly number[])[]
  readonly bandStart: readonly number[]
  readonly bandEnd: readonly number[]
  /** Gap `g` sits before rank `g`; gap `rankCount` sits after the last rank. */
  readonly gapStart: readonly number[]
  readonly gapEnd: readonly number[]
  readonly splitMergePairs: readonly ArisLayoutSplitMergePair[]
  /** Control-flow extent across the flow axis, occupied boxes included. */
  readonly crossMin: number
  readonly crossMax: number
}

function median(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback
  const sorted = [...values].sort((left, right) => left - right)
  const middle = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/**
 * Spacing defaults are derived from the **control-flow** node sizes only, so
 * adding satellites can never change the grid (§13.2). They are also unit
 * agnostic: AML hundredths of a millimetre and CSS pixels both behave.
 */
export function resolveSpacing(
  controlNodes: readonly ArisLayoutNodeInput[],
  orientation: ArisLayoutOrientation,
  overrides: {
    rankGap?: number
    crossGap?: number
    componentGap?: number
    channelGap?: number
    corridorGap?: number
    margin?: number
    labelGap?: number
  } = {}
): ResolvedSpacing {
  const alongSizes = controlNodes.map((node) =>
    orientation === 'top-to-bottom' ? node.size.height : node.size.width
  )
  const crossSizes = controlNodes.map((node) =>
    orientation === 'top-to-bottom' ? node.size.width : node.size.height
  )
  const medianAlong = median(alongSizes, 60)
  const medianCross = median(crossSizes, 120)
  const rankGap = overrides.rankGap ?? Math.max(40, Math.round(medianAlong * 0.8))
  const crossGap = overrides.crossGap ?? Math.max(40, Math.round(medianCross * 0.35))
  return {
    rankGap,
    crossGap,
    componentGap: overrides.componentGap ?? crossGap * 3,
    channelGap: overrides.channelGap ?? Math.max(20, Math.round(crossGap * 0.6)),
    corridorGap: overrides.corridorGap ?? Math.max(12, Math.round(crossGap * 0.35)),
    margin: overrides.margin ?? Math.max(40, rankGap),
    labelGap: overrides.labelGap ?? Math.max(4, Math.round(rankGap * 0.1))
  }
}

interface ForwardGraph {
  /** `successors[i]` = distinct forward successors of `i`, in edge order. */
  readonly successors: readonly (readonly number[])[]
  readonly predecessors: readonly (readonly number[])[]
}

function buildForwardGraph(
  adjacency: DirectedAdjacency,
  classification: EdgeClassification
): ForwardGraph {
  const successors: number[][] = adjacency.ids.map(() => [])
  const predecessors: number[][] = adjacency.ids.map(() => [])
  for (const edgeIndex of classification.forwardEdgeIndices) {
    const edge = adjacency.edges[edgeIndex] as ArisLayoutEdgeInput
    const source = adjacency.indexOf.get(edge.source)
    const target = adjacency.indexOf.get(edge.target)
    if (source === undefined || target === undefined || source === target) continue
    const outgoing = successors[source] as number[]
    if (!outgoing.includes(target)) outgoing.push(target)
    const incoming = predecessors[target] as number[]
    if (!incoming.includes(source)) incoming.push(source)
  }
  return { successors, predecessors }
}

/**
 * Longest-path ranking over the acyclic forward graph, evaluated with an
 * explicit stack so a 500-node chain cannot overflow.
 */
function assignRanks(forward: ForwardGraph, nodeCount: number): number[] {
  const rank = new Array<number>(nodeCount).fill(-1)
  for (let start = 0; start < nodeCount; start += 1) {
    if (rank[start] !== -1) continue
    const stack: number[] = [start]
    while (stack.length > 0) {
      const node = stack[stack.length - 1] as number
      if (rank[node] !== -1) {
        stack.pop()
        continue
      }
      const predecessors = forward.predecessors[node] as readonly number[]
      let pending = false
      let best = 0
      for (const predecessor of predecessors) {
        const value = rank[predecessor] as number
        if (value === -1) {
          stack.push(predecessor)
          pending = true
        } else if (value + 1 > best) {
          best = value + 1
        }
      }
      if (pending) continue
      rank[node] = best
      stack.pop()
    }
  }
  return rank
}

/** Forward-reachable set of `start`, including `start` itself. */
function forwardReachable(forward: ForwardGraph, start: number, nodeCount: number): boolean[] {
  const seen = new Array<boolean>(nodeCount).fill(false)
  const queue: number[] = [start]
  seen[start] = true
  while (queue.length > 0) {
    const node = queue.shift() as number
    for (const next of forward.successors[node] as readonly number[]) {
      if (seen[next]) continue
      seen[next] = true
      queue.push(next)
    }
  }
  return seen
}

interface BranchLayout {
  readonly cross: Map<number, number>
  readonly min: number
  readonly max: number
}

const EMPTY_BRANCH: BranchLayout = { cross: new Map<number, number>(), min: 0, max: 0 }

/**
 * Cross-axis placement for one connected component.
 *
 * The walk keeps the primary flow on a stable spine at cross `0` (step 6). At
 * every split it lays each branch out in its own local coordinate system, then
 * gives **every** branch the same column width and places the columns at
 * `(i - (k-1)/2) * (columnWidth + crossGap)`. Those offsets are exactly
 * symmetric about the split for any branch count, which is step 7, and the
 * merge partner found by `findMerge` is step 8.
 */
class ComponentCrossLayout {
  private readonly claimed: boolean[]

  private readonly pairs: ArisLayoutSplitMergePair[] = []

  constructor(
    private readonly forward: ForwardGraph,
    private readonly rank: readonly number[],
    private readonly boxes: readonly OccupiedBox[],
    private readonly nodes: readonly ArisLayoutNodeInput[],
    private readonly componentOf: readonly number[],
    private readonly crossGap: number,
    nodeCount: number
  ) {
    this.claimed = new Array<boolean>(nodeCount).fill(false)
  }

  get splitMergePairs(): readonly ArisLayoutSplitMergePair[] {
    return this.pairs
  }

  layoutComponent(members: readonly number[]): Map<number, number> {
    const roots = members.filter(
      (member) => (this.forward.predecessors[member] as readonly number[]).length === 0
    )
    const entries = roots.length > 0 ? roots : [members[0] as number]
    const parallel = this.layoutParallel(entries, null)
    const result = new Map(parallel.cross)
    // Anything the spine walk could not reach (cross links between branches,
    // nodes only reachable through a back edge) is anchored to the median of
    // its already placed neighbours and separated later by `separateRanks`.
    for (const member of members) {
      if (result.has(member)) continue
      const neighbours: number[] = []
      for (const predecessor of this.forward.predecessors[member] as readonly number[]) {
        const value = result.get(predecessor)
        if (value !== undefined) neighbours.push(value)
      }
      for (const successor of this.forward.successors[member] as readonly number[]) {
        const value = result.get(successor)
        if (value !== undefined) neighbours.push(value)
      }
      neighbours.sort((left, right) => left - right)
      const anchor = neighbours.length === 0 ? 0 : (neighbours[neighbours.length >> 1] as number)
      result.set(member, anchor)
      this.claimed[member] = true
    }
    return result
  }

  /** Lay `entries` out as symmetric columns, each walked until `stop`. */
  private layoutParallel(entries: readonly number[], stop: number | null): BranchLayout {
    if (entries.length === 1) {
      return this.measure(this.walkChain(entries[0] as number, stop))
    }
    const branches = entries.map((entry) => {
      if (entry === stop || this.claimed[entry]) return EMPTY_BRANCH
      return this.measure(this.walkChain(entry, stop))
    })
    let columnWidth = 0
    for (const branch of branches) columnWidth = Math.max(columnWidth, branch.max - branch.min)
    const step = columnWidth + this.crossGap
    const merged = new Map<number, number>()
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    branches.forEach((branch, index) => {
      const columnCenter = (index - (branches.length - 1) / 2) * step
      const branchCenter = (branch.min + branch.max) / 2
      const shift = columnCenter - branchCenter
      for (const [node, value] of [...branch.cross.entries()].sort(
        (left, right) => left[0] - right[0]
      )) {
        merged.set(node, value + shift)
      }
      min = Math.min(min, columnCenter - columnWidth / 2)
      max = Math.max(max, columnCenter + columnWidth / 2)
    })
    if (!Number.isFinite(min)) return EMPTY_BRANCH
    return { cross: merged, min, max }
  }

  /** Walk the spine from `start` until `stop`, recursing into every split. */
  private walkChain(start: number, stop: number | null): Map<number, number> {
    const local = new Map<number, number>()
    let node: number | null = start
    while (node !== null) {
      if (stop !== null && node === stop) break
      if (this.claimed[node]) break
      this.claimed[node] = true
      local.set(node, 0)
      const successors = (this.forward.successors[node] as readonly number[]).filter(
        (candidate) => this.componentOf[candidate] === this.componentOf[node as number]
      )
      if (successors.length === 0) break
      if (successors.length === 1) {
        const next = successors[0] as number
        if (next === stop || this.claimed[next]) break
        node = next
        continue
      }
      const merge = this.findMerge(node, successors)
      this.recordPair(node, merge, successors)
      const branchStop = merge ?? stop
      const fan = this.layoutParallel(successors, branchStop)
      for (const [member, value] of [...fan.cross.entries()].sort(
        (left, right) => left[0] - right[0]
      )) {
        local.set(member, value)
      }
      if (merge === null || merge === stop || this.claimed[merge]) break
      node = merge
    }
    return local
  }

  private recordPair(split: number, merge: number | null, successors: readonly number[]): void {
    const splitNode = this.nodes[split] as ArisLayoutNodeInput
    const operator: ArisLayoutRuleOperator | null =
      splitNode.role === 'rule' ? (splitNode.operator ?? null) : null
    this.pairs.push({
      splitId: splitNode.id,
      mergeId: merge === null ? null : (this.nodes[merge] as ArisLayoutNodeInput).id,
      operator,
      branchEntryIds: successors.map((entry) => (this.nodes[entry] as ArisLayoutNodeInput).id)
    })
  }

  /**
   * Step 8: the merge partner of a split is the lowest-ranked node reachable
   * from *every* branch. When no such node exists the split simply has no
   * partner and the fan is left open, which is exactly what the plan means by
   * "when the topology supports it".
   */
  private findMerge(split: number, successors: readonly number[]): number | null {
    const nodeCount = this.forward.successors.length
    let intersection: boolean[] | null = null
    for (const successor of successors) {
      const reachable = forwardReachable(this.forward, successor, nodeCount)
      if (intersection === null) {
        intersection = reachable
        continue
      }
      for (let index = 0; index < nodeCount; index += 1) {
        if (!reachable[index]) intersection[index] = false
      }
    }
    if (intersection === null) return null
    let best: number | null = null
    for (let index = 0; index < nodeCount; index += 1) {
      if (!intersection[index]) continue
      if (index === split) continue
      if ((this.rank[index] as number) <= (this.rank[split] as number)) continue
      if (best === null || (this.rank[index] as number) < (this.rank[best] as number)) best = index
    }
    return best
  }

  private measure(cross: Map<number, number>): BranchLayout {
    if (cross.size === 0) return EMPTY_BRANCH
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const [node, value] of cross) {
      const half = (this.boxes[node] as OccupiedBox).cross / 2
      min = Math.min(min, value - half)
      max = Math.max(max, value + half)
    }
    return { cross, min, max }
  }
}

/**
 * Step 12, cross axis: push overlapping nodes of one rank apart, preserving
 * their left-to-right order. The sweep only fires where a violation exists, so
 * a well-formed symmetric fan is never disturbed.
 */
function separateRanks(
  rankNodes: readonly (readonly number[])[],
  crossOf: number[],
  boxes: readonly OccupiedBox[],
  crossGap: number
): number {
  let corrections = 0
  for (const members of rankNodes) {
    if (members.length < 2) continue
    const ordered = [...members].sort(
      (left, right) => (crossOf[left] as number) - (crossOf[right] as number) || left - right
    )
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1] as number
      const current = ordered[index] as number
      const required =
        (crossOf[previous] as number) +
        (boxes[previous] as OccupiedBox).cross / 2 +
        crossGap +
        (boxes[current] as OccupiedBox).cross / 2
      if ((crossOf[current] as number) < required - LAYOUT_EPSILON) {
        const shift = required - (crossOf[current] as number)
        for (let rest = index; rest < ordered.length; rest += 1) {
          crossOf[ordered[rest] as number] = (crossOf[ordered[rest] as number] as number) + shift
        }
        corrections += 1
      }
    }
  }
  return corrections
}

/** Run steps 6-8 and the cross-axis part of step 12 for the whole graph. */
export function placeControlFlow(
  controlNodes: readonly ArisLayoutNodeInput[],
  adjacency: DirectedAdjacency,
  classification: EdgeClassification,
  components: ConnectedComponents,
  orientation: ArisLayoutOrientation,
  spacing: ResolvedSpacing
): ControlPlacement {
  const nodeCount = controlNodes.length
  const boxes = controlNodes.map((node) => occupiedBoxOf(node, orientation, spacing.labelGap))
  const forward = buildForwardGraph(adjacency, classification)
  const rankOf = assignRanks(forward, nodeCount)

  const layout = new ComponentCrossLayout(
    forward,
    rankOf,
    boxes,
    controlNodes,
    components.componentOf,
    spacing.crossGap,
    nodeCount
  )

  const crossOf = new Array<number>(nodeCount).fill(0)
  let cursor = spacing.margin
  for (const members of components.components) {
    const placed = layout.layoutComponent(members)
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const member of members) {
      const value = placed.get(member) ?? 0
      const half = (boxes[member] as OccupiedBox).cross / 2
      min = Math.min(min, value - half)
      max = Math.max(max, value + half)
    }
    if (!Number.isFinite(min)) {
      min = 0
      max = 0
    }
    const shift = cursor - min
    for (const member of members) crossOf[member] = (placed.get(member) ?? 0) + shift
    cursor = cursor + (max - min) + spacing.componentGap
  }

  const rankCount = rankOf.reduce((highest, value) => Math.max(highest, value + 1), 0)
  const rankNodes: number[][] = Array.from({ length: rankCount }, () => [])
  for (let index = 0; index < nodeCount; index += 1) {
    ;(rankNodes[rankOf[index] as number] as number[]).push(index)
  }

  // Step 12 (cross axis). Iterate: one pass can create a new violation with a
  // node further right, so repeat until the layout is stable.
  for (let iteration = 0; iteration < 8; iteration += 1) {
    if (separateRanks(rankNodes, crossOf, boxes, spacing.crossGap) === 0) break
  }

  const bandStart: number[] = []
  const bandEnd: number[] = []
  let along = spacing.margin + spacing.rankGap
  for (let rank = 0; rank < rankCount; rank += 1) {
    let height = 0
    for (const member of rankNodes[rank] as readonly number[]) {
      height = Math.max(height, (boxes[member] as OccupiedBox).along)
    }
    bandStart.push(along)
    bandEnd.push(along + height)
    along = along + height + spacing.rankGap
  }

  const gapStart: number[] = []
  const gapEnd: number[] = []
  for (let gap = 0; gap <= rankCount; gap += 1) {
    const start = gap === 0 ? spacing.margin : (bandEnd[gap - 1] as number)
    const end = gap === rankCount ? start + spacing.rankGap : (bandStart[gap] as number)
    gapStart.push(start)
    gapEnd.push(end)
  }

  const alongOf = new Array<number>(nodeCount).fill(0)
  for (let index = 0; index < nodeCount; index += 1) {
    const rank = rankOf[index] as number
    alongOf[index] = ((bandStart[rank] as number) + (bandEnd[rank] as number)) / 2
  }

  let crossMin = Number.POSITIVE_INFINITY
  let crossMax = Number.NEGATIVE_INFINITY
  for (let index = 0; index < nodeCount; index += 1) {
    const half = (boxes[index] as OccupiedBox).cross / 2
    crossMin = Math.min(crossMin, (crossOf[index] as number) - half)
    crossMax = Math.max(crossMax, (crossOf[index] as number) + half)
  }
  if (!Number.isFinite(crossMin)) {
    crossMin = spacing.margin
    crossMax = spacing.margin
  }

  return {
    orientation,
    spacing,
    boxes,
    rankOf,
    crossOf,
    alongOf,
    rankCount,
    rankNodes,
    bandStart,
    bandEnd,
    gapStart,
    gapEnd,
    splitMergePairs: layout.splitMergePairs,
    crossMin,
    crossMax
  }
}
