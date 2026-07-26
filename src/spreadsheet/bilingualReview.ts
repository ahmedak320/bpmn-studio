import {
  SEEDED_GLOSSARY,
  approvedNeutralTerms as seededNeutralTerms,
  validateTargetScript
} from '../localization'
import {
  getRuntimeValidationAdapters,
  validateBpmnXml,
  type BpmnValidationAdapter
} from '../validation'
import type {
  BilingualValue,
  BpmnModelGenerationAdapter,
  BpmnNodeType,
  ProcessGraphModel,
  ProcessWorkbookModel,
  SpreadsheetLocale,
  WorkbookNode,
  WorkbookParticipant
} from './contracts'
import { SpreadsheetError, throwIfAborted } from './errors'

export const SPREADSHEET_BILINGUAL_REVIEW_PROTOCOL_VERSION = 1 as const

export interface SpreadsheetBilingualReviewRequest {
  readonly version: typeof SPREADSHEET_BILINGUAL_REVIEW_PROTOCOL_VERSION
  readonly processId: string
  readonly suggestedName: string
  readonly xml: string
  readonly ordinal: number
  readonly total: number
  readonly signal: AbortSignal
}

export type SpreadsheetBilingualReviewResult =
  | {
      readonly status: 'completed'
      readonly reviewedXml: string
    }
  | {
      readonly status: 'cancelled'
    }

export type SpreadsheetBilingualReviewCallback = (
  request: SpreadsheetBilingualReviewRequest
) => Promise<SpreadsheetBilingualReviewResult>

export type SpreadsheetBilingualReviewOutcome =
  | {
      readonly status: 'completed'
      readonly model: ProcessWorkbookModel
    }
  | {
      readonly status: 'cancelled'
      readonly processId: string
    }

export interface MergeReviewedBpmnOptions {
  readonly knownProcessIds?: Iterable<string>
  readonly validationAdapters?: readonly BpmnValidationAdapter[]
  readonly signal?: AbortSignal
}

export interface ReviewProcessWorkbookOptions extends MergeReviewedBpmnOptions {
  readonly generator: BpmnModelGenerationAdapter
  readonly review: SpreadsheetBilingualReviewCallback
}

interface BpmnElement {
  readonly $type?: string
  readonly $attrs?: Readonly<Record<string, unknown>>
  readonly id?: string
  readonly name?: string
  readonly rootElements?: readonly BpmnElement[]
  readonly flowElements?: readonly BpmnElement[]
  readonly participants?: readonly BpmnElement[]
  readonly processRef?: BpmnElement
  readonly sourceRef?: BpmnElement
  readonly targetRef?: BpmnElement
  readonly default?: BpmnElement
  readonly laneSets?: readonly BpmnElement[]
  readonly lanes?: readonly BpmnElement[]
  readonly childLaneSet?: BpmnElement
  readonly flowNodeRef?: readonly BpmnElement[]
  readonly eventDefinitions?: readonly BpmnElement[]
  readonly messageFlows?: readonly BpmnElement[]
  readonly conversationNodes?: readonly BpmnElement[]
  readonly calledElement?: string
  readonly isExecutable?: boolean
  readonly get?: (property: string) => unknown
  readonly [key: string]: unknown
}

interface ParsedGraph {
  readonly process: BpmnElement
  readonly nodes: ReadonlyMap<string, BpmnElement>
  readonly flows: ReadonlyMap<string, BpmnElement>
  readonly pools: ReadonlyMap<string, BpmnElement>
  readonly lanes: ReadonlyMap<string, BpmnElement>
  readonly laneParents: ReadonlyMap<string, string | undefined>
  readonly laneMembership: ReadonlyMap<string, readonly string[]>
}

