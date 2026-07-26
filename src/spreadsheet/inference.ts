import {
  PROCESS_WORKBOOK_MODEL_VERSION,
  type BilingualValue,
  type GeneratedIdRecord,
  type GraphInferencePlan,
  type InferredFlowRecord,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type SpreadsheetValidationIssue,
  type SyntheticBoundaryRecord,
  type WorkbookFlow,
  type WorkbookNode,
  type WorkbookParticipant
} from './contracts'
import { SpreadsheetError } from './errors'
import { stableHash } from './hash'

const GATEWAY_TYPES = new Set([
  'exclusiveGateway',
  'inclusiveGateway',
  'parallelGateway',
  'complexGateway',
  'eventBasedGateway'
])

function labelText(value: BilingualValue): string {
  return value.en || value.ar || ''
}

function idPart(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  return normalized || fallback
}

function generatedId(
  prefix: 'Participant' | 'Step' | 'Flow',
  processId: string,
  label: string,
  row: number
): string {
  const normalizedLabel = label.normalize('NFKC').toLocaleLowerCase('en-US').trim()
  const seed = `${processId}\u001f${normalizedLabel}\u001f${row}`
  return `${prefix}_${idPart(processId, 'process')}_${idPart(normalizedLabel, 'item')}_r${row}_${stableHash(seed).slice(0, 8)}`
}

function cloneModel(
  model: ProcessWorkbookModel,
  participants: readonly WorkbookParticipant[],
  nodes: readonly WorkbookNode[],
  flows: readonly WorkbookFlow[]
): ProcessWorkbookModel {
  return Object.freeze({
    version: PROCESS_WORKBOOK_MODEL_VERSION,
    ...(model.templateVersion ? { templateVersion: model.templateVersion } : {}),
    source: model.source,
    processes: model.processes,
    participants: Object.freeze(participants),
    nodes: Object.freeze(nodes),
    flows: Object.freeze(flows),
    glossary: model.glossary
  })
}

export function assignDeterministicIds(model: ProcessWorkbookModel): {
  readonly model: ProcessWorkbookModel
  readonly generatedIds: readonly GeneratedIdRecord[]
} {
  const generatedIds: GeneratedIdRecord[] = []
  const participants = model.participants.map((participant) => {
    if (participant.id) return participant
    const id = generatedId(
      'Participant',
      participant.processId,
      labelText(participant.name),
      participant.provenance.row
    )
    generatedIds.push({
      entity: 'participant',
      processId: participant.processId,
      generatedId: id,
      worksheet: participant.provenance.worksheet,
      row: participant.provenance.row
    })
    return Object.freeze({ ...participant, id, idOrigin: 'generated' as const })
  })
  const nodes = model.nodes.map((node) => {
    if (node.id) return node
    const id = generatedId(
      'Step',
      node.processId,
      labelText(node.name),
      node.provenance.row
    )
    generatedIds.push({
      entity: 'node',
      processId: node.processId,
      generatedId: id,
      worksheet: node.provenance.worksheet,
      row: node.provenance.row
    })
    return Object.freeze({ ...node, id, idOrigin: 'generated' as const })
  })
  const flows = model.flows.map((flow) => {
    if (flow.id) return flow
    const id = generatedId(
      'Flow',
      flow.processId,
      `${flow.sourceStepId}_${flow.targetStepId}`,
      flow.provenance.row
    )
    generatedIds.push({
      entity: 'flow',
      processId: flow.processId,
      generatedId: id,
      worksheet: flow.provenance.worksheet,
      row: flow.provenance.row
    })
    return Object.freeze({ ...flow, id, idOrigin: 'generated' as const })
  })
  return Object.freeze({
    model: cloneModel(model, participants, nodes, flows),
    generatedIds: Object.freeze(generatedIds)
  })
}

