import type { EpcFinding, EpcGraph } from './types'
import { FLOW_NODE_TYPES, OT_EVT, OT_FUNC, OT_RULE, classifyRuleSymbol } from './constants'
import { type FlowGraphIndex, buildFlowGraphIndex, connectedComponents } from './flowGraph'

export interface ValidateEpcOptions {
  /**
   * Model ids known to exist in the surrounding document, used by
   * `checkLinkedModelAssignments` to detect dangling `linkedModelIds` references. When
   * omitted, the linked-model check is skipped (there is nothing to validate against).
   */
  readonly knownModelIds?: ReadonlySet<string>
}

/**
 * Section 14.1 EPC rule table.
 *
 * | Rule id                              | Function                              |
 * |---------------------------------------|----------------------------------------|
 * | epc.alternation                       | checkAlternation                       |
 * | epc.startEnd.missingStart             | checkStartEndCompleteness              |
 * | epc.startEnd.missingEnd               | checkStartEndCompleteness              |
 * | epc.rule.splitMergeConflict           | checkRuleSplitMergeConflict            |
 * | epc.event.decisionViolation           | checkEventPrecedesDecisionSplit        |
 * | epc.connectivity.orphanNode           | checkConnectedComponentIntegrity       |
 * | epc.rule.unrecognizedSymbol           | checkRuleSymbolRecognized              |
 * | epc.connection.missingType            | checkTypedConnections                  |
 * | epc.linkedModel.danglingReference     | checkLinkedModelAssignments            |
 */
export function validateEpcGraph(
  graph: EpcGraph,
  options: ValidateEpcOptions = {}
): readonly EpcFinding[] {
  const index = buildFlowGraphIndex(graph)
  return [
    ...checkAlternation(index),
    ...checkStartEndCompleteness(index),
    ...checkRuleSplitMergeConflict(index),
    ...checkEventPrecedesDecisionSplit(index),
    ...checkConnectedComponentIntegrity(index),
    ...checkRuleSymbolRecognized(index),
    ...checkTypedConnections(index),
    ...checkLinkedModelAssignments(index, options.knownModelIds)
  ]
}

/**
 * Classic rule: events and functions must alternate along control flow. Two functions or
 * two events directly connected by a flow edge is a violation (rules sit between them),
 * except for DMT's exact `CT_IS_PREDEC_OF_1` Function→Function sequence tuple.
 */
export function checkAlternation(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  for (const edge of index.flowEdges) {
    const source = index.nodeById.get(edge.source)
    const target = index.nodeById.get(edge.target)
    if (!source || !target) continue
    if (
      edge.connectionType === 'CT_IS_PREDEC_OF_1' &&
      source.objectType === OT_FUNC &&
      target.objectType === OT_FUNC
    ) {
      continue
    }
    if (
      source.objectType === target.objectType &&
      (source.objectType === OT_FUNC || source.objectType === OT_EVT)
    ) {
      findings.push({
        ruleId: 'epc.alternation',
        severity: 'error',
        messageKey: 'aris.epc.finding.alternationViolation',
        messageParams: { objectType: source.objectType },
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id]
      })
    }
  }
  return findings
}

/** Classic rule: a model must have at least one start event and at least one end event. */
export function checkStartEndCompleteness(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  const events = index.graph.nodes.filter((node) => node.objectType === OT_EVT)
  const startEvents = events.filter(
    (event) => (index.flowEdgesByTarget.get(event.id)?.length ?? 0) === 0
  )
  const endEvents = events.filter(
    (event) => (index.flowEdgesBySource.get(event.id)?.length ?? 0) === 0
  )

  if (startEvents.length === 0) {
    findings.push({
      ruleId: 'epc.startEnd.missingStart',
      severity: 'error',
      messageKey: 'aris.epc.finding.missingStartEvent',
      nodeIds: events.map((event) => event.id),
      edgeIds: []
    })
  }
  if (endEvents.length === 0) {
    findings.push({
      ruleId: 'epc.startEnd.missingEnd',
      severity: 'error',
      messageKey: 'aris.epc.finding.missingEndEvent',
      nodeIds: events.map((event) => event.id),
      edgeIds: []
    })
  }
  return findings
}

/**
 * Classic rule: a rule (connector) with multiple outgoing flow edges is a split; multiple
 * incoming is a merge. Being both at once (an ambiguous connector that both merges several
 * incoming branches and re-splits them) is a violation — split and merge must be modeled as
 * distinct connectors.
 */
export function checkRuleSplitMergeConflict(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  for (const node of index.graph.nodes) {
    if (node.objectType !== OT_RULE) continue
    const incoming = index.flowEdgesByTarget.get(node.id) ?? []
    const outgoing = index.flowEdgesBySource.get(node.id) ?? []
    if (incoming.length > 1 && outgoing.length > 1) {
      findings.push({
        ruleId: 'epc.rule.splitMergeConflict',
        severity: 'error',
        messageKey: 'aris.epc.finding.ruleSplitMergeConflict',
        nodeIds: [node.id],
        edgeIds: [...incoming, ...outgoing].map((edge) => edge.id)
      })
    }
  }
  return findings
}