const BPMN_TYPE_BY_NODE_TYPE: Readonly<Record<BpmnNodeType, string>> = Object.freeze({
  task: 'bpmn:Task',
  userTask: 'bpmn:UserTask',
  serviceTask: 'bpmn:ServiceTask',
  sendTask: 'bpmn:SendTask',
  receiveTask: 'bpmn:ReceiveTask',
  businessRuleTask: 'bpmn:BusinessRuleTask',
  manualTask: 'bpmn:ManualTask',
  scriptTask: 'bpmn:ScriptTask',
  callActivity: 'bpmn:CallActivity',
  subProcess: 'bpmn:SubProcess',
  startEvent: 'bpmn:StartEvent',
  endEvent: 'bpmn:EndEvent',
  intermediateCatchEvent: 'bpmn:IntermediateCatchEvent',
  intermediateThrowEvent: 'bpmn:IntermediateThrowEvent',
  exclusiveGateway: 'bpmn:ExclusiveGateway',
  inclusiveGateway: 'bpmn:InclusiveGateway',
  parallelGateway: 'bpmn:ParallelGateway',
  complexGateway: 'bpmn:ComplexGateway',
  eventBasedGateway: 'bpmn:EventBasedGateway'
})

const EVENT_DEFINITION_TYPE: Readonly<
  Partial<Record<NonNullable<WorkbookNode['metadata']['eventDefinition']>, string>>
> = Object.freeze({
  message: 'bpmn:MessageEventDefinition',
  timer: 'bpmn:TimerEventDefinition',
  signal: 'bpmn:SignalEventDefinition',
  conditional: 'bpmn:ConditionalEventDefinition',
  link: 'bpmn:LinkEventDefinition',
  error: 'bpmn:ErrorEventDefinition',
  escalation: 'bpmn:EscalationEventDefinition',
  terminate: 'bpmn:TerminateEventDefinition'
})

function reviewFailure(
  reason: string,
  processId: string,
  details: Readonly<Record<string, string | number | boolean>> = {}
): never {
  throw new SpreadsheetError('adapter-contract-violation', {
    contract: 'bilingual-review',
    reason,
    processId,
    ...details
  })
}

function typeOf(element: BpmnElement | undefined): string {
  return typeof element?.$type === 'string' ? element.$type : ''
}

function idOf(element: BpmnElement | undefined): string | undefined {
  return typeof element?.id === 'string' && element.id.trim() ? element.id.trim() : undefined
}

function elements(value: unknown): readonly BpmnElement[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is BpmnElement => typeof entry === 'object' && entry !== null)
    : []
}

function property(element: BpmnElement, name: string): unknown {
  if (element[name] !== undefined) return element[name]
  try {
    const direct = element.get?.(name)
    if (direct !== undefined) return direct
    const qualified = element.get?.(`orbitpm:${name}`)
    if (qualified !== undefined) return qualified
  } catch {
    // Fall through to raw attributes. Unknown OrbitPM attributes are retained
    // there by bpmn-moddle.
  }
  return element.$attrs?.[`orbitpm:${name}`] ?? element.$attrs?.[name]
}

function textProperty(element: BpmnElement, name: string): string | undefined {
  const value = property(element, name)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function activeLanguage(
  element: BpmnElement,
  fallback: SpreadsheetLocale,
  processId: string
): SpreadsheetLocale {
  const active = textProperty(element, 'activeLang')
  if (active === undefined) return fallback
  if (active === 'en' || active === 'ar') return active
  return reviewFailure('invalid-active-language', processId, {
    elementId: idOf(element) ?? 'unknown',
    value: active
  })
}

function populated(value: BilingualValue | undefined): boolean {
  return Boolean(value?.en?.trim() || value?.ar?.trim())
}

function approvedNeutralTerms(model: ProcessWorkbookModel): readonly string[] {
  return Object.freeze(
    [
      ...seededNeutralTerms(SEEDED_GLOSSARY),
      ...model.glossary
        .filter(({ doNotTranslate }) => doNotTranslate)
        .flatMap(({ english, arabic }) => [english.trim(), arabic.trim()])
    ].filter(Boolean)
  )
}

function validatedPair(
  element: BpmnElement,
  prefix: string,
  expected: BilingualValue | undefined,
  active: SpreadsheetLocale,
  processId: string,
  field: string,
  neutralTerms: readonly string[],
  required = false
): BilingualValue | undefined {
  const en = textProperty(element, `${prefix}En`)
  const ar = textProperty(element, `${prefix}Ar`)
  const projection =
    prefix === 'name' ? textProperty(element, 'name') : textProperty(element, prefix)
  const expectedPresent = populated(expected)
  const actualPresent = Boolean(en || ar || projection)

  if (!expectedPresent && !required) {
    if (actualPresent) {
      reviewFailure('unexpected-bilingual-field', processId, {
        elementId: idOf(element) ?? 'unknown',
        field
      })
    }
    return expected
  }
  if (!en || !ar) {
    reviewFailure('incomplete-bilingual-field', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      missing: !en ? 'en' : 'ar'
    })
  }

  const enValidation = validateTargetScript(en, 'en', {
    approvedNeutralTerms: neutralTerms
  })
  if (!enValidation.valid) {
    reviewFailure('wrong-script', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      target: 'en',
      script: enValidation.script
    })
  }
  const arValidation = validateTargetScript(ar, 'ar', {
    approvedNeutralTerms: neutralTerms
  })
  if (!arValidation.valid) {
    reviewFailure('wrong-script', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      target: 'ar',
      script: arValidation.script
    })
  }

  const projected = active === 'ar' ? ar : en
  if (projection !== projected) {
    reviewFailure('stale-projection', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      target: active
    })
  }
  return Object.freeze({ en, ar, active })
}

