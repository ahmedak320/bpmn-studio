import {
  BPMN_NODE_TYPES,
  PROCESS_WORKBOOK_MODEL_VERSION,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type SpreadsheetValidationIssue,
  type ValidationSeverity,
  type WorkbookFlow,
  type WorkbookNode,
  type WorkbookValidationReport
} from './contracts'
import { SPREADSHEET_LIMITS } from './limits'

export interface WorkbookValidationOptions {
  readonly destinationProcessIds?: ReadonlySet<string>
  readonly additionalIssues?: readonly SpreadsheetValidationIssue[]
}

const SEVERITY_ORDER: Readonly<Record<ValidationSeverity, number>> = {
  error: 0,
  review: 1,
  warning: 2,
  info: 3
}
const DEFAULT_SOURCE_TYPES = new Set([
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'businessRuleTask',
  'manualTask',
  'scriptTask',
  'callActivity',
  'subProcess',
  'exclusiveGateway',
  'inclusiveGateway',
  'complexGateway'
])
const CONDITIONAL_GATEWAYS = new Set(['exclusiveGateway', 'inclusiveGateway', 'complexGateway'])
const NON_CONDITIONAL_GATEWAYS = new Set(['parallelGateway', 'eventBasedGateway'])

function provenanceCell(provenance: RecordProvenance, field?: string): string | undefined {
  if (field) return provenance.fields?.[field]?.address
  return Object.values(provenance.fields ?? {})[0]?.address
}

function makeIssue(
  code: string,
  severity: ValidationSeverity,
  provenance?: RecordProvenance,
  context: {
    processId?: string
    elementId?: string
    field?: string
    rawValue?: unknown
    normalizedValue?: unknown
    details?: Readonly<Record<string, string | number | boolean>>
    guidanceCode?: string
  } = {}
): SpreadsheetValidationIssue {
  return Object.freeze({
    code,
    severity,
    messageKey: `spreadsheet.validation.${code}`,
    guidanceKey: `spreadsheet.guidance.${context.guidanceCode ?? code}`,
    ...(context.processId ? { processId: context.processId } : {}),
    ...(context.elementId ? { elementId: context.elementId } : {}),
    ...(provenance
      ? {
          worksheet: provenance.worksheet,
          cellAddress: provenanceCell(provenance, context.field)
        }
      : {}),
    ...(context.rawValue !== undefined ? { rawValue: context.rawValue } : {}),
    ...(context.normalizedValue !== undefined ? { normalizedValue: context.normalizedValue } : {}),
    ...(context.details ? { details: context.details } : {})
  })
}

function hasText(value: { readonly en?: string; readonly ar?: string } | undefined): boolean {
  return Boolean(value?.en?.trim() || value?.ar?.trim())
}

function conditionPresent(flow: WorkbookFlow): boolean {
  return hasText(flow.condition)
}

function validBpmnId(id: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(id)
}

function validateId(
  id: string,
  kind: string,
  processId: string,
  provenance: RecordProvenance,
  issues: SpreadsheetValidationIssue[],
  field: string
): void {
  if (!id) {
    issues.push(makeIssue(`${kind}-id-missing`, 'error', provenance, { processId, field }))
  } else if (!validBpmnId(id)) {
    issues.push(
      makeIssue(`${kind}-id-invalid`, 'error', provenance, {
        processId,
        elementId: id,
        field,
        rawValue: id
      })
    )
  }
}

function validateFolder(
  folder: string | undefined,
  provenance: RecordProvenance,
  processId: string,
  issues: SpreadsheetValidationIssue[]
): void {
  if (!folder) return
  if (
    folder.startsWith('/') ||
    folder.startsWith('\\') ||
    /^[A-Za-z]:/.test(folder) ||
    folder.includes('\\') ||
    folder.split('/').some((part) => part === '..' || part === '') ||
    /[\u0000-\u001f\u007f]/.test(folder)
  ) {
    issues.push(
      makeIssue('destination-folder-unsafe', 'error', provenance, {
        processId,
        field: 'folder',
        rawValue: folder
      })
    )
  }
}

