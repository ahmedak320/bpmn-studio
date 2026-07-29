import type { EpcGraph } from './types'
import { OT_RULE, type EpcRuleKind, classifyRuleSymbol } from './constants'
import { type FlowGraphIndex, buildFlowGraphIndex } from './flowGraph'

/**
 * Section 14.2 — XOR (and AND/OR) rule rendering/validation support.
 *
 * Every `OT_RULE` occurrence, regardless of connector kind, is classified the same way:
 * split (>1 outgoing flow edge), merge (>1 incoming), both (a split/merge conflict, also
 * reported by `checkRuleSplitMergeConflict` in `validate.ts`), through (a single in/out
 * pass-through connector — unusual but not by itself invalid), or isolated (no flow edges
 * at all). The real AnimalWF fixture's rule symbol is `ST_OPR_XOR_1` (not a bare `ST_OPR_XOR`
 * — `classifyRuleSymbol` tokenizes on `_` so both forms classify the same way).
 *
 * This module never removes, merges, or renumbers edges: `incomingEdgeIds` /
 * `outgoingEdgeIds` are built directly from the flow-edge index, which keeps every parallel
 * edge and every self-loop as a distinct id (see `flowGraph.ts`). Explicit cycles are
 * therefore preserved automatically — nothing here ever drops or collapses an edge, and
 * `classifyRules` is a pure read over its input graph (see `immutability.test.ts` for the
 * cross-module freeze guarantee).
 */

export type RuleFlowRole = 'split' | 'merge' | 'both' | 'through' | 'isolated'

export interface RuleClassification {
  readonly nodeId: string
  readonly ruleKind: EpcRuleKind
  readonly role: RuleFlowRole
  readonly inDegree: number
  readonly outDegree: number
  readonly incomingEdgeIds: readonly string[]
  readonly outgoingEdgeIds: readonly string[]
}

function roleFor(inDegree: number, outDegree: number): RuleFlowRole {
  if (inDegree > 1 && outDegree > 1) return 'both'
  if (inDegree > 1) return 'merge'
  if (outDegree > 1) return 'split'
  if (inDegree === 0 && outDegree === 0) return 'isolated'
  return 'through'
}

export function classifyRule(index: FlowGraphIndex, nodeId: string): RuleClassification {
  const node = index.nodeById.get(nodeId)
  const incoming = index.flowEdgesByTarget.get(nodeId) ?? []
  const outgoing = index.flowEdgesBySource.get(nodeId) ?? []
  return {
    nodeId,
    ruleKind: classifyRuleSymbol(node?.symbolType ?? null),
    role: roleFor(incoming.length, outgoing.length),
    inDegree: incoming.length,
    outDegree: outgoing.length,
    incomingEdgeIds: incoming.map((edge) => edge.id),
    outgoingEdgeIds: outgoing.map((edge) => edge.id)
  }
}

/** Classifies every `OT_RULE` node in the graph, preserving input order. */
export function classifyRules(graph: EpcGraph): readonly RuleClassification[] {
  const index = buildFlowGraphIndex(graph)
  return graph.nodes
    .filter((node) => node.objectType === OT_RULE)
    .map((node) => classifyRule(index, node.id))
}

export function isXorRule(classification: RuleClassification): boolean {
  return classification.ruleKind === 'XOR'
}

export function isAndRule(classification: RuleClassification): boolean {
  return classification.ruleKind === 'AND'
}

export function isOrRule(classification: RuleClassification): boolean {
  return classification.ruleKind === 'OR'
}

export function isSplit(classification: RuleClassification): boolean {
  return classification.role === 'split' || classification.role === 'both'
}

export function isMerge(classification: RuleClassification): boolean {
  return classification.role === 'merge' || classification.role === 'both'
}
