/** Deterministic graph builders shared by the layout tests. */

import type {
  ArisLayoutEdgeInput,
  ArisLayoutGraphInput,
  ArisLayoutNodeInput,
  ArisLayoutRuleOperator
} from '../types'

export const FUNCTION_SIZE = { width: 200, height: 80 } as const
export const EVENT_SIZE = { width: 180, height: 60 } as const
export const RULE_SIZE = { width: 40, height: 40 } as const
export const SATELLITE_SIZE = { width: 160, height: 50 } as const

export function fn(id: string, extra: Partial<ArisLayoutNodeInput> = {}): ArisLayoutNodeInput {
  return { id, role: 'function', size: FUNCTION_SIZE, ...extra }
}

export function event(id: string, extra: Partial<ArisLayoutNodeInput> = {}): ArisLayoutNodeInput {
  return { id, role: 'event', size: EVENT_SIZE, ...extra }
}

export function rule(
  id: string,
  operator: ArisLayoutRuleOperator,
  extra: Partial<ArisLayoutNodeInput> = {}
): ArisLayoutNodeInput {
  return { id, role: 'rule', operator, size: RULE_SIZE, ...extra }
}

export function satellite(id: string, extra: Partial<ArisLayoutNodeInput> = {}): ArisLayoutNodeInput {
  return { id, role: 'satellite', size: SATELLITE_SIZE, ...extra }
}

export function flow(source: string, target: string): ArisLayoutEdgeInput {
  return { id: `${source}->${target}`, source, target, kind: 'control-flow' }
}

export function attach(source: string, target: string): ArisLayoutEdgeInput {
  return { id: `${source}~${target}`, source, target, kind: 'satellite' }
}

/** `start -> split -> branch_0..branch_{n-1} -> merge -> end`. */
export function xorDiamond(branchCount: number): ArisLayoutGraphInput {
  const nodes: ArisLayoutNodeInput[] = [
    event('E.start'),
    rule('R.split', 'xor'),
    rule('R.merge', 'xor'),
    event('E.end')
  ]
  const edges: ArisLayoutEdgeInput[] = [flow('E.start', 'R.split')]
  for (let index = 0; index < branchCount; index += 1) {
    nodes.push(fn(`F.${index}`))
    edges.push(flow('R.split', `F.${index}`))
    edges.push(flow(`F.${index}`, 'R.merge'))
  }
  edges.push(flow('R.merge', 'E.end'))
  return { id: `xor-${branchCount}`, nodes, edges }
}

/** A straight chain with one explicit return path from the tail to the head. */
export function cycleGraph(): ArisLayoutGraphInput {
  return {
    id: 'cycle',
    nodes: [event('E.start'), fn('F.a'), fn('F.b'), fn('F.c'), event('E.end')],
    edges: [
      flow('E.start', 'F.a'),
      flow('F.a', 'F.b'),
      flow('F.b', 'F.c'),
      flow('F.c', 'F.a'),
      flow('F.c', 'E.end')
    ]
  }
}

export function selfLoopGraph(): ArisLayoutGraphInput {
  return {
    id: 'self-loop',
    nodes: [event('E.start'), fn('F.a'), event('E.end')],
    edges: [flow('E.start', 'F.a'), flow('F.a', 'F.a'), flow('F.a', 'E.end')]
  }
}

export function twoComponentGraph(): ArisLayoutGraphInput {
  return {
    id: 'two-components',
    nodes: [event('E.1'), fn('F.1'), event('E.2'), fn('F.2')],
    edges: [flow('E.1', 'F.1'), flow('E.2', 'F.2')]
  }
}

/** A three-function chain, optionally decorated with `count` satellites. */
export function chainWithSatellites(count: number): ArisLayoutGraphInput {
  const nodes: ArisLayoutNodeInput[] = [
    event('E.start'),
    fn('F.a'),
    fn('F.b'),
    fn('F.c'),
    event('E.end')
  ]
  const edges: ArisLayoutEdgeInput[] = [
    flow('E.start', 'F.a'),
    flow('F.a', 'F.b'),
    flow('F.b', 'F.c'),
    flow('F.c', 'E.end')
  ]
  for (let index = 0; index < count; index += 1) {
    nodes.push(satellite(`S.${index}`))
    edges.push(attach('F.b', `S.${index}`))
  }
  return { id: 'chain-with-satellites', nodes, edges }
}

/**
 * A graph of exactly `nodeCount` control-flow nodes: a spine of alternating
 * events and functions, interrupted every 24 nodes by an XOR diamond and
 * carrying a return path every 40 nodes.
 */
export function largeGraph(nodeCount: number): ArisLayoutGraphInput {
  const nodes: ArisLayoutNodeInput[] = []
  const edges: ArisLayoutEdgeInput[] = []
  const spine: string[] = []
  for (let index = 0; index < nodeCount; index += 1) {
    const id = `N.${index}`
    if (index % 12 === 5) nodes.push(rule(id, 'xor'))
    else if (index % 2 === 0) nodes.push(event(id))
    else nodes.push(fn(id))
    spine.push(id)
  }
  for (let index = 1; index < nodeCount; index += 1) {
    const previous = spine[index - 1] as string
    const current = spine[index] as string
    if (index % 24 === 6 && index + 3 < nodeCount) {
      // split into two branches that rejoin three nodes later
      edges.push(flow(previous, spine[index] as string))
      edges.push(flow(previous, spine[index + 1] as string))
      edges.push(flow(spine[index] as string, spine[index + 2] as string))
      edges.push(flow(spine[index + 1] as string, spine[index + 2] as string))
      continue
    }
    if (index % 24 === 7 || index % 24 === 8) continue
    edges.push(flow(previous, current))
  }
  for (let index = 40; index < nodeCount; index += 40) {
    edges.push(flow(spine[index] as string, spine[index - 20] as string))
  }
  return { id: `large-${nodeCount}`, nodes, edges }
}

/** Deep-freeze a value so any mutation attempt throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}