function validateParticipants(
  model: ProcessWorkbookModel,
  processIds: ReadonlySet<string>,
  issues: SpreadsheetValidationIssue[]
): void {
  const seen = new Set<string>()
  const byKey = new Map<string, (typeof model.participants)[number]>()
  for (const participant of model.participants) {
    validateId(
      participant.id,
      'participant',
      participant.processId,
      participant.provenance,
      issues,
      'participant_id'
    )
    if (!processIds.has(participant.processId)) {
      issues.push(
        makeIssue('participant-process-missing', 'error', participant.provenance, {
          processId: participant.processId,
          elementId: participant.id,
          field: 'process_id',
          rawValue: participant.processId
        })
      )
    }
    const key = `${participant.processId}\u001f${participant.id}`
    if (seen.has(key)) {
      issues.push(
        makeIssue('participant-id-duplicate', 'error', participant.provenance, {
          processId: participant.processId,
          elementId: participant.id,
          field: 'participant_id'
        })
      )
    }
    seen.add(key)
    byKey.set(key, participant)
    if (!hasText(participant.name)) {
      issues.push(
        makeIssue('participant-name-missing', 'error', participant.provenance, {
          processId: participant.processId,
          elementId: participant.id
        })
      )
    }
    if (participant.type === 'pool' && participant.parentId) {
      issues.push(
        makeIssue('pool-parent-not-allowed', 'error', participant.provenance, {
          processId: participant.processId,
          elementId: participant.id,
          field: 'parent_id',
          rawValue: participant.parentId
        })
      )
    }
  }

  for (const participant of model.participants) {
    if (!participant.parentId) continue
    const parent = byKey.get(`${participant.processId}\u001f${participant.parentId}`)
    if (!parent) {
      issues.push(
        makeIssue('participant-parent-missing', 'error', participant.provenance, {
          processId: participant.processId,
          elementId: participant.id,
          field: 'parent_id',
          rawValue: participant.parentId
        })
      )
    }
  }

  const visitState = new Map<string, 0 | 1 | 2>()
  const visit = (key: string, trail: readonly string[]): void => {
    const state = visitState.get(key) ?? 0
    if (state === 2) return
    if (state === 1) {
      const participant = byKey.get(key)
      if (participant) {
        issues.push(
          makeIssue('participant-parent-cycle', 'error', participant.provenance, {
            processId: participant.processId,
            elementId: participant.id,
            details: { cycle: [...trail, participant.id].join(' -> ') }
          })
        )
      }
      return
    }
    visitState.set(key, 1)
    const participant = byKey.get(key)
    if (participant?.parentId) {
      visit(`${participant.processId}\u001f${participant.parentId}`, [...trail, participant.id])
    }
    visitState.set(key, 2)
  }
  for (const key of byKey.keys()) visit(key, [])
}

function validateNodes(
  model: ProcessWorkbookModel,
  processIds: ReadonlySet<string>,
  issues: SpreadsheetValidationIssue[]
): Map<string, WorkbookNode> {
  const globalIds = new Map<string, WorkbookNode>()
  const nodesByKey = new Map<string, WorkbookNode>()
  let totalNodes = 0
  for (const process of model.processes) {
    const processNodes = model.nodes.filter((node) => node.processId === process.id)
    totalNodes += processNodes.length
    if (processNodes.length > SPREADSHEET_LIMITS.nodesPerProcess) {
      issues.push(
        makeIssue('node-process-limit', 'error', process.provenance, {
          processId: process.id,
          details: {
            actual: processNodes.length,
            limit: SPREADSHEET_LIMITS.nodesPerProcess
          }
        })
      )
    } else if (processNodes.length > SPREADSHEET_LIMITS.diagramReadabilityWarningNodes) {
      issues.push(
        makeIssue('diagram-readability', 'warning', process.provenance, {
          processId: process.id,
          details: {
            actual: processNodes.length,
            threshold: SPREADSHEET_LIMITS.diagramReadabilityWarningNodes
          }
        })
      )
    }
  }
  if (totalNodes > SPREADSHEET_LIMITS.nodesPerTransaction) {
    issues.push(
      makeIssue('node-transaction-limit', 'error', undefined, {
        details: {
          actual: totalNodes,
          limit: SPREADSHEET_LIMITS.nodesPerTransaction
        }
      })
    )
  }

  for (const node of model.nodes) {
    validateId(node.id, 'node', node.processId, node.provenance, issues, 'step_id')
    if (!processIds.has(node.processId)) {
      issues.push(
        makeIssue('node-process-missing', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'process_id',
          rawValue: node.processId
        })
      )
    }
    if (node.type === 'unknown' || !(BPMN_NODE_TYPES as readonly string[]).includes(node.type)) {
      issues.push(
        makeIssue('unknown-step-type', 'review', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'type',
          rawValue: node.rawType ?? node.type
        })
      )
    }
    if (!hasText(node.name)) {
      issues.push(
        makeIssue('node-name-missing', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id
        })
      )
    }
    if (node.order !== undefined && !Number.isFinite(node.order)) {
      issues.push(
        makeIssue('node-order-invalid', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'order',
          rawValue: node.order
        })
      )
    }
    if (node.metadata.raci) {
      const roles = node.metadata.raci
        .split(/[;\n]/)
        .map((role) => role.trim().toLocaleUpperCase('en-US'))
        .filter(Boolean)
      if (roles.some((role) => !['R', 'A', 'C', 'I'].includes(role))) {
        issues.push(
          makeIssue('raci-invalid', 'review', node.provenance, {
            processId: node.processId,
            elementId: node.id,
            field: 'raci',
            rawValue: node.metadata.raci
          })
        )
      }
    }
    if (node.metadata.calledProcessId && node.type !== 'callActivity') {
      issues.push(
        makeIssue('called-process-on-non-call-activity', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'called_process_id',
          rawValue: node.metadata.calledProcessId
        })
      )
    }
    if (
      node.metadata.eventDefinition &&
      node.metadata.eventDefinition !== 'none' &&
      !['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent'].includes(
        node.type
      )
    ) {
      issues.push(
        makeIssue('event-definition-on-non-event', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'event_definition',
          rawValue: node.metadata.eventDefinition
        })
      )
    }
    const key = `${node.processId}\u001f${node.id}`
    if (nodesByKey.has(key)) {
      issues.push(
        makeIssue('node-id-duplicate', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          field: 'step_id'
        })
      )
    }
    nodesByKey.set(key, node)
    const global = globalIds.get(node.id)
    if (global && global.processId !== node.processId) {
      issues.push(
        makeIssue('node-id-workbook-duplicate', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          details: { otherProcessId: global.processId }
        })
      )
    } else {
      globalIds.set(node.id, node)
    }
  }
  return nodesByKey
}

