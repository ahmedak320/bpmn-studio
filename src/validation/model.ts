import BpmnModdle from 'bpmn-moddle'
import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import { auditBpmnLocalization } from '../localization'
import type { BpmnValidationAdapter } from './adapters'
import {
  createValidationSummary,
  validationIssue,
  type SourceLocation,
  type ValidationDocumentStats,
  type ValidationIssue,
  type ValidationSource,
  type ValidationStageName,
  type ValidationStageStatus,
  type ValidationSummary
} from './contracts'
import {
  preflightXml,
  sourceLocationAt,
  type XmlPreflightLimits
} from './preflight'

interface ModdleElement {
  $type?: string
  $parent?: ModdleElement
  $attrs?: Record<string, unknown>
  $children?: ModdleElement[]
  $instanceOf?: (type: string) => boolean
  get?: (name: string) => unknown
  id?: string
  name?: string
  [key: string]: unknown
}

interface ModdleWarning {
  message?: string
  element?: ModdleElement
  property?: string
  value?: unknown
  error?: { message?: string }
}

interface ModdleImportResult {
  rootElement?: ModdleElement
  warnings?: ModdleWarning[]
}

interface BpmnModdleLike {
  fromXML(xml: string): Promise<ModdleImportResult>
}

export interface BpmnValidationOptions {
  preflightLimits?: Partial<XmlPreflightLimits>
  /** Workspace process IDs that may satisfy cross-file call activities. */
  knownProcessIds?: Iterable<string>
  /** Require every visible translatable name to have valid EN/AR values. */
  requireBilingual?: boolean
  /** Promote missing process planes from preview warning to blocking error. */
  requireDi?: boolean
  /** Workspace-approved neutral terms that may be identical in both languages. */
  neutralTerms?: Iterable<string>
  /** Optional worker-backed XSD/bpmnlint adapters. */
  adapters?: readonly BpmnValidationAdapter[]
}

export interface ParsedBpmnValidation {
  summary: ValidationSummary
  /** Present only after secure preflight and moddle parsing succeed. */
  definitions?: ModdleElement
  /** Original bytes-as-text; validation never serializes or mutates them. */
  originalXml: string
}

interface ValidationContext {
  xml: string
  issues: ValidationIssue[]
  allElements: ModdleElement[]
  processes: ModdleElement[]
  collaborations: ModdleElement[]
  diagrams: ModdleElement[]
  knownProcessIds: ReadonlySet<string>
  requireBilingual: boolean
  requireDi: boolean
  neutralTerms: ReadonlySet<string>
}

const NCNAME = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7\u0300-\u036F\u203F-\u2040]*$/u
const ARABIC_SCRIPT = /\p{Script=Arabic}/u
const LATIN_SCRIPT = /\p{Script=Latin}/u
const LETTER = /\p{L}/u
const DEFAULT_NEUTRAL_TERMS = ['API', 'SLA', 'DMT HUB']

function asElement(value: unknown): ModdleElement | undefined {
  if (!value || typeof value !== 'object') return undefined
  return value as ModdleElement
}

function asElements(value: unknown): ModdleElement[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ModdleElement => Boolean(asElement(entry)))
    : []
}

function typeOf(element: ModdleElement | undefined): string {
  return typeof element?.$type === 'string' ? element.$type : ''
}

function idOf(element: ModdleElement | undefined): string | undefined {
  return typeof element?.id === 'string' && element.id.length > 0 ? element.id : undefined
}

function instanceOf(element: ModdleElement, type: string): boolean {
  try {
    return element.$instanceOf?.(type) === true
  } catch {
    return false
  }
}

function ownContainedElements(element: ModdleElement): ModdleElement[] {
  const children: ModdleElement[] = []
  for (const [key, value] of Object.entries(element)) {
    if (key === '$parent' || key === '$attrs' || key === '$model' || key === '$descriptor') {
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const child = asElement(entry)
        if (child?.$type) children.push(child)
      }
    } else {
      const child = asElement(value)
      if (child?.$type) children.push(child)
    }
  }
  return children
}

export function collectBpmnElements(root: ModdleElement): ModdleElement[] {
  const found: ModdleElement[] = []
  const visited = new Set<object>()
  const visit = (element: ModdleElement): void => {
    if (visited.has(element)) return
    visited.add(element)
    found.push(element)
    for (const child of ownContainedElements(element)) visit(child)
  }
  visit(root)
  return found
}

