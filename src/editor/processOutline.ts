/**
 * UI-independent process-outline model and bpmn-js synchronization adapter.
 *
 * The outline is deliberately structural: it depends only on the small set of
 * bpmn-js services it uses, so it can be tested without mounting a canvas and
 * embedded in any responsive pane or dialog.
 */

export const PROCESS_OUTLINE_NODE_TYPES = [
  'bpmn:StartEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway'
] as const

export type ProcessOutlineNodeType = (typeof PROCESS_OUTLINE_NODE_TYPES)[number]
export type ProcessOutlineItemKind = 'node' | 'flow'
export type ProcessOutlineMoveDirection = 'up' | 'down'

const DEFAULT_FLOW_GATEWAY_TYPES = new Set<string>([
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway'
])

export function canSetProcessOutlineDefault(type: string): boolean {
  return DEFAULT_FLOW_GATEWAY_TYPES.has(type)
}

export interface ProcessOutlineIssue {
  code:
    | 'outline.empty'
    | 'outline.duplicate-id'
    | 'outline.flow-endpoint-missing'
    | 'outline.flow-self-reference'
    | 'outline.flow-duplicate'
    | 'outline.start-has-incoming'
    | 'outline.end-has-outgoing'
    | 'outline.default-has-condition'
    | 'outline.gateway-condition-missing'
    | 'outline.gateway-default-multiple'
    | 'outline.node-disconnected'
  severity: 'error' | 'warning'
  itemId?: string
  details?: Readonly<Record<string, string | number | boolean>>
}

export interface ProcessOutlineNode {
  kind: 'node'
  id: string
  type: string
  name: string
  documentation: string
  calledElement?: string
  parentId?: string
  x: number
  y: number
  incomingFlowIds: readonly string[]
  outgoingFlowIds: readonly string[]
}

export interface ProcessOutlineFlow {
  kind: 'flow'
  id: string
  type: string
  name: string
  sourceId: string
  targetId: string
  condition: string
  isDefault: boolean
  editable: boolean
}

export type ProcessOutlineItem = ProcessOutlineNode | ProcessOutlineFlow

export interface ProcessOutlineSnapshot {
  nodes: readonly ProcessOutlineNode[]
  flows: readonly ProcessOutlineFlow[]
  items: readonly ProcessOutlineItem[]
  selectedIds: readonly string[]
  issues: readonly ProcessOutlineIssue[]
}

export interface ProcessOutlineAddNodeInput {
  type: ProcessOutlineNodeType
  name?: string
  documentation?: string
  connectFromId?: string
}

export interface ProcessOutlineUpdateNodeInput {
  name: string
  documentation: string
  calledElement?: string
}

export interface ProcessOutlineConnectInput {
  sourceId: string
  targetId: string
  name?: string
  condition?: string
  isDefault?: boolean
}

export type ProcessOutlineUpdateFlowInput = ProcessOutlineConnectInput

export type ProcessOutlineErrorCode =
  | 'item-not-found'
  | 'node-not-found'
  | 'flow-not-found'
  | 'unsupported-node-type'
  | 'flow-edit-not-supported'
  | 'invalid-connection'
  | 'default-flow-has-condition'
  | 'default-flow-source-invalid'
  | 'connection-rejected'
  | 'reorder-not-linear'
  | 'service-unavailable'

export class ProcessOutlineError extends Error {
  readonly code: ProcessOutlineErrorCode
  readonly details?: Readonly<Record<string, string | number | boolean>>

  constructor(
    code: ProcessOutlineErrorCode,
    details?: Readonly<Record<string, string | number | boolean>>
  ) {
    super(code)
    this.name = 'ProcessOutlineError'
    this.code = code
    this.details = details
  }
}

interface ModdleElementLike {
  $type?: string
  $instanceOf?: (type: string) => boolean
  id?: string
  name?: string
  documentation?: Array<{ text?: string }>
  calledElement?: string
  conditionExpression?: { body?: string }
  default?: ModdleElementLike
  sourceRef?: ModdleElementLike
  targetRef?: ModdleElementLike
  get?: (name: string) => unknown
}

export interface ProcessOutlineCanvasElement {
  id: string
  type?: string
  businessObject?: ModdleElementLike
  parent?: ProcessOutlineCanvasElement
  source?: ProcessOutlineCanvasElement
  target?: ProcessOutlineCanvasElement
  labelTarget?: unknown
  waypoints?: readonly { x: number; y: number }[]
  x?: number
  y?: number
  width?: number
  height?: number
}

interface ElementRegistryLike {
  getAll(): ProcessOutlineCanvasElement[]
  get(id: string): ProcessOutlineCanvasElement | undefined
}