function fingerprint(model: ProcessWorkbookModel): string {
  return stableHash(
    JSON.stringify({
      processes: model.processes.map(({ id }) => id),
      nodes: model.nodes.map(({ processId, id, order, type, nextStepIds, mappedTransitions }) => ({
        processId,
        id,
        order,
        type,
        nextStepIds,
        mappedTransitions
      })),
      flows: model.flows.map(
        ({ processId, id, sourceStepId, targetStepId, isDefault, origin }) => ({
          processId,
          id,
          sourceStepId,
          targetStepId,
          isDefault,
          origin
        })
      )
    })
  )
}

function syntheticProvenance(
  source: RecordProvenance,
  kind: 'start' | 'end'
): RecordProvenance {
  return Object.freeze({
    worksheet: source.worksheet,
    row: source.row,
    fields: source.fields,
    synthetic: kind
  } as RecordProvenance)
}

function issue(
  code: string,
  severity: 'error' | 'review' | 'warning',
  processId: string,
  provenance?: RecordProvenance,
  details?: Readonly<Record<string, string | number | boolean>>
): SpreadsheetValidationIssue {
  return Object.freeze({
    code,
    severity,
    messageKey: `spreadsheet.validation.${code}`,
    guidanceKey: `spreadsheet.guidance.${code}`,
    processId,
    ...(provenance
      ? { worksheet: provenance.worksheet, cellAddress: provenance.fields?.order?.address }
      : {}),
    ...(details ? { details } : {})
  })
}

function inferredFlow(
  processId: string,
  source: WorkbookNode,
  targetId: string,
  ordinal: number,
  origin: WorkbookFlow['origin'],
  condition?: WorkbookFlow['condition'],
  isDefault = false
): WorkbookFlow {
  const row = source.provenance.row * 1_000 + ordinal
  return Object.freeze({
    processId,
    id: generatedId('Flow', processId, `${source.id}_${targetId}`, row),
    idOrigin: 'generated',
    sourceStepId: source.id,
    targetStepId: targetId,
    ...(condition ? { condition } : {}),
    isDefault,
    origin,
    provenance: source.provenance
  })
}

function planProcessFlows(
  processId: string,
  nodes: readonly WorkbookNode[],
  explicitFlows: readonly WorkbookFlow[],
  issues: SpreadsheetValidationIssue[],
  inferred: WorkbookFlow[],
  records: InferredFlowRecord[]
): void {
  if (explicitFlows.length > 0) return

  const hasMappedTransitions = nodes.some(
    (node) => node.mappedTransitions && node.mappedTransitions.length > 0
  )
  const hasMappedNext = nodes.some((node) => node.nextStepIds && node.nextStepIds.length > 0)

  if (hasMappedTransitions) {
    for (const node of nodes) {
      const transitions = node.mappedTransitions ?? []
      for (const [index, transition] of transitions.entries()) {
        if (
          GATEWAY_TYPES.has(node.type) &&
          node.type !== 'parallelGateway' &&
          node.type !== 'eventBasedGateway' &&
          !transition.isDefault &&
          !transition.condition?.en &&
          !transition.condition?.ar
        ) {
          issues.push(
            issue('gateway-condition-required', 'error', processId, node.provenance, {
              nodeId: node.id,
              targetId: transition.targetStepId
            })
          )
          continue
        }
        const flow = inferredFlow(
          processId,
          node,
          transition.targetStepId,
          index,
          'mapped',
          transition.condition,
          transition.isDefault ?? false
        )
        inferred.push(flow)
        records.push({
          processId,
          flowId: flow.id,
          sourceStepId: flow.sourceStepId,
          targetStepId: flow.targetStepId,
          reason: 'mapped-next-step'
        })
      }
    }
    return
  }

  if (hasMappedNext) {
    for (const node of nodes) {
      const targets = node.nextStepIds ?? []
      if (targets.length > 1 || (GATEWAY_TYPES.has(node.type) && targets.length > 0)) {
        issues.push(
          issue('branch-topology-requires-explicit-conditions', 'error', processId, node.provenance, {
            nodeId: node.id,
            targets: targets.length
          })
        )
        continue
      }
      if (targets.length === 1) {
        const flow = inferredFlow(processId, node, targets[0]!, 0, 'mapped')
        inferred.push(flow)
        records.push({
          processId,
          flowId: flow.id,
          sourceStepId: flow.sourceStepId,
          targetStepId: flow.targetStepId,
          reason: 'mapped-next-step'
        })
      }
    }
    return
  }

  if (nodes.some((node) => GATEWAY_TYPES.has(node.type))) {
    const gateway = nodes.find((node) => GATEWAY_TYPES.has(node.type))!
    issues.push(
      issue('gateway-topology-not-inferred', 'error', processId, gateway.provenance, {
        nodeId: gateway.id
      })
    )
    return
  }
  const missingOrder = nodes.find((node) => node.order === undefined)
  if (missingOrder) {
    issues.push(
      issue('numeric-order-required', 'error', processId, missingOrder.provenance, {
        nodeId: missingOrder.id
      })
    )
    return
  }
  const orderValues = new Set<number>()
  for (const node of nodes) {
    if (orderValues.has(node.order!)) {
      issues.push(
        issue('duplicate-numeric-order', 'error', processId, node.provenance, {
          order: node.order!
        })
      )
      return
    }
    orderValues.add(node.order!)
  }
  const ordered = nodes
    .slice()
    .sort((left, right) => left.order! - right.order! || left.provenance.row - right.provenance.row)
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const source = ordered[index]!
    const target = ordered[index + 1]!
    const flow = inferredFlow(processId, source, target.id, index, 'inferred-order')
    inferred.push(flow)
    records.push({
      processId,
      flowId: flow.id,
      sourceStepId: source.id,
      targetStepId: target.id,
      reason: 'numeric-order'
    })
  }
}

