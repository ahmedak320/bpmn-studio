import { describe, it, expect } from 'vitest'
import { installLabelBilingualSync } from '../editor/labelSync'
import type { LangToggleModeler } from '../editor/langToggle'

// labelSync.ts is bpmn-js-free — this suite drives it with the same
// recorder-fake style as langToggle.test.ts: a fake eventBus that stores
// handlers, a recording `modeling`, and a canvas root carrying
// `orbitpm:activeLang`. Firing the stored handler with a synthetic
// `commandStack.element.updateLabel.postExecuted` event is exactly what the
// real diagram-js CommandStack does.

interface FakeBusinessObject {
  $type?: string
  name?: string
  $attrs?: Record<string, unknown>
  [key: string]: unknown
}

interface FakeElement {
  id: string
  businessObject?: FakeBusinessObject
  labelTarget?: FakeElement | null
}

interface RecordedUpdate {
  element: unknown
  properties: Record<string, unknown>
}

function makeModeler(opts: { activeLang?: string } = {}) {
  const root: FakeElement = {
    id: 'Process_1',
    businessObject: {
      $type: 'bpmn:Process',
      $attrs: opts.activeLang ? { 'orbitpm:activeLang': opts.activeLang } : {}
    }
  }
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  const offCalls: Array<{ event: string; callback: (event: unknown) => void }> = []
  const eventBus = {
    on: (event: string, callback: (event: unknown) => void) => {
      const list = handlers.get(event) ?? []
      list.push(callback)
      handlers.set(event, list)
    },
    off: (event: string, callback: (event: unknown) => void) => {
      offCalls.push({ event, callback })
      const list = handlers.get(event) ?? []
      handlers.set(
        event,
        list.filter((cb) => cb !== callback)
      )
    }
  }
  const rec: RecordedUpdate[] = []
  const modeling = {
    updateProperties: (element: unknown, properties: Record<string, unknown>) => {
      rec.push({ element, properties })
    }
  }
  const modeler: LangToggleModeler = {
    get(name: string): unknown {
      switch (name) {
        case 'eventBus':
          return eventBus
        case 'modeling':
          return modeling
        case 'canvas':
          return { getRootElement: () => root }
        default:
          throw new Error('unexpected service ' + name)
      }
    }
  }
  const fire = (event: string, payload: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(payload)
  }
  const handlerCount = (event: string) => (handlers.get(event) ?? []).length
  return { modeler, rec, fire, offCalls, handlerCount }
}

const EVENT = 'commandStack.element.updateLabel.postExecuted'

describe('installLabelBilingualSync', () => {
  it('subscribes to the updateLabel postExecuted event on install', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    expect(world.handlerCount(EVENT)).toBe(1)
  })

  it('mirrors a fresh label edit into the active-language attr (en default)', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: { $type: 'bpmn:Task', name: 'Review request', $attrs: {} }
    }
    world.fire(EVENT, { context: { element: task } })
    expect(world.rec).toEqual([
      { element: task, properties: { 'orbitpm:nameEn': 'Review request' } }
    ])
  })

  it('writes the ar attr when the diagram is in Arabic', () => {
    const world = makeModeler({ activeLang: 'ar' })
    installLabelBilingualSync(world.modeler)
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: { $type: 'bpmn:Task', name: 'مراجعة الطلب', $attrs: {} }
    }
    world.fire(EVENT, { context: { element: task } })
    expect(world.rec).toEqual([
      { element: task, properties: { 'orbitpm:nameAr': 'مراجعة الطلب' } }
    ])
  })

  it('resolves a LABEL shape to its labelTarget and writes onto the target', () => {
    const world = makeModeler()
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: { $type: 'bpmn:Task', name: 'Ship', $attrs: {} }
    }
    const label: FakeElement = {
      id: 'Task_1_label',
      businessObject: task.businessObject,
      labelTarget: task
    }
    installLabelBilingualSync(world.modeler)
    world.fire(EVENT, { context: { element: label } })
    expect(world.rec).toHaveLength(1)
    expect(world.rec[0].element).toBe(task) // the TARGET, never the label shape
    expect(world.rec[0].properties).toEqual({ 'orbitpm:nameEn': 'Ship' })
  })

  it('does NOT write when the visible name already matches the stored attr', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: {
        $type: 'bpmn:Task',
        name: 'Review',
        $attrs: { 'orbitpm:nameEn': 'Review' }
      }
    }
    world.fire(EVENT, { context: { element: task } })
    expect(world.rec).toHaveLength(0)
  })

  it('does NOT write for an emptied label (stored translation preserved)', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: {
        $type: 'bpmn:Task',
        name: '',
        $attrs: { 'orbitpm:nameEn': 'Review', 'orbitpm:nameAr': 'مراجعة' }
      }
    }
    world.fire(EVENT, { context: { element: task } })
    expect(world.rec).toHaveLength(0)
  })

  it('is naturally inert for TextAnnotations (label attr is `text`, name reads empty)', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    const note: FakeElement = {
      id: 'Note_1',
      businessObject: { $type: 'bpmn:TextAnnotation', text: 'A remark', $attrs: {} }
    }
    world.fire(EVENT, { context: { element: note } })
    expect(world.rec).toHaveLength(0)
  })

  it('tolerates malformed events and a missing business object', () => {
    const world = makeModeler()
    installLabelBilingualSync(world.modeler)
    expect(() => {
      world.fire(EVENT, undefined)
      world.fire(EVENT, {})
      world.fire(EVENT, { context: {} })
      world.fire(EVENT, { context: { element: { id: 'X' } } })
    }).not.toThrow()
    expect(world.rec).toHaveLength(0)
  })

  it('uninstall unsubscribes the exact handler via eventBus.off', () => {
    const world = makeModeler()
    const uninstall = installLabelBilingualSync(world.modeler)
    expect(world.handlerCount(EVENT)).toBe(1)
    uninstall()
    expect(world.offCalls).toHaveLength(1)
    expect(world.offCalls[0].event).toBe(EVENT)
    expect(world.handlerCount(EVENT)).toBe(0)
    // and the handler really is gone
    const task: FakeElement = {
      id: 'Task_1',
      businessObject: { $type: 'bpmn:Task', name: 'After uninstall', $attrs: {} }
    }
    world.fire(EVENT, { context: { element: task } })
    expect(world.rec).toHaveLength(0)
  })
})
