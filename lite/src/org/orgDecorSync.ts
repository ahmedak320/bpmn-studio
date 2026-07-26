// DI service that keeps the org decorations in step with the diagram itself:
//   * tracks the diagram's majority flow orientation (horizontal vs vertical,
//     via decorExtents.detectOrientation over the sequence flows) together
//     with each shape's local direction and sweeps a full shape repaint
//     whenever the local-direction cache or the fallback axis changes;
//   * repaints a shape whenever its EXTERNAL LABEL changes (move/resize), so
//     the label-cleared below-stack never goes stale.
//
// Registered by OrgRenderModule (org/orgRenderer.ts) and injected into
// OrgRenderer, which asks `getDirectionFor()` on every drawShape. Typed
// against minimal STRUCTURAL service shapes (never concrete bpmn-js classes)
// so it is unit-testable with plain object fakes in the node vitest
// environment.

import {
  computeDecorLayout,
  decorationBoxes,
  detectElementFlowDirection,
  detectOrientation,
  type FlowDirection,
  type FlowOrientation
} from './decorExtents'
import { getOrgProps, type OrgElementLike } from './orgModel'
import { isCompletenessOn } from './orgSettings'
import {
  refreshAllShapes,
  type ElementRegistryLike,
  type GraphicsFactoryLike
} from './orgSettings'

interface DecorSyncElementLike {
  id?: string
  type?: string
  waypoints?: unknown
  incoming?: ReadonlyArray<{ type?: string; waypoints?: unknown }>
  outgoing?: ReadonlyArray<{ type?: string; waypoints?: unknown }>
  x?: number
  y?: number
  width?: number
  height?: number
  businessObject?: OrgElementLike['businessObject']
  /** Present (truthy) on external-label shapes; points at the labelled shape. */
  labelTarget?: DecorSyncElementLike | null
}

interface DecorSyncEventLike {
  element?: DecorSyncElementLike
}

interface DecorSyncEventBusLike {
  on(event: string, callback: (event?: unknown) => void): void
}

export class OrgDecorSync {
  static $inject = ['eventBus', 'elementRegistry', 'graphicsFactory']

  private current: FlowOrientation = 'horizontal'
  private directions = new Map<string, FlowDirection>()
  private flips = new Map<string, boolean>()
  private readonly registry: ElementRegistryLike
  private readonly graphicsFactory: GraphicsFactoryLike

  constructor(
    eventBus: DecorSyncEventBusLike,
    elementRegistry: ElementRegistryLike,
    graphicsFactory: GraphicsFactoryLike
  ) {
    this.registry = elementRegistry
    this.graphicsFactory = graphicsFactory

    const recompute = (): void => this.recompute()
    // `commandStack.changed` fires once per command batch (create / delete /
    // reconnect / waypoint edits / undo / redo) but NOT during import;
    // `import.done` covers the initial load.
    eventBus.on('import.done', recompute)
    eventBus.on('commandStack.changed', recompute)
    eventBus.on('diagram.clear', () => {
      this.current = 'horizontal'
      this.directions.clear()
      this.flips.clear()
    })
    // Label-follows-target repaint: when an external label moves or resizes,
    // re-draw its TARGET so the label-cleared stacks reposition. Repainting
    // the target never mutates the label, so this cannot recurse.
    eventBus.on('element.changed', (event) => {
      const labelTarget = (event as DecorSyncEventLike | undefined)?.element?.labelTarget
      if (!labelTarget) return
      try {
        this.graphicsFactory.update('shape', labelTarget, this.registry.getGraphics(labelTarget))
      } catch {
        /* label without live target graphics — nothing to repaint */
      }
    })
  }

  /** The diagram's current majority flow orientation. */
  getOrientation(): FlowOrientation {
    return this.current
  }

  /** The element's cached local flow direction, or a live safe fallback. */
  getDirectionFor(element: DecorSyncElementLike): FlowDirection {
    const id = typeof element.id === 'string' ? element.id : undefined
    const cached = id ? this.directions.get(id) : undefined
    if (cached) return cached
    try {
      return detectElementFlowDirection(element, this.current)
    } catch {
      return this.current === 'vertical' ? 'down' : 'right'
    }
  }

  /** Whether this element's cross-flow decoration sides are collision-flipped. */
  getFlipFor(element: DecorSyncElementLike): boolean {
    const id = typeof element.id === 'string' ? element.id : undefined
    return id ? this.flips.get(id) === true : false
  }

