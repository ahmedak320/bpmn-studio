/**
 * Steps 1-5 of the clean-layout algorithm (plan §14.4).
 *
 * 1. Separate the control-flow graph from the satellite graph.
 * 2. Find connected components.
 * 3. Find strongly connected components.
 * 4. Classify forward edges and back edges.
 * 5. Preserve the source orientation.
 *
 * Every traversal here iterates arrays in input order and every derived set is
 * emitted sorted by input index, so the whole module is order-stable: no
 * `Map`/`Set` iteration ever reaches the output without an explicit sort.
 */

import type {
  ArisLayoutEdgeClass,
  ArisLayoutEdgeInput,
  ArisLayoutGraphInput,
  ArisLayoutNodeInput,
  ArisLayoutOrientation
} from './types'

/** Result of step 1. */
export interface SeparatedGraph {
  /** Nodes whose role is not `satellite`, in input order. */
  readonly controlNodes: readonly ArisLayoutNodeInput[]
  /** Edges between two control-flow nodes whose kind is `control-flow`. */
  readonly controlEdges: readonly ArisLayoutEdgeInput[]
  /** Nodes whose role is `satellite`, in input order. */
  readonly satelliteNodes: readonly ArisLayoutNodeInput[]
  /** Every remaining edge that has both endpoints present in the graph. */
  readonly satelliteEdges: readonly ArisLayoutEdgeInput[]
  /** Edges whose source or target is unknown; they can never be routed. */
  readonly danglingEdges: readonly ArisLayoutEdgeInput[]
}

/**
 * Step 1. An edge counts as control flow only when it is declared
 * `control-flow` *and* both of its endpoints are control-flow nodes. Anything
 * else (including a `control-flow` edge that happens to touch a satellite) is
 * treated as satellite attachment, which keeps the backbone free of metadata.
 */
export function separateGraphs(graph: ArisLayoutGraphInput): SeparatedGraph {
  const controlNodes: ArisLayoutNodeInput[] = []
  const satelliteNodes: ArisLayoutNodeInput[] = []
  const roleById = new Map<string, ArisLayoutNodeInput>()
  for (const node of graph.nodes) {
    if (roleById.has(node.id)) continue
    roleById.set(node.id, node)
    if (node.role === 'satellite') satelliteNodes.push(node)
    else controlNodes.push(node)
  }

  const controlEdges: ArisLayoutEdgeInput[] = []
  const satelliteEdges: ArisLayoutEdgeInput[] = []
  const danglingEdges: ArisLayoutEdgeInput[] = []
  const seenEdgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (seenEdgeIds.has(edge.id)) continue
    seenEdgeIds.add(edge.id)
    const source = roleById.get(edge.source)
    const target = roleById.get(edge.target)
    if (!source || !target) {
      danglingEdges.push(edge)
      continue
    }
    const isControl =
      edge.kind === 'control-flow' && source.role !== 'satellite' && target.role !== 'satellite'
    if (isControl) controlEdges.push(edge)
    else satelliteEdges.push(edge)
  }

  return { controlNodes, controlEdges, satelliteNodes, satelliteEdges, danglingEdges }
}

/** Adjacency built once and reused by steps 2-4. Arrays stay in input order. */
export interface DirectedAdjacency {
  readonly ids: readonly string[]
  readonly indexOf: ReadonlyMap<string, number>
  /** `out[i]` = indices of edges leaving node `i`, in edge input order. */
  readonly out: readonly (readonly number[])[]
  /** `in[i]` = indices of edges entering node `i`, in edge input order. */
  readonly in: readonly (readonly number[])[]
  readonly edges: readonly ArisLayoutEdgeInput[]
}

export function buildAdjacency(
  nodes: readonly ArisLayoutNodeInput[],
  edges: readonly ArisLayoutEdgeInput[]
): DirectedAdjacency {
  const ids = nodes.map((node) => node.id)
  const indexOf = new Map<string, number>()
  ids.forEach((id, index) => indexOf.set(id, index))
  const out: number[][] = ids.map(() => [])
  const incoming: number[][] = ids.map(() => [])
  edges.forEach((edge, edgeIndex) => {
    const source = indexOf.get(edge.source)
    const target = indexOf.get(edge.target)
    if (source === undefined || target === undefined) return
    ;(out[source] as number[]).push(edgeIndex)
    ;(incoming[target] as number[]).push(edgeIndex)
  })
  return { ids, indexOf, out, in: incoming, edges }
}