interface SelectionLike {
  get(): ProcessOutlineCanvasElement[]
  select(element: ProcessOutlineCanvasElement | null): void
}

interface CanvasLike {
  getRootElement(): ProcessOutlineCanvasElement
  scrollToElement(
    element: ProcessOutlineCanvasElement,
    padding?: number | Record<string, number>
  ): void
}

interface EventBusLike {
  on(event: string, priority: number, callback: (event?: Record<string, unknown>) => void): void
  off(event: string, callback: (event?: Record<string, unknown>) => void): void
}

interface ElementFactoryLike {
  createShape(attributes: { type: ProcessOutlineNodeType }): ProcessOutlineCanvasElement
}

interface BpmnFactoryLike {
  create(type: string, attributes?: Record<string, unknown>): ModdleElementLike
}

interface RulesLike {
  allowed(
    action: string,
    context?: Record<string, unknown>
  ): boolean | Record<string, unknown> | null
}

interface CommandHandlerLike {
  preExecute?(context: AtomicReorderContext): void
}

interface CommandStackLike {
  execute(command: string, context: AtomicReorderContext): void
  register(command: string, handler: CommandHandlerLike): void
}

interface ModelingLike {
  createShape(
    shape: ProcessOutlineCanvasElement,
    position: { x: number; y: number },
    parent: ProcessOutlineCanvasElement
  ): ProcessOutlineCanvasElement
  connect(
    source: ProcessOutlineCanvasElement,
    target: ProcessOutlineCanvasElement,
    attributes?: Record<string, unknown>
  ): ProcessOutlineCanvasElement | undefined
  reconnect(
    connection: ProcessOutlineCanvasElement,
    source: ProcessOutlineCanvasElement,
    target: ProcessOutlineCanvasElement,
    dockingOrPoints?: unknown
  ): void
  updateProperties(element: ProcessOutlineCanvasElement, properties: Record<string, unknown>): void
  moveShape?(
    shape: ProcessOutlineCanvasElement,
    delta: { x: number; y: number },
    newParent?: ProcessOutlineCanvasElement
  ): void
  removeElements?(elements: ProcessOutlineCanvasElement[]): void
  removeShape?(shape: ProcessOutlineCanvasElement): void
  removeConnection?(connection: ProcessOutlineCanvasElement): void
}

interface PreparedFlowProperties {
  name: string | undefined
  conditionExpression: ModdleElementLike | undefined
  isDefault: boolean
}

interface AtomicReorderContext {
  modeling: ModelingLike
  first: ProcessOutlineCanvasElement
  second: ProcessOutlineCanvasElement
  between: ProcessOutlineCanvasElement
  previous?: ProcessOutlineCanvasElement
  next?: ProcessOutlineCanvasElement
}

const ATOMIC_REORDER_COMMAND = 'orbitpm.process-outline.reorder'

const atomicReorderHandler: CommandHandlerLike = {
  preExecute({ modeling, first, second, between, previous, next }): void {
    if (previous) {
      modeling.reconnect(previous, previous.source as ProcessOutlineCanvasElement, second)
    }
    modeling.reconnect(between, second, first)
    if (next) {
      modeling.reconnect(next, first, next.target as ProcessOutlineCanvasElement)
    }

    if (modeling.moveShape) {
      const delta = {
        x: (second.x ?? 0) - (first.x ?? 0),
        y: (second.y ?? 0) - (first.y ?? 0)
      }
      modeling.moveShape(first, delta, first.parent)
      modeling.moveShape(second, { x: -delta.x, y: -delta.y }, second.parent)
    }
  }
}

export interface ProcessOutlineModeler {
  get(name: string): unknown
}

interface MutableNode extends Omit<ProcessOutlineNode, 'incomingFlowIds' | 'outgoingFlowIds'> {
  incomingFlowIds: string[]
  outgoingFlowIds: string[]
}

function readProperty(element: ModdleElementLike | undefined, name: string): unknown {
  if (!element) return undefined
  const direct = element[name as keyof ModdleElementLike]
  if (direct !== undefined) return direct
  try {
    return element.get?.(name)
  } catch {
    return undefined
  }
}

function elementType(element: ProcessOutlineCanvasElement): string {
  return element.type ?? element.businessObject?.$type ?? ''
}

function isInstance(element: ProcessOutlineCanvasElement, type: string): boolean {
  try {
    return element.businessObject?.$instanceOf?.(type) === true
  } catch {
    return false
  }
}

