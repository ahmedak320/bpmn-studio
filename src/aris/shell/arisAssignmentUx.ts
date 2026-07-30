/**
 * Canvas assignment UX (Lane T6): the ⊞ marker + double-click drill-down.
 *
 * An ARIS object definition may carry `LinkedModels.IdRefs` — a process-interface
 * assignment to one or more child models. Every occurrence of such a definition
 * earns a small ⊞ marker on the canvas, and double-clicking (or clicking the
 * marker) drills into the assigned model. This is the ARIS analogue of a BPMN
 * call activity's calledElement navigation.
 *
 * It is a faithful sibling of `arisValidationOverlays.ts`: the same structural
 * diagram-js service views (`OverlaysLike`), the same `applied` map keyed
 * add/remove `sync()` loop, the same try/catch around every overlays call, and
 * the same returned `resync()` / `uninstall()` controller. It NEVER imports
 * `src/editor/**` or any `bpmn-*` package — the diagram-js Overlays module is
 * already registered by `src/aris/canvas/modules.ts`.
 *
 * ## Priority contract (must never collide with C3's inline label editor)
 *
 * The double-click handler registers on `element.dblclick` at **priority 2000**,
 * above the direct-editing provider's handler at **1500**. It returns `false`
 * (halting propagation) **only** when a canonical (in-document) model actually
 * opened — not merely when an assignment exists. `onActivate` reports that by
 * returning a navigation-result boolean (`true` = a canonical model opened);
 * a target that is missing/ambiguous or lives off-file resolves to `undefined`,
 * so the label editor at 1500 runs instead. A definition whose assignment drills
 * into this document opens that model; one that cannot opens the label editor.
 * The two never fire for the same gesture.
 *
 * Runs only in the browser (uses `document.createElement`) but is import-safe
 * from a jsdom test environment, and every overlays call is try/catch-wrapped so
 * detached/unknown elements are non-fatal.
 */

import { t } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import { arisBusinessObject } from '../canvas/elements'
import { ARIS_DOCUMENT_CHANGED } from '../canvas/commandBridge'

/** Structural view of diagram-js Overlays (didi-injected; not exported as a class type). */
interface OverlaysLike {
  add(
    element: string,
    type: string,
    overlay: { position: { bottom: number; left: number }; html: HTMLElement }
  ): string
  remove(id: string): void
}

/** Structural view of diagram-js ElementRegistry, narrowed to what this module reads. */
interface ElementRegistryLike {
  get(id: string): unknown
  getAll(): readonly unknown[]
}

export const ARIS_ASSIGNMENT_OVERLAY_TYPE = 'aris-assignment'

/**
 * The activation a marker click / drill-down gesture reports: the occurrence, the
 * definition behind it, its display name and the models it is linked to.
 */
export interface ArisAssignmentActivation {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly definitionName: string
  readonly linkedModelIds: readonly string[]
}

export interface ArisAssignmentUxController {
  /** Re-diff the markers against the live document. Idempotent. */
  resync(): void
  uninstall(): void
}

/**
 * Build the activation for one occurrence from the live document, or `null` when
 * the occurrence has no assignment. Read at gesture time so a long-lived marker
 * never reports a stale definition.
 */
function activationForOccurrence(
  canvas: ArisCanvas,
  occurrenceId: string
): ArisAssignmentActivation | null {
  const element = canvas.elementRegistry.get(occurrenceId)
  const businessObject = arisBusinessObject(element as never)
  if (!businessObject || businessObject.kind !== 'occurrence') return null
  const definition = canvas.document.objectDefinitions.get(businessObject.definitionId)
  if (!definition || definition.linkedModelIds.length === 0) return null
  return Object.freeze({
    occurrenceId,
    definitionId: businessObject.definitionId,
    definitionName: businessObject.name || definition.names.fallback || businessObject.definitionId,
    linkedModelIds: definition.linkedModelIds
  })
}

/** Cheap change detector — a changed signature re-creates the marker. */
function markerSignature(activation: ArisAssignmentActivation): string {
  return `${activation.definitionId}:${activation.linkedModelIds.join(',')}`
}

/**
 * Build the marker DOM: a real `<button>` carrying the ⊞ glyph, the localized
 * aria-label, and the `data-orbitpm-aris-assignment` test hook. Reads the live
 * activation at click time so a long-lived marker never navigates a stale
 * assignment.
 */
