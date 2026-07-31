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
import {
  ARIS_CONVENTION_SYMBOLS,
  conventionSymbol,
  conventionSymbolByCatalogId
} from '../conventions/catalog'
import type { ArisAuthoring } from './authoring'
import { createDescriptorPreview } from './descriptorPreview'
import { dmtLibraryItem } from './dmtLibrary'
import { arisBusinessObject } from './elements'
import type { ArisPaletteProvider } from './paletteProvider'

import './arisQuickPick.css'

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

/**
 * The slice of `diagram-js-direct-editing`'s service the quick-pick drives to
 * carry an open inline editor across a cross-type replace (#6): the replace
 * swaps the occurrence + definition out from under the editor, so the editor
 * must be re-pointed at the replacement, preserving whatever the user has typed.
 */
interface DirectEditingLike {
  isActive(element?: unknown): boolean
  getValue(): string
  activate(element: unknown): boolean
}

export const ARIS_QUICK_PICK_OVERLAY_TYPE = 'aris-quick-pick'

export interface ArisQuickPickMember {
  readonly catalogId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly descriptorFingerprint: string
  readonly enabled: boolean
  readonly active: boolean
}

interface OpenState {
  readonly elementId: string
  readonly overlayId: string
  readonly popover: HTMLElement
  readonly onDocumentPointerDown: (event: Event) => void
  readonly onDocumentKeyDown: (event: KeyboardEvent) => void
  readonly returnFocus: HTMLElement | null
}

export class ArisQuickPick {
  static $inject = [
    'overlays',
    'eventBus',
    'elementRegistry',
    'selection',
    'canvas',
    'arisAuthoring',
    'directEditing',
    'arisPaletteProvider'
  ]

  private open_: OpenState | null = null

  constructor(
    private readonly overlays: OverlaysLike,
    eventBus: EventBus,
    private readonly elementRegistry: ElementRegistry,
    private readonly selection: Selection,
    private readonly canvas: Canvas,
    private readonly authoring: ArisAuthoring,
    private readonly directEditing: DirectEditingLike,
    private readonly palette: ArisPaletteProvider
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
    const currentCatalogId = businessObject.catalogId ?? this.palette.catalogIdFor(elementId)
    const current =
      (currentCatalogId === null ? null : conventionSymbolByCatalogId(currentCatalogId)) ??
      conventionSymbol(objectType, symbolNum)
    if (!current || current.family === null) return Object.freeze([])

    const canReplace = this.authoring.canReplaceNewObject(elementId)
    const currentItem = dmtLibraryItem(current.catalogId)
    if (currentItem === null) return Object.freeze([])
    const members: ArisQuickPickMember[] = [
      {
        catalogId: current.catalogId,
        objectType,
        symbolNum,
        labelKey: current.labelKey,
        descriptorFingerprint: currentItem.descriptorFingerprint,
        enabled: true,
        active: true
      }
    ]
    // The whole convention family, across object types: same-object-type rows
    // are an in-place symbol swap (always safe); other object types are a guarded
    // cross-type replace. The active row (and any duplicate of it) is skipped.
    for (const peer of ARIS_CONVENTION_SYMBOLS) {
      if (peer.family !== current.family) continue
      if (peer.catalogId === current.catalogId) continue
      const sameType = peer.objectType === objectType
      const item = dmtLibraryItem(peer.catalogId)
      if (item === null) continue
      members.push({
        catalogId: peer.catalogId,
        objectType: peer.objectType,
        symbolNum: peer.symbolNum,
        labelKey: peer.labelKey,
        descriptorFingerprint: item.descriptorFingerprint,
        enabled: sameType ? true : canReplace,
        active: false
      })
    }
    return Object.freeze(members)
  }