/**
 * Headline rule from the plan: an event must never perform a decision. A decision belongs
 * to a rule (OT_RULE), not an event (OT_EVT). Concretely: an event must not be followed
 * directly by an XOR/OR *split* — a rule with more than one outgoing flow edge. (AND is
 * excluded: a parallel fork does not choose between alternatives, so it is not "a
 * decision" in the sense this rule guards against.) An event flowing into an XOR/OR rule
 * that only *merges* (outdegree <= 1) is fine — the rule still does the (trivial) routing,
 * not the event.
 */
export function checkEventPrecedesDecisionSplit(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  for (const edge of index.flowEdges) {
    const source = index.nodeById.get(edge.source)
    const target = index.nodeById.get(edge.target)
    if (!source || !target) continue
    if (source.objectType !== OT_EVT || target.objectType !== OT_RULE) continue
    const ruleKind = classifyRuleSymbol(target.symbolType)
    if (ruleKind !== 'XOR' && ruleKind !== 'OR') continue
    const outgoing = index.flowEdgesBySource.get(target.id) ?? []
    if (outgoing.length > 1) {
      findings.push({
        ruleId: 'epc.event.decisionViolation',
        severity: 'error',
        messageKey: 'aris.epc.finding.eventPrecedesDecisionSplit',
        messageParams: { ruleKind },
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id, ...outgoing.map((out) => out.id)]
      })
    }
  }
  return findings
}

/**
 * Connected-component integrity: every control-flow node (function/event/rule) must belong
 * to the same connected component as the rest of the model's control flow. Nodes stranded
 * in a smaller component are reported as orphans. Satellite objects (OT_APPL_SYS, OT_PERS,
 * ...) are out of scope for this check — they are not expected to sit on the flow graph.
 */
export function checkConnectedComponentIntegrity(index: FlowGraphIndex): readonly EpcFinding[] {
  const flowNodeIds = new Set(
    index.graph.nodes.filter((node) => FLOW_NODE_TYPES.has(node.objectType)).map((node) => node.id)
  )
  if (flowNodeIds.size <= 1) return []

  const components = connectedComponents(index, flowNodeIds)
  if (components.length <= 1) return []

  let largest = components[0]
  for (const component of components) {
    if (component.length > largest.length) largest = component
  }
  const primary = new Set(largest)

  const findings: EpcFinding[] = []
  for (const component of components) {
    if (component === largest) continue
    for (const nodeId of component) {
      if (primary.has(nodeId)) continue
      findings.push({
        ruleId: 'epc.connectivity.orphanNode',
        severity: 'warning',
        messageKey: 'aris.epc.finding.orphanNode',
        nodeIds: [nodeId],
        edgeIds: []
      })
    }
  }
  return findings
}

/** AND/OR/XOR rule use: every OT_RULE must declare a recognized connector symbol. */
export function checkRuleSymbolRecognized(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  for (const node of index.graph.nodes) {
    if (node.objectType !== OT_RULE) continue
    if (classifyRuleSymbol(node.symbolType) === 'unknown') {
      findings.push({
        ruleId: 'epc.rule.unrecognizedSymbol',
        severity: 'warning',
        messageKey: 'aris.epc.finding.unrecognizedRuleSymbol',
        messageParams: { symbolType: node.symbolType ?? '' },
        nodeIds: [node.id],
        edgeIds: []
      })
    }
  }
  return findings
}

/** Typed connections: every connection occurrence must carry a non-empty connection type. */
export function checkTypedConnections(index: FlowGraphIndex): readonly EpcFinding[] {
  const findings: EpcFinding[] = []
  for (const edge of index.allEdges) {
    if (!edge.connectionType || edge.connectionType.trim() === '') {
      findings.push({
        ruleId: 'epc.connection.missingType',
        severity: 'error',
        messageKey: 'aris.epc.finding.missingConnectionType',
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id]
      })
    }
  }
  return findings
}

/**
 * Linked-model assignments: a node's `linkedModelIds` (process-interface assignment to a
 * child model) must reference models that actually exist. Only checked when the caller
 * supplies `knownModelIds` — without it there is nothing to validate against.
 */
export function checkLinkedModelAssignments(
  index: FlowGraphIndex,
  knownModelIds: ReadonlySet<string> | undefined
): readonly EpcFinding[] {
  if (!knownModelIds) return []
  const findings: EpcFinding[] = []
  for (const node of index.graph.nodes) {
    for (const modelId of node.linkedModelIds ?? []) {
      if (!knownModelIds.has(modelId)) {
        findings.push({
          ruleId: 'epc.linkedModel.danglingReference',
          severity: 'error',
          messageKey: 'aris.epc.finding.danglingLinkedModel',
          messageParams: { modelId },
          nodeIds: [node.id],
          edgeIds: []
        })
      }
    }
  }
  return findings
}