function listLines(value: string): readonly string[] {
  return Object.freeze(
    value
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((entry) => entry.trim())
  )
}

function validatedList(
  element: BpmnElement,
  prefix: string,
  expected: readonly BilingualValue[] | undefined,
  active: SpreadsheetLocale,
  processId: string,
  field: string,
  neutralTerms: readonly string[]
): readonly BilingualValue[] | undefined {
  const enText = textProperty(element, `${prefix}En`)
  const arText = textProperty(element, `${prefix}Ar`)
  const projection = textProperty(element, prefix)
  const expectedCount = expected?.length ?? 0
  const actualPresent = Boolean(enText || arText || projection)
  if (expectedCount === 0) {
    if (actualPresent) {
      reviewFailure('unexpected-bilingual-field', processId, {
        elementId: idOf(element) ?? 'unknown',
        field
      })
    }
    return expected
  }
  if (!enText || !arText) {
    reviewFailure('incomplete-bilingual-field', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      missing: !enText ? 'en' : 'ar'
    })
  }

  const en = listLines(enText)
  const ar = listLines(arText)
  if (
    en.length !== expectedCount ||
    ar.length !== expectedCount ||
    en.some((entry) => !entry) ||
    ar.some((entry) => !entry)
  ) {
    reviewFailure('metadata-list-shape-changed', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      expected: expectedCount,
      english: en.length,
      arabic: ar.length
    })
  }
  const expectedProjection = (active === 'ar' ? ar : en).join('\n')
  if (projection !== expectedProjection) {
    reviewFailure('stale-projection', processId, {
      elementId: idOf(element) ?? 'unknown',
      field,
      target: active
    })
  }

  return Object.freeze(
    en.map((english, index) => {
      const arabic = ar[index]!
      const enValidation = validateTargetScript(english, 'en', {
        approvedNeutralTerms: neutralTerms
      })
      const arValidation = validateTargetScript(arabic, 'ar', {
        approvedNeutralTerms: neutralTerms
      })
      if (!enValidation.valid || !arValidation.valid) {
        reviewFailure('wrong-script', processId, {
          elementId: idOf(element) ?? 'unknown',
          field: `${field}.${index}`,
          target: !enValidation.valid ? 'en' : 'ar',
          script: !enValidation.valid ? enValidation.script : arValidation.script
        })
      }
      return Object.freeze({ en: english, ar: arabic, active })
    })
  )
}

function exactIds(
  actual: ReadonlyMap<string, BpmnElement>,
  expected: readonly string[],
  processId: string,
  kind: string
): void {
  const expectedSet = new Set(expected)
  if (actual.size !== expectedSet.size || [...actual.keys()].some((id) => !expectedSet.has(id))) {
    reviewFailure('graph-identity-changed', processId, {
      kind,
      expected: [...expectedSet].sort().join(','),
      actual: [...actual.keys()].sort().join(',')
    })
  }
}

