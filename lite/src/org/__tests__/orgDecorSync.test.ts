import { describe, it, expect } from 'vitest'
import { OrgDecorSync } from '../orgDecorSync'
import { refreshAllShapes } from '../orgSettings'

// OrgDecorSync is bpmn-js-free — driven here entirely through hand-rolled
// fakes for eventBus / elementRegistry / graphicsFactory (same recorder style
// as the langToggle suite).

interface FakeElement {
  id: string
  type?: string
  waypoints?: unknown
  incoming?: FakeElement[]
  outgoing?: FakeElement[]
  labelTarget?: FakeElement | null
}

function makeWorld(initial: FakeElement[] = []) {
  const handlers = new Map<string, Array<(event?: unknown) => void>>()
  const eventBus = {
    on: (event: string, callback: (event?: unknown) => void) => {
      const list = handlers.get(event) ?? []
      list.push(callback)
      handlers.set(event, list)
    }
  }
  const fire = (event: string, payload?: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(payload)
  }
  let elements = initial
  const registry = {
    getAll: () => elements,
    getGraphics: (el: unknown) => ({ gfxFor: (el as FakeElement).id })
  }
  const updates: Array<{ type: string; element: unknown }> = []
  const graphicsFactory = {
    update: (type: 'shape' | 'connection', element: unknown) => {
      updates.push({ type, element })
    }
  }
  const setElements = (next: FakeElement[]) => {
    elements = next
  }
  return { eventBus, fire, registry, graphicsFactory, updates, setElements }
}

function verticalFlow(id: string): FakeElement {
  return {
    id,
    type: 'bpmn:SequenceFlow',
    waypoints: [
      { x: 0, y: 0 },
      { x: 0, y: 150 }
    ]
  }
}

function horizontalFlow(id: string): FakeElement {
  return {
    id,
    type: 'bpmn:SequenceFlow',
    waypoints: [
      { x: 0, y: 0 },
      { x: 150, y: 0 }
    ]
  }
}

function directedFlow(id: string, dx: number, dy: number): FakeElement {
  return {
    id,
    type: 'bpmn:SequenceFlow',
    waypoints: [
      { x: 50, y: 50 },
      { x: 50 + dx, y: 50 + dy }
    ]
  }
}