function validateParticipantReferences(
  model: ProcessWorkbookModel,
  nodesByKey: ReadonlyMap<string, WorkbookNode>,
  issues: SpreadsheetValidationIssue[]
): void {
  const participants = new Map(
    model.participants.map((participant) => [
      `${participant.processId}\u001f${participant.id}`,
      participant
    ])
  )
  for (const node of nodesByKey.values()) {
    for (const [field, id, expected] of [
      ['pool_id', node.poolId, 'pool'],
      ['lane_id', node.laneId, 'lane'],
      ['participant_id', node.participantId, undefined]
    ] as const) {
      if (!id) continue
      const participant = participants.get(`${node.processId}\u001f${id}`)
      if (!participant) {
        issues.push(
          makeIssue('node-participant-missing', 'error', node.provenance, {
            processId: node.processId,
            elementId: node.id,
            field,
            rawValue: id
          })
        )
      } else if (expected && participant.type !== expected) {
        issues.push(
          makeIssue('node-participant-kind-mismatch', 'error', node.provenance, {
            processId: node.processId,
            elementId: node.id,
            field,
            rawValue: id,
            normalizedValue: expected
          })
        )
      }
    }
    if (node.laneId && node.participantId && node.laneId !== node.participantId) {
      issues.push(
        makeIssue('multiple-lane-assignments', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id
        })
      )
    }
  }
}