function participantOrder(left: WorkbookParticipant, right: WorkbookParticipant): number {
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY
  return (
    leftOrder - rightOrder ||
    left.provenance.row - right.provenance.row ||
    left.id.localeCompare(right.id, 'en')
  )
}

function assertSecondaryPoolsAreEmpty(
  model: ProcessWorkbookModel,
  processId: string,
  orderedPools: readonly WorkbookParticipant[]
): void {
  if (orderedPools.length <= 1) return
  const primaryPoolId = orderedPools[0]!.id
  const poolIds = new Set(orderedPools.map(({ id }) => id))
  const lanes = new Map(
    model.participants
      .filter((participant) => participant.processId === processId && participant.type === 'lane')
      .map((lane) => [lane.id, lane] as const)
  )
  const poolForLane = (laneId: string): string | undefined => {
    const visited = new Set<string>()
    let current = lanes.get(laneId)
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id)
      if (poolIds.has(current.parentId)) return current.parentId
      current = lanes.get(current.parentId)
    }
    return undefined
  }
  const reject = (poolId: string, elementId: string): never =>
    reviewFailure('participant-schema-changed', processId, {
      field: 'secondaryPoolAssignment',
      primaryPoolId,
      poolId,
      elementId
    })

  for (const lane of lanes.values()) {
    const poolId = poolForLane(lane.id)
    if (poolId && poolId !== primaryPoolId) reject(poolId, lane.id)
  }
  for (const node of model.nodes.filter((candidate) => candidate.processId === processId)) {
    const explicitPoolIds = [
      node.poolId && poolIds.has(node.poolId) ? node.poolId : undefined,
      node.participantId && poolIds.has(node.participantId) ? node.participantId : undefined
    ].filter((id): id is string => Boolean(id))
    const laneId =
      node.laneId && lanes.has(node.laneId)
        ? node.laneId
        : node.participantId && lanes.has(node.participantId)
          ? node.participantId
          : undefined
    const assignedPoolIds = laneId
      ? [...explicitPoolIds, poolForLane(laneId)].filter((id): id is string => Boolean(id))
      : explicitPoolIds
    const secondaryPoolId = assignedPoolIds.find((poolId) => poolId !== primaryPoolId)
    if (secondaryPoolId) reject(secondaryPoolId, node.id)
  }
}

function collectLanes(
  laneSets: readonly BpmnElement[],
  lanes: Map<string, BpmnElement>,
  parents: Map<string, string | undefined>,
  membership: Map<string, string[]>,
  processId: string,
  parentLaneId?: string
): void {
  for (const laneSet of laneSets) {
    for (const lane of elements(laneSet.lanes)) {
      const laneId = idOf(lane)
      if (!laneId || lanes.has(laneId)) {
        reviewFailure('lane-identity-invalid', processId, {
          elementId: laneId ?? 'missing'
        })
      }
      lanes.set(laneId, lane)
      parents.set(laneId, parentLaneId)
      for (const node of elements(lane.flowNodeRef)) {
        const nodeId = idOf(node)
        if (!nodeId) continue
        const assigned = membership.get(nodeId)
        if (assigned) assigned.push(laneId)
        else membership.set(nodeId, [laneId])
      }
      if (lane.childLaneSet) {
        collectLanes([lane.childLaneSet], lanes, parents, membership, processId, laneId)
      }
    }
  }
}

function mapById(
  values: readonly BpmnElement[],
  processId: string,
  kind: string
): ReadonlyMap<string, BpmnElement> {
  const mapped = new Map<string, BpmnElement>()
  for (const value of values) {
    const id = idOf(value)
    if (!id || mapped.has(id)) {
      reviewFailure('graph-identity-changed', processId, {
        kind,
        elementId: id ?? 'missing'
      })
    }
    mapped.set(id, value)
  }
  return mapped
}

