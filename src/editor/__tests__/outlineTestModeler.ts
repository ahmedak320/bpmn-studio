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
    options?: { name?: string; condition?: string; isDefault?: boolean }
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
    options: { name?: string; condition?: string; isDefault?: boolean } = {}
  ): TestElement => {
    const source = elements.get(sourceId)
    const target = elements.get(targetId)
    if (!source || !target) throw new Error('test flow endpoint missing')
    flowSequence += 1
    const flowBusinessObject = businessObject('bpmn:SequenceFlow', id, {
      name: options.name || undefined,
      sourceRef: source.businessObject,
      targetRef: target.businessObject,
      conditionExpression: options.condition ? { body: options.condition } : undefined
    })
    const flow: TestElement = {
      id,
      type: 'bpmn:SequenceFlow',
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
    addNode,
    addFlow,
    emit
  }
}