function findIdLocation(xml: string, id: string | undefined): SourceLocation | undefined {
  if (!id) return undefined
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\bid\\s*=\\s*(['\"])${escaped}\\1`).exec(xml)
  return match ? sourceLocationAt(xml, match.index) : undefined
}

function addIssue(
  context: ValidationContext,
  issue: {
    code: string
    severity: 'error' | 'warning' | 'info'
    source: ValidationSource
    message: string
    blocking?: boolean
    process?: ModdleElement
    element?: ModdleElement
    diagram?: ModdleElement
    plane?: ModdleElement
    suggestedRepair?: string
    details?: Record<string, string | number | boolean | null>
  }
): void {
  const elementId = idOf(issue.element)
  context.issues.push(
    validationIssue({
      code: issue.code,
      severity: issue.severity,
      source: issue.source,
      message: issue.message,
      blocking: issue.blocking,
      processId: idOf(issue.process),
      elementId,
      diagramId: idOf(issue.diagram),
      planeId: idOf(issue.plane),
      location: findIdLocation(context.xml, elementId ?? idOf(issue.process)),
      suggestedRepair: issue.suggestedRepair,
      details: issue.details
    })
  )
}

function parseWarningLocation(message: string): SourceLocation | undefined {
  const line = /\bline:\s*(\d+)/i.exec(message)
  const column = /\bcolumn:\s*(\d+)/i.exec(message)
  if (!line && !column) return undefined
  // saxen reports zero-based positions.
  return {
    line: Number(line?.[1] ?? 0) + 1,
    column: Number(column?.[1] ?? 0) + 1
  }
}

function normalizeModdleWarnings(warnings: readonly ModdleWarning[]): ValidationIssue[] {
  return warnings.map((warning) => {
    const message = warning.message?.trim() || warning.error?.message || 'BPMN import warning'
    const blocking = /unparsable content|duplicate id|unresolved reference/i.test(message)
    const code = /unresolved reference/i.test(message)
      ? 'moddle.unresolved-reference'
      : /duplicate id/i.test(message)
        ? 'moddle.duplicate-id'
        : /unparsable content/i.test(message)
          ? 'moddle.unparsable-content'
          : 'moddle.warning'
    return validationIssue({
      code,
      severity: blocking ? 'error' : 'warning',
      source: 'moddle',
      message,
      blocking,
      elementId: idOf(warning.element),
      location: parseWarningLocation(message),
      details:
        warning.property || warning.value !== undefined
          ? {
              property: warning.property ?? '',
              value:
                typeof warning.value === 'string'
                  ? warning.value
                  : JSON.stringify(warning.value) ?? ''
            }
          : undefined
    })
  })
}

function processAncestor(element: ModdleElement | undefined): ModdleElement | undefined {
  let current = element
  while (current) {
    if (typeOf(current) === 'bpmn:Process') return current
    current = current.$parent
  }
  return undefined
}

function directFlowElements(container: ModdleElement): ModdleElement[] {
  return asElements(container.flowElements).filter((element) => element.$parent === container)
}

function refId(value: unknown): string | undefined {
  return idOf(asElement(value))
}

function validateDefinitions(context: ValidationContext, definitions: ModdleElement): void {
  if (typeOf(definitions) !== 'bpmn:Definitions') {
    addIssue(context, {
      code: 'structure.definitions-root',
      severity: 'error',
      source: 'structure',
      message: `Expected bpmn:Definitions as the document root, found "${typeOf(definitions) || 'unknown'}".`,
      element: definitions,
      suggestedRepair: 'Wrap BPMN root elements in a BPMN 2.0 definitions element.'
    })
    return
  }

  if (!idOf(definitions)) {
    addIssue(context, {
      code: 'structure.definitions-id',
      severity: 'error',
      source: 'structure',
      message: 'BPMN definitions must have an ID.',
      element: definitions
    })
  }
  const targetNamespace = definitions.targetNamespace
  if (typeof targetNamespace !== 'string' || targetNamespace.trim().length === 0) {
    addIssue(context, {
      code: 'structure.target-namespace',
      severity: 'error',
      source: 'structure',
      message: 'BPMN definitions must declare a non-empty targetNamespace.',
      element: definitions,
      suggestedRepair: 'Set targetNamespace to a stable organization-owned URI.'
    })
  } else if (
    /\s/.test(targetNamespace) ||
    !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(targetNamespace)
  ) {
    addIssue(context, {
      code: 'structure.target-namespace-uri',
      severity: 'error',
      source: 'structure',
      message: `targetNamespace "${targetNamespace}" is not an absolute URI.`,
      element: definitions,
      suggestedRepair: 'Use a stable absolute URI such as https://orbitpm.ae/bpmn/Process_name.'
    })
  }

  if (context.processes.length === 0) {
    addIssue(context, {
      code: 'structure.process-missing',
      severity: 'error',
      source: 'structure',
      message: 'The BPMN document does not contain a process.',
      element: definitions
    })
  }
}

function validateGlobalIds(context: ValidationContext): void {
  const ids = new Map<string, ModdleElement>()
  for (const element of context.allElements) {
    const id = idOf(element)
    if (!id) continue
    const prior = ids.get(id)
    if (prior) {
      addIssue(context, {
        code: 'structure.duplicate-id',
        severity: 'error',
        source: 'structure',
        message: `ID "${id}" is used by more than one BPMN/DI element.`,
        process: processAncestor(element),
        element,
        details: { firstType: typeOf(prior), duplicateType: typeOf(element) }
      })
    } else {
      ids.set(id, element)
    }
    if (!NCNAME.test(id)) {
      addIssue(context, {
        code: 'structure.invalid-id',
        severity: 'error',
        source: 'structure',
        message: `ID "${id}" is not a valid XML NCName.`,
        process: processAncestor(element),
        element,
        suggestedRepair: 'Use a letter or underscore first, followed by letters, numbers, dots, dashes or underscores.'
      })
    }
  }
}

function validateSequenceFlows(context: ValidationContext, process: ModdleElement): void {
  const containers = context.allElements.filter(
    (element) =>
      (element === process || typeOf(element) === 'bpmn:SubProcess') &&
      processAncestor(element) === process
  )

  for (const container of containers) {
    const direct = directFlowElements(container)
    const nodes = direct.filter((element) => instanceOf(element, 'bpmn:FlowNode'))
    const flows = direct.filter((element) => typeOf(element) === 'bpmn:SequenceFlow')
    const nodeSet = new Set(nodes)
    const outgoing = new Map<ModdleElement, ModdleElement[]>()
    const incoming = new Map<ModdleElement, ModdleElement[]>()

    for (const flow of flows) {
      const source = asElement(flow.sourceRef)
      const target = asElement(flow.targetRef)
      if (!source || !target) {
        addIssue(context, {
          code: 'structure.sequence-ref-missing',
          severity: 'error',
          source: 'structure',
          message: `Sequence flow "${idOf(flow) ?? '(without ID)'}" has an unresolved sourceRef or targetRef.`,
          process,
          element: flow
        })
        continue
      }
      if (!nodeSet.has(source) || !nodeSet.has(target)) {
        addIssue(context, {
          code: 'structure.sequence-ref-container',
          severity: 'error',
          source: 'structure',
          message: `Sequence flow "${idOf(flow) ?? '(without ID)'}" crosses process/subprocess containment.`,
          process,
          element: flow,
          details: { sourceRef: idOf(source) ?? '', targetRef: idOf(target) ?? '' }
        })
      }
      outgoing.set(source, [...(outgoing.get(source) ?? []), flow])
      incoming.set(target, [...(incoming.get(target) ?? []), flow])
    }

    for (const node of nodes) {
      const actualIncoming = incoming.get(node) ?? []
      const actualOutgoing = outgoing.get(node) ?? []
      const declaredIncoming = asElements(node.incoming)
      const declaredOutgoing = asElements(node.outgoing)
      if (
        declaredIncoming.length > 0 &&
        declaredIncoming.some((flow) => !actualIncoming.includes(flow))
      ) {
        addIssue(context, {
          code: 'structure.incoming-mismatch',
          severity: 'error',
          source: 'structure',
          message: `Incoming references on "${idOf(node)}" do not match sequence-flow targetRef values.`,
          process,
          element: node
        })
      }
      if (
        declaredOutgoing.length > 0 &&
        declaredOutgoing.some((flow) => !actualOutgoing.includes(flow))
      ) {
        addIssue(context, {
          code: 'structure.outgoing-mismatch',
          severity: 'error',
          source: 'structure',
          message: `Outgoing references on "${idOf(node)}" do not match sequence-flow sourceRef values.`,
          process,
          element: node
        })
      }

      if (typeOf(node) === 'bpmn:StartEvent' && actualIncoming.length > 0) {
        addIssue(context, {
          code: 'semantic.start-incoming',
          severity: 'error',
          source: 'semantic',
          message: `Start event "${idOf(node)}" must not have incoming sequence flows.`,
          process,
          element: node
        })
      }
      if (typeOf(node) === 'bpmn:EndEvent' && actualOutgoing.length > 0) {
        addIssue(context, {
          code: 'semantic.end-outgoing',
          severity: 'error',
          source: 'semantic',
          message: `End event "${idOf(node)}" must not have outgoing sequence flows.`,
          process,
          element: node
        })
      }

      const defaultFlow = asElement(node.default)
      if (defaultFlow) {
        const supportsDefault =
          instanceOf(node, 'bpmn:Activity') ||
          ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway'].includes(
            typeOf(node)
          )
        if (!supportsDefault) {
          addIssue(context, {
            code: 'semantic.default-source',
            severity: 'error',
            source: 'semantic',
            message: `"${idOf(node)}" cannot declare a default sequence flow.`,
            process,
            element: node
          })
        }
        if (!actualOutgoing.includes(defaultFlow) || asElement(defaultFlow.sourceRef) !== node) {
          addIssue(context, {
            code: 'semantic.default-not-outgoing',
            severity: 'error',
            source: 'semantic',
            message: `Default flow "${idOf(defaultFlow)}" is not an outgoing flow of "${idOf(node)}".`,
            process,
            element: node
          })
        }
        if (defaultFlow.conditionExpression) {
          addIssue(context, {
            code: 'semantic.default-has-condition',
            severity: 'error',
            source: 'semantic',
            message: `Default flow "${idOf(defaultFlow)}" must not have a conditionExpression.`,
            process,
            element: defaultFlow
          })
        }
      }

      const gatewayNeedsConditions =
        ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway'].includes(typeOf(node)) &&
        actualOutgoing.length > 1
      for (const flow of actualOutgoing) {
        const isDefault = flow === defaultFlow
        if (gatewayNeedsConditions && !isDefault && !flow.conditionExpression) {
          addIssue(context, {
            code: 'semantic.branch-condition-missing',
            severity: 'error',
            source: 'semantic',
            message: `Non-default branch "${idOf(flow)}" requires a conditionExpression.`,
            process,
            element: flow,
            suggestedRepair: 'Add a formal condition or mark exactly one outgoing branch as default.'
          })
        }
        if (
          flow.conditionExpression &&
          !instanceOf(node, 'bpmn:Activity') &&
          ![
            'bpmn:ExclusiveGateway',
            'bpmn:InclusiveGateway',
            'bpmn:ComplexGateway'
          ].includes(typeOf(node))
        ) {
          addIssue(context, {
            code: 'semantic.condition-source',
            severity: 'error',
            source: 'semantic',
            message: `Sequence flow "${idOf(flow)}" cannot be conditional when sourced by ${typeOf(node)}.`,
            process,
            element: flow
          })
        }
      }
    }

    // Connectedness is checked for every process and subprocess, rather than
    // stopping at the first root process. Boundary events are connected by
    // attachedToRef and therefore handled separately.
    const boundaryEvents = new Set(
      nodes.filter((node) => typeOf(node) === 'bpmn:BoundaryEvent')
    )
    const starts = nodes.filter(
      (node) =>
        typeOf(node) === 'bpmn:StartEvent' ||
        ((incoming.get(node)?.length ?? 0) === 0 && !boundaryEvents.has(node))
    )
    const reachable = new Set<ModdleElement>(starts)
    const queue = [...starts]
    while (queue.length > 0) {
      const current = queue.shift() as ModdleElement
      for (const flow of outgoing.get(current) ?? []) {
        const target = asElement(flow.targetRef)
        if (target && !reachable.has(target)) {
          reachable.add(target)
          queue.push(target)
        }
      }
    }
    for (const node of nodes) {
      if (boundaryEvents.has(node)) {
        const attached = asElement(node.attachedToRef)
        if (!attached || !nodeSet.has(attached) || !instanceOf(attached, 'bpmn:Activity')) {
          addIssue(context, {
            code: 'semantic.boundary-attachment',
            severity: 'error',
            source: 'semantic',
            message: `Boundary event "${idOf(node)}" has an invalid attachedToRef.`,
            process,
            element: node
          })
        }
        continue
      }
      if (!reachable.has(node)) {
        addIssue(context, {
          code: 'semantic.disconnected-node',
          severity: 'error',
          source: 'semantic',
          message: `Flow node "${idOf(node)}" is disconnected from the process entry path.`,
          process,
          element: node
        })
      }
    }
  }
}

function validateLanes(context: ValidationContext, process: ModdleElement): void {
  const processElements = new Set(
    context.allElements.filter((element) => processAncestor(element) === process)
  )
  for (const lane of context.allElements.filter(
    (element) => typeOf(element) === 'bpmn:Lane' && processAncestor(element) === process
  )) {
    for (const node of asElements(lane.flowNodeRef)) {
      if (!processElements.has(node) || !instanceOf(node, 'bpmn:FlowNode')) {
        addIssue(context, {
          code: 'structure.lane-node-ref',
          severity: 'error',
          source: 'structure',
          message: `Lane "${idOf(lane)}" references a flow node outside process "${idOf(process)}".`,
          process,
          element: lane
        })
      }
    }
  }
}

function validateCollaborations(context: ValidationContext): void {
  const processSet = new Set(context.processes)
  for (const collaboration of context.collaborations) {
    for (const participant of asElements(collaboration.participants)) {
      const processRef = asElement(participant.processRef)
      if (processRef && !processSet.has(processRef)) {
        addIssue(context, {
          code: 'structure.participant-process-ref',
          severity: 'error',
          source: 'structure',
          message: `Participant "${idOf(participant)}" references a process outside this definitions document.`,
          element: participant
        })
      }
    }
    for (const messageFlow of asElements(collaboration.messageFlows)) {
      if (!asElement(messageFlow.sourceRef) || !asElement(messageFlow.targetRef)) {
        addIssue(context, {
          code: 'structure.message-flow-ref',
          severity: 'error',
          source: 'structure',
          message: `Message flow "${idOf(messageFlow)}" has an unresolved endpoint.`,
          element: messageFlow
        })
      }
    }
  }
}

function processElementsForPlaneTarget(
  target: ModdleElement,
  allElements: readonly ModdleElement[]
): Set<ModdleElement> {
  const allowed = new Set<ModdleElement>([target])
  const addTree = (root: ModdleElement): void => {
    for (const element of allElements) {
      let current: ModdleElement | undefined = element
      while (current) {
        if (current === root) {
          allowed.add(element)
          break
        }
        current = current.$parent
      }
    }
  }

  if (typeOf(target) === 'bpmn:Process') {
    addTree(target)
  } else if (typeOf(target) === 'bpmn:Collaboration') {
    addTree(target)
    for (const participant of asElements(target.participants)) {
      const processRef = asElement(participant.processRef)
      if (processRef) addTree(processRef)
    }
  }
  return allowed
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateDi(context: ValidationContext): void {
  const coveredProcesses = new Set<ModdleElement>()
  for (const diagram of context.diagrams) {
    const plane = asElement(diagram.plane)
    if (!plane || typeOf(plane) !== 'bpmndi:BPMNPlane') {
      addIssue(context, {
        code: 'di.plane-missing',
        severity: 'error',
        source: 'di',
        message: `Diagram "${idOf(diagram) ?? '(without ID)'}" does not contain a BPMNPlane.`,
        diagram
      })
      continue
    }

    const target = asElement(plane.bpmnElement)
    if (
      !target ||
      !['bpmn:Process', 'bpmn:Collaboration'].includes(typeOf(target))
    ) {
      addIssue(context, {
        code: 'di.plane-target',
        severity: 'error',
        source: 'di',
        message: `Plane "${idOf(plane) ?? '(without ID)'}" must reference a process or collaboration.`,
        diagram,
        plane
      })
      continue
    }

    if (typeOf(target) === 'bpmn:Process') {
      coveredProcesses.add(target)
    } else {
      for (const participant of asElements(target.participants)) {
        const processRef = asElement(participant.processRef)
        if (processRef) coveredProcesses.add(processRef)
      }
    }

    const allowed = processElementsForPlaneTarget(target, context.allElements)
    for (const planeElement of asElements(plane.planeElement)) {
      const represented = asElement(planeElement.bpmnElement)
      if (!represented) {
        // BPMNLabel and some label styles intentionally have no bpmnElement.
        if (!/Label/.test(typeOf(planeElement))) {
          addIssue(context, {
            code: 'di.element-ref',
            severity: 'error',
            source: 'di',
            message: `DI element "${idOf(planeElement)}" has no resolved bpmnElement reference.`,
            diagram,
            plane,
            element: planeElement
          })
        }
      } else if (!allowed.has(represented)) {
        addIssue(context, {
          code: 'di.element-plane-mismatch',
          severity: 'error',
          source: 'di',
          message: `DI element "${idOf(planeElement)}" represents an element outside its plane target.`,
          diagram,
          plane,
          element: planeElement
        })
      }

      if (typeOf(planeElement) === 'bpmndi:BPMNShape') {
        const bounds = asElement(planeElement.bounds)
        if (
          !bounds ||
          !isFiniteNumber(bounds.x) ||
          !isFiniteNumber(bounds.y) ||
          !isFiniteNumber(bounds.width) ||
          !isFiniteNumber(bounds.height) ||
          bounds.width <= 0 ||
          bounds.height <= 0
        ) {
          addIssue(context, {
            code: 'di.shape-bounds',
            severity: 'error',
            source: 'di',
            message: `Shape "${idOf(planeElement)}" requires finite, positive bounds.`,
            diagram,
            plane,
            element: planeElement
          })
        }
      } else if (typeOf(planeElement) === 'bpmndi:BPMNEdge') {
        const waypoints = asElements(planeElement.waypoint)
        if (
          waypoints.length < 2 ||
          waypoints.some(
            (waypoint) => !isFiniteNumber(waypoint.x) || !isFiniteNumber(waypoint.y)
          )
        ) {
          addIssue(context, {
            code: 'di.edge-waypoints',
            severity: 'error',
            source: 'di',
            message: `Edge "${idOf(planeElement)}" requires at least two finite waypoints.`,
            diagram,
            plane,
            element: planeElement
          })
        }
      }
    }
  }

  for (const process of context.processes) {
    if (!coveredProcesses.has(process)) {
      addIssue(context, {
        code: 'di.process-missing',
        severity: context.requireDi ? 'error' : 'warning',
        source: 'di',
        message: `Process "${idOf(process)}" has no BPMN plane.`,
        blocking: context.requireDi,
        process,
        suggestedRepair: 'Preview auto-layout and accept it before saving normalized XML.'
      })
    }
  }
}

function scalarProperty(element: ModdleElement, name: string): string | undefined {
  const direct = element[name]
  if (typeof direct === 'string') return direct.trim() || undefined
  const viaGet = element.get?.(name)
  if (typeof viaGet === 'string') return viaGet.trim() || undefined
  const attr = element.$attrs?.[`orbitpm:${name}`]
  return typeof attr === 'string' && attr.trim() ? attr.trim() : undefined
}

function bilingualBases(element: ModdleElement): Set<string> {
  const bases = new Set<string>()
  for (const key of [...Object.keys(element), ...Object.keys(element.$attrs ?? {})]) {
    const local = key.replace(/^orbitpm:/, '')
    const match = /^(.*?)(En|Ar)$/.exec(local)
    if (match?.[1]) bases.add(match[1])
  }
  if (typeof element.name === 'string' && element.name.trim()) bases.add('name')
  return bases
}

function neutralValue(value: string, neutralTerms: ReadonlySet<string>): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (neutralTerms.has(normalized.toLocaleUpperCase('en'))) return true
  if (/^[+\-]?\d+(?:[.,:/-]\d+)*%?$/.test(normalized)) return true
  if (/^(?:https?:\/\/|mailto:|urn:)\S+$/i.test(normalized)) return true
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return true
  if (/^[A-Za-z_][A-Za-z0-9_.:-]*\d[A-Za-z0-9_.:-]*$/.test(normalized)) return true
  return false
}

function meaningfulArabic(value: string): boolean {
  return ARABIC_SCRIPT.test(value) && LETTER.test(value)
}

function validateSharedLocalizationAudit(
  context: ValidationContext,
  definitions: ModdleElement
): void {
  if (!context.requireBilingual) return
  const report = auditBpmnLocalization(definitions, {
    source: 'xml',
    approvedNeutralTerms: context.neutralTerms
  })
  const elementById = new Map(
    context.allElements
      .map((element) => [idOf(element), element] as const)
      .filter((entry): entry is [string, ModdleElement] => Boolean(entry[0]))
  )
  const processById = new Map(
    context.processes
      .map((process) => [idOf(process), process] as const)
      .filter((entry): entry is [string, ModdleElement] => Boolean(entry[0]))
  )
  for (const issue of report.issues) {
    const code =
      issue.code === 'missing'
        ? `orbitpm.bilingual-missing-${issue.target}`
        : issue.code === 'wrong-script'
          ? `orbitpm.bilingual-wrong-script-${issue.target}`
          : issue.code === 'duplicate-counterpart'
            ? 'orbitpm.bilingual-duplicate-counterpart'
            : issue.code === 'mixed'
              ? `orbitpm.bilingual-mixed-${issue.target}`
              : 'orbitpm.bilingual-provider-failed'
    addIssue(context, {
      code,
      severity: 'error',
      source: 'orbitpm',
      message: `${issue.field}${issue.target === 'en' ? 'En' : 'Ar'} on "${
        issue.elementId
      }" failed bilingual audit (${issue.code}).`,
      process: processById.get(issue.processId),
      element: elementById.get(issue.elementId),
      details: {
        field: issue.field,
        target: issue.target,
        localizationCode: issue.code
      }
    })
  }
}

function validateOrbitPm(
  context: ValidationContext,
  definitions: ModdleElement
): void {
  validateSharedLocalizationAudit(context, definitions)
  const allProcessIds = new Set(
    context.processes.map(idOf).filter((id): id is string => Boolean(id))
  )
  for (const process of context.processes) {
    const active = scalarProperty(process, 'activeLang')
    if (active && active !== 'en' && active !== 'ar') {
      addIssue(context, {
        code: 'orbitpm.active-language',
        severity: 'error',
        source: 'orbitpm',
        message: `Process "${idOf(process)}" has unsupported orbitpm:activeLang "${active}".`,
        process,
        element: process
      })
    }
  }

  for (const element of context.allElements) {
    const process = processAncestor(element)
    const active = process ? scalarProperty(process, 'activeLang') : undefined
    for (const base of bilingualBases(element)) {
      const en = scalarProperty(element, `${base}En`)
      const ar = scalarProperty(element, `${base}Ar`)
      const visible =
        base === 'name' && typeof element.name === 'string' ? element.name.trim() : undefined
      const requiresPair = context.requireBilingual && Boolean(visible)
      // In strict mode the shared pure localization core above owns all
      // missing/script/mixed/duplicate decisions. The checks below remain the
      // lightweight compatibility audit for documents not yet in strict
      // ingestion/generation mode.
      if (context.requireBilingual) {
        const projected =
          visible &&
          active &&
          ((active === 'en' && en && visible !== en) ||
            (active === 'ar' && ar && visible !== ar))
        if (projected) {
          addIssue(context, {
            code: 'orbitpm.active-projection-mismatch',
            severity: 'error',
            source: 'orbitpm',
            message: `Visible ${base} on "${idOf(element) ?? typeOf(element)}" does not match the ${active} projection.`,
            process,
            element,
            suggestedRepair: `Project ${base}${active === 'en' ? 'En' : 'Ar'} to the visible BPMN name in one transaction.`
          })
        }
        continue
      }
      if (!en && !ar && !requiresPair) continue

      if (!en) {
        addIssue(context, {
          code: 'orbitpm.bilingual-missing-en',
          severity: 'error',
          source: 'orbitpm',
          message: `"${idOf(element) ?? typeOf(element)}" is missing ${base}En.`,
          process,
          element,
          details: { field: base, target: 'en' }
        })
      }
      if (!ar) {
        addIssue(context, {
          code: 'orbitpm.bilingual-missing-ar',
          severity: 'error',
          source: 'orbitpm',
          message: `"${idOf(element) ?? typeOf(element)}" is missing ${base}Ar.`,
          process,
          element,
          details: { field: base, target: 'ar' }
        })
      }
      if (ar && !neutralValue(ar, context.neutralTerms) && !meaningfulArabic(ar)) {
        addIssue(context, {
          code: 'orbitpm.bilingual-wrong-script-ar',
          severity: 'error',
          source: 'orbitpm',
          message: `${base}Ar on "${idOf(element) ?? typeOf(element)}" does not contain meaningful Arabic script.`,
          process,
          element,
          details: { field: base, target: 'ar' }
        })
      }
      if (en && !neutralValue(en, context.neutralTerms) && ARABIC_SCRIPT.test(en)) {
        addIssue(context, {
          code: 'orbitpm.bilingual-wrong-script-en',
          severity: 'error',
          source: 'orbitpm',
          message: `${base}En on "${idOf(element) ?? typeOf(element)}" contains Arabic-script text.`,
          process,
          element,
          details: { field: base, target: 'en' }
        })
      }
      if (
        en &&
        ar &&
        en.localeCompare(ar, undefined, { sensitivity: 'base' }) === 0 &&
        !neutralValue(en, context.neutralTerms)
      ) {
        addIssue(context, {
          code: 'orbitpm.bilingual-duplicate-counterpart',
          severity: 'error',
          source: 'orbitpm',
          message: `${base}En and ${base}Ar on "${idOf(element) ?? typeOf(element)}" are identical.`,
          process,
          element,
          details: { field: base }
        })
      }
      if (en && ARABIC_SCRIPT.test(en) && LATIN_SCRIPT.test(en)) {
        addIssue(context, {
          code: 'orbitpm.bilingual-mixed-en',
          severity: 'warning',
          source: 'orbitpm',
          blocking: false,
          message: `${base}En on "${idOf(element) ?? typeOf(element)}" mixes Arabic and Latin scripts.`,
          process,
          element
        })
      }
      if (ar && ARABIC_SCRIPT.test(ar) && LATIN_SCRIPT.test(ar)) {
        addIssue(context, {
          code: 'orbitpm.bilingual-mixed-ar',
          severity: 'warning',
          source: 'orbitpm',
          blocking: false,
          message: `${base}Ar on "${idOf(element) ?? typeOf(element)}" mixes Arabic and Latin scripts.`,
          process,
          element
        })
      }
      if (
        visible &&
        active &&
        ((active === 'en' && en && visible !== en) || (active === 'ar' && ar && visible !== ar))
      ) {
        addIssue(context, {
          code: 'orbitpm.active-projection-mismatch',
          severity: 'error',
          source: 'orbitpm',
          message: `Visible ${base} on "${idOf(element) ?? typeOf(element)}" does not match the ${active} projection.`,
          process,
          element,
          suggestedRepair: `Project ${base}${active === 'en' ? 'En' : 'Ar'} to the visible BPMN name in one transaction.`
        })
      }
    }

    if (typeOf(element) === 'bpmn:CallActivity') {
      const calledElement = scalarProperty(element, 'calledElement')
      if (!calledElement) {
        addIssue(context, {
          code: 'orbitpm.call-unlinked',
          severity: 'warning',
          source: 'orbitpm',
          blocking: false,
          message: `Call activity "${idOf(element)}" is not linked to a process.`,
          process,
          element
        })
      } else if (
        !allProcessIds.has(calledElement) &&
        !context.knownProcessIds.has(calledElement)
      ) {
        addIssue(context, {
          code: 'orbitpm.call-unresolved',
          severity: 'error',
          source: 'orbitpm',
          message: `Call activity "${idOf(element)}" references unknown process "${calledElement}".`,
          process,
          element,
          suggestedRepair: 'Link the call activity to an unambiguous workspace process or create the missing process.'
        })
      }
    }
  }
}

function parsedStats(context: ValidationContext): ValidationDocumentStats {
  return {
    processes: context.processes.length,
    collaborations: context.collaborations.length,
    diagrams: context.diagrams.length,
    planes: context.diagrams.filter(
      (diagram) => typeOf(asElement(diagram.plane)) === 'bpmndi:BPMNPlane'
    ).length,
    elements: context.allElements.length
  }
}

function stageStatus(
  issues: readonly ValidationIssue[],
  source: ValidationSource | readonly ValidationSource[]
): ValidationStageStatus {
  const sources = new Set(Array.isArray(source) ? source : [source])
  return issues.some((issue) => sources.has(issue.source) && issue.blocking) ? 'failed' : 'passed'
}

export async function validateBpmnXml(
  rawXml: string,
  options: BpmnValidationOptions = {}
): Promise<ParsedBpmnValidation> {
  const preflight = preflightXml(rawXml, options.preflightLimits)
  if (!preflight.safeToParse) {
    return {
      originalXml: rawXml,
      summary: preflight.summary
    }
  }

  const issues: ValidationIssue[] = []
  let imported: ModdleImportResult
  try {
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
    }) as unknown as BpmnModdleLike
    imported = await moddle.fromXML(preflight.xml)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    issues.push(
      validationIssue({
        code: 'moddle.parse-error',
        severity: 'error',
        source: 'moddle',
        message,
        location: parseWarningLocation(message),
        suggestedRepair: 'Repair the XML syntax before applying it to the editor.'
      })
    )
    return {
      originalXml: rawXml,
      summary: createValidationSummary(issues, {
        stages: { preflight: 'passed', moddle: 'failed' },
        xmlWellFormed: false
      })
    }
  }

  issues.push(...normalizeModdleWarnings(imported.warnings ?? []))
  const definitions = imported.rootElement
  if (!definitions) {
    issues.push(
      validationIssue({
        code: 'moddle.root-missing',
        severity: 'error',
        source: 'moddle',
        message: 'bpmn-moddle did not return a document root.'
      })
    )
    return {
      originalXml: rawXml,
      summary: createValidationSummary(issues, {
        stages: { preflight: 'passed', moddle: 'failed' },
        xmlWellFormed: false
      })
    }
  }

  const allElements = collectBpmnElements(definitions)
  const rootElements = asElements(definitions.rootElements)
  const processes = rootElements.filter((element) => typeOf(element) === 'bpmn:Process')
  const collaborations = rootElements.filter(
    (element) => typeOf(element) === 'bpmn:Collaboration'
  )
  const diagrams = asElements(definitions.diagrams)
  const context: ValidationContext = {
    xml: preflight.xml,
    issues,
    allElements,
    processes,
    collaborations,
    diagrams,
    knownProcessIds: new Set(options.knownProcessIds ?? []),
    requireBilingual: options.requireBilingual === true,
    requireDi: options.requireDi === true,
    neutralTerms: new Set(
      [...DEFAULT_NEUTRAL_TERMS, ...(options.neutralTerms ?? [])].map((term) =>
        term.trim().toLocaleUpperCase('en')
      )
    )
  }

  validateDefinitions(context, definitions)
  validateGlobalIds(context)
  for (const process of processes) {
    if (!idOf(process)) {
      addIssue(context, {
        code: 'structure.process-id',
        severity: 'error',
        source: 'structure',
        message: 'Every BPMN process must have an ID.',
        process,
        element: process
      })
    }
    validateSequenceFlows(context, process)
    validateLanes(context, process)
  }
  validateCollaborations(context)
  validateDi(context)
  validateOrbitPm(context, definitions)

  const stages: Partial<Record<ValidationStageName, ValidationStageStatus>> = {
    preflight: 'passed',
    moddle: stageStatus(issues, 'moddle'),
    structure: stageStatus(issues, 'structure'),
    semantic: stageStatus(issues, 'semantic'),
    di: stageStatus(issues, 'di'),
    orbitpm: stageStatus(issues, 'orbitpm')
  }

  const adapters = options.adapters ?? []
  for (const adapter of adapters) {
    const stage = adapter.source
    try {
      const adapterIssues = await adapter.validate(preflight.xml, {
        knownProcessIds: context.knownProcessIds
      })
      issues.push(...adapterIssues)
      stages[stage] = adapterIssues.some((issue) => issue.blocking) ? 'failed' : 'passed'
    } catch (error) {
      issues.push(
        validationIssue({
          code: `${stage}.adapter-failure`,
          severity: 'error',
          source: stage,
          message: `${stage} validation failed to run: ${
            error instanceof Error ? error.message : String(error)
          }`,
          suggestedRepair: 'Retry validation or restore the required validation worker.'
        })
      )
      stages[stage] = 'failed'
    }
  }

  return {
    originalXml: rawXml,
    definitions,
    summary: createValidationSummary(issues, {
      stages,
      stats: parsedStats(context),
      xmlWellFormed: true
    })
  }
}