function isFlowNode(element: ProcessOutlineCanvasElement): boolean {
  if (element.labelTarget || element.waypoints) return false
  if (isInstance(element, 'bpmn:FlowNode')) return true
  const type = elementType(element)
  return (
    PROCESS_OUTLINE_NODE_TYPES.includes(type as ProcessOutlineNodeType) ||
    /^bpmn:.*(?:Task|Activity|Event|Gateway)$/.test(type)
  )
}

function isFlow(element: ProcessOutlineCanvasElement): boolean {
  if (element.labelTarget) return false
  if (
    isInstance(element, 'bpmn:SequenceFlow') ||
    isInstance(element, 'bpmn:MessageFlow') ||
    isInstance(element, 'bpmn:Association')
  ) {
    return true
  }
  const type = elementType(element)
  return (
    Boolean(element.waypoints || (element.source && element.target)) &&
    /^bpmn:.*(?:Flow|Association)$/.test(type)
  )
}

function moddleId(value: unknown): string {
  return value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? ((value as { id: string }).id ?? '')
    : ''
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nodeVisualOrder(
  left: Pick<ProcessOutlineNode, 'id' | 'parentId' | 'x' | 'y'>,
  right: Pick<ProcessOutlineNode, 'id' | 'parentId' | 'x' | 'y'>
): number {
  return (
    (left.parentId ?? '').localeCompare(right.parentId ?? '') ||
    left.y - right.y ||
    left.x - right.x ||
    left.id.localeCompare(right.id)
  )
}

function orderNodes(
  nodes: readonly MutableNode[],
  flows: readonly ProcessOutlineFlow[]
): MutableNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, ProcessOutlineFlow[]>()

  for (const flow of flows) {
    if (
      flow.type !== 'bpmn:SequenceFlow' ||
      !nodeById.has(flow.sourceId) ||
      !nodeById.has(flow.targetId)
    ) {
      continue
    }
    indegree.set(flow.targetId, (indegree.get(flow.targetId) ?? 0) + 1)
    const bucket = outgoing.get(flow.sourceId) ?? []
    bucket.push(flow)
    outgoing.set(flow.sourceId, bucket)
  }

  const queue = nodes.filter((node) => indegree.get(node.id) === 0).sort(nodeVisualOrder)
  const ordered: MutableNode[] = []
  const visited = new Set<string>()
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node || visited.has(node.id)) continue
    visited.add(node.id)
    ordered.push(node)
    for (const flow of outgoing.get(node.id) ?? []) {
      const nextDegree = (indegree.get(flow.targetId) ?? 1) - 1
      indegree.set(flow.targetId, nextDegree)
      const target = nodeById.get(flow.targetId)
      if (target && nextDegree === 0) {
        queue.push(target)
        queue.sort(nodeVisualOrder)
      }
    }
  }

  ordered.push(...nodes.filter((node) => !visited.has(node.id)).sort(nodeVisualOrder))
  return ordered
}

function interleaveItems(
  nodes: readonly ProcessOutlineNode[],
  flows: readonly ProcessOutlineFlow[]
): ProcessOutlineItem[] {
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const remaining = new Map(flows.map((flow) => [flow.id, flow]))
  const items: ProcessOutlineItem[] = []

  for (const node of nodes) {
    items.push(node)
    const outgoing = flows
      .filter((flow) => flow.sourceId === node.id)
      .sort(
        (left, right) =>
          (order.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.targetId) ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id)
      )
    for (const flow of outgoing) {
      items.push(flow)
      remaining.delete(flow.id)
    }
  }

  items.push(...[...remaining.values()].sort((a, b) => a.id.localeCompare(b.id)))
  return items
}

