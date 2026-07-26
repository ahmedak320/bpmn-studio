// Overlay installer: paints a small "linked" badge on every bpmn:CallActivity
// whose calledElement is set. Runs only in the browser (uses
// document.createElement) — never imported from unit tests, which run in a
// plain node environment.

export interface BadgeElementLike {
  id: string
  type?: string
  businessObject?: { calledElement?: string | null } | null
}

export interface BadgeElementRegistryLike {
  getAll(): BadgeElementLike[]
}

export interface BadgeOverlaysLike {
  add(
    element: unknown,
    overlay: { position: { top: number; right: number }; html: HTMLElement }
  ): string
  remove(overlayId: string): void
}

export interface BadgeEventBusLike {
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

export interface LinkBadgeModeler {
  get(name: 'eventBus'): BadgeEventBusLike
  get(name: 'elementRegistry'): BadgeElementRegistryLike
  get(name: 'overlays'): BadgeOverlaysLike
}

function isLinkedCallActivity(element: BadgeElementLike): boolean {
  if (element.type !== 'bpmn:CallActivity') return false
  const calledElement = element.businessObject?.calledElement
  return Boolean(calledElement && calledElement.trim() !== '')
}

function createBadgeHtml(calledElement: string): HTMLElement {
  const el = document.createElement('div')
  el.textContent = '🔗'
  el.title = calledElement
  el.style.fontSize = '12px'
  el.style.padding = '1px 4px'
  el.style.borderRadius = '6px'
  el.style.background = 'var(--orbitpm-panel-bg, #fff)'
  el.style.border = '1px solid var(--orbitpm-border, #ccc)'
  return el
}

/**
 * Install a resync loop that keeps a "linked" badge overlay on every
 * bpmn:CallActivity with a non-empty calledElement, adding/removing
 * overlays as the diagram changes. Returns an uninstall function that
 * removes the event listeners and any overlays it added.
 */
export function installLinkBadges(modeler: LinkBadgeModeler): () => void {
  const eventBus = modeler.get('eventBus')
  const elementRegistry = modeler.get('elementRegistry')
  const overlays = modeler.get('overlays')

  const overlayIds = new Map<string, string>()

  const sync = (): void => {
    const elements = elementRegistry.getAll()
    const seen = new Set<string>()

    for (const element of elements) {
      if (!isLinkedCallActivity(element)) continue
      seen.add(element.id)
      if (overlayIds.has(element.id)) continue

      const calledElement = element.businessObject?.calledElement ?? ''
      try {
        const overlayId = overlays.add(element, {
          position: { top: -10, right: -10 },
          html: createBadgeHtml(calledElement)
        })
        overlayIds.set(element.id, overlayId)
      } catch {
        // overlay service may reject unknown/detached elements — non-fatal.
      }
    }

    for (const [elementId, overlayId] of overlayIds) {
      if (seen.has(elementId)) continue
      try {
        overlays.remove(overlayId)
      } catch {
        // already gone — non-fatal.
      }
      overlayIds.delete(elementId)
    }
  }

  eventBus.on('import.done', sync)
  eventBus.on('element.changed', sync)
  sync()

  return function uninstall(): void {
    try {
      eventBus.off('import.done', sync)
    } catch {
      // non-fatal.
    }
    try {
      eventBus.off('element.changed', sync)
    } catch {
      // non-fatal.
    }
    for (const overlayId of overlayIds.values()) {
      try {
        overlays.remove(overlayId)
      } catch {
        // non-fatal.
      }
    }
    overlayIds.clear()
  }
}
