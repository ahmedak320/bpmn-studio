import { vi } from 'vitest'
import type {
  ProcessOutlineCanvasElement,
  ProcessOutlineModeler,
  ProcessOutlineNodeType
} from '../processOutline'

interface TestBusinessObject {
  $type: string
  $instanceOf(type: string): boolean
  id: string
  name?: string
  documentation?: Array<{ text?: string }>
  calledElement?: string
  conditionExpression?: { body?: string }
  default?: TestBusinessObject
  sourceRef?: TestBusinessObject
  targetRef?: TestBusinessObject
  [key: string]: unknown
}

interface TestElement extends ProcessOutlineCanvasElement {
  businessObject: TestBusinessObject
  parent?: TestElement
  source?: TestElement
  target?: TestElement
}

type EventCallback = (event?: Record<string, unknown>) => void

const FLOW_NODE_TYPES = new Set([
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
])

function businessObject(
  type: string,
  id: string,
  attributes: Record<string, unknown> = {}
): TestBusinessObject {
  return {
    $type: type,
    id,
    $instanceOf(candidate: string): boolean {
      if (candidate === type) return true
      if (candidate === 'bpmn:FlowNode') return FLOW_NODE_TYPES.has(type)
      if (candidate === 'bpmn:SequenceFlow') return type === 'bpmn:SequenceFlow'
      if (candidate === 'bpmn:MessageFlow') return type === 'bpmn:MessageFlow'
      if (candidate === 'bpmn:Association') return type === 'bpmn:Association'
      return false
    },
    ...attributes
  }
}

export interface OutlineTestModeler {
  modeler: ProcessOutlineModeler
  root: TestElement
  elements: Map<string, TestElement>
  selected: TestElement[]
  scrollToElement: ReturnType<typeof vi.fn>
  updateProperties: ReturnType<typeof vi.fn>
  reconnect: ReturnType<typeof vi.fn>
  moveShape: ReturnType<typeof vi.fn>
  removeElements: ReturnType<typeof vi.fn>
  removeConnection: ReturnType<typeof vi.fn>
  commandExecute: ReturnType<typeof vi.fn>
  rulesAllowed: ReturnType<typeof vi.fn>
  undo(): void
  redo(): void
  addNode(
    id: string,
    type: ProcessOutlineNodeType,
    name?: string,
    position?: { x: number; y: number }
  ): TestElement
  addFlow(
    id: string,
    sourceId: string,
    targetId: string,
    options?: {
      type?: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow' | 'bpmn:Association'
      name?: string
      condition?: string
      isDefault?: boolean
    }
  ): TestElement
  emit(event: string): void
}