export function validateProcessOutline(
  snapshot: Pick<ProcessOutlineSnapshot, 'nodes' | 'flows'>
): ProcessOutlineIssue[] {
  const issues: ProcessOutlineIssue[] = []
  const allIds = new Map<string, number>()
  for (const item of [...snapshot.nodes, ...snapshot.flows]) {
    allIds.set(item.id, (allIds.get(item.id) ?? 0) + 1)
  }
  for (const [id, count] of allIds) {
    if (count > 1) {
      issues.push({
        code: 'outline.duplicate-id',
        severity: 'error',
        itemId: id,
        details: { count }
      })
    }
  }

  if (snapshot.nodes.length === 0) {
    issues.push({ code: 'outline.empty', severity: 'error' })
  }

  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const pairCounts = new Map<string, number>()
  for (const flow of snapshot.flows) {
    if (!nodes.has(flow.sourceId) || !nodes.has(flow.targetId)) {
      issues.push({
        code: 'outline.flow-endpoint-missing',
        severity: 'error',
        itemId: flow.id,
        details: { sourceId: flow.sourceId, targetId: flow.targetId }
      })
    }
    if (flow.sourceId && flow.sourceId === flow.targetId) {
      issues.push({
        code: 'outline.flow-self-reference',
        severity: 'error',
        itemId: flow.id
      })
    }
    if (flow.type === 'bpmn:SequenceFlow') {
      const key = `${flow.sourceId}\u0000${flow.targetId}`
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
    }
    if (flow.isDefault && flow.condition) {
      issues.push({
        code: 'outline.default-has-condition',
        severity: 'error',
        itemId: flow.id
      })
    }
  }
  for (const [pair, count] of pairCounts) {
    if (count <= 1) continue
    const [sourceId, targetId] = pair.split('\u0000')
    issues.push({
      code: 'outline.flow-duplicate',
      severity: 'warning',
      details: { sourceId, targetId, count }
    })
  }

  for (const node of snapshot.nodes) {
    const incoming = snapshot.flows.filter(
      (flow) => flow.type === 'bpmn:SequenceFlow' && flow.targetId === node.id
    )
    const outgoing = snapshot.flows.filter(
      (flow) => flow.type === 'bpmn:SequenceFlow' && flow.sourceId === node.id
    )
    if (node.type === 'bpmn:StartEvent' && incoming.length > 0) {
      issues.push({
        code: 'outline.start-has-incoming',
        severity: 'error',
        itemId: node.id,
        details: { count: incoming.length }
      })
    }
    if (node.type === 'bpmn:EndEvent' && outgoing.length > 0) {
      issues.push({
        code: 'outline.end-has-outgoing',
        severity: 'error',
        itemId: node.id,
        details: { count: outgoing.length }
      })
    }
    if (
      ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway'].includes(node.type) &&
      outgoing.length > 1
    ) {
      const defaults = outgoing.filter((flow) => flow.isDefault)
      if (defaults.length > 1) {
        issues.push({
          code: 'outline.gateway-default-multiple',
          severity: 'error',
          itemId: node.id,
          details: { count: defaults.length }
        })
      }
      for (const flow of outgoing) {
        if (!flow.isDefault && !flow.condition) {
          issues.push({
            code: 'outline.gateway-condition-missing',
            severity: 'error',
            itemId: flow.id,
            details: { gatewayId: node.id }
          })
        }
      }
    }
    if (snapshot.nodes.length > 1 && incoming.length === 0 && outgoing.length === 0) {
      issues.push({
        code: 'outline.node-disconnected',
        severity: 'warning',
        itemId: node.id
      })
    }
  }

  return issues.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      (left.itemId ?? '').localeCompare(right.itemId ?? '') ||
      left.code.localeCompare(right.code)
  )
}

export function buildProcessOutlineSnapshot(
  elements: readonly ProcessOutlineCanvasElement[],
  selectedIds: readonly string[] = []
): ProcessOutlineSnapshot {
  const mutableNodes: MutableNode[] = elements.filter(isFlowNode).map((element) => {
    const businessObject = element.businessObject
    const documentation = readProperty(businessObject, 'documentation')
    const firstDocumentation = Array.isArray(documentation) ? documentation[0] : undefined
    return {
      kind: 'node',
      id: element.id,
      type: elementType(element),
      name: text(readProperty(businessObject, 'name')),
      documentation:
        firstDocumentation && typeof firstDocumentation === 'object'
          ? text((firstDocumentation as { text?: unknown }).text)
          : '',
      calledElement: text(readProperty(businessObject, 'calledElement')) || undefined,
      parentId: element.parent?.id,
      x: element.x ?? 0,
      y: element.y ?? 0,
      incomingFlowIds: [],
      outgoingFlowIds: []
    }
  })
  const nodeIds = new Set(mutableNodes.map((node) => node.id))
  const flows: ProcessOutlineFlow[] = elements.filter(isFlow).map((element) => {
    const businessObject = element.businessObject
    const sourceId = element.source?.id ?? moddleId(readProperty(businessObject, 'sourceRef'))
    const targetId = element.target?.id ?? moddleId(readProperty(businessObject, 'targetRef'))
    const sourceBusinessObject =
      element.source?.businessObject ??
      (elements.find((candidate) => candidate.id === sourceId)?.businessObject as
        ModdleElementLike | undefined)
    const defaultFlow = readProperty(sourceBusinessObject, 'default')
    const condition = readProperty(businessObject, 'conditionExpression')
    return {
      kind: 'flow',
      id: element.id,
      type: elementType(element),
      name: text(readProperty(businessObject, 'name')),
      sourceId,
      targetId,
      condition:
        condition && typeof condition === 'object'
          ? text((condition as { body?: unknown }).body)
          : '',
      isDefault: moddleId(defaultFlow) === element.id,
      editable: elementType(element) === 'bpmn:SequenceFlow'
    }
  })

  const nodeById = new Map(mutableNodes.map((node) => [node.id, node]))
  for (const flow of flows) {
    nodeById.get(flow.sourceId)?.outgoingFlowIds.push(flow.id)
    nodeById.get(flow.targetId)?.incomingFlowIds.push(flow.id)
  }
  const nodes = orderNodes(mutableNodes, flows).map((node) => ({
    ...node,
    incomingFlowIds: Object.freeze([...node.incomingFlowIds].sort()),
    outgoingFlowIds: Object.freeze([...node.outgoingFlowIds].sort())
  }))
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]))
  const sortedFlows = [...flows].sort(
    (left, right) =>
      (nodeOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
        (nodeOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER) ||
      (nodeOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) -
        (nodeOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id)
  )
  const partial = { nodes, flows: sortedFlows }
  const normalizedSelectedIds = selectedIds.filter(
    (id) => nodeIds.has(id) || sortedFlows.some((flow) => flow.id === id)
  )
  const snapshot: ProcessOutlineSnapshot = {
    ...partial,
    items: interleaveItems(nodes, sortedFlows),
    selectedIds: normalizedSelectedIds,
    issues: []
  }
  return {
    ...snapshot,
    issues: validateProcessOutline(snapshot)
  }
}