function parseExactGraph(
  definitions: BpmnElement,
  model: ProcessWorkbookModel,
  processId: string
): ParsedGraph {
  const roots = elements(definitions.rootElements)
  const processes = roots.filter((element) => typeOf(element) === 'bpmn:Process')
  if (processes.length !== 1 || idOf(processes[0]) !== processId) {
    reviewFailure('wrong-process', processId, {
      actual: processes.map((process) => idOf(process) ?? 'missing').join(',')
    })
  }
  const process = processes[0]!
  if (process.isExecutable !== false) {
    reviewFailure('process-schema-changed', processId, {
      field: 'isExecutable'
    })
  }

  const expectedNodes = model.nodes.filter((node) => node.processId === processId)
  const expectedFlows = model.flows.filter((flow) => flow.processId === processId)
  const flowElements = elements(process.flowElements)
  const nodeElements = flowElements.filter((element) => typeOf(element) !== 'bpmn:SequenceFlow')
  const flowElementsOnly = flowElements.filter((element) => typeOf(element) === 'bpmn:SequenceFlow')
  if (flowElements.length !== expectedNodes.length + expectedFlows.length) {
    reviewFailure('graph-schema-changed', processId, {
      kind: 'flow-elements',
      expected: expectedNodes.length + expectedFlows.length,
      actual: flowElements.length
    })
  }
  const nodes = mapById(nodeElements, processId, 'nodes')
  const flows = mapById(flowElementsOnly, processId, 'flows')
  exactIds(
    nodes,
    expectedNodes.map(({ id }) => id),
    processId,
    'nodes'
  )
  exactIds(
    flows,
    expectedFlows.map(({ id }) => id),
    processId,
    'flows'
  )

  for (const node of expectedNodes) {
    const element = nodes.get(node.id)!
    const expectedType = node.type === 'unknown' ? undefined : BPMN_TYPE_BY_NODE_TYPE[node.type]
    if (!expectedType || typeOf(element) !== expectedType) {
      reviewFailure('node-schema-changed', processId, {
        elementId: node.id,
        expected: expectedType ?? 'known-node-type',
        actual: typeOf(element)
      })
    }
    if (typeOf(element) === 'bpmn:SubProcess' && elements(element.flowElements).length > 0) {
      reviewFailure('node-schema-changed', processId, {
        elementId: node.id,
        field: 'flowElements'
      })
    }
    const expectedCalledElement =
      node.type === 'callActivity' &&
      node.metadata.calledProcessId &&
      node.metadata.reviewedUnlinkedCall !== true
        ? node.metadata.calledProcessId
        : undefined
    const actualCalledElement = textProperty(element, 'calledElement')
    if (actualCalledElement !== expectedCalledElement) {
      reviewFailure('node-schema-changed', processId, {
        elementId: node.id,
        field: 'calledElement',
        expected: expectedCalledElement ?? '',
        actual: actualCalledElement ?? ''
      })
    }
    const expectedDefinition =
      node.metadata.eventDefinition && node.metadata.eventDefinition !== 'none'
        ? EVENT_DEFINITION_TYPE[node.metadata.eventDefinition]
        : undefined
    const actualDefinitions = elements(element.eventDefinitions).map(typeOf)
    if (
      actualDefinitions.length !== (expectedDefinition ? 1 : 0) ||
      (expectedDefinition && actualDefinitions[0] !== expectedDefinition)
    ) {
      reviewFailure('node-schema-changed', processId, {
        elementId: node.id,
        field: 'eventDefinitions'
      })
    }
  }

  for (const flow of expectedFlows) {
    const element = flows.get(flow.id)!
    if (
      idOf(element.sourceRef) !== flow.sourceStepId ||
      idOf(element.targetRef) !== flow.targetStepId
    ) {
      reviewFailure('flow-topology-changed', processId, {
        elementId: flow.id,
        expected: `${flow.sourceStepId}->${flow.targetStepId}`,
        actual: `${idOf(element.sourceRef) ?? ''}->${idOf(element.targetRef) ?? ''}`
      })
    }
    const source = nodes.get(flow.sourceStepId)
    const actualDefault = idOf(source?.default) === flow.id
    if (actualDefault !== flow.isDefault) {
      reviewFailure('flow-topology-changed', processId, {
        elementId: flow.id,
        field: 'isDefault'
      })
    }
  }

  const collaborations = roots.filter((element) => typeOf(element) === 'bpmn:Collaboration')
  const unexpectedRoots = roots.filter(
    (element) => !['bpmn:Process', 'bpmn:Collaboration'].includes(typeOf(element))
  )
  if (unexpectedRoots.length > 0 || collaborations.length > 1) {
    reviewFailure('definitions-schema-changed', processId)
  }
  const expectedPools = model.participants
    .filter((participant) => participant.processId === processId && participant.type === 'pool')
    .slice()
    .sort(participantOrder)
  assertSecondaryPoolsAreEmpty(model, processId, expectedPools)
  if (expectedPools.length > 0 !== (collaborations.length === 1)) {
    reviewFailure('participant-schema-changed', processId, {
      kind: 'collaboration'
    })
  }
  const collaboration = collaborations[0]
  if (
    collaboration &&
    (elements(collaboration.messageFlows).length > 0 ||
      elements(collaboration.conversationNodes).length > 0)
  ) {
    reviewFailure('participant-schema-changed', processId, {
      kind: 'collaboration-children'
    })
  }
  const pools = mapById(elements(collaboration?.participants), processId, 'pools')
  exactIds(
    pools,
    expectedPools.map(({ id }) => id),
    processId,
    'pools'
  )
  for (const [index, pool] of expectedPools.entries()) {
    const processRef = pools.get(pool.id)?.processRef
    const validProcessRef = index === 0 ? idOf(processRef) === processId : processRef === undefined
    if (!validProcessRef) {
      reviewFailure('participant-schema-changed', processId, {
        elementId: pool.id,
        field: 'processRef',
        expected: index === 0 ? processId : ''
      })
    }
  }

  const lanes = new Map<string, BpmnElement>()
  const laneParents = new Map<string, string | undefined>()
  const mutableMembership = new Map<string, string[]>()
  collectLanes(elements(process.laneSets), lanes, laneParents, mutableMembership, processId)
  const expectedLanes = model.participants.filter(
    (participant) => participant.processId === processId && participant.type === 'lane'
  )
  exactIds(
    lanes,
    expectedLanes.map(({ id }) => id),
    processId,
    'lanes'
  )
  const expectedLaneIds = new Set(expectedLanes.map(({ id }) => id))
  for (const lane of expectedLanes) {
    const expectedParent =
      lane.parentId && expectedLaneIds.has(lane.parentId) ? lane.parentId : undefined
    if (laneParents.get(lane.id) !== expectedParent) {
      reviewFailure('participant-schema-changed', processId, {
        elementId: lane.id,
        field: 'parentId',
        expected: expectedParent ?? '',
        actual: laneParents.get(lane.id) ?? ''
      })
    }
  }
  const laneMembership = new Map<string, readonly string[]>()
  for (const [nodeId, memberships] of mutableMembership) {
    laneMembership.set(nodeId, Object.freeze([...memberships].sort()))
  }
  const participantById = new Map(
    model.participants
      .filter((participant) => participant.processId === processId)
      .map((participant) => [participant.id, participant] as const)
  )
  for (const node of expectedNodes) {
    const participant =
      node.laneId ??
      (node.participantId && participantById.get(node.participantId)?.type === 'lane'
        ? node.participantId
        : undefined)
    const actual = laneMembership.get(node.id) ?? []
    if (
      (participant && (actual.length !== 1 || actual[0] !== participant)) ||
      (!participant && actual.length > 0)
    ) {
      reviewFailure('participant-schema-changed', processId, {
        elementId: node.id,
        field: 'laneMembership',
        expected: participant ?? '',
        actual: actual.join(',')
      })
    }
  }

  return {
    process,
    nodes,
    flows,
    pools,
    lanes,
    laneParents,
    laneMembership
  }
}

