/**
 * Headless DOM bootstrap for the canonical->SVG render entry (implementation
 * plan Lane L-HEADLESS, Wave 20; deliverable 3).
 *
 * The ~40 canvas test suites boot the diagram-js canvas under vitest's jsdom
 * environment (`// @vitest-environment jsdom`), which constructs the jsdom
 * window and publishes the DOM globals for them. The CLI / library consumer
 * runs under plain Node with no DOM at all, so `ensureHeadlessDom` constructs
 * the jsdom window itself and publishes the same globals onto `globalThis`
 * BEFORE anything DOM-touching (`createCanvasContainer`, `ArisCanvas.create`,
 * tiny-svg) reads them, then installs the SVG-geometry shim shared with the
 * test suites (`../canvas/testing/jsdomSvg`).
 *
 * `jsdom` is already a root devDependency (ZERO new dependencies). It is a
 * static import here: the library build (`vite.lib.config.ts`, W21) externalizes
 * `jsdom` so the consumer supplies it, and the studio browser app never imports
 * `src/aris/headless`, so this module never enters the browser bundle.
 *
 * Idempotent and deterministic: when a DOM already exists (a browser, or the
 * jsdom test environment) it is a no-op — the existing document is reused and
 * nothing is republished.
 */

import { JSDOM } from 'jsdom'

import { installJsdomSvgSupport } from '../canvas/testing/jsdomSvg'

/**
 * DOM constructors/objects the diagram-js canvas + the export capture read as
 * bare globals (not via `window.`): `document`/`window` for element creation,
 * `HTMLElement` for the size shim's prototype patch, `SVGElement`/`SVGSVGElement`
 * for the geometry shim, `DOMParser`/`XMLSerializer` for capture, `Element`/
 * `Node` for instance checks, and `navigator` for platform detection.
 */
const DOM_GLOBAL_KEYS = [
  'HTMLElement',
  'SVGElement',
  'SVGSVGElement',
  'DOMParser',
  'XMLSerializer',
  'Element',
  'Node'
] as const

/**
 * Publish a value onto `globalThis` robustly: plain assignment works for the
 * absent DOM globals, but `navigator` is a pre-existing read-only accessor on a
 * modern Node `globalThis`, so assignment throws (strict mode) — fall back to a
 * configurable data property in that case.
 */
function publishGlobal(scope: Record<string, unknown>, key: string, value: unknown): void {
  try {
    scope[key] = value
    if (scope[key] === value) return
  } catch {
    // Read-only accessor (e.g. Node's global `navigator`) — define instead.
  }
  Object.defineProperty(scope, key, { value, configurable: true, writable: true })
}

/**
 * Ensure a DOM is available for a headless canvas render.
 *
 * No-op when `globalThis.document` already exists. Otherwise builds a jsdom
 * window, publishes the DOM globals, and installs the SVG-geometry shim.
 */
export function ensureHeadlessDom(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return

  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const scope = globalThis as unknown as Record<string, unknown>
  const domWindow = dom.window as unknown as Record<string, unknown>

  publishGlobal(scope, 'window', dom.window)
  publishGlobal(scope, 'document', dom.window.document)
  publishGlobal(scope, 'navigator', dom.window.navigator)
  for (const key of DOM_GLOBAL_KEYS) publishGlobal(scope, key, domWindow[key])

  installJsdomSvgSupport()
}