export function emptyProcessOutlineSnapshot(): ProcessOutlineSnapshot {
  return {
    nodes: [],
    flows: [],
    items: [],
    selectedIds: [],
    issues: [{ code: 'outline.empty', severity: 'error' }]
  }
}

export interface ProcessOutlineSwapPlan {
  firstNodeId: string
  secondNodeId: string
  previousFlowId?: string
  betweenFlowId: string
  nextFlowId?: string
}

const REORDERABLE_TYPES = new Set<string>([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ManualTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ScriptTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent'
])

/**
 * Resolve a safe adjacent semantic swap. Branches, gateways, conditional
 * flows, defaults, start/end events and non-linear nodes are intentionally
 * rejected rather than silently changing their meaning.
 */
export function planLinearNodeSwap(
  snapshot: ProcessOutlineSnapshot,
  nodeId: string,
  direction: ProcessOutlineMoveDirection
): ProcessOutlineSwapPlan | null {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const flowById = new Map(snapshot.flows.map((flow) => [flow.id, flow]))
  const current = nodeById.get(nodeId)
  if (!current || !REORDERABLE_TYPES.has(current.type)) return null

  const incoming = current.incomingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  const outgoing = current.outgoingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  const neighborId =
    direction === 'up'
      ? incoming.length === 1
        ? incoming[0].sourceId
        : undefined
      : outgoing.length === 1
        ? outgoing[0].targetId
        : undefined
  const neighbor = neighborId ? nodeById.get(neighborId) : undefined
  if (!neighbor || !REORDERABLE_TYPES.has(neighbor.type)) return null

  const first = direction === 'up' ? neighbor : current
  const second = direction === 'up' ? current : neighbor
  const firstIncoming = first.incomingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  const firstOutgoing = first.outgoingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  const secondIncoming = second.incomingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  const secondOutgoing = second.outgoingFlowIds
    .map((id) => flowById.get(id))
    .filter((flow): flow is ProcessOutlineFlow => flow?.type === 'bpmn:SequenceFlow')
  if (
    firstIncoming.length > 1 ||
    firstOutgoing.length !== 1 ||
    secondIncoming.length !== 1 ||
    secondOutgoing.length > 1
  ) {
    return null
  }
  const between = firstOutgoing[0]
  if (between.targetId !== second.id || secondIncoming[0].id !== between.id) return null

  const affected = [...firstIncoming, between, ...secondOutgoing]
  if (affected.some((flow) => flow.isDefault || Boolean(flow.condition))) return null

  return {
    firstNodeId: first.id,
    secondNodeId: second.id,
    previousFlowId: firstIncoming[0]?.id,
    betweenFlowId: between.id,
    nextFlowId: secondOutgoing[0]?.id
  }
}

function requireElement(
  registry: ElementRegistryLike,
  id: string,
  code: 'item-not-found' | 'node-not-found' | 'flow-not-found'
): ProcessOutlineCanvasElement {
  const element = registry.get(id)
  if (!element) throw new ProcessOutlineError(code, { id })
  return element
}

function requireNode(registry: ElementRegistryLike, id: string): ProcessOutlineCanvasElement {
  const element = requireElement(registry, id, 'node-not-found')
  if (!isFlowNode(element)) throw new ProcessOutlineError('node-not-found', { id })
  return element
}