function validateFlows(
  model: ProcessWorkbookModel,
  nodesByKey: ReadonlyMap<string, WorkbookNode>,
  issues: SpreadsheetValidationIssue[]
): void {
  const flowIds = new Set<string>()
  const pairs = new Set<string>()
  const outgoingByNode = new Map<string, WorkbookFlow[]>()
  const incomingByNode = new Map<string, WorkbookFlow[]>()

  for (const flow of model.flows) {
    validateId(flow.id, 'flow', flow.processId, flow.provenance, issues, 'flow_id')
    const scopedFlowId = `${flow.processId}\u001f${flow.id}`
    if (flowIds.has(scopedFlowId)) {
      issues.push(
        makeIssue('flow-id-duplicate', 'error', flow.provenance, {
          processId: flow.processId,
          elementId: flow.id,
          field: 'flow_id'
        })
      )
    }
    flowIds.add(scopedFlowId)
    const sourceKey = `${flow.processId}\u001f${flow.sourceStepId}`
    const targetKey = `${flow.processId}\u001f${flow.targetStepId}`
    const source = nodesByKey.get(sourceKey)
    const target = nodesByKey.get(targetKey)
    if (!source) {
      issues.push(
        makeIssue('flow-source-missing', 'error', flow.provenance, {
          processId: flow.processId,
          elementId: flow.id,
          field: 'source_step_id',
          rawValue: flow.sourceStepId
        })
      )
    }
    if (!target) {
      issues.push(
        makeIssue('flow-target-missing', 'error', flow.provenance, {
          processId: flow.processId,
          elementId: flow.id,
          field: 'target_step_id',
          rawValue: flow.targetStepId
        })
      )
    }
    const pair = `${sourceKey}\u001f${flow.targetStepId}`
    if (pairs.has(pair)) {
      issues.push(
        makeIssue('flow-duplicate-edge', 'error', flow.provenance, {
          processId: flow.processId,
          elementId: flow.id
        })
      )
    }
    pairs.add(pair)
    if (source) {
      outgoingByNode.set(sourceKey, [...(outgoingByNode.get(sourceKey) ?? []), flow])
    }
    if (target) {
      incomingByNode.set(targetKey, [...(incomingByNode.get(targetKey) ?? []), flow])
    }
    if (flow.sourceStepId === flow.targetStepId) {
      issues.push(
        makeIssue('flow-self-loop-review', 'review', flow.provenance, {
          processId: flow.processId,
          elementId: flow.id
        })
      )
    }
  }

  for (const node of nodesByKey.values()) {
    const key = `${node.processId}\u001f${node.id}`
    const outgoing = outgoingByNode.get(key) ?? []
    const incoming = incomingByNode.get(key) ?? []
    if (node.type === 'startEvent' && incoming.length > 0) {
      issues.push(
        makeIssue('start-event-incoming', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id
        })
      )
    }
    if (node.type === 'endEvent' && outgoing.length > 0) {
      issues.push(
        makeIssue('end-event-outgoing', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id
        })
      )
    }
    const defaults = outgoing.filter((flow) => flow.isDefault)
    if (defaults.length > 1) {
      issues.push(
        makeIssue('multiple-default-flows', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          details: { count: defaults.length }
        })
      )
    }
    for (const flow of outgoing) {
      if (flow.isDefault && conditionPresent(flow)) {
        issues.push(
          makeIssue('default-flow-has-condition', 'error', flow.provenance, {
            processId: flow.processId,
            elementId: flow.id
          })
        )
      }
      if (flow.isDefault && !DEFAULT_SOURCE_TYPES.has(node.type)) {
        issues.push(
          makeIssue('default-flow-source-invalid', 'error', flow.provenance, {
            processId: flow.processId,
            elementId: flow.id,
            details: { sourceType: node.type }
          })
        )
      }
      if (NON_CONDITIONAL_GATEWAYS.has(node.type) && conditionPresent(flow)) {
        issues.push(
          makeIssue('gateway-condition-not-allowed', 'error', flow.provenance, {
            processId: flow.processId,
            elementId: flow.id,
            details: { sourceType: node.type }
          })
        )
      }
      if (NON_CONDITIONAL_GATEWAYS.has(node.type) && flow.isDefault) {
        issues.push(
          makeIssue('gateway-default-not-allowed', 'error', flow.provenance, {
            processId: flow.processId,
            elementId: flow.id,
            details: { sourceType: node.type }
          })
        )
      }
    }
    const gatewayIsSplitting =
      (CONDITIONAL_GATEWAYS.has(node.type) || NON_CONDITIONAL_GATEWAYS.has(node.type)) &&
      incoming.length <= 1
    if (gatewayIsSplitting && outgoing.length < 2) {
      issues.push(
        makeIssue('gateway-branch-count', 'error', node.provenance, {
          processId: node.processId,
          elementId: node.id,
          details: { outgoing: outgoing.length }
        })
      )
    }
    if (CONDITIONAL_GATEWAYS.has(node.type) && outgoing.length > 1) {
      for (const flow of outgoing) {
        if (!flow.isDefault && !conditionPresent(flow)) {
          issues.push(
            makeIssue('gateway-condition-required', 'error', flow.provenance, {
              processId: flow.processId,
              elementId: flow.id
            })
          )
        }
      }
    }
  }

  for (const process of model.processes) {
    const processNodes = model.nodes.filter((node) => node.processId === process.id)
    const starts = processNodes.filter((node) => node.type === 'startEvent')
    const ends = processNodes.filter((node) => node.type === 'endEvent')
    if (starts.length === 0) {
      issues.push(
        makeIssue('start-event-missing', 'error', process.provenance, {
          processId: process.id
        })
      )
    }
    if (ends.length === 0) {
      issues.push(
        makeIssue('end-event-missing', 'error', process.provenance, {
          processId: process.id
        })
      )
    }
    if (starts.length > 0) {
      const visited = new Set<string>()
      const queue = starts.map((node) => node.id)
      while (queue.length > 0) {
        const id = queue.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        for (const flow of outgoingByNode.get(`${process.id}\u001f${id}`) ?? []) {
          queue.push(flow.targetStepId)
        }
      }
      for (const node of processNodes) {
        if (!visited.has(node.id)) {
          issues.push(
            makeIssue('node-unreachable', 'warning', node.provenance, {
              processId: process.id,
              elementId: node.id
            })
          )
        }
      }
    }
  }
}

