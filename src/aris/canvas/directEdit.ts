/**
 * Inline label editing for the ARIS canvas (Plan Issue 2, Lane C3).
 *
 * `diagram-js-direct-editing` supplies the `directEditing` service — a single
 * contenteditable textbox with built-in Enter/Escape/focusout handling. This
 * module registers the ARIS provider that decides *what* is editable and *how*
 * a commit becomes an ARIS command, and wires the three ways an edit starts:
 * immediately on placement (`create.end`), on double-click, and on F2.
 *
 * ## Why a commit goes through `ArisAuthoring`, not the element's business object
 *
 * Every canvas re-render replaces an element's frozen `businessObject` with a
 * fresh one (see `canvasSync.ts`). If `update` read the definition/free-text id
 * off the element at commit time, an unrelated re-render between `activate` and
 * `complete` would hand it a stale object. The provider therefore captures the
 * ARIS **string id** at `activate` time and commits against that, so an edit
 * survives any number of intervening `elements.changed` cycles.
 *
 * ## Locale
 *
 * A rename lands under the **active content locale** (`sync.displayLocaleId`),
 * not the document default — editing while the canvas shows Arabic writes the
 * `ar-AE` name, exactly as the caption the user is looking at.
 *
 * ## RTL / zoom safety
 *
 * The textbox font size tracks the live zoom, and on activation the content
 * node is marked `dir="auto"` + `unicode-bidi: plaintext` so a mixed or Arabic
 * label lays out in its own natural direction regardless of the UI language.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type Selection from 'diagram-js/lib/features/selection/Selection'
import type { ShapeLike } from 'diagram-js/lib/core/Types'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

import DirectEditingModule from 'diagram-js-direct-editing'

import type { ArisAuthoring } from './authoring'
import type { ArisCanvasSync } from './canvasSync'
import type { ArisCommandBridge } from './commandBridge'
import { ARIS_DOCUMENT_CHANGED } from './commandBridge'
import { arisBusinessObject } from './elements'

/**
 * The subset of `diagram-js-direct-editing`'s `DirectEditing` service this
 * provider drives. Typed locally because the library ships no declarations.
 */
interface DirectEditingService {
  registerProvider(provider: unknown): void
  /** Returns `true` when a provider accepted the element. */
  activate(element: unknown): boolean
  cancel(): void
  complete(): void
  isActive(element?: unknown): boolean
  getValue(): string
}

/** The activation context `DirectEditing` hands to `TextBox.create`. */
export interface ArisDirectEditContext {
  readonly bounds: unknown
  readonly text: string
  readonly style?: Record<string, string>
  readonly options?: Record<string, unknown>
}

type EditableKind = 'occurrence' | 'freeText'

interface EditableTarget {
  /** Element whose absolute bbox anchors the textbox. */
  readonly element: Element
  readonly text: string
  readonly kind: EditableKind
  readonly definitionId: string | null
  readonly freeTextId: string | null
}

/**
 * Gestures whose ARIS command *creates* something. Only after one of these is
 * the immediately-following cancel of an empty free-text note treated as junk
 * to undo — cancelling an edit that follows any other gesture leaves the model
 * untouched.
 */
const CREATE_REASONS: ReadonlySet<string> = new Set([
  'create',
  'append',
  'create-free-text',
  'add-free-text'
])

/** F2, whichever way the browser reports the key. */
function isF2(keyEvent: { keyCode?: number; which?: number; key?: string }): boolean {
  const code = keyEvent.keyCode ?? keyEvent.which
  return code === 113 || keyEvent.key === 'F2'
}

function property<T = unknown>(source: unknown, key: string): T | undefined {
  if (source && typeof source === 'object' && key in source) {
    return (source as Record<string, unknown>)[key] as T
  }
  return undefined
}

export class ArisDirectEditingProvider {
  static $inject = [
    'directEditing',
    'eventBus',
    'canvas',
    'selection',
    'arisAuthoring',
    'arisCanvasSync',
    'elementRegistry',
    'arisCommandBridge'
  ]

  private capturedKind: EditableKind | null = null
  private capturedDefinitionId: string | null = null
  private capturedFreeTextId: string | null = null
  private capturedText = ''
  /** `true` while the most recent ARIS gesture was a creation (see `CREATE_REASONS`). */
  private justCreated = false

  constructor(
    private readonly directEditing: DirectEditingService,
    private readonly eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly selection: Selection,
    private readonly authoring: ArisAuthoring,
    private readonly sync: ArisCanvasSync,
    private readonly elementRegistry: ElementRegistry,
    private readonly bridge: ArisCommandBridge
  ) {
    this.directEditing.registerProvider(this)
    this.wire()
  }

  // -- DirectEditing provider contract --------------------------------------

  /**
   * Return an activation context for an editable element, or `undefined`.
   *
   * Occurrences and free-text notes edit their own caption; an external name
   * label retargets to the occurrence it names, so editing the label renames
   * the object. Connections, lanes, connection labels and the model root are
   * not directly editable here.
   */
  activate(element: unknown): ArisDirectEditContext | undefined {
    const target = this.resolveEditable(element)
    if (!target) return undefined

    this.capturedKind = target.kind
    this.capturedDefinitionId = target.definitionId
    this.capturedFreeTextId = target.freeTextId
    this.capturedText = target.text

    const bounds = this.canvas.getAbsoluteBBox(target.element as unknown as ShapeLike)
    const zoom = this.canvas.zoom()
    return {
      bounds,
      text: target.text,
      style: { fontSize: `${12 * zoom}px`, textAlign: 'center' },
      options: { autoResize: true }
    }
  }

