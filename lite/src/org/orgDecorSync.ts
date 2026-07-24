// DI service that keeps the org decorations in step with the diagram itself:
//   * tracks the diagram's majority flow orientation (horizontal vs vertical,
//     via decorExtents.detectOrientation over the sequence flows) and sweeps a
//     full shape repaint whenever the majority axis flips, so side/below
//     blocks migrate to their orientation-correct positions;
//   * repaints a shape whenever its EXTERNAL LABEL changes (move/resize), so
//     the label-cleared below-stack never goes stale.
//
// Registered by OrgRenderModule (org/orgRenderer.ts) and injected into
// OrgRenderer, which asks `getOrientation()` on every drawShape. Typed against
// minimal STRUCTURAL service shapes (never concrete bpmn-js classes) so it is
// unit-testable with plain object fakes in the node vitest environment.

import { detectOrientation, type FlowOrientation } from './decorExtents'
import {
  refreshAllShapes,
  type ElementRegistryLike,
  type GraphicsFactoryLike
} from './orgSettings'

interface DecorSyncElementLike {
  type?: string
  waypoints?: unknown
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

  private recompute(): void {
    let next: FlowOrientation
    try {
      next = detectOrientation(this.registry.getAll())
    } catch {
      return
    }
    if (next === this.current) return
    this.current = next
    // The majority axis flipped: every shape's decorations move, so sweep a
    // full repaint (cheap: one graphicsFactory.update per shape).
    refreshAllShapes(this.registry, this.graphicsFactory)
  }
}
