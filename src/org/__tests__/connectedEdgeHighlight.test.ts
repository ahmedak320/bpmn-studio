import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONNECTED_EDGE_HIGHLIGHT_LAYER,
  CONNECTED_EDGE_HIGHLIGHT_LAYER_INDEX,
  CONNECTED_EDGE_HIGHLIGHT_WIDTH,
  CONNECTED_EDGE_HIGHLIGHT_COLORS,
  ConnectedEdgeHighlight,
  ConnectedEdgeHighlightModule,
  connectedEdgesForSelection,
  type ConnectedActivityLike,
  type ConnectedEdgeLike
} from '../connectedEdgeHighlight'
import { PALETTE } from '../palette'

class FakeSvgElement {
  readonly children: FakeSvgElement[] = []
  readonly attributes = new Map<string, string>()
  parentNode: FakeSvgElement | null = null

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  appendChild(child: FakeSvgElement): FakeSvgElement {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  remove(): void {
    if (!this.parentNode) return
    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) this.parentNode.children.splice(index, 1)
    this.parentNode = null
  }
}

function edge(id?: string): ConnectedEdgeLike {
  return id ? { id } : {}
}

function activity(
  incoming: ConnectedEdgeLike[] = [],
  outgoing: ConnectedEdgeLike[] = []
): ConnectedActivityLike {
  return { id: 'Task_1', type: 'bpmn:Task', incoming, outgoing } as ConnectedActivityLike
}