function planBoundaries(
  processId: string,
  nodes: readonly WorkbookNode[],
  flows: readonly WorkbookFlow[],
  issues: SpreadsheetValidationIssue[],
  boundaries: SyntheticBoundaryRecord[],
  records: InferredFlowRecord[]
): void {
  if (nodes.length === 0) return
  const nodeIds = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, 0]))
  for (const flow of flows) {
    if (nodeIds.has(flow.sourceStepId)) {
      outgoing.set(flow.sourceStepId, (outgoing.get(flow.sourceStepId) ?? 0) + 1)
    }
    if (nodeIds.has(flow.targetStepId)) {
      incoming.set(flow.targetStepId, (incoming.get(flow.targetStepId) ?? 0) + 1)
    }
  }
  const hasStart = nodes.some((node) => node.type === 'startEvent')
  const hasEnd = nodes.some((node) => node.type === 'endEvent')

  if (!hasStart) {
    const candidates = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
    if (candidates.length !== 1) {
      issues.push(
        issue('synthetic-start-ambiguous', 'error', processId, nodes[0]!.provenance, {
          candidates: candidates.length
        })
      )
    } else {
      const target = candidates[0]!
      const id = generatedId('Step', processId, 'synthetic_start', target.provenance.row - 1)
      const node: WorkbookNode = Object.freeze({
        processId,
        id,
        idOrigin: 'generated',
        order: target.order === undefined ? undefined : target.order - 1,
        type: 'startEvent',
        name: Object.freeze({ en: 'Start', ar: 'البداية', active: target.name.active }),
        metadata: Object.freeze({}),
        provenance: syntheticProvenance(target.provenance, 'start')
      })
      const flow = inferredFlow(
        processId,
        node,
        target.id,
        0,
        'synthetic-boundary'
      )
      boundaries.push({ processId, kind: 'start', node, flow })
      records.push({
        processId,
        flowId: flow.id,
        sourceStepId: flow.sourceStepId,
        targetStepId: flow.targetStepId,
        reason: 'synthetic-boundary'
      })
    }
  }

  if (!hasEnd) {
    const candidates = nodes.filter((node) => (outgoing.get(node.id) ?? 0) === 0)
    if (candidates.length !== 1) {
      issues.push(
        issue('synthetic-end-ambiguous', 'error', processId, nodes[0]!.provenance, {
          candidates: candidates.length
        })
      )
    } else {
      const source = candidates[0]!
      const id = generatedId('Step', processId, 'synthetic_end', source.provenance.row + 1)
      const node: WorkbookNode = Object.freeze({
        processId,
        id,
        idOrigin: 'generated',
        order: source.order === undefined ? undefined : source.order + 1,
        type: 'endEvent',
        name: Object.freeze({ en: 'End', ar: 'النهاية', active: source.name.active }),
        metadata: Object.freeze({}),
        provenance: syntheticProvenance(source.provenance, 'end')
      })
      const flow = inferredFlow(
        processId,
        source,
        node.id,
        0,
        'synthetic-boundary'
      )
      boundaries.push({ processId, kind: 'end', node, flow })
      records.push({
        processId,
        flowId: flow.id,
        sourceStepId: flow.sourceStepId,
        targetStepId: flow.targetStepId,
        reason: 'synthetic-boundary'
      })
    }
  }
}

