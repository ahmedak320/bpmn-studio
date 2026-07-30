/**
 * Per-element canvas warning markers (issue 6).
 *
 * A small warning overlay is painted on every canvas element that carries at
 * least one validation finding. Hovering the marker shows a localized
 * plain-language explanation (native `title`); clicking it runs the SAME
 * reveal-and-highlight gesture as the validation rail rows.
 *
 * This is a faithful port of `main`'s BPMN-free overlay installer
 * (`src/links/linkBadges.ts`): structural diagram-js service views, a `sync()`
 * add/remove loop keyed by an `applied` map, a try/catch around every overlays
 * call, and a returned `uninstall()`. It NEVER imports `src/editor/**` or any
 * `bpmn-*` package — the diagram-js Overlays module is already registered by
 * `src/aris/canvas/modules.ts`.
 *
 * Runs only in the browser (uses `document.createElement`) — but the module is
 * import-safe from a jsdom test environment, and every overlays call is
 * try/catch-wrapped so detached/unknown elements are non-fatal.
 */

import { t, type Key } from '../../i18n'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import { ARIS_DOCUMENT_CHANGED } from '../canvas/commandBridge'
import type { ArisValidationFinding } from './arisValidationFindings'
import { tk } from './shellI18n'

/** Structural view of diagram-js Overlays (didi-injected; not exported as a class type). */
interface OverlaysLike {
  add(
    element: string,
    type: string,
    overlay: { position: { top: number; right: number }; html: HTMLElement }
  ): string
  remove(id: string): void
}

export const ARIS_VALIDATION_OVERLAY_TYPE = 'aris-validation'

export interface ArisValidationOverlayController {
  /** Re-diff overlays against the current findings map. Idempotent. */
  resync(): void
  uninstall(): void
}

/** Cheap change detector — a changed signature re-creates the marker. */
function markerSignature(findings: readonly ArisValidationFinding[]): string {
  const first = findings[0]
  return `${findings.length}:${first?.severity ?? ''}:${first?.messageKey ?? ''}`
}

/**
 * Build the marker DOM: a real `<button>` carrying the localized tooltip
 * (native `title`) + aria-label, a decorative glyph, an optional count badge,
 * and the `data-orbitpm-aris-warning*` test hooks. Reads the live findings map
 * at click time so a long-lived marker never activates a stale finding.
 */
function buildMarker(
  elementId: string,
  findings: readonly ArisValidationFinding[],
  getFindings: () => ReadonlyMap<string, readonly ArisValidationFinding[]>,
  onActivate: (finding: ArisValidationFinding) => void
): HTMLElement {
  const severity = findings[0]?.severity ?? 'warning'

  const button = document.createElement('button')
  button.type = 'button'
  button.className =
    'orbitpm-aris-warning-marker' +
    (severity === 'error' ? ' orbitpm-aris-warning-marker--error' : '')
  button.dataset.orbitpmArisWarning = elementId
  button.dataset.orbitpmArisWarningCount = String(findings.length)
  button.dataset.orbitpmArisWarningSeverity = severity

  const glyph = document.createElement('span')
  glyph.setAttribute('aria-hidden', 'true')
  glyph.textContent = '⚠'
  button.appendChild(glyph)

  if (findings.length > 1) {
    const count = document.createElement('span')
    count.setAttribute('aria-hidden', 'true')
    count.textContent = String(findings.length)
    button.appendChild(count)
  }

  const first = t(findings[0].messageKey as Key, findings[0].messageParams)
  const text =
    findings.length > 1
      ? `${first}\n${tk('aris.validation.moreOnElement', '+{count} more issues on this element', {
          count: findings.length - 1
        })}`
      : first
  button.title = text
  button.setAttribute(
    'aria-label',
    tk('aris.validation.markerAria', 'Validation issues on {id}: {summary}', {
      id: elementId,
      summary: text
    })
  )

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const current = getFindings().get(elementId)
    if (current?.[0]) onActivate(current[0])
  })

  return button
}

/**
 * Install a resync loop that keeps a warning marker overlay on every canvas
 * element with at least one validation finding, adding/removing/refreshing
 * overlays as the document changes. Returns a controller exposing an explicit
 * `resync()` (for React-side findings changes) and an `uninstall()` that removes
 * the event subscription and every overlay it added.
 */
export function installArisValidationOverlays(
  canvas: ArisCanvas,
  getFindings: () => ReadonlyMap<string, readonly ArisValidationFinding[]>,
  onActivate: (finding: ArisValidationFinding) => void
): ArisValidationOverlayController {
  const overlays = canvas.get<OverlaysLike>('overlays')
  const elementRegistry = canvas.elementRegistry
  const eventBus = canvas.eventBus

  const applied = new Map<string, { overlayId: string; signature: string }>()

  const sync = (): void => {
    const wanted = getFindings()

    // First pass: drop overlays that are stale, gone, or changed.
    for (const [elementId, entry] of applied) {
      const findings = wanted.get(elementId)
      const staleSignature = findings ? markerSignature(findings) !== entry.signature : false
      if (!findings || !elementRegistry.get(elementId) || staleSignature) {
        try {
          overlays.remove(entry.overlayId)
        } catch {
          // already gone — non-fatal.
        }
        applied.delete(elementId)
      }
    }

    // Second pass: add overlays for wanted elements not already applied.
    for (const [elementId, findings] of wanted) {
      if (applied.has(elementId)) continue
      if (!elementRegistry.get(elementId)) continue
      try {
        const overlayId = overlays.add(elementId, ARIS_VALIDATION_OVERLAY_TYPE, {
          position: { top: -8, right: -8 },
          html: buildMarker(elementId, findings, getFindings, onActivate)
        })
        applied.set(elementId, { overlayId, signature: markerSignature(findings) })
      } catch {
        // jsdom/detached elements are non-fatal, mirrors linkBadges.
      }
    }
  }

  eventBus.on(ARIS_DOCUMENT_CHANGED, sync)
  sync()

  return {
    resync: sync,
    uninstall(): void {
      try {
        eventBus.off(ARIS_DOCUMENT_CHANGED, sync)
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
