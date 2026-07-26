import { vi } from 'vitest'
import type {
  ProcessOutlineCanvasElement,
  ProcessOutlineModeler,
  ProcessOutlineNodeType
} from '../processOutline'

interface TestBusinessObject {
  $type: string
  $instanceOf(type: string): boolean
  get(name: string): unknown
  id: string
  $attrs?: Record<string, unknown>
  name?: string
  documentation?: Array<Record<string, unknown> & { text?: string }>
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
  'bpmn:Transaction',
  'bpmn:AdHocSubProcess',
  'bpmn:ExclusiveGateway',
  'bpmn:InclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:EventBasedGateway',
  'bpmn:ComplexGateway'
])

function businessObject(
  type: string,
  id: string,
  attributes: Record<string, unknown> = {}
): TestBusinessObject {
  return {
    $type: type,
    id,
    get(name: string): unknown {
      return this[name] ?? this.$attrs?.[name]
    },
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
  updateModdleProperties: ReturnType<typeof vi.fn>
  updateLabel: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
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
  addArtifact(
    id: string,
    type: 'bpmn:TextAnnotation' | 'bpmn:Participant',
    attributes?: Record<string, unknown>
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

  const addArtifact = (
    id: string,
    type: 'bpmn:TextAnnotation' | 'bpmn:Participant',
    attributes: Record<string, unknown> = {}
  ): TestElement => {
    const artifact: TestElement = {
      id,
      type,
      businessObject: businessObject(type, id, attributes),
      parent: root,
      x: 500,
      y: 220,
      width: type === 'bpmn:Participant' ? 600 : 140,
      height: type === 'bpmn:Participant' ? 200 : 60
    }
    elements.set(id, artifact)
    return artifact
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

  const updateModdleProperties = vi.fn(
    (
      _element: ProcessOutlineCanvasElement,
      moddleElement: Record<string, unknown>,
      properties: Record<string, unknown>
    ) => {
      Object.assign(moddleElement, properties)
      emit('elements.changed')
    }
  )

  const updateLabel = vi.fn((element: ProcessOutlineCanvasElement, label: string) => {
    ;(element as TestElement).businessObject.name = label || undefined
    emit('elements.changed')
  })

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

  const createShape = ({ type }: { type: string }): TestElement => {
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
    values: {
      parent: TestElement | undefined
      source: TestElement | undefined
      target: TestElement | undefined
      x: number | undefined
      y: number | undefined
      width: number | undefined
      height: number | undefined
      waypoints: ProcessOutlineCanvasElement['waypoints']
    }
  }

  interface ObjectState {
    target: Record<PropertyKey, unknown> | unknown[]
    entries: Array<[PropertyKey, unknown]>
    arrayValues?: unknown[]
  }

  interface ModelState {
    entries: Array<[string, TestElement]>
    elements: ElementState[]
    objects: ObjectState[]
  }

  const captureObjectGraph = (
    value: unknown,
    states: ObjectState[],
    visited: Set<object>
  ): void => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) {
      states.push({
        target: value,
        entries: [],
        arrayValues: [...value]
      })
      for (const item of value) captureObjectGraph(item, states, visited)
      return
    }
    const target = value as Record<PropertyKey, unknown>
    const entries = Reflect.ownKeys(target).map(
      (key) => [key, target[key]] as [PropertyKey, unknown]
    )
    states.push({ target, entries })
    for (const [, nested] of entries) {
      if (typeof nested !== 'function') captureObjectGraph(nested, states, visited)
    }
  }

  const captureState = (): ModelState => {
    const objectStates: ObjectState[] = []
    const visited = new Set<object>()
    const entries = [...elements.entries()]
    for (const [, element] of entries) {
      captureObjectGraph(element.businessObject, objectStates, visited)
    }
    return {
      entries,
      elements: entries.map(([, element]) => ({
        element,
        values: {
          parent: element.parent,
          source: element.source,
          target: element.target,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          waypoints: element.waypoints ? [...element.waypoints] : undefined
        }
      })),
      objects: objectStates
    }
  }

  const restoreObjectState = (state: ObjectState): void => {
    if (Array.isArray(state.target)) {
      state.target.splice(0, state.target.length, ...(state.arrayValues ?? []))
      return
    }
    const target = state.target
    const expectedKeys = new Set(state.entries.map(([key]) => key))
    for (const key of Reflect.ownKeys(target)) {
      if (expectedKeys.has(key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(target, key)
      if (descriptor?.configurable !== false) delete target[key]
    }
    for (const [key, value] of state.entries) {
      target[key] = value
    }
  }

  const restoreState = (state: ModelState): void => {
    for (const objectState of state.objects) restoreObjectState(objectState)
    elements.clear()
    for (const [id, element] of state.entries) elements.set(id, element)
    for (const elementState of state.elements) {
      Object.assign(elementState.element, elementState.values)
    }
  }

  const commandHandlers = new Map<
    string,
    { preExecute?: (context: Record<string, unknown>) => void }
  >()
  const commandHistory: Array<{ before: ModelState; after: ModelState }> = []
  let commandHistoryIndex = -1
  const commandExecute = vi.fn((command: string, context: Record<string, unknown>) => {
    const handler = commandHandlers.get(command)
    if (!handler) throw new Error(`missing test command handler ${command}`)
    const before = captureState()
    try {
      handler.preExecute?.(context)
    } catch (error) {
      restoreState(before)
      emit('elements.changed')
      emit('commandStack.changed')
      throw error
    }
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

  const connect = vi.fn(
    (source: TestElement, target: TestElement, attributes: Record<string, unknown> = {}) => {
      const id = `Flow_created_${++flowSequence}`
      const requestedType =
        typeof attributes.type === 'string' ? attributes.type : 'bpmn:SequenceFlow'
      const type = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'].includes(
        requestedType
      )
        ? (requestedType as 'bpmn:SequenceFlow' | 'bpmn:MessageFlow' | 'bpmn:Association')
        : 'bpmn:SequenceFlow'
      const flow = addFlow(id, source.id, target.id, { type })
      emit('elements.changed')
      return flow
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
        shapeOrAttributes: TestElement | { type: string },
        position: { x: number; y: number; width?: number; height?: number },
        parent: TestElement
      ) => {
        const shape = 'id' in shapeOrAttributes ? shapeOrAttributes : createShape(shapeOrAttributes)
        shape.parent = parent
        shape.x = position.x
        shape.y = position.y
        if (position.width !== undefined) shape.width = position.width
        if (position.height !== undefined) shape.height = position.height
        elements.set(shape.id, shape)
        emit('elements.changed')
        return shape
      },
      connect,
      reconnect,
      updateProperties,
      updateModdleProperties,
      updateLabel,
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
    updateModdleProperties,
    updateLabel,
    connect,
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
    addArtifact,
    emit
  }
}