export function createGraphInferencePlan(model: ProcessWorkbookModel): GraphInferencePlan {
  const assigned = assignDeterministicIds(model)
  const issues: SpreadsheetValidationIssue[] = []
  const inferredFlows: WorkbookFlow[] = []
  const inferredFlowRecords: InferredFlowRecord[] = []
  const syntheticBoundaries: SyntheticBoundaryRecord[] = []

  for (const process of assigned.model.processes) {
    const nodes = assigned.model.nodes.filter((node) => node.processId === process.id)
    const explicitFlows = assigned.model.flows.filter((flow) => flow.processId === process.id)
    planProcessFlows(
      process.id,
      nodes,
      explicitFlows,
      issues,
      inferredFlows,
      inferredFlowRecords
    )
    const processFlows = [...explicitFlows, ...inferredFlows.filter((flow) => flow.processId === process.id)]
    planBoundaries(
      process.id,
      nodes,
      processFlows,
      issues,
      syntheticBoundaries,
      inferredFlowRecords
    )
  }

  return Object.freeze({
    modelFingerprint: fingerprint(assigned.model),
    generatedIds: assigned.generatedIds,
    inferredFlows: Object.freeze(inferredFlows),
    inferredFlowRecords: Object.freeze(inferredFlowRecords),
    syntheticBoundaries: Object.freeze(syntheticBoundaries),
    issues: Object.freeze(issues),
    requiresSyntheticBoundaryConfirmation: syntheticBoundaries.length > 0
  })
}

export function applyGraphInferencePlan(
  model: ProcessWorkbookModel,
  plan: GraphInferencePlan,
  options: { readonly confirmSyntheticBoundaries: boolean }
): ProcessWorkbookModel {
  const assigned = assignDeterministicIds(model).model
  if (fingerprint(assigned) !== plan.modelFingerprint) {
    throw new SpreadsheetError('blocking-validation', { reason: 'stale-inference-plan' })
  }
  if (plan.issues.some((candidate) => candidate.severity === 'error')) {
    throw new SpreadsheetError('blocking-validation', { reason: 'inference-errors' })
  }
  if (plan.requiresSyntheticBoundaryConfirmation && !options.confirmSyntheticBoundaries) {
    throw new SpreadsheetError('blocking-validation', {
      reason: 'synthetic-boundary-confirmation-required'
    })
  }
  const boundaryNodes = options.confirmSyntheticBoundaries
    ? plan.syntheticBoundaries.map(({ node }) => node)
    : []
  const boundaryFlows = options.confirmSyntheticBoundaries
    ? plan.syntheticBoundaries.map(({ flow }) => flow)
    : []
  return cloneModel(
    assigned,
    assigned.participants,
    [...assigned.nodes, ...boundaryNodes],
    [...assigned.flows, ...plan.inferredFlows, ...boundaryFlows]
  )
}