/** Result of step 2. */
export interface ConnectedComponents {
  /** `componentOf[i]` = component index of node `i`. */
  readonly componentOf: readonly number[]
  /** `components[c]` = node indices, ascending. Components are ordered by
   * their lowest member index, so the ordering never depends on hashing. */
  readonly components: readonly (readonly number[])[]
}

/** Step 2: connected components of the *undirected* control-flow graph. */
export function findConnectedComponents(adjacency: DirectedAdjacency): ConnectedComponents {
  const count = adjacency.ids.length
  const componentOf = new Array<number>(count).fill(-1)
  const components: number[][] = []
  for (let start = 0; start < count; start += 1) {
    if (componentOf[start] !== -1) continue
    const componentIndex = components.length
    const members: number[] = []
    const queue: number[] = [start]
    componentOf[start] = componentIndex
    while (queue.length > 0) {
      const current = queue.shift() as number
      members.push(current)
      const neighbours: number[] = []
      for (const edgeIndex of adjacency.out[current] as readonly number[]) {
        const other = adjacency.indexOf.get(
          (adjacency.edges[edgeIndex] as ArisLayoutEdgeInput).target
        )
        if (other !== undefined) neighbours.push(other)
      }
      for (const edgeIndex of adjacency.in[current] as readonly number[]) {
        const other = adjacency.indexOf.get(
          (adjacency.edges[edgeIndex] as ArisLayoutEdgeInput).source
        )
        if (other !== undefined) neighbours.push(other)
      }
      for (const neighbour of neighbours) {
        if (componentOf[neighbour] !== -1) continue
        componentOf[neighbour] = componentIndex
        queue.push(neighbour)
      }
    }
    members.sort((left, right) => left - right)
    components.push(members)
  }
  return { componentOf, components }
}

/** Result of step 3. */
export interface StronglyConnectedComponents {
  readonly componentOf: readonly number[]
  /** Member indices ascending; components ordered by their lowest member. */
  readonly components: readonly (readonly number[])[]
}

/**
 * Step 3: Tarjan's algorithm, written iteratively so a 500-node chain cannot
 * blow the call stack. Successors are visited in edge input order.
 */
export function findStronglyConnectedComponents(
  adjacency: DirectedAdjacency
): StronglyConnectedComponents {
  const count = adjacency.ids.length
  const index = new Array<number>(count).fill(-1)
  const lowLink = new Array<number>(count).fill(0)
  const onStack = new Array<boolean>(count).fill(false)
  const stack: number[] = []
  const raw: number[][] = []
  let counter = 0

  const successorsOf = (node: number): number[] =>
    (adjacency.out[node] as readonly number[]).map((edgeIndex) => {
      const target = (adjacency.edges[edgeIndex] as ArisLayoutEdgeInput).target
      return adjacency.indexOf.get(target) ?? -1
    })

  for (let root = 0; root < count; root += 1) {
    if (index[root] !== -1) continue
    const frame: { node: number; successors: number[]; cursor: number }[] = [
      { node: root, successors: successorsOf(root), cursor: 0 }
    ]
    index[root] = counter
    lowLink[root] = counter
    counter += 1
    stack.push(root)
    onStack[root] = true

    while (frame.length > 0) {
      const top = frame[frame.length - 1] as { node: number; successors: number[]; cursor: number }
      if (top.cursor < top.successors.length) {
        const next = top.successors[top.cursor] as number
        top.cursor += 1
        if (next < 0) continue
        if (index[next] === -1) {
          index[next] = counter
          lowLink[next] = counter
          counter += 1
          stack.push(next)
          onStack[next] = true
          frame.push({ node: next, successors: successorsOf(next), cursor: 0 })
        } else if (onStack[next]) {
          lowLink[top.node] = Math.min(lowLink[top.node] as number, index[next] as number)
        }
        continue
      }
      frame.pop()
      if (frame.length > 0) {
        const parent = frame[frame.length - 1] as { node: number }
        lowLink[parent.node] = Math.min(lowLink[parent.node] as number, lowLink[top.node] as number)
      }
      if (lowLink[top.node] === index[top.node]) {
        const members: number[] = []
        for (;;) {
          const member = stack.pop() as number
          onStack[member] = false
          members.push(member)
          if (member === top.node) break
        }
        members.sort((left, right) => left - right)
        raw.push(members)
      }
    }
  }

  raw.sort((left, right) => (left[0] as number) - (right[0] as number))
  const componentOf = new Array<number>(count).fill(-1)
  raw.forEach((members, componentIndex) => {
    for (const member of members) componentOf[member] = componentIndex
  })
  return { componentOf, components: raw }
}