function requireFlow(registry: ElementRegistryLike, id: string): ProcessOutlineCanvasElement {
  const element = requireElement(registry, id, 'flow-not-found')
  if (!isFlow(element)) throw new ProcessOutlineError('flow-not-found', { id })
  return element
}

function isSupportedNodeType(type: string): type is ProcessOutlineNodeType {
  return PROCESS_OUTLINE_NODE_TYPES.includes(type as ProcessOutlineNodeType)
}

function service<T>(modeler: ProcessOutlineModeler, name: string): T {
  try {
    const resolved = modeler.get(name) as T | undefined
    if (!resolved) throw new Error(name)
    return resolved
  } catch {
    throw new ProcessOutlineError('service-unavailable', { service: name })
  }
}

function prepareFlowProperties(
  bpmnFactory: BpmnFactoryLike,
  source: ProcessOutlineCanvasElement,
  input: Pick<ProcessOutlineConnectInput, 'name' | 'condition' | 'isDefault'>
): PreparedFlowProperties {
  const condition = text(input.condition)
  if (input.isDefault && condition) {
    throw new ProcessOutlineError('default-flow-has-condition')
  }
  if (input.isDefault && !canSetProcessOutlineDefault(elementType(source))) {
    throw new ProcessOutlineError('default-flow-source-invalid', {
      sourceId: source.id,
      sourceType: elementType(source)
    })
  }
  return {
    name: text(input.name) || undefined,
    conditionExpression: condition
      ? bpmnFactory.create('bpmn:FormalExpression', { body: condition })
      : undefined,
    isDefault: input.isDefault === true
  }
}

function ensureSequenceConnectionAllowed(
  rules: RulesLike,
  action: 'connection.create' | 'connection.reconnect',
  source: ProcessOutlineCanvasElement,
  target: ProcessOutlineCanvasElement,
  connection?: ProcessOutlineCanvasElement
): void {
  const allowed = rules.allowed(action, { source, target, connection })
  const resultingType =
    allowed && typeof allowed === 'object' && typeof allowed.type === 'string'
      ? allowed.type
      : undefined
  if (
    allowed === false ||
    allowed === null ||
    (resultingType && resultingType !== 'bpmn:SequenceFlow')
  ) {
    throw new ProcessOutlineError('connection-rejected', {
      sourceId: source.id,
      targetId: target.id
    })
  }
}

function updateFlowProperties(
  modeling: ModelingLike,
  flow: ProcessOutlineCanvasElement,
  source: ProcessOutlineCanvasElement,
  prepared: PreparedFlowProperties
): void {
  modeling.updateProperties(flow, {
    name: prepared.name,
    conditionExpression: prepared.conditionExpression
  })

  const sourceBusinessObject = source?.businessObject
  const currentDefault = readProperty(sourceBusinessObject, 'default')
  if (prepared.isDefault) {
    if (flow.businessObject) {
      modeling.updateProperties(source, { default: flow.businessObject })
    }
  } else if (moddleId(currentDefault) === flow.id) {
    modeling.updateProperties(source, { default: undefined })
  }
}

export type ProcessOutlineListener = (snapshot: ProcessOutlineSnapshot) => void

export class ProcessOutlineController {
  private readonly modeler: ProcessOutlineModeler
  private readonly registry: ElementRegistryLike
  private readonly selection: SelectionLike
  private readonly canvas: CanvasLike
  private readonly eventBus: EventBusLike
  private readonly modeling: ModelingLike
  private readonly elementFactory: ElementFactoryLike
  private readonly bpmnFactory: BpmnFactoryLike
  private readonly rules: RulesLike
  private readonly commandStack: CommandStackLike
  private readonly listeners = new Set<ProcessOutlineListener>()
  private snapshotValue: ProcessOutlineSnapshot
  private destroyed = false

  private readonly refreshFromModel = (): void => {
    if (this.destroyed) return
    this.snapshotValue = buildProcessOutlineSnapshot(
      this.registry.getAll(),
      this.selection.get().map((element) => element.id)
    )
    for (const listener of this.listeners) listener(this.snapshotValue)
  }

