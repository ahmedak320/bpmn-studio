import type { EpcGraph, EpcPoint } from './types'
import { OT_FUNC, OT_RULE } from './constants'
import {
  type FlowGraphIndex,
  buildFlowGraphIndex,
  isOnCycle,
  sccMembership,
  upstreamDistances
} from './flowGraph'
import { classifyRule } from './xor'
import { findReturnOutcomeMatches, type ReturnTermMatch } from './returnTerms'

/**
 * Section 14.3 — return-path detection.
 *
 * Step 1 ("preserve explicit source return routes") is satisfied by construction: this
 * module only ever *reads* the graph and returns proposals. If an outcome node already
 * sits on an explicit cycle, `detectReturnPathOutcomes` reports `status: 'explicit'` and
 * produces no candidate — nothing is added, changed, or removed.
 *
 * Step 4 ("apply atomically") is explicitly out of scope for this module: the actual
 * mutation belongs to the command system in `src/aris/model` (owned by another agent/wave).
 * `buildReturnPathApplyPayload` below produces the data that transaction needs; it never
 * imports from or calls into `src/aris/model`. See the doc comment on
 * `ReturnPathApplyPayload` for the exact seam.
 */

export type ReturnRouteResult = ExplicitReturnRoute | MissingReturnRoute

export interface ExplicitReturnRoute {
  readonly status: 'explicit'
  readonly outcomeNodeId: string
  readonly matches: readonly ReturnTermMatch[]
  /** Every node id sharing the outcome node's strongly-connected (cyclic) component. */
  readonly cycleNodeIds: readonly string[]
}

export type ReturnPathCandidateReason = 'existingMergeRule' | 'nearestUpstreamFunction'

export interface ReturnPathCandidate {
  /** The node a dashed candidate edge would point to — a function, or an existing merge rule. */
  readonly targetNodeId: string
  readonly targetKind: 'function' | 'mergeRule'
  /** When `targetKind === 'mergeRule'`, the upstream function this rule already re-enters. */
  readonly viaFunctionNodeId: string | null
  readonly distance: number
  readonly reason: ReturnPathCandidateReason
  /** Always true: this module only ever proposes a dashed candidate, never an applied edge. */
  readonly dashed: true
}

export interface MissingReturnRoute {
  readonly status: 'missing'
  readonly outcomeNodeId: string
  readonly matches: readonly ReturnTermMatch[]
  /** Ranked upstream candidates (see `rankCandidates` for the ordering/tie-break policy). */
  readonly candidates: readonly ReturnPathCandidate[]
  /** The single recommended candidate's target id, or `null` when there is a tie or no candidate. */
  readonly recommendedTargetId: string | null
  /** True when the top-ranked candidates are indistinguishable and a human must pick. */
  readonly requiresManualSelection: boolean
}

/**
 * Scans every node's localized names for a return/rework/reject outcome term (English or
 * Arabic — see `returnTerms.ts`) and, for each match, reports whether the source already
 * has an explicit return route (the node sits on a cycle) or proposes ranked upstream
 * candidates. Never mutates `graph`.
 */
export function detectReturnPathOutcomes(graph: EpcGraph): readonly ReturnRouteResult[] {
  const index = buildFlowGraphIndex(graph)
  const membership = sccMembership(index)
  const results: ReturnRouteResult[] = []

  for (const node of graph.nodes) {
    const matches = findReturnOutcomeMatches(node.names)
    if (matches.length === 0) continue

    if (isOnCycle(index, node.id, membership)) {
      const cycleNodeIds = [...(membership.get(node.id) ?? new Set([node.id]))]
      results.push({ status: 'explicit', outcomeNodeId: node.id, matches, cycleNodeIds })
      continue
    }

    const candidates = rankCandidates(index, node.id)
    const { recommendedTargetId, requiresManualSelection } = pickRecommendation(candidates)
    results.push({
      status: 'missing',
      outcomeNodeId: node.id,
      matches,
      candidates,
      recommendedTargetId,
      requiresManualSelection
    })
  }

  return results
}

/**
 * Searches upstream within the outcome node's connected component for editable candidate
 * functions, ranked by graph distance. When a candidate function's immediate predecessor is
 * an existing merge/re-entry rule (an `OT_RULE` already classified `merge` or `both`), the
 * candidate targets that rule instead of the function directly (`reason:
 * 'existingMergeRule'`) — reusing established re-entry infrastructure is preferred over
 * introducing a fresh dashed edge straight into the function body.
 */
export function rankCandidates(
  index: FlowGraphIndex,
  outcomeNodeId: string
): readonly ReturnPathCandidate[] {
  const distances = upstreamDistances(index, outcomeNodeId)
  const byTarget = new Map<string, ReturnPathCandidate>()

  for (const [ancestorId, distance] of distances) {
    const ancestor = index.nodeById.get(ancestorId)
    if (!ancestor || ancestor.objectType !== OT_FUNC) continue
    if (ancestor.locked) continue

    const mergeRuleId = findImmediateMergeRule(index, ancestorId)
    const targetNodeId = mergeRuleId ?? ancestorId
    const candidate: ReturnPathCandidate = {
      targetNodeId,
      targetKind: mergeRuleId ? 'mergeRule' : 'function',
      viaFunctionNodeId: mergeRuleId ? ancestorId : null,
      distance,
      reason: mergeRuleId ? 'existingMergeRule' : 'nearestUpstreamFunction',
      dashed: true
    }

    const existing = byTarget.get(targetNodeId)
    if (!existing || candidate.distance < existing.distance) {
      byTarget.set(targetNodeId, candidate)
    }
  }

  return [...byTarget.values()].sort(compareCandidates)
}