/** Result of step 4. */
export interface EdgeClassification {
  /** Parallel to the control-edge array. */
  readonly classOf: readonly ArisLayoutEdgeClass[]
  readonly forwardEdgeIndices: readonly number[]
  readonly backEdgeIndices: readonly number[]
  readonly selfLoopEdgeIndices: readonly number[]
}

/**
 * Step 4. A depth-first search from every zero-in-degree node (then from every
 * still-unvisited node, both in input order) marks an edge as a back edge
 * exactly when its target is on the current DFS stack. Removing back edges
 * therefore always leaves an acyclic graph, which is what steps 6-8 need,
 * while every back edge stays a real, routable connection (§14.2/§14.3: the
 * cycle must remain visible, never collapsed).
 */
export function classifyEdges(adjacency: DirectedAdjacency): EdgeClassification {
  const nodeCount = adjacency.ids.length
  const edgeCount = adjacency.edges.length
  const classOf = new Array<ArisLayoutEdgeClass>(edgeCount).fill('forward')
  const visited = new Array<boolean>(nodeCount).fill(false)
  const onStack = new Array<boolean>(nodeCount).fill(false)

  const roots: number[] = []
  for (let node = 0; node < nodeCount; node += 1) {
    if ((adjacency.in[node] as readonly number[]).length === 0) roots.push(node)
  }
  for (let node = 0; node < nodeCount; node += 1) roots.push(node)

  for (const root of roots) {
    if (visited[root]) continue
    visited[root] = true
    onStack[root] = true
    const frame: { node: number; cursor: number }[] = [{ node: root, cursor: 0 }]
    while (frame.length > 0) {
      const top = frame[frame.length - 1] as { node: number; cursor: number }
      const outgoing = adjacency.out[top.node] as readonly number[]
      if (top.cursor < outgoing.length) {
        const edgeIndex = outgoing[top.cursor] as number
        top.cursor += 1
        const edge = adjacency.edges[edgeIndex] as ArisLayoutEdgeInput
        const target = adjacency.indexOf.get(edge.target)
        if (target === undefined) continue
        if (target === top.node) {
          classOf[edgeIndex] = 'self-loop'
          continue
        }
        if (onStack[target]) {
          classOf[edgeIndex] = 'back'
          continue
        }
        if (!visited[target]) {
          visited[target] = true
          onStack[target] = true
          frame.push({ node: target, cursor: 0 })
        }
        continue
      }
      onStack[top.node] = false
      frame.pop()
    }
  }

  const forwardEdgeIndices: number[] = []
  const backEdgeIndices: number[] = []
  const selfLoopEdgeIndices: number[] = []
  classOf.forEach((value, edgeIndex) => {
    if (value === 'forward') forwardEdgeIndices.push(edgeIndex)
    else if (value === 'back') backEdgeIndices.push(edgeIndex)
    else if (value === 'self-loop') selfLoopEdgeIndices.push(edgeIndex)
  })
  return { classOf, forwardEdgeIndices, backEdgeIndices, selfLoopEdgeIndices }
}

/**
 * Step 5. The orientation is *derived*, never assumed: every control-flow edge
 * whose two endpoints carry a source position casts one vote for the axis it
 * travels furthest along. A model with no source geometry, or a perfect tie,
 * falls back to top-to-bottom, which is the ARIS EPC default.
 */
export function detectSourceOrientation(
  controlNodes: readonly ArisLayoutNodeInput[],
  controlEdges: readonly ArisLayoutEdgeInput[]
): ArisLayoutOrientation {
  const nodeById = new Map<string, ArisLayoutNodeInput>()
  for (const node of controlNodes) nodeById.set(node.id, node)
  let vertical = 0
  let horizontal = 0
  for (const edge of controlEdges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source?.sourcePosition || !target?.sourcePosition) continue
    const dx = Math.abs(
      target.sourcePosition.x +
        target.size.width / 2 -
        (source.sourcePosition.x + source.size.width / 2)
    )
    const dy = Math.abs(
      target.sourcePosition.y +
        target.size.height / 2 -
        (source.sourcePosition.y + source.size.height / 2)
    )
    if (dy > dx) vertical += 1
    else if (dx > dy) horizontal += 1
  }
  return horizontal > vertical ? 'left-to-right' : 'top-to-bottom'
}