describe('OrgDecorSync', () => {
  it('starts horizontal and recomputes on import.done', () => {
    const world = makeWorld([verticalFlow('F1'), { id: 'T1', type: 'bpmn:Task' }])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)
    expect(sync.getOrientation()).toBe('horizontal')

    world.fire('import.done')
    expect(sync.getOrientation()).toBe('vertical')
    // orientation flip -> full shape sweep (the task, not the connection)
    expect(world.updates).toEqual([{ type: 'shape', element: world.registry.getAll()[1] }])
  })

  it('recomputes on commandStack.changed and skips sweeps when nothing changed', () => {
    const task: FakeElement = { id: 'T1', type: 'bpmn:Task' }
    const world = makeWorld([horizontalFlow('F1'), task])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    world.fire('commandStack.changed')
    expect(sync.getOrientation()).toBe('horizontal')
    // Initial cache population repaints once: import/command events are where
    // final incoming/outgoing topology becomes authoritative.
    expect(world.updates).toEqual([{ type: 'shape', element: task }])

    world.setElements([verticalFlow('F1'), verticalFlow('F2'), task])
    world.fire('commandStack.changed')
    expect(sync.getOrientation()).toBe('vertical')
    expect(world.updates).toEqual([
      { type: 'shape', element: task },
      { type: 'shape', element: task }
    ])

    world.fire('commandStack.changed') // still vertical -> no extra sweep
    expect(world.updates).toHaveLength(2)
  })

  it('the sweep skips connections, the process root and non-bpmn elements', () => {
    const task: FakeElement = { id: 'T1', type: 'bpmn:Task' }
    const gateway: FakeElement = { id: 'G1', type: 'bpmn:ExclusiveGateway' }
    const world = makeWorld([
      verticalFlow('F1'),
      { id: 'P1', type: 'bpmn:Process' },
      { id: 'L1', type: 'label' },
      task,
      gateway
    ])
    new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)
    world.fire('import.done')
    expect(world.updates.map((u) => (u.element as FakeElement).id)).toEqual(['T1', 'G1'])
  })

  it('diagram.clear resets to horizontal without sweeping', () => {
    const world = makeWorld([verticalFlow('F1')])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)
    world.fire('import.done')
    expect(sync.getOrientation()).toBe('vertical')
    const updatesBefore = world.updates.length

    world.fire('diagram.clear')
    expect(sync.getOrientation()).toBe('horizontal')
    expect(world.updates).toHaveLength(updatesBefore)
  })

  it.each([
    ['right', 80, 0],
    ['down', 0, 80],
    ['left', -80, 0],
    ['up', 0, -80]
  ] as const)('caches an element-local %s flow direction', (expected, dx, dy) => {
    const connection = directedFlow(`F_${expected}`, dx, dy)
    const task: FakeElement = {
      id: 'T1',
      type: 'bpmn:Task',
      outgoing: [connection]
    }
    const world = makeWorld([horizontalFlow('global-horizontal'), connection, task])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    world.fire('import.done')
    expect(sync.getDirectionFor(task)).toBe(expected)
    expect(world.updates).toEqual([{ type: 'shape', element: task }])
  })

  it('falls back to the current majority orientation for isolated elements', () => {
    const task: FakeElement = { id: 'T1', type: 'bpmn:Task' }
    const world = makeWorld([verticalFlow('F1'), task])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    expect(sync.getDirectionFor(task)).toBe('right')
    world.fire('import.done')
    expect(sync.getOrientation()).toBe('vertical')
    expect(sync.getDirectionFor(task)).toBe('down')
  })

  it('sweeps when a cached element direction changes without a global axis flip', () => {
    const local = directedFlow('local', 80, 0)
    const task: FakeElement = {
      id: 'T1',
      type: 'bpmn:Task',
      outgoing: [local]
    }
    const world = makeWorld([horizontalFlow('global-horizontal'), local, task])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    world.fire('import.done')
    expect(sync.getDirectionFor(task)).toBe('right')
    expect(world.updates).toEqual([{ type: 'shape', element: task }])
    world.updates.length = 0

    local.waypoints = directedFlow('changed', 0, 80).waypoints
    world.fire('commandStack.changed')
    expect(sync.getOrientation()).toBe('horizontal')
    expect(sync.getDirectionFor(task)).toBe('down')
    expect(world.updates).toEqual([{ type: 'shape', element: task }])
  })

  it('diagram.clear drops cached element directions', () => {
    const local = directedFlow('local', -80, 0)
    const task: FakeElement = {
      id: 'T1',
      type: 'bpmn:Task',
      outgoing: [local]
    }
    const world = makeWorld([local, task])
    const sync = new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    world.fire('import.done')
    expect(sync.getDirectionFor(task)).toBe('left')

    world.fire('diagram.clear')
    local.waypoints = directedFlow('changed', 80, 0).waypoints
    expect(sync.getDirectionFor(task)).toBe('right')
  })

  it('element.changed on an external label repaints its TARGET shape', () => {
    const task: FakeElement = { id: 'T1', type: 'bpmn:Task' }
    const label: FakeElement = { id: 'T1_label', type: 'label', labelTarget: task }
    const world = makeWorld([task, label])
    new OrgDecorSync(world.eventBus, world.registry, world.graphicsFactory)

    world.fire('element.changed', { element: label })
    expect(world.updates).toEqual([{ type: 'shape', element: task }])

    // a non-label change does nothing
    world.fire('element.changed', { element: task })
    world.fire('element.changed', {})
    world.fire('element.changed')
    expect(world.updates).toHaveLength(1)
  })

  it('survives a throwing registry (recompute + label repaint are both guarded)', () => {
    const world = makeWorld()
    const throwingRegistry = {
      getAll: () => {
        throw new Error('boom')
      },
      getGraphics: () => {
        throw new Error('boom')
      }
    }
    const sync = new OrgDecorSync(world.eventBus, throwingRegistry, world.graphicsFactory)
    expect(() => world.fire('import.done')).not.toThrow()
    expect(() =>
      world.fire('element.changed', { element: { labelTarget: { id: 'X' } } })
    ).not.toThrow()
    expect(sync.getOrientation()).toBe('horizontal')
  })
})

// refreshAllShapes stays directly exercisable for the settings path too.
describe('refreshAllShapes (factored out of refreshOrgStyling)', () => {
  it('updates every bpmn shape, skipping connections / process / non-bpmn', () => {
    const elements = [
      { type: 'bpmn:Task' },
      { type: 'bpmn:SequenceFlow', waypoints: [] },
      { type: 'bpmn:Process' },
      { type: 'label' },
      { type: 'bpmn:StartEvent' }
    ]
    const updated: unknown[] = []
    refreshAllShapes(
      { getAll: () => elements, getGraphics: (el) => el },
      { update: (_type, element) => void updated.push(element) }
    )
    expect(updated).toEqual([elements[0], elements[4]])
  })

  it('a single throwing element does not abort the sweep', () => {
    const elements = [{ type: 'bpmn:Task', boom: true }, { type: 'bpmn:UserTask' }]
    const updated: unknown[] = []
    refreshAllShapes(
      {
        getAll: () => elements,
        getGraphics: (el) => {
          if ((el as { boom?: boolean }).boom) throw new Error('no gfx')
          return el
        }
      },
      { update: (_type, element) => void updated.push(element) }
    )
    expect(updated).toEqual([elements[1]])
  })
})
