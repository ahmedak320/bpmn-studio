import type { EpcEdge, EpcGraph, EpcNode } from './types'
import { isControlFlowTriple } from './constants'

/**
 * A read-only index over an `EpcGraph`: node lookup plus adjacency lists restricted to
 * control-flow edges (see `isControlFlowTriple`). Building this once and sharing it between
 * the validator, the XOR classifier, and the return-path detector avoids repeated O(edges)
 * scans and keeps the "which edges count as flow" decision in one place.
 *
 * Every array exposed here is a fresh copy — nothing aliases the input graph's arrays, and
 * nothing here ever mutates `graph`.
 */
export interface FlowGraphIndex {
  readonly graph: EpcGraph
  readonly nodeById: ReadonlyMap<string, EpcNode>
  /** All edges, in input order, unfiltered. */
  readonly allEdges: readonly EpcEdge[]
  /** Edges classified as control flow (both endpoints resolve and are flow-node types). */
  readonly flowEdges: readonly EpcEdge[]
  readonly flowEdgesBySource: ReadonlyMap<string, readonly EpcEdge[]>
  readonly flowEdgesByTarget: ReadonlyMap<string, readonly EpcEdge[]>
}

export function isControlFlowEdge(edge: EpcEdge, nodeById: ReadonlyMap<string, EpcNode>): boolean {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  if (!source || !target) return false
  return isControlFlowTriple(edge.connectionType, source.objectType, target.objectType)
}

function pushInto<K>(map: Map<K, EpcEdge[]>, key: K, edge: EpcEdge): void {
  const list = map.get(key)
  if (list) list.push(edge)
  else map.set(key, [edge])
}

export function buildFlowGraphIndex(graph: EpcGraph): FlowGraphIndex {
  const nodeById = new Map<string, EpcNode>()
  for (const node of graph.nodes) nodeById.set(node.id, node)

  const allEdges = graph.edges.slice()
  const flowEdges: EpcEdge[] = []
  const bySource = new Map<string, EpcEdge[]>()
  const byTarget = new Map<string, EpcEdge[]>()

  for (const edge of graph.edges) {
    if (!isControlFlowEdge(edge, nodeById)) continue
    flowEdges.push(edge)
    pushInto(bySource, edge.source, edge)
    pushInto(byTarget, edge.target, edge)
  }

  return {
    graph,
    nodeById,
    allEdges,
    flowEdges,
    flowEdgesBySource: bySource,
    flowEdgesByTarget: byTarget
  }
}

/** Tarjan strongly-connected-components over the flow-edge subgraph. */
export function stronglyConnectedComponents(index: FlowGraphIndex): readonly (readonly string[])[] {
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []
  let counter = 0

  const adjacency = (id: string): readonly EpcEdge[] => index.flowEdgesBySource.get(id) ?? []

  function strongConnect(v: string): void {
    indices.set(v, counter)
    lowlink.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)

    for (const edge of adjacency(v)) {
      const w = edge.target
      if (!indices.has(w)) {
        strongConnect(w)
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!))
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = []
      for (;;) {
        const w = stack.pop()!
        onStack.delete(w)
        component.push(w)
        if (w === v) break
      }
      sccs.push(component)
    }
  }

  for (const node of index.graph.nodes) {
    if (!indices.has(node.id)) strongConnect(node.id)
  }

  return sccs
}

/** Maps every node id to the id-set of its strongly-connected component. */
export function sccMembership(index: FlowGraphIndex): ReadonlyMap<string, ReadonlySet<string>> {
  const sccs = stronglyConnectedComponents(index)
  const membership = new Map<string, ReadonlySet<string>>()
  for (const component of sccs) {
    const set = new Set(component)
    for (const id of component) membership.set(id, set)
  }
  return membership
}

/** True if `nodeId` participates in a cycle (its SCC has more than one member). */
export function isOnCycle(
  index: FlowGraphIndex,
  nodeId: string,
  membership: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const set = membership.get(nodeId)
  return !!set && set.size > 1
}

/**
 * Undirected connected components over the flow-edge subgraph (both directions traversed).
 * By default every node in the graph is included (as its own singleton component if it has
 * no flow edges); pass `restrictTo` to scope the traversal to a subset of node ids (e.g.
 * only the control-flow-typed nodes, so satellite objects with no flow edges of their own
 * don't get reported as "orphans" of a graph they were never part of).
 */
export function connectedComponents(
  index: FlowGraphIndex,
  restrictTo?: ReadonlySet<string>
): readonly (readonly string[])[] {
  const scope = restrictTo ?? new Set(index.graph.nodes.map((node) => node.id))
  const undirected = new Map<string, Set<string>>()
  const ensure = (id: string): Set<string> => {
    let set = undirected.get(id)
    if (!set) {
      set = new Set()
      undirected.set(id, set)
    }
    return set
  }
  for (const id of scope) ensure(id)
  for (const edge of index.flowEdges) {
    if (!scope.has(edge.source) || !scope.has(edge.target)) continue
    ensure(edge.source).add(edge.target)
    ensure(edge.target).add(edge.source)
  }

  const visited = new Set<string>()
  const components: string[][] = []
  for (const id of scope) {
    if (visited.has(id)) continue
    const component: string[] = []
    const queue = [id]
    visited.add(id)
    while (queue.length > 0) {
      const current = queue.shift()!
      component.push(current)
      for (const neighbor of undirected.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    components.push(component)
  }
  return components
}

/**
 * Reverse-BFS over flow edges from `startId`, returning each reachable ancestor's id and
 * hop distance (1 = direct predecessor). `startId` itself is excluded.
 */
export function upstreamDistances(
  index: FlowGraphIndex,
  startId: string
): ReadonlyMap<string, number> {
  const distances = new Map<string, number>()
  const queue: string[] = [startId]
  const seen = new Set<string>([startId])
  let frontier = 0
  while (queue.length > 0) {
    frontier += 1
    const levelSize = queue.length
    for (let i = 0; i < levelSize; i += 1) {
      const current = queue.shift()!
      const incoming = index.flowEdgesByTarget.get(current) ?? []
      for (const edge of incoming) {
        if (!seen.has(edge.source)) {
          seen.add(edge.source)
          distances.set(edge.source, frontier)
          queue.push(edge.source)
        }
      }
    }
  }
  return distances
}