  private recompute(): void {
    let elements: DecorSyncElementLike[]
    let next: FlowOrientation
    try {
      elements = this.registry.getAll() as DecorSyncElementLike[]
      next = detectOrientation(elements)
    } catch {
      return
    }

    const nextDirections = new Map<string, FlowDirection>()
    for (const element of elements) {
      if (
        typeof element.id !== 'string' ||
        element.waypoints ||
        typeof element.type !== 'string' ||
        !element.type.startsWith('bpmn:') ||
        element.type === 'bpmn:Process'
      ) {
        continue
      }
      let direction: FlowDirection
      try {
        direction = detectElementFlowDirection(element, next)
      } catch {
        direction = next === 'vertical' ? 'down' : 'right'
      }
      nextDirections.set(element.id, direction)
    }

    const nextFlips = this.computeCollisionFlips(elements, next, nextDirections)

    const orientationChanged = next !== this.current
    const directionsChanged =
      nextDirections.size !== this.directions.size ||
      Array.from(nextDirections).some(([id, direction]) => this.directions.get(id) !== direction)
    const flipsChanged =
      nextFlips.size !== this.flips.size ||
      Array.from(nextFlips).some(([id, flipped]) => this.flips.get(id) !== flipped)
    this.current = next
    this.directions = nextDirections
    this.flips = nextFlips
    if (!orientationChanged && !directionsChanged && !flipsChanged) return
    // A fallback-axis or local-direction-cache change can move decorations, so
    // sweep every shape (cheap: one graphicsFactory.update per shape).
    refreshAllShapes(this.registry, this.graphicsFactory)
  }

  private computeCollisionFlips(
    elements: DecorSyncElementLike[],
    orientation: FlowOrientation,
    directions: ReadonlyMap<string, FlowDirection>
  ): Map<string, boolean> {
    interface Rect {
      x: number
      y: number
      w: number
      h: number
    }
    const finiteRect = (element: DecorSyncElementLike): Rect | null => {
      if (
        typeof element.x !== 'number' ||
        typeof element.y !== 'number' ||
        typeof element.width !== 'number' ||
        typeof element.height !== 'number' ||
        !Number.isFinite(element.x) ||
        !Number.isFinite(element.y) ||
        !Number.isFinite(element.width) ||
        !Number.isFinite(element.height)
      ) {
        return null
      }
      return {
        x: element.x,
        y: element.y,
        w: element.width,
        h: element.height
      }
    }
    const isContainer = (type: string | undefined): boolean =>
      type === 'bpmn:Process' ||
      type === 'bpmn:Collaboration' ||
      type === 'bpmn:Participant' ||
      type === 'bpmn:Lane' ||
      type === 'bpmn:Group'
    const overlaps = (a: Rect, b: Rect): number => {
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      return w > 0 && h > 0 ? w * h : 0
    }
    const segmentHits = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      rect: Rect
    ): boolean => {
      if (a.x === b.x) {
        const lo = Math.min(a.y, b.y)
        const hi = Math.max(a.y, b.y)
        return (
          a.x > rect.x &&
          a.x < rect.x + rect.w &&
          lo < rect.y + rect.h &&
          hi > rect.y
        )
      }
      if (a.y === b.y) {
        const lo = Math.min(a.x, b.x)
        const hi = Math.max(a.x, b.x)
        return (
          a.y > rect.y &&
          a.y < rect.y + rect.h &&
          lo < rect.x + rect.w &&
          hi > rect.x
        )
      }
      return false
    }

    const baseObstacles = elements
      .filter(
        (element) =>
          !element.waypoints &&
          !element.labelTarget &&
          !isContainer(element.type)
      )
      .map((element) => ({ element, rect: finiteRect(element) }))
      .filter(
        (item): item is { element: DecorSyncElementLike; rect: Rect } =>
          item.rect !== null
      )
    const connectionSegments: Array<
      readonly [{ x: number; y: number }, { x: number; y: number }]
    > = []
    for (const connection of elements) {
      if (
        connection.type !== 'bpmn:SequenceFlow' ||
        !Array.isArray(connection.waypoints)
      ) {
        continue
      }
      const points = connection.waypoints.filter(
        (value): value is { x: number; y: number } =>
          Boolean(
            value &&
              typeof value === 'object' &&
              typeof (value as { x?: unknown }).x === 'number' &&
              Number.isFinite((value as { x: number }).x) &&
              typeof (value as { y?: unknown }).y === 'number' &&
              Number.isFinite((value as { y: number }).y)
          )
      )
      for (let index = 1; index < points.length; index += 1) {
        connectionSegments.push([points[index - 1], points[index]])
      }
    }

    const result = new Map<string, boolean>()
    for (const { element, rect: base } of baseObstacles) {
      if (
        typeof element.id !== 'string' ||
        typeof element.type !== 'string' ||
        !element.businessObject
      ) {
        continue
      }
      const direction =
        directions.get(element.id) ??
        (orientation === 'vertical' ? 'down' : 'right')
      const score = (flipCrossAxis: boolean): number => {
        let total = 0
        const layout = computeDecorLayout({
          props: getOrgProps(element as OrgElementLike),
          elementType: element.type as string,
          width: base.w,
          height: base.h,
          orientation,
          direction,
          flipCrossAxis,
          completenessOn: isCompletenessOn(),
          labelBox: null
        })
        for (const { box } of decorationBoxes(layout)) {
          const absolute: Rect = {
            x: base.x + box.x,
            y: base.y + box.y,
            w: box.w,
            h: box.h
          }
          for (const other of baseObstacles) {
            if (other.element === element) continue
            total += overlaps(absolute, other.rect) * 10
          }
          for (const [a, b] of connectionSegments) {
            if (segmentHits(a, b, absolute)) total += 10_000
          }
        }
        return total
      }
      const normal = score(false)
      const flipped = score(true)
      result.set(element.id, flipped < normal)
    }
    return result
  }
}
