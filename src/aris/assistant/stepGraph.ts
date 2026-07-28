// Small, pure graph utilities over an `ArisProcessDigest`'s step/next-edge
// graph. Shared by the digest builder (gap detection) and the deterministic
// answerers (before/next/return-branch).

import type { ArisDigestStep, ArisProcessDigest } from './types'

export interface StepEdge {
  readonly fromOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly relationType: string
  readonly outcome?: string
}

/** occurrenceId -> outgoing edges, in digest step/edge order (deterministic). */
export function buildNextIndex(digest: ArisProcessDigest): Map<string, StepEdge[]> {
  const index = new Map<string, StepEdge[]>()
  for (const step of digest.steps) {
    const edges = step.next.map((n) => ({ fromOccurrenceId: step.occurrenceId, ...n }))
    index.set(step.occurrenceId, edges)
  }
  return index
}

/** occurrenceId -> incoming edges (reverse of `buildNextIndex`), in a deterministic scan order. */
export function buildPrevIndex(digest: ArisProcessDigest): Map<string, StepEdge[]> {
  const index = new Map<string, StepEdge[]>()
  for (const step of digest.steps) {
    for (const n of step.next) {
      const edge: StepEdge = { fromOccurrenceId: step.occurrenceId, ...n }
      const list = index.get(n.targetOccurrenceId)
      if (list) list.push(edge)
      else index.set(n.targetOccurrenceId, [edge])
    }
  }
  return index
}

export function stepByOccurrenceId(digest: ArisProcessDigest): Map<string, ArisDigestStep> {
  return new Map(digest.steps.map((s) => [s.occurrenceId, s]))
}

/** occurrenceIds of steps with no incoming next-edge — the digest's flow entry points. */
export function findRootOccurrenceIds(digest: ArisProcessDigest): string[] {
  const hasIncoming = new Set<string>()
  for (const step of digest.steps) for (const n of step.next) hasIncoming.add(n.targetOccurrenceId)
  return digest.steps.filter((s) => !hasIncoming.has(s.occurrenceId)).map((s) => s.occurrenceId)
}

/**
 * Back-edges (return branches) found by DFS from every root, tracking the
 * current path stack: an edge whose target is already on the stack closes a
 * loop back to an ancestor step. Traversal order follows `digest.steps`
 * (array) order, so results are deterministic for a given digest.
 */
export function findBackEdges(digest: ArisProcessDigest): StepEdge[] {
  const next = buildNextIndex(digest)
  const roots = findRootOccurrenceIds(digest)
  const startIds = roots.length > 0 ? roots : digest.steps.map((s) => s.occurrenceId)
  const backEdges: StepEdge[] = []
  const visited = new Set<string>()
  const onStack = new Set<string>()

  const visit = (occurrenceId: string): void => {
    if (onStack.has(occurrenceId)) return
    if (visited.has(occurrenceId)) return
    visited.add(occurrenceId)
    onStack.add(occurrenceId)
    for (const edge of next.get(occurrenceId) ?? []) {
      if (onStack.has(edge.targetOccurrenceId)) backEdges.push(edge)
      else visit(edge.targetOccurrenceId)
    }
    onStack.delete(occurrenceId)
  }

  for (const id of startIds) visit(id)
  // Any step never reached from a root (an isolated cycle) still needs a pass
  // so its back-edges are not silently dropped.
  for (const step of digest.steps) if (!visited.has(step.occurrenceId)) visit(step.occurrenceId)
  return backEdges
}