function validateCalls(
  model: ProcessWorkbookModel,
  processIds: ReadonlySet<string>,
  destinationProcessIds: ReadonlySet<string>,
  issues: SpreadsheetValidationIssue[]
): void {
  for (const node of model.nodes) {
    const called = node.metadata.calledProcessId
    if (!called) continue
    if (processIds.has(called) || destinationProcessIds.has(called)) continue
    issues.push(
      makeIssue(
        node.metadata.reviewedUnlinkedCall
          ? 'called-process-reviewed-unlinked'
          : 'called-process-unresolved',
        node.metadata.reviewedUnlinkedCall ? 'warning' : 'error',
        node.provenance,
        {
          processId: node.processId,
          elementId: node.id,
          field: 'called_process_id',
          rawValue: called
        }
      )
    )
  }
}

function validateGlossary(model: ProcessWorkbookModel, issues: SpreadsheetValidationIssue[]): void {
  const seen = new Set<string>()
  for (const entry of model.glossary) {
    if (!entry.english || (!entry.arabic && !entry.doNotTranslate)) {
      issues.push(
        makeIssue('glossary-entry-incomplete', 'error', entry.provenance, {
          rawValue: `${entry.english}|${entry.arabic}`
        })
      )
    }
    const key = entry.caseSensitive ? entry.english : entry.english.toLocaleLowerCase('en-US')
    if (seen.has(key)) {
      issues.push(
        makeIssue('glossary-entry-duplicate', 'warning', entry.provenance, {
          rawValue: entry.english
        })
      )
    }
    seen.add(key)
  }
}

function sortedIssues(
  issues: readonly SpreadsheetValidationIssue[]
): readonly SpreadsheetValidationIssue[] {
  return Object.freeze(
    issues.slice().sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        (left.worksheet ?? '').localeCompare(right.worksheet ?? '', 'en') ||
        (left.cellAddress ?? '').localeCompare(right.cellAddress ?? '', 'en', {
          numeric: true
        }) ||
        left.code.localeCompare(right.code, 'en')
    )
  )
}

export function validateProcessWorkbookModel(
  model: ProcessWorkbookModel,
  options: WorkbookValidationOptions = {}
): WorkbookValidationReport {
  const issues: SpreadsheetValidationIssue[] = [...(options.additionalIssues ?? [])]
  if (model.version !== PROCESS_WORKBOOK_MODEL_VERSION) {
    issues.push(
      makeIssue('model-version-unsupported', 'error', undefined, {
        rawValue: model.version,
        normalizedValue: PROCESS_WORKBOOK_MODEL_VERSION
      })
    )
  }
  const processIds = new Set<string>()
  for (const process of model.processes) {
    validateId(process.id, 'process', process.id, process.provenance, issues, 'process_id')
    if (processIds.has(process.id)) {
      issues.push(
        makeIssue('process-id-duplicate', 'error', process.provenance, {
          processId: process.id,
          field: 'process_id'
        })
      )
    }
    processIds.add(process.id)
    if (options.destinationProcessIds?.has(process.id)) {
      issues.push(
        makeIssue('destination-process-id-collision', 'error', process.provenance, {
          processId: process.id
        })
      )
    }
    if (!hasText(process.name)) {
      issues.push(
        makeIssue('process-name-missing', 'error', process.provenance, {
          processId: process.id
        })
      )
    }
    validateFolder(process.folder, process.provenance, process.id, issues)
  }
  if (model.processes.length === 0) {
    issues.push(makeIssue('processes-empty', 'error'))
  }

  validateParticipants(model, processIds, issues)
  const nodesByKey = validateNodes(model, processIds, issues)
  validateParticipantReferences(model, nodesByKey, issues)
  validateFlows(model, nodesByKey, issues)
  validateCalls(model, processIds, options.destinationProcessIds ?? new Set(), issues)
  validateGlossary(model, issues)

  const sorted = sortedIssues(issues)
  const errorCount = sorted.filter(({ severity }) => severity === 'error').length
  const reviewCount = sorted.filter(({ severity }) => severity === 'review').length
  const warningCount = sorted.filter(({ severity }) => severity === 'warning').length
  return Object.freeze({
    issues: sorted,
    blocking: errorCount > 0 || reviewCount > 0,
    errorCount,
    reviewCount,
    warningCount
  })
}
