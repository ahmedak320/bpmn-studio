import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONNECTION_HOP_RADIUS,
  CONNECTION_JUNCTION_RADIUS,
  OrgConnectionRenderer,
  OrgConnectionRendererModule,
  type EdgeVisualAnalyzer
} from '../orgConnectionRenderer'
import type { EdgeVisualAnalysis, Point } from '../edgeVisuals'

class FakeSvgElement {
  readonly children: FakeSvgElement[] = []
  readonly attributes = new Map<string, string>()
  parentNode: FakeSvgElement | null = null
  removed = false

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
    this.removed = true
    if (!this.parentNode) return
    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) this.parentNode.children.splice(index, 1)
    this.parentNode = null
  }
}

interface TestElement {
  id: string
  type: string
  waypoints?: Point[]
}

function descendants(
  root: FakeSvgElement,
  predicate: (node: FakeSvgElement) => boolean
): FakeSvgElement[] {
  const matches: FakeSvgElement[] = []
  for (const child of root.children) {
    if (predicate(child)) matches.push(child)
    matches.push(...descendants(child, predicate))
  }
  return matches
}

function byVisual(root: FakeSvgElement, visual: string): FakeSvgElement[] {
  return descendants(root, (node) => node.getAttribute('data-org-edge-visual') === visual)
}

function makeWorld(initial: TestElement[] = []) {
  let elements = initial
  const handlers = new Map<string, Array<(event?: unknown) => void>>()
  const eventBus = {
    on(event: string, callback: (event?: unknown) => void) {
      const callbacks = handlers.get(event) ?? []
      callbacks.push(callback)
      handlers.set(event, callbacks)
    }
  }
  const fire = (event: string): void => {
    for (const callback of handlers.get(event) ?? []) callback()
  }
  const layer = new FakeSvgElement('g')
  const canvas = {
    getActiveLayer: () => ({ group: layer as unknown as SVGElement })
  }
  const elementRegistry = {
    getAll: () => elements
  }
  return {
    eventBus,
    fire,
    handlers,
    layer,
    canvas,
    elementRegistry,
    setElements(next: TestElement[]) {
      elements = next
    }
  }
}