  constructor(modeler: ProcessOutlineModeler) {
    this.modeler = modeler
    this.registry = service<ElementRegistryLike>(modeler, 'elementRegistry')
    this.selection = service<SelectionLike>(modeler, 'selection')
    this.canvas = service<CanvasLike>(modeler, 'canvas')
    this.eventBus = service<EventBusLike>(modeler, 'eventBus')
    this.modeling = service<ModelingLike>(modeler, 'modeling')
    this.elementFactory = service<ElementFactoryLike>(modeler, 'elementFactory')
    this.bpmnFactory = service<BpmnFactoryLike>(modeler, 'bpmnFactory')
    this.rules = service<RulesLike>(modeler, 'rules')
    this.commandStack = service<CommandStackLike>(modeler, 'commandStack')
    this.commandStack.register(ATOMIC_REORDER_COMMAND, atomicReorderHandler)
    this.snapshotValue = buildProcessOutlineSnapshot(
      this.registry.getAll(),
      this.selection.get().map((element) => element.id)
    )
    for (const event of [
      'import.done',
      'elements.changed',
      'commandStack.changed',
      'selection.changed',
      'root.set'
    ]) {
      this.eventBus.on(event, 750, this.refreshFromModel)
    }
  }

  get snapshot(): ProcessOutlineSnapshot {
    return this.snapshotValue
  }

