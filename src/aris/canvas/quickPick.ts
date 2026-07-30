/**
 * Post-placement quick-pick popover (Lane C4).
 *
 * When a shape whose symbol belongs to a variant *family* is placed, a small
 * radio menu opens beside it offering the family's other symbols. Picking a
 * same-object-type member swaps the occurrence's symbol in place
 * (`setOccurrenceSymbol`); picking a cross-object-type member replaces the whole
 * object (`replaceNewObject`) — but only while that is safe (a fresh, unshared,
 * unconnected shape), otherwise the member is shown disabled with a tooltip.
 *
 * ## Focus
 *
 * The menu is meant to be used *while the inline label editor is open* (it
 * opens on `create.end`, right as direct editing activates). Its buttons act on
 * `pointerdown` and `preventDefault()` so the `.djs-direct-editing-content`
 * textbox never loses focus — the user can pick a symbol and keep typing the
 * caption without a second click.
 *
 * The menu is dismissed on outside click, selection change, Escape, or when it
 * is re-opened for another shape.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type Selection from 'diagram-js/lib/features/selection/Selection'
import type { Element } from 'diagram-js/lib/model/Types'

import { t, type Key } from '../../i18n'
import { ARIS_CONVENTION_SYMBOLS, conventionSymbol } from '../conventions'
import type { ArisAuthoring } from './authoring'
import { arisBusinessObject } from './elements'
import { arisPaletteGlyph } from './paletteProvider'

/** Structural view of diagram-js Overlays (didi-injected; no exported class type). */
interface OverlaysLike {
  add(
    element: string,
    type: string,
    overlay: {
      readonly position: { readonly right: number; readonly top: number }
      readonly show?: { readonly minZoom: number }
      readonly html: HTMLElement
    }
  ): string
  remove(id: string): void
}

export const ARIS_QUICK_PICK_OVERLAY_TYPE = 'aris-quick-pick'

export interface ArisQuickPickMember {
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly enabled: boolean
  readonly active: boolean
}

interface OpenState {
  readonly elementId: string
  readonly overlayId: string
  readonly popover: HTMLElement
  readonly onDocumentPointerDown: (event: Event) => void
  readonly onDocumentKeyDown: (event: KeyboardEvent) => void
}

export class ArisQuickPick {
  static $inject = [
    'overlays',
    'eventBus',
    'elementRegistry',
    'selection',
    'canvas',
    'arisAuthoring'
  ]

  private open_: OpenState | null = null

  constructor(
    private readonly overlays: OverlaysLike,
    eventBus: EventBus,
    private readonly elementRegistry: ElementRegistry,
    private readonly selection: Selection,
    private readonly canvas: Canvas,
    private readonly authoring: ArisAuthoring
  ) {
    // Open right after a shape is placed, above direct editing's own
    // `create.end` handler (priority 250) so the popover exists before the
    // textbox activates and can co-exist with it.
    eventBus.on('create.end', 260, (event: unknown) => {
      const context = property(event, 'context')
      if (property(context, 'canExecute') === false) return
      const shape = property<{ id?: string }>(context, 'shape')
      if (!shape || typeof shape.id !== 'string') return
      const shapeId = shape.id
      // The create gesture is still settling; defer so the element is committed.
      setTimeout(() => this.open(shapeId), 0)
    })

    // Any selection change or model re-render dismisses the menu.
    eventBus.on('selection.changed', () => this.close())
  }

  /** The swap candidates for an occurrence, active member first. */
  membersFor(elementId: string): readonly ArisQuickPickMember[] {
    const businessObject = arisBusinessObject(this.elementRegistry.get(elementId))
    if (!businessObject || businessObject.kind !== 'occurrence') return Object.freeze([])
    const { objectType, symbolNum } = businessObject
    const current = conventionSymbol(objectType, symbolNum)
    if (!current || current.family === null) return Object.freeze([])

    const canReplace = this.authoring.canReplaceNewObject(elementId)
    const members: ArisQuickPickMember[] = [
      { objectType, symbolNum, labelKey: current.labelKey, enabled: true, active: true }
    ]
    // The whole convention family, across object types: same-object-type rows
    // are an in-place symbol swap (always safe); other object types are a guarded
    // cross-type replace. The active row (and any duplicate of it) is skipped.
    for (const peer of ARIS_CONVENTION_SYMBOLS) {
      if (peer.family !== current.family) continue
      if (peer.objectType === objectType && peer.symbolNum === symbolNum) continue
      const sameType = peer.objectType === objectType
      members.push({
        objectType: peer.objectType,
        symbolNum: peer.symbolNum,
        labelKey: peer.labelKey,
        enabled: sameType ? true : canReplace,
        active: false
      })
    }
    return Object.freeze(members)
  }

