import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type Selection from 'diagram-js/lib/features/selection/Selection'

import { arisObjectBlockName } from '../conventions/displayNames'
import { arisBusinessObject } from './elements'

interface OverlaysLike {
  add(
    elementId: string,
    type: string,
    overlay: {
      readonly position: { readonly bottom: number; readonly left: number }
      readonly html: HTMLElement
    }
  ): string
  remove(overlayId: string): void
}

interface ElementEvent {
  readonly element?: { readonly id?: string }
}

const ARM_DELAY_MS = 300
const OVERLAY_TYPE = 'aris-type-tooltip'

/** Delayed, non-interactive friendly-type tooltip for occurrence shapes. */
export class ArisHoverTooltip {
  static $inject = ['eventBus', 'overlays', 'elementRegistry', 'selection']

  private armTimer: ReturnType<typeof setTimeout> | null = null
  private armedElementId: string | null = null
  private overlayId: string | null = null
  private overlayElementId: string | null = null
  private dragging = false
  private creating = false

  constructor(
    eventBus: EventBus,
    private readonly overlays: OverlaysLike,
    private readonly elementRegistry: ElementRegistry,
    private readonly selection: Selection
  ) {
    eventBus.on('element.hover', (event: ElementEvent) => this.arm(event.element?.id))
    eventBus.on('element.out', () => this.clear())

    eventBus.on('drag.start', () => {
      this.dragging = true
      this.clear()
    })
    eventBus.on(['drag.end', 'drag.cancel'], () => {
      this.dragging = false
    })
    eventBus.on('create.start', () => {
      this.creating = true
      this.clear()
    })
    eventBus.on(['create.end', 'create.cancel'], () => {
      this.creating = false
    })

    eventBus.on('selection.changed', () => {
      const elementId = this.armedElementId ?? this.overlayElementId
      if (elementId && this.isSelected(elementId)) this.clear()
    })
    eventBus.on(['canvas.viewbox.changed', 'elements.changed'], () => this.clear())
    eventBus.on('diagram.destroy', () => this.clear())
  }

  private arm(elementId: string | undefined): void {
    this.clear()
    if (!elementId || this.dragging || this.creating || this.isSelected(elementId)) return
    const businessObject = arisBusinessObject(this.elementRegistry.get(elementId))
    if (businessObject?.kind !== 'occurrence') return

    this.armedElementId = elementId
    this.armTimer = setTimeout(() => {
      this.armTimer = null
      const armedElementId = this.armedElementId
      this.armedElementId = null
      if (!armedElementId || this.dragging || this.creating || this.isSelected(armedElementId)) {
        return
      }
      this.show(armedElementId)
    }, ARM_DELAY_MS)
  }

  private show(elementId: string): void {
    const businessObject = arisBusinessObject(this.elementRegistry.get(elementId))
    if (businessObject?.kind !== 'occurrence') return

    const tooltip = document.createElement('div')
    tooltip.className = 'aris-type-tip'
    tooltip.dataset.orbitpmArisTypeTip = ''
    tooltip.setAttribute('role', 'tooltip')
    Object.assign(tooltip.style, {
      pointerEvents: 'none',
      display: 'grid',
      gap: '2px',
      maxWidth: '240px',
      padding: '5px 8px',
      border: '1px solid var(--orbitpm-border)',
      borderRadius: '5px',
      background: 'var(--orbitpm-panel-bg)',
      boxShadow: '0 3px 12px rgba(0, 0, 0, 0.2)',
      color: 'var(--orbitpm-fg)',
      fontSize: '12px',
      lineHeight: '1.3',
      whiteSpace: 'normal'
    })
    if (businessObject.name.trim().length > 0) {
      const name = document.createElement('span')
      name.textContent = businessObject.name
      tooltip.append(name)
    }
    const type = document.createElement('span')
    type.textContent = arisObjectBlockName({
      objectType: businessObject.objectType,
      symbolNum: businessObject.symbolNum,
      catalogId: businessObject.catalogId
    })
    tooltip.append(type)

    try {
      this.overlayId = this.overlays.add(elementId, OVERLAY_TYPE, {
        position: { bottom: -6, left: 0 },
        html: tooltip
      })
      this.overlayElementId = elementId
    } catch {
      this.overlayId = null
      this.overlayElementId = null
    }
  }

  private isSelected(elementId: string): boolean {
    return this.selection.get().some((element) => element.id === elementId)
  }

  private clear(): void {
    if (this.armTimer !== null) clearTimeout(this.armTimer)
    this.armTimer = null
    this.armedElementId = null
    if (this.overlayId !== null) this.overlays.remove(this.overlayId)
    this.overlayId = null
    this.overlayElementId = null
  }
}