  /** Open the menu beside `elementId`, replacing any menu already open. */
  open(elementId: string, focusMenu = false): void {
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
      if (event.key === 'Escape') {
        event.preventDefault()
        this.close(true)
      }
    }
    // Capture phase so an outside click closes the menu before it lands.
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown, true)

    const activeElement = document.activeElement
    const returnFocus = activeElement instanceof HTMLElement ? activeElement : null
    this.open_ = {
      elementId,
      overlayId,
      popover,
      onDocumentPointerDown,
      onDocumentKeyDown,
      returnFocus
    }
    if (focusMenu) {
      popover.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    }
  }

  /** Dismiss the menu if one is open. Idempotent. */
  close(restoreFocus = false): void {
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
    if (restoreFocus && open.returnFocus?.isConnected) open.returnFocus.focus()
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
      button.dataset.arisCatalogId = member.catalogId
      button.dataset.arisObjectType = member.objectType
      button.dataset.arisSymbolNum = member.symbolNum
      button.dataset.arisDescriptorFingerprint = member.descriptorFingerprint
      if (!member.enabled) {
        button.disabled = true
        button.title = t('aris.quickPick.replaceBlocked')
      }

      const glyph = document.createElement('span')
      glyph.className = 'aris-quick-pick__glyph'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.appendChild(createDescriptorPreview(member.catalogId))
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
      // Native keyboard activation dispatches a detail-0 click. Pointer clicks
      // were already handled on pointerdown to preserve the inline editor.
      button.addEventListener('click', (event) => {
        if (event.detail !== 0) return
        event.preventDefault()
        event.stopPropagation()
        if (!button.disabled) this.activate(elementId, member)
      })

      menu.appendChild(button)
    }

    menu.addEventListener('keydown', (event) => {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (current < 0) return
      let next = current
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = (current + 1) % buttons.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = (current - 1 + buttons.length) % buttons.length
      } else if (event.key === 'Home') {
        next = 0
      } else if (event.key === 'End') {
        next = buttons.length - 1
      } else {
        return
      }
      buttons[next]?.focus()
      event.preventDefault()
    })

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
      // Same object type: an in-place symbol swap. A collapsed catalog variant
      // may share the same SymbolNum, in which case only the exact live
      // presentation identity changes.
      if (member.symbolNum !== businessObject.symbolNum) {
        this.authoring.setOccurrenceSymbol(elementId, member.symbolNum)
      }
      this.palette.rememberCatalogPresentation(elementId, member.catalogId)
      this.close()
      return
    }

    // Cross object type: replace the whole object, if still safe.
    if (!member.enabled || !this.authoring.canReplaceNewObject(elementId)) {
      this.close()
      return
    }
    // The replace deletes the occurrence + definition the inline editor is
    // pointed at and re-creates new ones (#6). Capture any in-progress caption
    // BEFORE the swap so it can move to the replacement instead of being
    // committed to (or renaming) the deleted definition.
    const pendingCaption = this.directEditing.isActive() ? this.directEditing.getValue() : null
    const result = this.authoring.replaceNewObject(elementId, {
      objectType: member.objectType,
      symbolNum: member.symbolNum
    })
    this.close()
    this.palette.rememberCatalogPresentation(result.occurrenceId, member.catalogId)
    const replacement = this.elementRegistry.get(result.occurrenceId) as Element | undefined
    if (!replacement) return
    this.selection.select(replacement)
    if (pendingCaption !== null) this.retargetInlineEdit(replacement, pendingCaption)
  }

  /**
   * Re-point an open inline editor at the replacement occurrence, restoring the
   * caption the user had typed. Re-activating recaptures the new definition id
   * inside the direct-editing provider, so the eventual commit lands on the new
   * object; no command runs here, so the replace stays a single undo step (#6).
   */
  private retargetInlineEdit(replacement: Element, caption: string): void {
    // `activate` cancels the stale session (its element is already gone) and
    // opens a fresh one on the replacement.
    this.directEditing.activate(replacement)
    const content = this.canvas.getContainer().querySelector('.djs-direct-editing-content')
    if (content instanceof HTMLElement) content.innerText = caption
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
