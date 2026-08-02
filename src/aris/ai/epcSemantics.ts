/**
 * Section 16.6 step 9 — "Validate EPC semantics" — for an AI draft.
 *
 * Steps 7 and 8 (`validateArisAiDraft`) answer "is this a well-formed
 * `ArisAiDraftV1` whose type codes exist?". They deliberately stop short of
 * EPC *meaning*: alternation, start/end completeness, split/merge pairing,
 * "events never decide". That semantics lives in `src/aris/epc/`, which is
 * written against occurrence/definition-shaped models rather than against a
 * draft's logical ids.
 *
 * This module is the seam between the two. It projects each drafted model
 * onto the `EpcAdapterModel` shape `toEpcGraph` already accepts — logical
 * ids stand in for occurrence ids, which is legitimate because a draft has
 * exactly one occurrence per object by construction — and runs the existing
 * `validateEpcGraph`. No EPC rule is re-implemented here.
 *
 * Two deliberate scoping decisions:
 *
 *  - Only `severity: 'error'` findings are returned as `errors` (the ones a
 *    semantic repair turn should try to fix). Warnings — an orphan satellite
 *    cluster, an unrecognized rule symbol — are returned separately so the
 *    Create surface can show them next to the draft's own uncertainties
 *    without refusing an otherwise valid model.
 *  - Empty assigned-model placeholders are skipped. A draft with no
 *    control-flow objects anywhere, or an empty primary model that is not an
 *    assignment target, receives `epc.model.empty`; accepting either would
 *    turn a deletion response into a successful generation.
 */

import { FLOW_NODE_TYPES, toEpcGraph, validateEpcGraph } from '../epc'
import type {
  EpcAdapterConnectionDefinition,
  EpcAdapterConnectionOccurrence,
  EpcAdapterModel,
  EpcAdapterObjectDefinition,
  EpcAdapterObjectOccurrence,
  EpcFinding
} from '../epc'
import type { ArisAiDraftV1, ArisAiLocalizedText } from './contract'
import { finding, type ArisAiValidationFinding } from './findings'

/**
 * English explanation per EPC rule id, used as the finding's `message`.
 *
 * These strings are consumed by `buildArisAiRepairMessage` — they are
 * outbound prompt text telling the model what to fix, not UI copy, so they
 * stay English and are not routed through `t()`. The stable `ruleId` travels
 * as the finding's `code`, which is what a UI localizes from.
 */
const EPC_RULE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  'epc.model.empty':
    'The primary model contains no EPC control-flow objects. Add the source process events, functions, and any required rule objects.',
  'epc.alternation':
    'EPC alternation broken: two functions or two events are connected directly by control flow. Put an event between two functions (and a function between two events), or route the branch through a rule.',
  'epc.startEnd.missingStart':
    'The model has no start event: every EPC needs at least one event with no incoming control flow.',
  'epc.startEnd.missingEnd':
    'The model has no end event: every EPC needs at least one event with no outgoing control flow.',
  'epc.startEnd.unreachableEnd':
    'No end event is reachable from a start event by following control flow. Connect the flow so every start can finish.',
  'epc.rule.splitMergeConflict':
    'A rule both merges several incoming branches and splits into several outgoing branches. Model the merge and the split as two separate rule objects.',
  'epc.event.decisionViolation':
    'An event feeds directly into an XOR/OR split, which makes the event decide. Put a function before the deciding rule.',
  'epc.rule.unlabeledDecisionBranch':
    'A decision branch out of an XOR/OR rule has no label: name the outgoing relation or the outcome event it leads to.',
  'epc.connectivity.orphanNode':
    'A control-flow object is disconnected from the rest of the model’s control flow.',
  'epc.rule.unrecognizedSymbol':
    'A rule object does not declare a recognized AND/OR/XOR connector symbol.',
  'epc.connection.missingType': 'A relation carries no connection type.',
  'epc.linkedModel.danglingReference':
    'An assignment points at a model logical id that the draft never declares.'
})

function localizedValues(names: ArisAiLocalizedText | undefined): Record<string, string> {
  const values: Record<string, string> = {}
  if (names?.en) values.en = names.en
  if (names?.ar) values.ar = names.ar
  return values
}

function describeFinding(epcFinding: EpcFinding, draft: ArisAiDraftV1): string {
  const base = EPC_RULE_MESSAGES[epcFinding.ruleId] ?? epcFinding.messageKey
  const nodes =
    epcFinding.nodeIds.length > 0
      ? ` Objects: ${epcFinding.nodeIds
          .map((nodeId) => {
            const object = draft.objects.find((candidate) => candidate.logicalId === nodeId)
            const label = object?.names.en ?? object?.names.ar
            return label ? `"${label}" (${nodeId})` : nodeId
          })
          .join(', ')}.`
      : ''
  const edges = epcFinding.edgeIds.length > 0 ? ` Relations: ${epcFinding.edgeIds.join(', ')}.` : ''
  return `${base}${nodes}${edges}`
}