function findImmediateMergeRule(index: FlowGraphIndex, functionNodeId: string): string | null {
  const incoming = index.flowEdgesByTarget.get(functionNodeId) ?? []
  for (const edge of incoming) {
    const source = index.nodeById.get(edge.source)
    if (!source || source.objectType !== OT_RULE) continue
    const classification = classifyRule(index, source.id)
    if (classification.role === 'merge' || classification.role === 'both') return source.id
  }
  return null
}

function compareCandidates(a: ReturnPathCandidate, b: ReturnPathCandidate): number {
  if (a.distance !== b.distance) return a.distance - b.distance
  if (a.reason !== b.reason) return a.reason === 'existingMergeRule' ? -1 : 1
  return a.targetNodeId < b.targetNodeId ? -1 : a.targetNodeId > b.targetNodeId ? 1 : 0
}

function candidatesTie(a: ReturnPathCandidate, b: ReturnPathCandidate): boolean {
  return a.distance === b.distance && a.reason === b.reason
}

function pickRecommendation(candidates: readonly ReturnPathCandidate[]): {
  readonly recommendedTargetId: string | null
  readonly requiresManualSelection: boolean
} {
  if (candidates.length === 0) return { recommendedTargetId: null, requiresManualSelection: false }
  if (candidates.length > 1 && candidatesTie(candidates[0], candidates[1])) {
    return { recommendedTargetId: null, requiresManualSelection: true }
  }
  return { recommendedTargetId: candidates[0].targetNodeId, requiresManualSelection: false }
}

/**
 * Command-payload shape for a *confirmed* return-path candidate (plan section 14.3.4).
 *
 * SEAM: this module never imports `src/aris/model`. This shape is intentionally parallel to
 * (but structurally independent of) `ArisEditCommand` in `src/aris/model/commands.ts`: the
 * command system turns `connectionDefinition` and `connectionOccurrence` below into one
 * `createConnectionDefinition` command followed by one `createConnectionOccurrence` command,
 * records `audit` in revision history, and derives the undo record via `invertCommand` — all of
 * which belongs to the command system, not here. The two commands cannot be wrapped in a single
 * `transaction`: `validatePreconditions`'s `case 'transaction'` in `src/aris/model/commands.ts`
 * checks every subcommand against the document as it stood before the transaction, so
 * `createConnectionOccurrence`'s precondition can never see the `createConnectionDefinition`
 * from earlier in the same transaction — they must instead be applied as an ordered pair of
 * top-level commands (see `src/aris/chat/modelCommandMapping.ts`, `src/aris/shell/
 * arisChatHost.ts` and `src/aris/canvas/commandBridge.ts`, which all hit and document the same
 * constraint). Every field this module needs to hand off is present below; nothing about ID
 * generation, revision numbers, or persistence is decided here, since those are the command
 * system's responsibility.
 */
export interface ReturnPathConnectionDefinitionPayload {
  readonly id: string
  readonly connectionType: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
}

export interface ReturnPathConnectionOccurrencePayload {
  readonly id: string
  readonly modelId: string
  readonly connectionDefinitionId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly route: readonly EpcPoint[]
  readonly lineStyle: 'dashed'
}

export interface ReturnPathAuditEntry {
  readonly kind: 'return-path-applied'
  readonly outcomeNodeId: string
  readonly targetNodeId: string
  readonly candidateReason: ReturnPathCandidateReason
  readonly distance: number
  readonly confirmedBy: string
  readonly confirmedAt: string
}

export interface ReturnPathApplyPayload {
  readonly kind: 'returnPathApply'
  readonly outcomeNodeId: string
  readonly connectionDefinition: ReturnPathConnectionDefinitionPayload
  readonly connectionOccurrence: ReturnPathConnectionOccurrencePayload
  readonly audit: ReturnPathAuditEntry
}

export interface BuildReturnPathApplyPayloadParams {
  readonly outcomeNodeId: string
  readonly candidate: ReturnPathCandidate
  readonly connectionDefinitionId: string
  readonly connectionOccurrenceId: string
  readonly connectionType: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
  readonly modelId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly confirmedBy: string
  readonly confirmedAt: string
  readonly route?: readonly EpcPoint[]
}

/**
 * Builds the atomic apply payload for a candidate the user has already confirmed. This
 * function performs no mutation and calls no command/store API — it is a pure assembler.
 * Callers MUST have obtained explicit confirmation (plan 14.3 step 3 / 18.4) before calling
 * this; nothing in this module calls it automatically.
 */
export function buildReturnPathApplyPayload(
  params: BuildReturnPathApplyPayloadParams
): ReturnPathApplyPayload {
  return {
    kind: 'returnPathApply',
    outcomeNodeId: params.outcomeNodeId,
    connectionDefinition: {
      id: params.connectionDefinitionId,
      connectionType: params.connectionType,
      fromObjectDefinitionId: params.fromObjectDefinitionId,
      toObjectDefinitionId: params.toObjectDefinitionId
    },
    connectionOccurrence: {
      id: params.connectionOccurrenceId,
      modelId: params.modelId,
      connectionDefinitionId: params.connectionDefinitionId,
      sourceOccurrenceId: params.sourceOccurrenceId,
      targetOccurrenceId: params.targetOccurrenceId,
      route: params.route ?? [],
      lineStyle: 'dashed'
    },
    audit: {
      kind: 'return-path-applied',
      outcomeNodeId: params.outcomeNodeId,
      targetNodeId: params.candidate.targetNodeId,
      candidateReason: params.candidate.reason,
      distance: params.candidate.distance,
      confirmedBy: params.confirmedBy,
      confirmedAt: params.confirmedAt
    }
  }
}