  subscribe(listener: ProcessOutlineListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshotValue)
    return () => this.listeners.delete(listener)
  }

  refresh(): ProcessOutlineSnapshot {
    this.refreshFromModel()
    return this.snapshotValue
  }

  select(itemId: string): void {
    const element = requireElement(this.registry, itemId, 'item-not-found')
    this.selection.select(element)
    try {
      this.canvas.scrollToElement(element, 120)
    } catch {
      // Selection is authoritative; inability to scroll must not undo it.
    }
    this.refreshFromModel()
  }

  addNode(input: ProcessOutlineAddNodeInput): ProcessOutlineNode {
    if (!isSupportedNodeType(input.type)) {
      throw new ProcessOutlineError('unsupported-node-type', { type: input.type })
    }
    const anchor = input.connectFromId ? requireNode(this.registry, input.connectFromId) : undefined
    const parent = anchor?.parent ?? this.canvas.getRootElement()
    const draft = this.elementFactory.createShape({ type: input.type })
    const position = anchor
      ? {
          x: (anchor.x ?? 0) + (anchor.width ?? 100) + 140,
          y: (anchor.y ?? 0) + (anchor.height ?? 80) / 2
        }
      : {
          x: 240,
          y: 140 + this.snapshotValue.nodes.length * 110
        }
    const created = this.modeling.createShape(draft, position, parent)
    const documentation = text(input.documentation)
    this.modeling.updateProperties(created, {
      name: text(input.name) || undefined,
      documentation: documentation
        ? [this.bpmnFactory.create('bpmn:Documentation', { text: documentation })]
        : []
    })
    if (anchor) {
      const connection = this.modeling.connect(anchor, created, {
        type: 'bpmn:SequenceFlow'
      })
      if (!connection) {
        throw new ProcessOutlineError('connection-rejected', {
          sourceId: anchor.id,
          targetId: created.id
        })
      }
    }
    this.selection.select(created)
    this.refreshFromModel()
    const node = this.snapshotValue.nodes.find((candidate) => candidate.id === created.id)
    if (!node) throw new ProcessOutlineError('node-not-found', { id: created.id })
    return node
  }

  updateNode(nodeId: string, input: ProcessOutlineUpdateNodeInput): void {
    const node = requireElement(this.registry, nodeId, 'node-not-found')
    const documentation = text(input.documentation)
    const properties: Record<string, unknown> = {
      name: text(input.name) || undefined,
      documentation: documentation
        ? [this.bpmnFactory.create('bpmn:Documentation', { text: documentation })]
        : []
    }
    if (input.calledElement !== undefined) {
      properties.calledElement = text(input.calledElement) || undefined
    }
    this.modeling.updateProperties(node, properties)
    this.refreshFromModel()
  }

  connectNodes(input: ProcessOutlineConnectInput): ProcessOutlineFlow {
    if (!input.sourceId || !input.targetId || input.sourceId === input.targetId) {
      throw new ProcessOutlineError('invalid-connection', {
        sourceId: input.sourceId,
        targetId: input.targetId
      })
    }
    const source = requireNode(this.registry, input.sourceId)
    const target = requireNode(this.registry, input.targetId)
    const prepared = prepareFlowProperties(this.bpmnFactory, source, input)
    ensureSequenceConnectionAllowed(this.rules, 'connection.create', source, target)
    const connection = this.modeling.connect(source, target, {
      type: 'bpmn:SequenceFlow'
    })
    if (!connection) {
      throw new ProcessOutlineError('connection-rejected', {
        sourceId: input.sourceId,
        targetId: input.targetId
      })
    }
    updateFlowProperties(this.modeling, connection, source, prepared)
    this.selection.select(connection)
    this.refreshFromModel()
    const flow = this.snapshotValue.flows.find((candidate) => candidate.id === connection.id)
    if (!flow) throw new ProcessOutlineError('flow-not-found', { id: connection.id })
    return flow
  }

  updateFlow(flowId: string, input: ProcessOutlineUpdateFlowInput): void {
    const flow = requireFlow(this.registry, flowId)
    const currentSourceId =
      flow.source?.id ?? moddleId(readProperty(flow.businessObject, 'sourceRef'))
    const currentTargetId =
      flow.target?.id ?? moddleId(readProperty(flow.businessObject, 'targetRef'))
    if (elementType(flow) !== 'bpmn:SequenceFlow') {
      if (
        input.sourceId !== currentSourceId ||
        input.targetId !== currentTargetId ||
        text(input.condition) ||
        input.isDefault
      ) {
        throw new ProcessOutlineError('flow-edit-not-supported', {
          flowId,
          flowType: elementType(flow)
        })
      }
      this.modeling.updateProperties(flow, { name: text(input.name) || undefined })
      this.refreshFromModel()
      return
    }
    if (!input.sourceId || !input.targetId || input.sourceId === input.targetId) {
      throw new ProcessOutlineError('invalid-connection', {
        sourceId: input.sourceId,
        targetId: input.targetId
      })
    }
    const newSource = requireNode(this.registry, input.sourceId)
    const newTarget = requireNode(this.registry, input.targetId)
    const prepared = prepareFlowProperties(this.bpmnFactory, newSource, input)
    ensureSequenceConnectionAllowed(this.rules, 'connection.reconnect', newSource, newTarget, flow)
    const oldSource = flow.source
    const oldSourceDefault = readProperty(oldSource?.businessObject, 'default')
    if (flow.source?.id !== newSource.id || flow.target?.id !== newTarget.id) {
      this.modeling.reconnect(flow, newSource, newTarget)
    }
    const currentFlow = this.registry.get(flowId) ?? flow
    updateFlowProperties(this.modeling, currentFlow, newSource, prepared)
    if (
      oldSource &&
      oldSource.id !== newSource.id &&
      moddleId(oldSourceDefault) === currentFlow.id
    ) {
      this.modeling.updateProperties(oldSource, { default: undefined })
    }
    this.refreshFromModel()
  }

  moveNode(nodeId: string, direction: ProcessOutlineMoveDirection): void {
    const plan = planLinearNodeSwap(this.snapshotValue, nodeId, direction)
    if (!plan) {
      throw new ProcessOutlineError('reorder-not-linear', { nodeId, direction })
    }
    const first = requireNode(this.registry, plan.firstNodeId)
    const second = requireNode(this.registry, plan.secondNodeId)
    const between = requireFlow(this.registry, plan.betweenFlowId)
    const previous = plan.previousFlowId
      ? requireFlow(this.registry, plan.previousFlowId)
      : undefined
    const next = plan.nextFlowId ? requireFlow(this.registry, plan.nextFlowId) : undefined
    if (previous && !previous.source) {
      throw new ProcessOutlineError('flow-not-found', { id: previous.id })
    }
    if (next && !next.target) {
      throw new ProcessOutlineError('flow-not-found', { id: next.id })
    }
    this.commandStack.execute(ATOMIC_REORDER_COMMAND, {
      modeling: this.modeling,
      first,
      second,
      between,
      previous,
      next
    })
    this.selection.select(direction === 'up' ? second : first)
    this.refreshFromModel()
  }

  deleteItem(itemId: string): void {
    const element = requireElement(this.registry, itemId, 'item-not-found')
    if (element.waypoints || (element.source && element.target)) {
      if (this.modeling.removeConnection) {
        this.modeling.removeConnection(element)
      } else if (this.modeling.removeElements) {
        this.modeling.removeElements([element])
      } else {
        throw new ProcessOutlineError('service-unavailable', { service: 'removeConnection' })
      }
    } else if (this.modeling.removeElements) {
      this.modeling.removeElements([element])
    } else if (this.modeling.removeShape) {
      this.modeling.removeShape(element)
    } else {
      throw new ProcessOutlineError('service-unavailable', { service: 'removeElements' })
    }
    this.selection.select(null)
    this.refreshFromModel()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const event of [
      'import.done',
      'elements.changed',
      'commandStack.changed',
      'selection.changed',
      'root.set'
    ]) {
      this.eventBus.off(event, this.refreshFromModel)
    }
    this.listeners.clear()
  }
}

export function createProcessOutlineController(
  modeler: ProcessOutlineModeler
): ProcessOutlineController {
  return new ProcessOutlineController(modeler)
}