function emptyAnalysis(): EdgeVisualAnalysis {
  return { crossings: [], junctions: [] }
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

describe('OrgConnectionRenderer DI and lifecycle', () => {
  it('exports a standalone bpmn-js module with structural service injection', () => {
    expect(OrgConnectionRenderer.$inject).toEqual(['eventBus', 'canvas', 'elementRegistry'])
    expect(OrgConnectionRendererModule.__init__).toEqual(['orgConnectionRenderer'])
    expect(OrgConnectionRendererModule.orgConnectionRenderer).toEqual([
      'type',
      OrgConnectionRenderer
    ])
  })

  it('refreshes only after import/command events and delegates the complete sorted snapshot', () => {
    const originalA: Point[] = [
      { x: 0, y: 10 },
      { x: 30, y: 10 },
      { x: 100, y: 10 }
    ]
    const world = makeWorld([
      {
        id: 'z-note',
        type: 'bpmn:Association',
        waypoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 }
        ]
      },
      {
        id: 'b-flow',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 50, y: 0 },
          { x: 50, y: 100 }
        ]
      },
      { id: 'a-flow', type: 'bpmn:SequenceFlow', waypoints: originalA },
      { id: 'bad-flow', type: 'bpmn:SequenceFlow', waypoints: [{ x: 1, y: 1 }] }
    ])
    const analysis: EdgeVisualAnalysis = {
      crossings: [
        {
          point: { x: 50, y: 10 },
          overEdgeId: 'a-flow',
          underEdgeId: 'b-flow'
        }
      ],
      junctions: []
    }
    const analyzer = vi.fn<EdgeVisualAnalyzer>(() => analysis)
    const renderer = new OrgConnectionRenderer(
      world.eventBus,
      world.canvas,
      world.elementRegistry,
      analyzer
    )

    expect(analyzer).not.toHaveBeenCalled()
    expect([...world.handlers.keys()].sort()).toEqual([
      'commandStack.changed',
      'diagram.clear',
      'import.done'
    ])

    world.fire('import.done')

    expect(analyzer).toHaveBeenCalledTimes(1)
    const delegated = analyzer.mock.calls[0][0]
    expect(delegated.map((edge) => edge.id)).toEqual(['a-flow', 'b-flow'])
    expect(delegated[0].waypoints).toEqual(originalA)
    expect(delegated[0].waypoints).not.toBe(originalA)
    expect([...renderer.getWaypointCache().keys()]).toEqual(['a-flow', 'b-flow'])

    const external = renderer.getWaypointCache().get('a-flow')!
    ;(external[0] as Point).x = 999
    expect(renderer.getWaypointCache().get('a-flow')![0].x).toBe(0)
  })

  it('replaces the overlay and cache after a command, then clears both on diagram.clear', () => {
    const world = makeWorld([
      {
        id: 'old',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 0, y: 0 },
          { x: 20, y: 0 }
        ]
      }
    ])
    const analyzer = vi.fn<EdgeVisualAnalyzer>(() => emptyAnalysis())
    const renderer = new OrgConnectionRenderer(
      world.eventBus,
      world.canvas,
      world.elementRegistry,
      analyzer
    )

    world.fire('import.done')
    const firstRoot = world.layer.children[0]
    expect(firstRoot.getAttribute('class')).toBe('orbitpm-connection-visuals')

    world.setElements([
      {
        id: 'new',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 1, y: 2 },
          { x: 3, y: 4 }
        ]
      }
    ])
    world.fire('commandStack.changed')

    expect(analyzer).toHaveBeenCalledTimes(2)
    expect(firstRoot.removed).toBe(true)
    expect(world.layer.children).toHaveLength(1)
    expect(world.layer.children[0]).not.toBe(firstRoot)
    expect([...renderer.getWaypointCache().keys()]).toEqual(['new'])

    const secondRoot = world.layer.children[0]
    world.fire('diagram.clear')
    expect(secondRoot.removed).toBe(true)
    expect(world.layer.children).toEqual([])
    expect(renderer.getWaypointCache().size).toBe(0)
  })

  it('does not let registry, analyzer, or detached-canvas failures escape lifecycle events', () => {
    const world = makeWorld()
    const analyzer = vi.fn<EdgeVisualAnalyzer>(() => {
      throw new Error('analysis unavailable')
    })
    const renderer = new OrgConnectionRenderer(
      world.eventBus,
      world.canvas,
      world.elementRegistry,
      analyzer
    )

    expect(() => world.fire('import.done')).not.toThrow()
    expect(renderer.getWaypointCache().size).toBe(0)

    const throwingRegistry = {
      getAll(): TestElement[] {
        throw new Error('registry unavailable')
      }
    }
    const second = new OrgConnectionRenderer(
      world.eventBus,
      { getActiveLayer: () => null },
      throwingRegistry
    )
    expect(() => second.refresh()).not.toThrow()
    expect(second.getWaypointCache().size).toBe(0)
  })
})