function makeWorld(initialSelection: unknown[] = []) {
  let selected = initialSelection
  const handlers = new Map<string, Array<(event?: unknown) => void>>()
  const eventBus = {
    on(name: string, callback: (event?: unknown) => void) {
      const callbacks = handlers.get(name) ?? []
      callbacks.push(callback)
      handlers.set(name, callbacks)
    }
  }
  const fire = (name: string, event?: unknown): void => {
    for (const callback of handlers.get(name) ?? []) callback(event)
  }
  const layer = new FakeSvgElement('g')
  const getLayer = vi.fn(() => layer as unknown as SVGElement)
  const canvas = { getLayer }
  const drawConnection = vi.fn(
    (parent: SVGElement, _connection: ConnectedEdgeLike, _attrs?: Record<string, unknown>) => {
      const path = new FakeSvgElement('path')
      ;(parent as unknown as FakeSvgElement).appendChild(path)
      return path as unknown as SVGElement
    }
  )
  const graphicsFactory = { drawConnection }
  const selection = { get: vi.fn(() => selected) }

  return {
    eventBus,
    fire,
    handlers,
    layer,
    canvas,
    graphicsFactory,
    drawConnection,
    selection,
    setSelection(next: unknown[]) {
      selected = next
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElementNS: (_namespace: string, tag: string) =>
      new FakeSvgElement(tag) as unknown as SVGElement
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('connectedEdgesForSelection', () => {
  it('returns the stable incoming/outgoing union for exactly one activity', () => {
    const incomingA = edge('Flow_In_A')
    const incomingB = edge('Flow_In_B')
    const outgoing = edge('Flow_Out')

    expect(connectedEdgesForSelection([activity([incomingA, incomingB], [outgoing])])).toEqual([
      incomingA,
      incomingB,
      outgoing
    ])
  })

  it('deduplicates a self-loop by object identity and by edge ID', () => {
    const loop = edge('Flow_Loop')
    const duplicateWrapper = edge('Flow_Loop')
    const anonymous = edge()

    expect(
      connectedEdgesForSelection([activity([loop, anonymous], [loop, duplicateWrapper, anonymous])])
    ).toEqual([loop, anonymous])
  })

  it('accepts semantic activity inheritance when the concrete type is custom', () => {
    const flow = edge('Flow_Custom')
    const selected = {
      type: 'vendor:SpecialStep',
      businessObject: {
        $instanceOf: (type: string) => type === 'bpmn:Activity'
      },
      outgoing: [flow]
    }

    expect(connectedEdgesForSelection([selected])).toEqual([flow])
  })

  it.each([
    ['empty', []],
    ['multiple', [activity(), activity()]],
    ['event', [{ type: 'bpmn:StartEvent', outgoing: [edge('F')] }]],
    ['gateway', [{ type: 'bpmn:ExclusiveGateway', outgoing: [edge('F')] }]],
    ['process root', [{ type: 'bpmn:Process', outgoing: [edge('F')] }]],
    ['collaboration root', [{ type: 'bpmn:Collaboration', outgoing: [edge('F')] }]],
    ['connection', [{ type: 'bpmn:SequenceFlow', waypoints: [], outgoing: [edge('F')] }]],
    ['external label', [{ type: 'bpmn:Task', labelTarget: {}, outgoing: [edge('F')] }]]
  ])('clears for a %s selection', (_label, selection) => {
    expect(connectedEdgesForSelection(selection)).toEqual([])
  })

  it('is defensive around absent selection and malformed edge lists', () => {
    expect(connectedEdgesForSelection(undefined)).toEqual([])
    expect(
      connectedEdgesForSelection([
        { type: 'bpmn:Task', incoming: 'not-an-array', outgoing: [null, edge('valid')] }
      ])
    ).toEqual([{ id: 'valid' }])
  })
})

describe('ConnectedEdgeHighlight DI service', () => {
  it('exports a structural bpmn-js module and subscribes to every repaint/clear event', () => {
    const world = makeWorld()
    new ConnectedEdgeHighlight(world.eventBus, world.canvas, world.graphicsFactory, world.selection)

    expect(ConnectedEdgeHighlight.$inject).toEqual([
      'eventBus',
      'canvas',
      'graphicsFactory',
      'selection'
    ])
    expect(ConnectedEdgeHighlightModule).toEqual({
      __init__: ['connectedEdgeHighlight'],
      connectedEdgeHighlight: ['type', ConnectedEdgeHighlight]
    })
    expect([...world.handlers.keys()].sort()).toEqual([
      'commandStack.changed',
      'diagram.clear',
      'import.done',
      'selection.changed'
    ])
  })

  it('renders non-interactive edge-ID wrappers on the named upper layer', () => {
    const incoming = edge('Flow_In')
    const outgoing = edge('Flow_Out')
    const world = makeWorld()
    new ConnectedEdgeHighlight(world.eventBus, world.canvas, world.graphicsFactory, world.selection)

    world.fire('selection.changed', {
      newSelection: [activity([incoming], [outgoing])]
    })

    expect(world.canvas.getLayer).toHaveBeenCalledWith(
      CONNECTED_EDGE_HIGHLIGHT_LAYER,
      CONNECTED_EDGE_HIGHLIGHT_LAYER_INDEX
    )
    expect(world.layer.getAttribute('data-org-connected-edge-highlights')).toBe('true')
    expect(world.layer.getAttribute('pointer-events')).toBe('none')
    expect(world.layer.getAttribute('aria-hidden')).toBe('true')
    expect(world.layer.children).toHaveLength(2)
    expect(world.layer.children.map((wrapper) => wrapper.getAttribute('data-edge-id'))).toEqual([
      'Flow_In',
      'Flow_Out'
    ])

    for (const wrapper of world.layer.children) {
      expect(wrapper.getAttribute('class')).toBe('orbitpm-connected-edge-highlight')
      expect(wrapper.getAttribute('data-org-connected-edge-highlight')).toBe('true')
      expect(wrapper.getAttribute('pointer-events')).toBe('none')
      expect(wrapper.getAttribute('aria-hidden')).toBe('true')
      const route = wrapper.children[0]
      expect(route.getAttribute('stroke-width')).toBe(String(CONNECTED_EDGE_HIGHLIGHT_WIDTH))
      expect(route.getAttribute('data-org-highlight-route')).toBe('true')
      expect(route.getAttribute('marker-end')).toMatch(/^url\(#orbitpm-highlight-arrow-/)
      const defs = wrapper.children[1]
      expect(defs.tagName).toBe('defs')
      const arrow = defs.children[0].children[0]
      expect(arrow.getAttribute('fill')).toBe(wrapper.getAttribute('data-highlight-color'))
      expect(arrow.getAttribute('stroke')).toBe(wrapper.getAttribute('data-highlight-color'))
    }

    expect(world.drawConnection).toHaveBeenNthCalledWith(1, expect.anything(), incoming, {
      stroke: PALETTE.edgeHighlightStroke,
      strokeWidth: CONNECTED_EDGE_HIGHLIGHT_WIDTH
    })
    expect(world.drawConnection).toHaveBeenNthCalledWith(2, expect.anything(), outgoing, {
      stroke: CONNECTED_EDGE_HIGHLIGHT_COLORS[1],
      strokeWidth: CONNECTED_EDGE_HIGHLIGHT_WIDTH
    })
    expect(world.layer.children[0].getAttribute('data-highlight-pattern')).toBe('solid')
    expect(world.layer.children[1].getAttribute('data-highlight-pattern')).toBe('10 6')
  })

  it('clears on empty/multi/non-activity selection without creating a layer', () => {
    const world = makeWorld()
    new ConnectedEdgeHighlight(world.eventBus, world.canvas, world.graphicsFactory, world.selection)

    world.fire('selection.changed', { newSelection: [activity([], [edge('Flow')])] })
    expect(world.layer.children).toHaveLength(1)

    for (const next of [
      [],
      [activity(), activity()],
      [{ type: 'bpmn:ExclusiveGateway', incoming: [edge('Other')] }]
    ]) {
      world.fire('selection.changed', { newSelection: next })
      expect(world.layer.children).toEqual([])
    }
    expect(world.canvas.getLayer).toHaveBeenCalledTimes(1)
  })

  it('repaints live routes on commands/import and clears on diagram.clear', () => {
    const oldEdge = edge('Flow_Old')
    const newEdge = edge('Flow_New')
    const world = makeWorld([activity([], [oldEdge])])
    new ConnectedEdgeHighlight(world.eventBus, world.canvas, world.graphicsFactory, world.selection)

    world.fire('import.done')
    const oldWrapper = world.layer.children[0]
    expect(oldWrapper.getAttribute('data-edge-id')).toBe('Flow_Old')

    world.setSelection([activity([newEdge])])
    world.fire('commandStack.changed')
    expect(oldWrapper.parentNode).toBeNull()
    expect(world.layer.children).toHaveLength(1)
    expect(world.layer.children[0].getAttribute('data-edge-id')).toBe('Flow_New')
    expect(world.drawConnection).toHaveBeenCalledTimes(2)

    world.fire('diagram.clear')
    expect(world.layer.children).toEqual([])
  })

  it('does not let unavailable services or one malformed edge break lifecycle events', () => {
    const good = edge('Flow_Good')
    const bad = edge('Flow_Bad')
    const world = makeWorld([activity([], [bad, good])])
    world.drawConnection.mockImplementation((parent: SVGElement, connection: ConnectedEdgeLike) => {
      if (connection === bad) throw new Error('cannot render')
      const path = new FakeSvgElement('path')
      ;(parent as unknown as FakeSvgElement).appendChild(path)
      return path as unknown as SVGElement
    })
    new ConnectedEdgeHighlight(world.eventBus, world.canvas, world.graphicsFactory, world.selection)

    expect(() => world.fire('import.done')).not.toThrow()
    expect(world.layer.children).toHaveLength(1)
    expect(world.layer.children[0].getAttribute('data-edge-id')).toBe('Flow_Good')

    const broken = makeWorld()
    broken.selection.get.mockImplementation(() => {
      throw new Error('selection unavailable')
    })
    broken.canvas.getLayer.mockImplementation(() => {
      throw new Error('canvas unavailable')
    })
    const service = new ConnectedEdgeHighlight(
      broken.eventBus,
      broken.canvas,
      broken.graphicsFactory,
      broken.selection
    )
    expect(() => service.refresh([activity([], [edge('Flow')])])).not.toThrow()
    expect(() => broken.fire('commandStack.changed')).not.toThrow()
  })
})