function safeBpmnName(processId: string): string {
  const safe = processId.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'process'}.bpmn`
}

export function processGraphsFromWorkbook(
  model: ProcessWorkbookModel
): readonly ProcessGraphModel[] {
  return Object.freeze(
    model.processes.map((process) =>
      Object.freeze({
        process,
        participants: Object.freeze(
          model.participants.filter(({ processId }) => processId === process.id)
        ),
        nodes: Object.freeze(model.nodes.filter(({ processId }) => processId === process.id)),
        flows: Object.freeze(model.flows.filter(({ processId }) => processId === process.id)),
        glossary: model.glossary
      })
    )
  )
}

/**
 * Securely applies reviewed bilingual fields to one process while preserving
 * every structural field and each original spreadsheet provenance object.
 */
export async function mergeReviewedBpmnIntoWorkbook(
  model: ProcessWorkbookModel,
  processId: string,
  reviewedXml: string,
  options: MergeReviewedBpmnOptions = {}
): Promise<ProcessWorkbookModel> {
  throwIfAborted(options.signal)
  if (!model.processes.some((process) => process.id === processId)) {
    reviewFailure('wrong-process', processId, { actual: 'not-in-workbook' })
  }

  const validation = await validateBpmnXml(reviewedXml, {
    knownProcessIds: [...model.processes.map(({ id }) => id), ...(options.knownProcessIds ?? [])],
    // Exact expected fields are checked below with workbook glossary context.
    // The generic BPMN audit cannot validate list cardinality/provenance.
    requireBilingual: false,
    requireDi: true,
    adapters: options.validationAdapters ?? getRuntimeValidationAdapters()
  })
  throwIfAborted(options.signal)
  if (!validation.summary.valid || !validation.definitions) {
    const first = validation.summary.issues.find(({ blocking }) => blocking)
    const reason = first?.code.includes('bilingual-missing')
      ? 'incomplete-bilingual-field'
      : first?.code.includes('bilingual-wrong-script') ||
          first?.code.includes('bilingual-mixed') ||
          first?.code.includes('bilingual-duplicate')
        ? 'wrong-script'
        : first?.source === 'structure' || first?.source === 'semantic'
          ? 'graph-schema-changed'
          : 'reviewed-xml-invalid'
    reviewFailure(reason, processId, {
      validationCode: first?.code ?? 'unknown',
      validationSource: first?.source ?? 'unknown'
    })
  }

  const graph = parseExactGraph(validation.definitions as BpmnElement, model, processId)
  const neutralTerms = approvedNeutralTerms(model)
  const originalProcess = model.processes.find((process) => process.id === processId)!
  const processActive = activeLanguage(graph.process, originalProcess.activeLanguage, processId)

  const processes = Object.freeze(
    model.processes.map((process) => {
      if (process.id !== processId) return process
      return Object.freeze({
        ...process,
        name: validatedPair(
          graph.process,
          'name',
          process.name,
          processActive,
          processId,
          'name',
          neutralTerms,
          true
        )!,
        description: validatedPair(
          graph.process,
          'description',
          process.description,
          processActive,
          processId,
          'description',
          neutralTerms
        ),
        owner: validatedPair(
          graph.process,
          'owner',
          process.owner,
          processActive,
          processId,
          'owner',
          neutralTerms
        ),
        activeLanguage: processActive
      })
    })
  )

  const participants = Object.freeze(
    model.participants.map((participant) => {
      if (participant.processId !== processId) return participant
      const element =
        participant.type === 'pool'
          ? graph.pools.get(participant.id)
          : graph.lanes.get(participant.id)
      if (!element) {
        reviewFailure('participant-schema-changed', processId, {
          elementId: participant.id
        })
      }
      const active = activeLanguage(element, participant.name.active, processId)
      return Object.freeze({
        ...participant,
        name: validatedPair(
          element,
          'name',
          participant.name,
          active,
          processId,
          'name',
          neutralTerms,
          true
        )!
      })
    })
  )

  const nodes = Object.freeze(
    model.nodes.map((node) => {
      if (node.processId !== processId) return node
      const element = graph.nodes.get(node.id)
      if (!element) {
        reviewFailure('node-schema-changed', processId, { elementId: node.id })
      }
      const active = activeLanguage(element, node.name.active, processId)
      const metadata = Object.freeze({
        ...node.metadata,
        owner: validatedPair(
          element,
          'owner',
          node.metadata.owner,
          active,
          processId,
          'owner',
          neutralTerms
        ),
        channel: validatedPair(
          element,
          'channel',
          node.metadata.channel,
          active,
          processId,
          'channel',
          neutralTerms
        ),
        channelDetail: validatedPair(
          element,
          'channelDetail',
          node.metadata.channelDetail,
          active,
          processId,
          'channelDetail',
          neutralTerms
        ),
        responsibleParties: validatedList(
          element,
          'respList',
          node.metadata.responsibleParties,
          active,
          processId,
          'responsibleParties',
          neutralTerms
        ),
        inputs: validatedList(
          element,
          'inputs',
          node.metadata.inputs,
          active,
          processId,
          'inputs',
          neutralTerms
        ),
        outputs: validatedList(
          element,
          'outputs',
          node.metadata.outputs,
          active,
          processId,
          'outputs',
          neutralTerms
        ),
        cc: validatedList(
          element,
          'ccList',
          node.metadata.cc,
          active,
          processId,
          'cc',
          neutralTerms
        ),
        decisionBasis: validatedPair(
          element,
          'decisionBasis',
          node.metadata.decisionBasis,
          active,
          processId,
          'decisionBasis',
          neutralTerms
        ),
        triggers: validatedPair(
          element,
          'triggers',
          node.metadata.triggers,
          active,
          processId,
          'triggers',
          neutralTerms
        ),
        notes: validatedPair(
          element,
          'notes',
          node.metadata.notes,
          active,
          processId,
          'notes',
          neutralTerms
        )
      })
      return Object.freeze({
        ...node,
        name: validatedPair(
          element,
          'name',
          node.name,
          active,
          processId,
          'name',
          neutralTerms,
          true
        )!,
        metadata
      })
    })
  )

  const flows = Object.freeze(
    model.flows.map((flow) => {
      if (flow.processId !== processId) return flow
      const element = graph.flows.get(flow.id)
      if (!element) {
        reviewFailure('flow-topology-changed', processId, { elementId: flow.id })
      }
      const active = activeLanguage(element, flow.condition?.active ?? processActive, processId)
      return Object.freeze({
        ...flow,
        condition: validatedPair(
          element,
          'name',
          flow.condition,
          active,
          processId,
          'condition',
          neutralTerms
        )
      })
    })
  )

  return Object.freeze({
    ...model,
    processes,
    participants,
    nodes,
    flows
  })
}

/**
 * Sequential, all-or-nothing review coordinator. A cancelled or invalid item
 * never exposes the locally merged prefix to the caller.
 */
export async function reviewProcessWorkbookBilingual(
  model: ProcessWorkbookModel,
  options: ReviewProcessWorkbookOptions
): Promise<SpreadsheetBilingualReviewOutcome> {
  let reviewedModel = model
  const processIds = model.processes.map(({ id }) => id)
  for (const [index, processId] of processIds.entries()) {
    throwIfAborted(options.signal)
    const graph = processGraphsFromWorkbook(reviewedModel).find(
      (candidate) => candidate.process.id === processId
    )
    if (!graph) reviewFailure('wrong-process', processId)
    const artifact = await options.generator.generate(graph, options.signal)
    if (artifact.processId !== processId || !artifact.layoutedXml.trim()) {
      reviewFailure('generator-process-mismatch', processId, {
        actual: artifact.processId
      })
    }
    throwIfAborted(options.signal)
    const result = await options.review({
      version: SPREADSHEET_BILINGUAL_REVIEW_PROTOCOL_VERSION,
      processId,
      suggestedName: safeBpmnName(processId),
      xml: artifact.layoutedXml,
      ordinal: index + 1,
      total: processIds.length,
      signal: options.signal ?? new AbortController().signal
    })
    throwIfAborted(options.signal)
    if (!result || typeof result !== 'object') {
      reviewFailure('invalid-review-result', processId)
    }
    if (result.status === 'cancelled') {
      return Object.freeze({ status: 'cancelled', processId })
    }
    if (result.status !== 'completed' || typeof result.reviewedXml !== 'string') {
      reviewFailure('invalid-review-result', processId)
    }
    reviewedModel = await mergeReviewedBpmnIntoWorkbook(
      reviewedModel,
      processId,
      result.reviewedXml,
      options
    )
  }
  return Object.freeze({ status: 'completed', model: reviewedModel })
}
