import BpmnModdle from 'bpmn-moddle'
import { layoutProcess } from 'bpmn-auto-layout'

import {
  LocalizationSource,
  SEEDED_GLOSSARY,
  approvedNeutralTerms,
  auditLocalizationFields,
  type LocalizationField
} from '../localization'
import { layoutBpmnValidated, type LayoutFunction } from '../generation/layout'
import { ORG_ATTR_NAMES, orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import {
  evaluateValidationPolicy,
  getRuntimeValidationAdapters,
  type BpmnValidationAdapter
} from '../validation'
import type {
  BilingualAuditSummary,
  BilingualValue,
  BpmnModelGenerationAdapter,
  GeneratedBpmnArtifact,
  PipelineDiagnostic,
  ProcessGraphModel,
  SpreadsheetBilingualAuditAdapter,
  WorkbookNode
} from './contracts'
import { throwIfAborted } from './errors'
import { stableHash } from './hash'

interface ModdleElement {
  $type: string
  $attrs?: Record<string, string>
  id?: string
  name?: string
  flowElements?: ModdleElement[]
  rootElements?: ModdleElement[]
  laneSets?: ModdleElement[]
  lanes?: ModdleElement[]
  childLaneSet?: ModdleElement
  flowNodeRef?: ModdleElement[]
  incoming?: ModdleElement[]
  outgoing?: ModdleElement[]
  sourceRef?: ModdleElement
  targetRef?: ModdleElement
  default?: ModdleElement
  processRef?: ModdleElement
  documentation?: ModdleElement[]
  conditionExpression?: ModdleElement
  calledElement?: string
  body?: string
  [key: string]: unknown
}

interface SpreadsheetModdle {
  create(type: string, properties?: Record<string, unknown>): ModdleElement
  toXML(
    root: ModdleElement,
    options: { format: boolean; preamble: boolean }
  ): Promise<{ xml: string }>
}

export interface SpreadsheetBpmnGeneratorOptions {
  readonly knownProcessIds?: Iterable<string>
  readonly layout?: LayoutFunction
  /**
   * Transaction generation is strict by default. The only false use is a
   * read-only/open-in-editor handoff so missing language values can be reviewed.
   */
  readonly requireBilingual?: boolean
  readonly validationAdapters?: readonly BpmnValidationAdapter[]
}

type BilingualEmissionMode = 'strict' | 'review'

const NODE_ELEMENT_TYPES: Readonly<Record<WorkbookNode['type'], string>> = Object.freeze({
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
  eventBasedGateway: 'bpmn:EventBasedGateway',
  unknown: 'bpmn:Task'
})

const EVENT_DEFINITION_TYPES = Object.freeze({
  message: 'bpmn:MessageEventDefinition',
  timer: 'bpmn:TimerEventDefinition',
  signal: 'bpmn:SignalEventDefinition',
  conditional: 'bpmn:ConditionalEventDefinition',
  link: 'bpmn:LinkEventDefinition',
  error: 'bpmn:ErrorEventDefinition',
  escalation: 'bpmn:EscalationEventDefinition',
  terminate: 'bpmn:TerminateEventDefinition'
} as const)

const REGISTERED_ORBITPM_ATTRIBUTES = new Set<string>(ORG_ATTR_NAMES)

function setOrbitpmAttribute(element: ModdleElement, property: string, value: string): void {
  if (REGISTERED_ORBITPM_ATTRIBUTES.has(property)) {
    element[property] = value
    return
  }
  element.$attrs ??= {}
  element.$attrs[`orbitpm:${property}`] = value
}

function projected(value: BilingualValue): string {
  return value.active === 'ar' ? value.ar || value.en || '' : value.en || value.ar || ''
}

function pairProperties(
  prefix: string,
  value: BilingualValue | undefined,
  mode: BilingualEmissionMode
): Record<string, string> {
  if (!value) return {}
  const projection = projected(value)
  if (mode === 'review' && !(value.en?.trim() && value.ar?.trim())) {
    // A partial pair is deliberately represented as a projection-only review
    // seed. The shared extractor can infer its source script, while the
    // compatibility validator does not mistake it for a completed pair.
    return projection ? { [prefix]: projection } : {}
  }
  return {
    ...(value.en ? { [`${prefix}En`]: value.en } : {}),
    ...(value.ar ? { [`${prefix}Ar`]: value.ar } : {}),
    ...(projection ? { [prefix]: projection } : {})
  }
}

function joined(values: readonly BilingualValue[] | undefined, language: 'en' | 'ar'): string {
  if (!values) return ''
  return values
    .map((value) => value[language] ?? '')
    .filter(Boolean)
    .join('\n')
}

function setPair(
  element: ModdleElement,
  prefix: string,
  value: BilingualValue | undefined,
  mode: BilingualEmissionMode
): void {
  for (const [property, text] of Object.entries(pairProperties(prefix, value, mode))) {
    setOrbitpmAttribute(element, property, text)
  }
}

function setBilingualName(
  element: ModdleElement,
  value: BilingualValue,
  mode: BilingualEmissionMode
): void {
  element.name = projected(value)
  if (mode === 'strict' || (value.en?.trim() && value.ar?.trim())) {
    if (value.en) element.nameEn = value.en
    if (value.ar) element.nameAr = value.ar
  }
  element.activeLang = value.active
}

function setNodeMetadata(
  moddle: SpreadsheetModdle,
  element: ModdleElement,
  node: WorkbookNode,
  mode: BilingualEmissionMode
): void {
  const metadata = node.metadata
  setPair(element, 'owner', metadata.owner, mode)
  setPair(element, 'channelDetail', metadata.channelDetail, mode)
  setPair(element, 'decisionBasis', metadata.decisionBasis, mode)
  setPair(element, 'triggers', metadata.triggers, mode)
  setPair(element, 'notes', metadata.notes, mode)
  if (metadata.channel) {
    const values = pairProperties('channel', metadata.channel, mode)
    for (const [property, text] of Object.entries(values)) {
      setOrbitpmAttribute(element, property, text)
    }
  }
  if (metadata.raci) setOrbitpmAttribute(element, 'raci', metadata.raci)

  for (const [prefix, values] of [
    ['respList', metadata.responsibleParties],
    ['inputs', metadata.inputs],
    ['outputs', metadata.outputs],
    ['ccList', metadata.cc]
  ] as const) {
    const en = joined(values, 'en')
    const ar = joined(values, 'ar')
    const active = node.name.active === 'ar' ? ar || en : en || ar
    const complete =
      values !== undefined &&
      values.length > 0 &&
      values.every((value) => value.en?.trim() && value.ar?.trim())
    if (mode === 'strict' || complete) {
      if (en) setOrbitpmAttribute(element, `${prefix}En`, en)
      if (ar) setOrbitpmAttribute(element, `${prefix}Ar`, ar)
    }
    if (active) setOrbitpmAttribute(element, prefix, active)
  }

  if (
    node.type === 'callActivity' &&
    metadata.calledProcessId &&
    metadata.reviewedUnlinkedCall !== true
  ) {
    element.calledElement = metadata.calledProcessId
  }
}

function eventDefinition(moddle: SpreadsheetModdle, node: WorkbookNode): ModdleElement | undefined {
  const definition = node.metadata.eventDefinition
  if (!definition || definition === 'none') return undefined
  return moddle.create(EVENT_DEFINITION_TYPES[definition], {
    id: `${node.id}_${definition}_definition`
  })
}

function diagnosticsFromSummaries(
  summaries: readonly {
    readonly issues: readonly {
      readonly code: string
      readonly source: string
      readonly severity: string
      readonly blocking: boolean
      readonly elementId?: string
      readonly processId?: string
    }[]
  }[]
): readonly PipelineDiagnostic[] {
  const seen = new Set<string>()
  const diagnostics: PipelineDiagnostic[] = []
  for (const summary of summaries) {
    for (const issue of summary.issues) {
      const key = `${issue.source}\u0000${issue.code}\u0000${issue.processId ?? ''}\u0000${issue.elementId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const stage: PipelineDiagnostic['stage'] =
        issue.code.includes('call-') || issue.code.includes('link')
          ? 'link'
          : issue.source === 'di'
            ? 'di'
            : issue.source === 'xsd'
              ? 'xsd'
              : issue.source === 'bpmnlint'
                ? 'lint'
                : issue.source === 'orbitpm'
                  ? 'metadata'
                  : issue.source === 'structure' || issue.source === 'semantic'
                    ? 'structural'
                    : 'moddle'
      diagnostics.push(
        Object.freeze({
          stage,
          severity: issue.blocking || issue.severity === 'error' ? 'error' : 'warning',
          code: issue.code,
          details: {
            ...(issue.processId ? { processId: issue.processId } : {}),
            ...(issue.elementId ? { elementId: issue.elementId } : {})
          }
        })
      )
    }
  }
  return Object.freeze(diagnostics)
}

function addLanes(
  moddle: SpreadsheetModdle,
  process: ModdleElement,
  graph: ProcessGraphModel,
  nodes: ReadonlyMap<string, ModdleElement>,
  mode: BilingualEmissionMode
): void {
  const laneRecords = graph.participants.filter(({ type }) => type === 'lane')
  if (laneRecords.length === 0) return
  const lanes = new Map<string, ModdleElement>()
  for (const record of laneRecords) {
    const lane = moddle.create('bpmn:Lane', {
      id: record.id,
      flowNodeRef: graph.nodes
        .filter(
          (node) => node.laneId === record.id || (node.participantId === record.id && !node.laneId)
        )
        .map((node) => nodes.get(node.id))
        .filter((node): node is ModdleElement => Boolean(node))
    })
    setBilingualName(lane, record.name, mode)
    lanes.set(record.id, lane)
  }

  const topLevel: ModdleElement[] = []
  for (const record of laneRecords) {
    const lane = lanes.get(record.id)!
    const parentLane = record.parentId ? lanes.get(record.parentId) : undefined
    if (!parentLane) {
      topLevel.push(lane)
      continue
    }
    if (!parentLane.childLaneSet) {
      parentLane.childLaneSet = moddle.create('bpmn:LaneSet', {
        id: `${parentLane.id}_children`,
        lanes: []
      })
    }
    parentLane.childLaneSet.lanes?.push(lane)
  }
  process.laneSets = [
    moddle.create('bpmn:LaneSet', {
      id: `LaneSet_${stableHash(graph.process.id).slice(0, 10)}`,
      lanes: topLevel
    })
  ]
}

function buildDefinitions(
  moddle: SpreadsheetModdle,
  graph: ProcessGraphModel,
  mode: BilingualEmissionMode
): ModdleElement {
  const process = moddle.create('bpmn:Process', {
    id: graph.process.id,
    isExecutable: false,
    flowElements: []
  })
  setBilingualName(process, graph.process.name, mode)
  setPair(process, 'owner', graph.process.owner, mode)
  setPair(process, 'description', graph.process.description, mode)

  const nodeElements = new Map<string, ModdleElement>()
  for (const node of graph.nodes) {
    const element = moddle.create(NODE_ELEMENT_TYPES[node.type], {
      id: node.id,
      incoming: [],
      outgoing: []
    })
    setBilingualName(element, node.name, mode)
    setNodeMetadata(moddle, element, node, mode)
    const definition = eventDefinition(moddle, node)
    if (definition) element.eventDefinitions = [definition]
    nodeElements.set(node.id, element)
    process.flowElements?.push(element)
  }

  for (const flow of graph.flows) {
    const source = nodeElements.get(flow.sourceStepId)
    const target = nodeElements.get(flow.targetStepId)
    if (!source || !target) continue
    const sequenceFlow = moddle.create('bpmn:SequenceFlow', {
      id: flow.id,
      sourceRef: source,
      targetRef: target
    })
    if (flow.condition?.en?.trim() || flow.condition?.ar?.trim()) {
      setBilingualName(sequenceFlow, flow.condition, mode)
      if (!flow.isDefault) {
        sequenceFlow.conditionExpression = moddle.create('bpmn:FormalExpression', {
          body: projected(flow.condition)
        })
      }
    }
    source.outgoing?.push(sequenceFlow)
    target.incoming?.push(sequenceFlow)
    if (flow.isDefault) source.default = sequenceFlow
    process.flowElements?.push(sequenceFlow)
  }

  addLanes(moddle, process, graph, nodeElements, mode)
  const rootElements: ModdleElement[] = [process]
  const pools = graph.participants.filter(({ type }) => type === 'pool')
  if (pools.length > 0) {
    const collaboration = moddle.create('bpmn:Collaboration', {
      id: `Collaboration_${stableHash(graph.process.id).slice(0, 10)}`,
      participants: pools.map((record) => {
        const participant = moddle.create('bpmn:Participant', {
          id: record.id,
          processRef: process
        })
        setBilingualName(participant, record.name, mode)
        return participant
      })
    })
    rootElements.push(collaboration)
  }

  return moddle.create('bpmn:Definitions', {
    id: `Definitions_${stableHash(graph.process.id).slice(0, 12)}`,
    targetNamespace: `https://orbitpm.ae/bpmn/${encodeURIComponent(graph.process.id)}`,
    exporter: 'OrbitPM Process Studio Lite',
    exporterVersion: '0.4.5',
    rootElements
  })
}

interface DiagramBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function numericAttribute(attributes: string, name: string): number | undefined {
  const match = attributes.match(new RegExp(`\\b${name}="(-?(?:\\d+\\.?\\d*|\\.\\d+))"`))
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function contentBounds(xml: string): DiagramBounds {
  const bounds = [...xml.matchAll(/<dc:Bounds\b([^>]*)\/?>/g)]
    .map(([, attributes]) => ({
      x: numericAttribute(attributes ?? '', 'x'),
      y: numericAttribute(attributes ?? '', 'y'),
      width: numericAttribute(attributes ?? '', 'width'),
      height: numericAttribute(attributes ?? '', 'height')
    }))
    .filter(
      (
        value
      ): value is {
        x: number
        y: number
        width: number
        height: number
      } =>
        value.x !== undefined &&
        value.y !== undefined &&
        value.width !== undefined &&
        value.height !== undefined
    )
  if (bounds.length === 0) return { x: 40, y: 40, width: 720, height: 160 }
  const minX = Math.min(...bounds.map(({ x }) => x))
  const minY = Math.min(...bounds.map(({ y }) => y))
  const maxX = Math.max(...bounds.map(({ x, width }) => x + width))
  const maxY = Math.max(...bounds.map(({ y, height }) => y + height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * bpmn-auto-layout deliberately lays out flow nodes only. Spreadsheet models
 * may also contain pools and lanes, so add deterministic container DI around
 * the generated node bounds before the shared post-layout validation runs.
 */
function addContainerDi(xml: string, graph: ProcessGraphModel): string {
  const containers = graph.participants.filter(({ type }) => type === 'pool' || type === 'lane')
  if (containers.length === 0) return xml

  const content = contentBounds(xml)
  const shape = (id: string, bounds: DiagramBounds): string =>
    [
      `      <bpmndi:BPMNShape id="${xmlAttribute(id)}_di" bpmnElement="${xmlAttribute(id)}" isHorizontal="true">`,
      `        <dc:Bounds x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" />`,
      '      </bpmndi:BPMNShape>'
    ].join('\n')
  const laneBounds: DiagramBounds = {
    x: content.x - 50,
    y: content.y - 30,
    width: content.width + 100,
    height: Math.max(100, content.height + 60)
  }
  const poolBounds: DiagramBounds = {
    x: laneBounds.x - 30,
    y: laneBounds.y - 20,
    width: laneBounds.width + 60,
    height: laneBounds.height + 40
  }
  const additions = containers
    .filter(({ id }) => !xml.includes(`bpmnElement="${xmlAttribute(id)}"`))
    .map(({ id, type }) => shape(id, type === 'pool' ? poolBounds : laneBounds))
    .join('\n')
  if (!additions) return xml

  const pools = containers.filter(({ type }) => type === 'pool')
  return xml.replace(/<bpmndi:BPMNPlane\b[^>]*>/, (planeTag) => {
    const plane =
      pools.length === 0
        ? planeTag
        : planeTag.replace(
            /\bbpmnElement="[^"]*"/,
            `bpmnElement="Collaboration_${stableHash(graph.process.id).slice(0, 10)}"`
          )
    return `${plane}\n${additions}`
  })
}

/**
 * Production spreadsheet adapter: moddle construction, shared validated
 * auto-layout, then the exact post-layout bytes used by the transaction.
 */
export class SpreadsheetBpmnGenerator implements BpmnModelGenerationAdapter {
  constructor(private readonly options: SpreadsheetBpmnGeneratorOptions = {}) {}

  async generate(graph: ProcessGraphModel, signal?: AbortSignal): Promise<GeneratedBpmnArtifact> {
    throwIfAborted(signal)
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
    }) as unknown as SpreadsheetModdle
    const definitions = buildDefinitions(
      moddle,
      graph,
      this.options.requireBilingual === false ? 'review' : 'strict'
    )
    const semanticXml = (await moddle.toXML(definitions, { format: true, preamble: true })).xml
    throwIfAborted(signal)
    const validationAdapters = this.options.validationAdapters ?? getRuntimeValidationAdapters()
    const layouted = await layoutBpmnValidated(semanticXml, {
      validation: {
        knownProcessIds: this.options.knownProcessIds,
        requireBilingual: this.options.requireBilingual !== false,
        adapters: validationAdapters
      },
      layout: async (xml) => {
        const layout = this.options.layout
          ? await this.options.layout(xml)
          : await layoutProcess(xml)
        return addContainerDi(layout, graph)
      }
    })
    throwIfAborted(signal)
    const policy = evaluateValidationPolicy(layouted.postLayoutValidation, 'commit-import')
    if (!policy.allowed) {
      throw new Error(`Generated spreadsheet BPMN failed commit policy: ${policy.reason}`)
    }
    const bytes = new TextEncoder().encode(layouted.xml)
    return Object.freeze({
      processId: graph.process.id,
      semanticXml,
      layoutedXml: layouted.xml,
      bytes,
      diagnostics: diagnosticsFromSummaries([
        layouted.preLayoutValidation,
        layouted.postLayoutValidation
      ])
    })
  }
}

function localizationField(
  graph: ProcessGraphModel,
  elementId: string,
  elementType: string,
  field: string,
  kind: LocalizationField['kind'],
  value: BilingualValue
): LocalizationField {
  return {
    source: LocalizationSource.Excel,
    processId: graph.process.id,
    elementId,
    elementType,
    field,
    kind,
    value: { ...value },
    sourceLanguage: value.active,
    projection: projected(value),
    origins: {
      ...(value.en ? { en: 'paired' as const } : {}),
      ...(value.ar ? { ar: 'paired' as const } : {})
    },
    storage: {
      enProperty: `orbitpm:${field}En`,
      arProperty: `orbitpm:${field}Ar`,
      projectionProperty: field === 'name' ? 'name' : `orbitpm:${field}`
    },
    planeIds: []
  }
}

function collectBilingualFields(graph: ProcessGraphModel): readonly LocalizationField[] {
  const fields: LocalizationField[] = []
  const add = (
    elementId: string,
    elementType: string,
    field: string,
    kind: LocalizationField['kind'],
    value: BilingualValue | undefined,
    required = false
  ): void => {
    const populated = Boolean(value?.en?.trim() || value?.ar?.trim())
    if (!populated && !required) return
    fields.push(
      localizationField(
        graph,
        elementId,
        elementType,
        field,
        kind,
        value ?? { active: graph.process.activeLanguage }
      )
    )
  }

  add(graph.process.id, 'bpmn:Process', 'name', 'name', graph.process.name, true)
  add(graph.process.id, 'bpmn:Process', 'description', 'annotation', graph.process.description)
  add(graph.process.id, 'bpmn:Process', 'owner', 'metadata', graph.process.owner)
  for (const participant of graph.participants) {
    add(
      participant.id,
      participant.type === 'pool' ? 'bpmn:Participant' : 'bpmn:Lane',
      'name',
      'name',
      participant.name,
      true
    )
  }
  for (const node of graph.nodes) {
    const type = NODE_ELEMENT_TYPES[node.type]
    add(node.id, type, 'name', 'name', node.name, true)
    add(node.id, type, 'owner', 'metadata', node.metadata.owner)
    add(node.id, type, 'channel', 'metadata', node.metadata.channel)
    add(node.id, type, 'channelDetail', 'metadata', node.metadata.channelDetail)
    add(node.id, type, 'decisionBasis', 'metadata', node.metadata.decisionBasis)
    add(node.id, type, 'triggers', 'metadata', node.metadata.triggers)
    add(node.id, type, 'notes', 'notes', node.metadata.notes)
    for (const [field, values] of [
      ['responsibleParties', node.metadata.responsibleParties],
      ['inputs', node.metadata.inputs],
      ['outputs', node.metadata.outputs],
      ['cc', node.metadata.cc]
    ] as const) {
      for (const [index, value] of (values ?? []).entries()) {
        add(node.id, type, `${field}.${index}`, 'metadata', value)
      }
    }
  }
  for (const flow of graph.flows) {
    add(flow.id, 'bpmn:SequenceFlow', 'condition', 'condition', flow.condition)
  }
  return Object.freeze(fields)
}

export class SpreadsheetBilingualAudit implements SpreadsheetBilingualAuditAdapter {
  audit(graph: ProcessGraphModel): BilingualAuditSummary {
    const report = auditLocalizationFields(collectBilingualFields(graph), {
      approvedNeutralTerms: [
        ...approvedNeutralTerms(SEEDED_GLOSSARY),
        ...graph.glossary
          .filter(({ doNotTranslate }) => doNotTranslate)
          .flatMap(({ english, arabic }) => [english, arabic])
      ]
    })
    const missing = report.issues.filter(({ code }) => code === 'missing').length
    const invalid = report.issues.length - missing
    return Object.freeze({
      complete: report.issues.length === 0,
      missing,
      invalid,
      translationRequired: report.issues.length > 0
    })
  }
}