export function createOutlineTestModeler(): OutlineTestModeler {
  const listeners = new Map<string, Set<EventCallback>>()
  const elements = new Map<string, TestElement>()
  const selected: TestElement[] = []
  let nodeSequence = 0
  let flowSequence = 0

  const root: TestElement = {
    id: 'Process_1',
    type: 'bpmn:Process',
    businessObject: businessObject('bpmn:Process', 'Process_1'),
    x: 0,
    y: 0
  }
  elements.set(root.id, root)

  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener({ type: event })
  }

  const addNode = (
    id: string,
    type: ProcessOutlineNodeType,
    name = '',
    position = { x: 100 + nodeSequence * 160, y: 100 }
  ): TestElement => {
    nodeSequence += 1
    const node: TestElement = {
      id,
      type,
      businessObject: businessObject(type, id, { name: name || undefined }),
      parent: root,
      x: position.x,
      y: position.y,
      width: 100,
      height: 80
    }
    elements.set(id, node)
    return node
  }

  const addFlow = (
    id: string,
    sourceId: string,
    targetId: string,
    options: {
      type?: 'bpmn:SequenceFlow' | 'bpmn:MessageFlow' | 'bpmn:Association'
      name?: string
      condition?: string
      isDefault?: boolean
    } = {}
  ): TestElement => {
    const source = elements.get(sourceId)
    const target = elements.get(targetId)
    if (!source || !target) throw new Error('test flow endpoint missing')
    flowSequence += 1
    const type = options.type ?? 'bpmn:SequenceFlow'
    const flowBusinessObject = businessObject(type, id, {
      name: options.name || undefined,
      sourceRef: source.businessObject,
      targetRef: target.businessObject,
      conditionExpression: options.condition ? { body: options.condition } : undefined
    })
    const flow: TestElement = {
      id,
      type,
      businessObject: flowBusinessObject,
      parent: root,
      source,
      target,
      waypoints: [
        { x: source.x ?? 0, y: source.y ?? 0 },
        { x: target.x ?? 0, y: target.y ?? 0 }
      ]
    }
    elements.set(id, flow)
    if (options.isDefault) source.businessObject.default = flowBusinessObject
    return flow
  }

  const updateProperties = vi.fn(
    (element: ProcessOutlineCanvasElement, properties: Record<string, unknown>) => {
      const testElement = element as TestElement
      Object.assign(testElement.businessObject, properties)
      emit('elements.changed')
    }
  )

  const reconnect = vi.fn(
    (
      connection: ProcessOutlineCanvasElement,
      source: ProcessOutlineCanvasElement,
      target: ProcessOutlineCanvasElement
    ) => {
      const testConnection = connection as TestElement
      testConnection.source = source as TestElement
      testConnection.target = target as TestElement
      testConnection.businessObject.sourceRef = (source as TestElement).businessObject
      testConnection.businessObject.targetRef = (target as TestElement).businessObject
      emit('elements.changed')
    }
  )

  const moveShape = vi.fn((shape: ProcessOutlineCanvasElement, delta: { x: number; y: number }) => {
    const testShape = shape as TestElement
    testShape.x = (testShape.x ?? 0) + delta.x
    testShape.y = (testShape.y ?? 0) + delta.y
    emit('elements.changed')
  })

  const removeConnection = vi.fn((connection: ProcessOutlineCanvasElement) => {
    elements.delete(connection.id)
    for (const element of elements.values()) {
      if (element.businessObject.default?.id === connection.id) {
        element.businessObject.default = undefined
      }
    }
    emit('elements.changed')
  })

  const removeElements = vi.fn((removed: ProcessOutlineCanvasElement[]) => {
    const ids = new Set(removed.map((element) => element.id))
    for (const element of elements.values()) {
      if (element.source && ids.has(element.source.id)) ids.add(element.id)
      if (element.target && ids.has(element.target.id)) ids.add(element.id)
    }
    for (const id of ids) elements.delete(id)
    emit('elements.changed')
  })

  const createShape = ({ type }: { type: ProcessOutlineNodeType }): TestElement => {
    const localName = type.replace(/^bpmn:/, '')
    const id = `${localName}_${++nodeSequence}`
    return {
      id,
      type,
      businessObject: businessObject(type, id),
      width: 100,
      height: 80
    }
  }

  interface ElementState {
    element: TestElement
    x: number | undefined
    y: number | undefined
    source: TestElement | undefined
    target: TestElement | undefined
    sourceRef: TestBusinessObject | undefined
    targetRef: TestBusinessObject | undefined
    defaultFlow: TestBusinessObject | undefined
  }

  const captureState = (): ElementState[] =>
    [...elements.values()].map((element) => ({
      element,
      x: element.x,
      y: element.y,
      source: element.source,
      target: element.target,
      sourceRef: element.businessObject.sourceRef,
      targetRef: element.businessObject.targetRef,
      defaultFlow: element.businessObject.default
    }))

  const restoreState = (states: readonly ElementState[]): void => {
    for (const state of states) {
      state.element.x = state.x
      state.element.y = state.y
      state.element.source = state.source
      state.element.target = state.target
      state.element.businessObject.sourceRef = state.sourceRef
      state.element.businessObject.targetRef = state.targetRef
      state.element.businessObject.default = state.defaultFlow
    }
  }

  const commandHandlers = new Map<
    string,
    { preExecute?: (context: Record<string, unknown>) => void }
  >()
  const commandHistory: Array<{ before: ElementState[]; after: ElementState[] }> = []
  let commandHistoryIndex = -1
  const commandExecute = vi.fn((command: string, context: Record<string, unknown>) => {
    const handler = commandHandlers.get(command)
    if (!handler) throw new Error(`missing test command handler ${command}`)
    const before = captureState()
    handler.preExecute?.(context)
    commandHistory.splice(commandHistoryIndex + 1)
    commandHistory.push({ before, after: captureState() })
    commandHistoryIndex = commandHistory.length - 1
    emit('commandStack.changed')
  })
  const undo = (): void => {
    const entry = commandHistory[commandHistoryIndex]
    if (!entry) return
    restoreState(entry.before)
    commandHistoryIndex -= 1
    emit('elements.changed')
    emit('commandStack.changed')
  }
  const redo = (): void => {
    const entry = commandHistory[commandHistoryIndex + 1]
    if (!entry) return
    restoreState(entry.after)
    commandHistoryIndex += 1
    emit('elements.changed')
    emit('commandStack.changed')
  }

  const rulesAllowed = vi.fn(
    (
      action: string,
      context: { source?: TestElement; target?: TestElement } = {}
    ): boolean | Record<string, string> => {
      if (action !== 'connection.create' && action !== 'connection.reconnect') return true
      const { source, target } = context
      return source &&
        target &&
        FLOW_NODE_TYPES.has(source.type ?? '') &&
        FLOW_NODE_TYPES.has(target.type ?? '') &&
        source.parent?.id === target.parent?.id
        ? { type: 'bpmn:SequenceFlow' }
        : false
    }
  )

  const services: Record<string, unknown> = {
    elementRegistry: {
      getAll: () => [...elements.values()],
      get: (id: string) => elements.get(id)
    },
    selection: {
      get: () => [...selected],
      select: (element: TestElement | null) => {
        selected.splice(0, selected.length, ...(element ? [element] : []))
        emit('selection.changed')
      }
    },
    canvas: {
      getRootElement: () => root,
      scrollToElement: vi.fn()
    },
    eventBus: {
      on: (event: string, _priority: number, callback: EventCallback) => {
        const bucket = listeners.get(event) ?? new Set<EventCallback>()
        bucket.add(callback)
        listeners.set(event, bucket)
      },
      off: (event: string, callback: EventCallback) => {
        listeners.get(event)?.delete(callback)
      }
    },
    elementFactory: { createShape },
    bpmnFactory: {
      create: (type: string, attributes: Record<string, unknown> = {}) =>
        businessObject(
          type,
          `${type.replace(/^bpmn:/, '')}_${nodeSequence + flowSequence}`,
          attributes
        )
    },
    rules: {
      allowed: rulesAllowed
    },
    commandStack: {
      register: (
        command: string,
        handler: { preExecute?: (context: Record<string, unknown>) => void }
      ) => commandHandlers.set(command, handler),
      execute: commandExecute,
      undo,
      redo
    },
    modeling: {
      createShape: (
        shape: TestElement,
        position: { x: number; y: number },
        parent: TestElement
      ) => {
        shape.parent = parent
        shape.x = position.x
        shape.y = position.y
        elements.set(shape.id, shape)
        emit('elements.changed')
        return shape
      },
      connect: (
        source: TestElement,
        target: TestElement,
        _attributes?: Record<string, unknown>
      ) => {
        const id = `Flow_created_${++flowSequence}`
        const flow = addFlow(id, source.id, target.id)
        emit('elements.changed')
        return flow
      },
      reconnect,
      updateProperties,
      moveShape,
      removeElements,
      removeConnection
    }
  }

  return {
    modeler: {
      get(name: string): unknown {
        const resolved = services[name]
        if (!resolved) throw new Error(`missing test service ${name}`)
        return resolved
      }
    },
    root,
    elements,
    selected,
    scrollToElement: services.canvas
      ? (services.canvas as { scrollToElement: ReturnType<typeof vi.fn> }).scrollToElement
      : vi.fn(),
    updateProperties,
    reconnect,
    moveShape,
    removeElements,
    removeConnection,
    commandExecute,
    rulesAllowed,
    undo,
    redo,
    addNode,
    addFlow,
    emit
  }
}