  /** Open the menu beside `elementId`, replacing any menu already open. */
  open(elementId: string): void {
    this.close()
    if (!this.elementRegistry.get(elementId)) return
    const members = this.membersFor(elementId)
    // Only a symbol with at least one alternative is worth a menu.
    if (members.length <= 1) return

    const popover = this.buildPopover(elementId, members)
    let overlayId: string
    try {
      overlayId = this.overlays.add(elementId, ARIS_QUICK_PICK_OVERLAY_TYPE, {
        position: { right: -8, top: 0 },
        show: { minZoom: 0.4 },
        html: popover
      })
    } catch {
      // Detached/unknown element — non-fatal, mirrors the validation overlays.
      return
    }

    const onDocumentPointerDown = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && popover.contains(target)) return
      this.close()
    }
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') this.close()
    }
    // Capture phase so an outside click closes the menu before it lands.
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)

    this.open_ = { elementId, overlayId, popover, onDocumentPointerDown, onDocumentKeyDown }
  }

  /** Dismiss the menu if one is open. Idempotent. */
  close(): void {
    const open = this.open_
    if (!open) return
    this.open_ = null
    document.removeEventListener('pointerdown', open.onDocumentPointerDown, true)
    document.removeEventListener('keydown', open.onDocumentKeyDown, true)
    try {
      this.overlays.remove(open.overlayId)
    } catch {
      // already gone — non-fatal.
    }
  }

  // -- rendering -------------------------------------------------------------

  private buildPopover(elementId: string, members: readonly ArisQuickPickMember[]): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'aris-quick-pick'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', t('aris.quickPick.aria'))

    for (const member of members) {
      const label = t(member.labelKey as Key)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'aris-quick-pick__item'
      button.setAttribute('role', 'menuitemradio')
      button.setAttribute('aria-checked', member.active ? 'true' : 'false')
      button.dataset.arisObjectType = member.objectType
      button.dataset.arisSymbolNum = member.symbolNum
      if (!member.enabled) {
        button.disabled = true
        button.title = t('aris.quickPick.replaceBlocked')
      }

      const glyph = document.createElement('span')
      glyph.className = 'aris-quick-pick__glyph'
      glyph.setAttribute('aria-hidden', 'true')
      // Author-controlled line-art markup (the palette glyph table).
      glyph.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${arisPaletteGlyph(
        member.objectType,
        member.symbolNum
      )}</svg>`
      button.appendChild(glyph)

      const text = document.createElement('span')
      text.className = 'aris-quick-pick__label'
      text.textContent = label
      button.appendChild(text)

      // Act on pointerdown + preventDefault so the direct-editing textbox keeps
      // focus (the button never becomes the active element).
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (button.disabled) return
        this.activate(elementId, member)
      })

      menu.appendChild(button)
    }

    return menu
  }

  // -- actions ---------------------------------------------------------------

  private activate(elementId: string, member: ArisQuickPickMember): void {
    if (member.active) {
      this.close()
      return
    }
    const businessObject = arisBusinessObject(this.elementRegistry.get(elementId))
    if (!businessObject || businessObject.kind !== 'occurrence') {
      this.close()
      return
    }

    if (member.objectType === businessObject.objectType) {
      // Same object type: an in-place symbol swap.
      this.authoring.setOccurrenceSymbol(elementId, member.symbolNum)
      this.close()
      return
    }

    // Cross object type: replace the whole object, if still safe.
    if (!member.enabled || !this.authoring.canReplaceNewObject(elementId)) {
      this.close()
      return
    }
    const result = this.authoring.replaceNewObject(elementId, {
      objectType: member.objectType,
      symbolNum: member.symbolNum
    })
    this.close()
    const replacement = this.elementRegistry.get(result.occurrenceId) as Element | undefined
    if (replacement) this.selection.select(replacement)
  }
}

function property<T = unknown>(source: unknown, key: string): T | undefined {
  if (source && typeof source === 'object' && key in source) {
    return (source as Record<string, unknown>)[key] as T
  }
  return undefined
}

/** diagram-js module registering the quick-pick service. */
export const ArisQuickPickModule: Record<string, unknown> = {
  __init__: ['arisQuickPick'],
  arisQuickPick: ['type', ArisQuickPick]
}