describe('OrgConnectionRenderer SVG projection', () => {
  it('paints one exact 5px top hop and one deduplicated 3.5px junction dot', () => {
    const world = makeWorld([
      {
        id: 'over',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 0, y: 50 },
          { x: 100, y: 50 }
        ]
      },
      {
        id: 'under',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 50, y: 0 },
          { x: 50, y: 100 }
        ]
      }
    ])
    const analyzer = vi.fn<EdgeVisualAnalyzer>(() => ({
      // A defensive duplicate must not create a second geometric hop.
      crossings: [
        { point: { x: 50, y: 50 }, overEdgeId: 'over', underEdgeId: 'under' },
        { point: { x: 50, y: 50 }, overEdgeId: 'over', underEdgeId: 'under' }
      ],
      // Deduplicate by point, merge IDs, and give split deterministic
      // precedence if a malformed/custom analyzer reports both kinds.
      junctions: [
        { point: { x: 20, y: 50 }, kind: 'merge', edgeIds: ['under', 'third'] },
        { point: { x: 20, y: 50 }, kind: 'split', edgeIds: ['over', 'under'] }
      ]
    }))
    new OrgConnectionRenderer(world.eventBus, world.canvas, world.elementRegistry, analyzer)

    world.fire('import.done')

    expect(world.layer.children).toHaveLength(1)
    const root = world.layer.children[0]
    expect(root.tagName).toBe('g')
    expect(root.getAttribute('class')).toBe('orbitpm-connection-visuals')
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.getAttribute('pointer-events')).toBe('none')
    expect(root.getAttribute('data-org-edge-visuals')).toBe('true')

    const masks = descendants(
      root,
      (node) => node.getAttribute('data-org-edge-hop-mask') === 'true'
    )
    const hops = byVisual(root, 'hop')
    const junctions = byVisual(root, 'junction')
    expect(masks).toHaveLength(1)
    expect(hops).toHaveLength(1)
    expect(junctions).toHaveLength(1)

    expect(masks[0].getAttribute('d')).toBe('M 44 50 L 56 50')
    expect(hops[0].tagName).toBe('path')
    expect(hops[0].getAttribute('d')).toBe('M 45 50 A 5 5 0 0 1 55 50')
    expect(hops[0].getAttribute('data-radius')).toBe(String(CONNECTION_HOP_RADIUS))
    expect(hops[0].getAttribute('data-edge-id')).toBe('over')
    expect(hops[0].getAttribute('data-crossing-edge-id')).toBe('under')

    expect(junctions[0].tagName).toBe('circle')
    expect(junctions[0].getAttribute('r')).toBe(String(CONNECTION_JUNCTION_RADIUS))
    expect(junctions[0].getAttribute('cx')).toBe('20')
    expect(junctions[0].getAttribute('cy')).toBe('50')
    expect(junctions[0].getAttribute('data-junction-kind')).toBe('split-merge')
    expect(junctions[0].getAttribute('data-edge-ids')).toBe('over,third,under')

    // The overlay is an actual child of the active diagram plane, not a
    // diagram-js utility overlay; BaseViewer.saveSVG serializes this layer.
    expect(root.parentNode).toBe(world.layer)
  })

  it('uses the real geometry analyzer for an unrelated crossing and shared source prefix', () => {
    const world = makeWorld([
      {
        id: 'branch-a',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 40 },
          { x: 100, y: 40 }
        ]
      },
      {
        id: 'branch-b',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: -20 }
        ]
      },
      {
        id: 'vertical',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 50, y: 20 },
          { x: 50, y: 60 }
        ]
      }
    ])
    new OrgConnectionRenderer(world.eventBus, world.canvas, world.elementRegistry)

    world.fire('import.done')

    const root = world.layer.children[0]
    const hops = byVisual(root, 'hop')
    const junctions = byVisual(root, 'junction')
    expect(hops).toHaveLength(1)
    expect(hops[0].getAttribute('data-edge-id')).toBe('branch-a')
    expect(hops[0].getAttribute('data-crossing-x')).toBe('50')
    expect(hops[0].getAttribute('data-crossing-y')).toBe('40')
    expect(junctions).toHaveLength(1)
    expect(junctions[0].getAttribute('data-junction-kind')).toBe('split')
    expect(junctions[0].getAttribute('cx')).toBe('20')
    expect(junctions[0].getAttribute('cy')).toBe('0')
  })

  it('supports vertical bridges and ignores an absent over-edge', () => {
    const world = makeWorld([
      {
        id: 'vertical',
        type: 'bpmn:SequenceFlow',
        waypoints: [
          { x: 10, y: 0 },
          { x: 10, y: 20 }
        ]
      }
    ])
    const analyzer = vi.fn<EdgeVisualAnalyzer>(() => ({
      crossings: [
        { point: { x: 10, y: 10 }, overEdgeId: 'vertical', underEdgeId: 'missing' },
        { point: { x: 1, y: 1 }, overEdgeId: 'missing', underEdgeId: 'vertical' }
      ],
      junctions: []
    }))
    new OrgConnectionRenderer(world.eventBus, world.canvas, world.elementRegistry, analyzer)

    world.fire('import.done')

    const hops = byVisual(world.layer.children[0], 'hop')
    expect(hops).toHaveLength(1)
    expect(hops[0].getAttribute('data-edge-id')).toBe('vertical')
    expect(hops[0].getAttribute('d')).toBe('M 10 5 Q 5 10 10 15')
  })
})