function buildMarker(
  occurrenceId: string,
  activation: ArisAssignmentActivation,
  getActivation: (occurrenceId: string) => ArisAssignmentActivation | null,
  onActivate: (activation: ArisAssignmentActivation) => boolean | void
): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'orbitpm-aris-assignment-marker'
  button.dataset.orbitpmArisAssignment = occurrenceId
  button.textContent = '⊞'
  button.setAttribute(
    'aria-label',
    t('aris.assign.marker.aria', { name: activation.definitionName })
  )

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const current = getActivation(occurrenceId)
    if (current) onActivate(current)
  })

  return button
}

/**
 * Install the assignment UX: paint a ⊞ marker on every occurrence whose
 * definition carries a linked-model assignment, and register the priority-2000
 * double-click drill-down. Returns a controller exposing an explicit `resync()`
 * (for React-side document changes) and an `uninstall()` that removes the marker
 * overlays and both event subscriptions.
 */
export function installArisAssignmentUx(
  canvas: ArisCanvas,
  onActivate: (activation: ArisAssignmentActivation) => boolean | void
): ArisAssignmentUxController {
  const overlays = canvas.get<OverlaysLike>('overlays')
  const elementRegistry = canvas.get<ElementRegistryLike>('elementRegistry')
  const eventBus = canvas.eventBus

  const applied = new Map<string, { overlayId: string; signature: string }>()

  const getActivation = (occurrenceId: string): ArisAssignmentActivation | null =>
    activationForOccurrence(canvas, occurrenceId)

  const sync = (): void => {
    const wanted = new Map<string, ArisAssignmentActivation>()
    for (const element of elementRegistry.getAll()) {
      const businessObject = arisBusinessObject(element as never)
      if (!businessObject || businessObject.kind !== 'occurrence') continue
      const activation = getActivation(businessObject.occurrenceId)
      if (activation) wanted.set(businessObject.occurrenceId, activation)
    }

    // First pass: drop overlays that are stale, gone, or changed.
    for (const [occurrenceId, entry] of applied) {
      const activation = wanted.get(occurrenceId)
      const staleSignature = activation ? markerSignature(activation) !== entry.signature : false
      if (!activation || !elementRegistry.get(occurrenceId) || staleSignature) {
        try {
          overlays.remove(entry.overlayId)
        } catch {
          // already gone — non-fatal.
        }
        applied.delete(occurrenceId)
      }
    }

    // Second pass: add overlays for wanted occurrences not already applied.
    for (const [occurrenceId, activation] of wanted) {
      if (applied.has(occurrenceId)) continue
      if (!elementRegistry.get(occurrenceId)) continue
      try {
        const overlayId = overlays.add(occurrenceId, ARIS_ASSIGNMENT_OVERLAY_TYPE, {
          position: { bottom: -8, left: -8 },
          html: buildMarker(occurrenceId, activation, getActivation, onActivate)
        })
        applied.set(occurrenceId, { overlayId, signature: markerSignature(activation) })
      } catch {
        // jsdom/detached elements are non-fatal, mirrors arisValidationOverlays.
      }
    }
  }

  // Priority 2000: above the direct-editing label editor (1500). Return `false`
  // (halting propagation, suppressing the editor) ONLY when a canonical model
  // actually opened; otherwise `undefined` so the label editor runs. See the
  // module header's priority contract.
  const onDblClick = (event: unknown): boolean | undefined => {
    const element = (event as { element?: unknown } | null)?.element
    const businessObject = arisBusinessObject(element as never)
    if (!businessObject || businessObject.kind !== 'occurrence') return undefined
    const activation = getActivation(businessObject.occurrenceId)
    if (!activation) return undefined
    const navigated = onActivate(activation)
    // `onActivate` reports whether a canonical model opened. A caller that still
    // returns nothing is inferred from the document: an in-document linked model
    // would have switched the canvas, whereas a missing/off-file target only
    // delegates to the shell and leaves the canvas here — where the label editor
    // should take over.
    const openedCanonicalModel =
      navigated === true ||
      (navigated === undefined &&
        activation.linkedModelIds.some((modelId) => canvas.document.models.has(modelId)))
    return openedCanonicalModel ? false : undefined
  }

  eventBus.on(ARIS_DOCUMENT_CHANGED, sync)
  eventBus.on('element.dblclick', 2000, onDblClick)
  sync()

  return {
    resync: sync,
    uninstall(): void {
      try {
        eventBus.off(ARIS_DOCUMENT_CHANGED, sync)
      } catch {
        // non-fatal.
      }
      try {
        eventBus.off('element.dblclick', onDblClick)
      } catch {
        // non-fatal.
      }
      for (const entry of applied.values()) {
        try {
          overlays.remove(entry.overlayId)
        } catch {
          // non-fatal.
        }
      }
      applied.clear()
    }
  }
}