  /** Commit an edit against the id captured at `activate` time. */
  update(_element: unknown, newText: string): void {
    if (this.capturedKind === 'occurrence' && this.capturedDefinitionId) {
      this.authoring.renameDefinition(this.capturedDefinitionId, newText, this.sync.displayLocaleId)
      return
    }
    if (this.capturedKind === 'freeText' && this.capturedFreeTextId) {
      this.authoring.editFreeText(this.capturedFreeTextId, { text: newText })
    }
  }

  // -- wiring ----------------------------------------------------------------

  private wire(): void {
    // Double-click opens the editor. Priority 1500 sits below the assignment
    // drill-down (Lane T6, priority 2000): that handler returns `false` only
    // when it navigates, otherwise this one runs.
    this.eventBus.on('element.dblclick', 1500, (event: unknown) => {
      const element = property(event, 'element')
      if (!element) return undefined
      return this.directEditing.activate(element) ? false : undefined
    })

    // Immediately after a shape is placed, open its editor so a label can be
    // typed without a second gesture. Priority 250 runs after diagram-js's own
    // `create.end` (priority 1000), so `context.shape` is the committed shape.
    this.eventBus.on('create.end', 250, (event: unknown) => {
      const context = property(event, 'context')
      if (property(context, 'canExecute') === false) return
      const shape = property(context, 'shape')
      if (!shape || !this.resolveEditable(shape)) return
      // Defer: the create gesture is still settling its own event chain.
      setTimeout(() => this.directEditing.activate(shape), 0)
    })

    // F2 edits the single selected element.
    this.eventBus.on('keyboard.keydown', (event: unknown) => {
      const keyEvent = property<{ keyCode?: number; which?: number; key?: string }>(
        event,
        'keyEvent'
      )
      if (!keyEvent || !isF2(keyEvent)) return undefined
      const selected = this.selection.get()
      if (selected.length !== 1) return undefined
      const only = selected[0]
      if (!this.resolveEditable(only)) return undefined
      return this.directEditing.activate(only) ? true : undefined
    })

    // Make the live textbox direction-aware so Arabic / mixed labels lay out
    // naturally regardless of the UI language.
    this.eventBus.on('directEditing.activate', () => {
      const content = this.canvas.getContainer().querySelector('.djs-direct-editing-content')
      if (content instanceof HTMLElement) {
        content.setAttribute('dir', 'auto')
        content.style.unicodeBidi = 'plaintext'
      }
    })

    // Track whether the last ARIS gesture created something, so an empty
    // just-created free-text note can be cleaned up on cancel.
    this.eventBus.on(ARIS_DOCUMENT_CHANGED, (event: unknown) => {
      const reason = property<string>(event, 'reason')
      this.justCreated = typeof reason === 'string' && CREATE_REASONS.has(reason)
    })

    // Escaping a brand-new empty free-text note removes the junk note; an
    // occurrence cancel leaves the (unnamed) shape in place.
    this.eventBus.on('directEditing.cancel', () => {
      if (!this.justCreated) return
      if (this.capturedKind !== 'freeText') return
      if (this.capturedText.trim() !== '') return
      this.bridge.undo()
    })
  }

  // -- resolution ------------------------------------------------------------

  private resolveEditable(element: unknown): EditableTarget | null {
    const businessObject = arisBusinessObject(element as { businessObject?: unknown } | null)
    if (!businessObject) return null

    if (businessObject.kind === 'occurrence') {
      return {
        element: element as Element,
        text: businessObject.name,
        kind: 'occurrence',
        definitionId: businessObject.definitionId,
        freeTextId: null
      }
    }

    if (businessObject.kind === 'freeText') {
      return {
        element: element as Element,
        text: businessObject.text,
        kind: 'freeText',
        definitionId: null,
        freeTextId: businessObject.freeTextId
      }
    }

    // An external caption retargets to the occurrence it names.
    if (businessObject.kind === 'label') {
      const owner = this.elementRegistry.get(businessObject.ownerOccurrenceId) as Shape | undefined
      const ownerBo = arisBusinessObject(owner)
      if (owner && ownerBo?.kind === 'occurrence') {
        return {
          element: owner,
          text: ownerBo.name,
          kind: 'occurrence',
          definitionId: ownerBo.definitionId,
          freeTextId: null
        }
      }
    }

    return null
  }
}

/**
 * Self-contained module: the library's `DirectEditing` service plus the ARIS
 * provider. `modules.ts` wires the same two pieces into the canvas directly, so
 * this bundle is exported for standalone/embedding use and is intentionally not
 * added to the canvas module list (that would double-register the provider).
 */
export const ArisDirectEditModule: Record<string, unknown> = {
  __depends__: [DirectEditingModule],
  __init__: ['arisDirectEditingProvider'],
  arisDirectEditingProvider: ['type', ArisDirectEditingProvider]
}