export interface ArisAiEpcSemanticsResult {
  /** Findings that must be repaired before the draft may be committed. */
  readonly errors: readonly ArisAiValidationFinding[]
  /** Advisory findings, surfaced next to the draft's own uncertainties. */
  readonly warnings: readonly ArisAiValidationFinding[]
}

/** Project one drafted model onto the shape `toEpcGraph` consumes. */
function adapterModelFor(draft: ArisAiDraftV1, modelLogicalId: string): EpcAdapterModel {
  const linkedModelsByObject = new Map<string, string[]>()
  for (const assignment of draft.assignments) {
    const list = linkedModelsByObject.get(assignment.objectLogicalId) ?? []
    list.push(assignment.assignedModelLogicalId)
    linkedModelsByObject.set(assignment.objectLogicalId, list)
  }

  const objects = draft.objects.filter((object) => object.modelLogicalId === modelLogicalId)
  const objectDefinitionById = new Map<string, EpcAdapterObjectDefinition>()
  const objectOccurrences: EpcAdapterObjectOccurrence[] = []
  for (const object of objects) {
    const linked = linkedModelsByObject.get(object.logicalId)
    objectDefinitionById.set(object.logicalId, {
      id: object.logicalId,
      type: object.objectType,
      names: { values: localizedValues(object.names) },
      ...(linked ? { linkedModelIds: linked } : {})
    })
    objectOccurrences.push({
      id: object.logicalId,
      definitionId: object.logicalId,
      symbol: object.symbolType ?? null
    })
  }

  const relations = draft.relations.filter((relation) => relation.modelLogicalId === modelLogicalId)
  const connectionDefinitionById = new Map<string, EpcAdapterConnectionDefinition>()
  const connectionOccurrences: EpcAdapterConnectionOccurrence[] = []
  for (const relation of relations) {
    connectionDefinitionById.set(relation.logicalId, {
      id: relation.logicalId,
      type: relation.connectionType
    })
    connectionOccurrences.push({
      id: relation.logicalId,
      definitionId: relation.logicalId,
      sourceOccurrenceId: relation.sourceLogicalId,
      targetOccurrenceId: relation.targetLogicalId,
      names: { values: localizedValues(relation.names) }
    })
  }

  return {
    modelId: modelLogicalId,
    objectOccurrences,
    objectDefinitionById,
    connectionOccurrences,
    connectionDefinitionById
  }
}

/**
 * Run the Section 14.1 EPC validator over every drafted model.
 *
 * Never throws: an unvalidatable model contributes no findings rather than
 * failing the whole draft.
 */
export function validateArisAiDraftEpcSemantics(draft: ArisAiDraftV1): ArisAiEpcSemanticsResult {
  const knownModelIds = new Set(draft.models.map((model) => model.logicalId))
  const errors: ArisAiValidationFinding[] = []
  const warnings: ArisAiValidationFinding[] = []
  const assignmentTargets = new Set(
    draft.assignments.map((assignment) => assignment.assignedModelLogicalId)
  )
  const draftHasFlowNode = draft.objects.some((object) => FLOW_NODE_TYPES.has(object.objectType))

  draft.models.forEach((model, index) => {
    const hasFlowNode = draft.objects.some(
      (object) =>
        object.modelLogicalId === model.logicalId && FLOW_NODE_TYPES.has(object.objectType)
    )
    if (!hasFlowNode) {
      const emptyWholeDraft = !draftHasFlowNode && index === 0
      const emptyUnassignedPrimary = index === 0 && !assignmentTargets.has(model.logicalId)
      if (emptyWholeDraft || emptyUnassignedPrimary) {
        errors.push(
          finding('epc.model.empty', `$.models[${index}]`, EPC_RULE_MESSAGES['epc.model.empty'])
        )
      }
      return
    }

    const graph = toEpcGraph(adapterModelFor(draft, model.logicalId))
    for (const epcFinding of validateEpcGraph(graph, { knownModelIds })) {
      const mapped = finding(
        epcFinding.ruleId,
        `$.models[${index}]`,
        describeFinding(epcFinding, draft)
      )
      if (epcFinding.severity === 'error') errors.push(mapped)
      else warnings.push(mapped)
    }
  })

  return { errors, warnings }
}
