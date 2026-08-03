/**
 * SVG-aware allowlist sanitizer for the engine's anchored `process.svg`
 * (production-hardening: safe embedding in a verification portal).
 *
 * A review portal inlines `process.svg` via `innerHTML` so its `data-epc-node`/
 * `data-epc-edge` anchors become real, clickable DOM nodes. The engine escapes
 * text, so a process label never becomes live markup on the engine's own path —
 * but the portal must NOT rely on that alone: labels, descriptions, and criteria
 * originate from employees, uploaded documents, and AI output, so the SVG is
 * treated as UNTRUSTED regardless of who generated it. Before insertion, run it
 * through `sanitizeEpcSvg`.
 *
 * The sanitizer parses the markup as XML and rebuilds it against an allowlist:
 *
 *  - **Elements** — only a fixed set of safe SVG shape/text/structural elements
 *    is kept; everything else (`script`, `foreignObject`, `style`, `image`, `a`,
 *    `animate*`, and any HTML element) is dropped WITH its subtree.
 *  - **Attributes** — `on*` event handlers are dropped; `href`/`xlink:href` are
 *    dropped unless they are same-document `#fragment` references; any attribute
 *    whose value carries an external `url(...)`, a `javascript:` URL, a CSS
 *    `expression(...)`, or an angle bracket is dropped; every other attribute in
 *    the presentation/data/aria allowlist is kept, so `data-epc-*` anchors and
 *    presentation attributes survive intact.
 *
 * It never executes markup and adds no dependency — it needs only a DOM
 * parser/serializer. A browser provides `DOMParser`/`XMLSerializer` natively; a
 * Node consumer calls `ensureHeadlessDom()` first (which publishes them onto
 * `globalThis`) or injects its own via `options.dom`.
 *
 * Pair this with a restrictive Content-Security-Policy on the portal — see
 * `RECOMMENDED_VERIFICATION_CSP` — so an injected handler could not execute even
 * if the sanitizer were ever bypassed. Defense in depth, not a single gate.
 */

/** Safe SVG elements. Compared case-insensitively against each element's localName. */
const ALLOWED_SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'title',
  'desc',
  'metadata',
  'use'
])

/**
 * Safe attribute names (lowercased). Presentation/geometry/text/marker attributes
 * plus structural identity; `data-*`/`aria-*` are allowed by prefix and
 * `xmlns`/`xmlns:*` by their own rule. Anything else is dropped.
 */
const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  // structural / identity
  'id',
  'class',
  'role',
  'version',
  'width',
  'height',
  'transform',
  'viewbox',
  'preserveaspectratio',
  // presentation
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'opacity',
  'color',
  'display',
  'visibility',
  'style',
  // text
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'direction',
  'letter-spacing',
  'word-spacing',
  'writing-mode',
  'unicode-bidi',
  'textlength',
  'lengthadjust',
  // geometry
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'dx',
  'dy',
  'rotate',
  'fx',
  'fy',
  // markers / clip / gradients
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerwidth',
  'markerheight',
  'markerunits',
  'orient',
  'refx',
  'refy',
  'clip-path',
  'clip-rule',
  'clippathunits',
  'mask',
  'maskunits',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternunits',
  'patterntransform'
])

const ALLOWED_ATTR_PREFIXES = ['data-', 'aria-']

/** DOM constructors the sanitizer needs. A browser has both as globals; jsdom supplies them too. */
export interface SvgSanitizerDom {
  readonly DOMParser: typeof DOMParser
  readonly XMLSerializer: typeof XMLSerializer
}

export interface SanitizeEpcSvgOptions {
  /** Inject a DOM (e.g. from jsdom in Node). Defaults to the `globalThis` DOM. */
  readonly dom?: SvgSanitizerDom
}

function resolveDom(dom: SvgSanitizerDom | undefined): SvgSanitizerDom {
  if (dom) return dom
  const scope = globalThis as {
    DOMParser?: typeof DOMParser
    XMLSerializer?: typeof XMLSerializer
  }
  if (scope.DOMParser && scope.XMLSerializer) {
    return { DOMParser: scope.DOMParser, XMLSerializer: scope.XMLSerializer }
  }
  throw new Error(
    'sanitizeEpcSvg needs a DOM: pass options.dom = {DOMParser, XMLSerializer}, or call ' +
      'ensureHeadlessDom() first in Node (browsers provide these natively).'
  )
}

function isElementAllowed(localName: string): boolean {
  return ALLOWED_SVG_ELEMENTS.has(localName.toLowerCase())
}

/** No `<`/`>`, no `javascript:`, no `expression(...)`, and any `url(...)` must be `#fragment`. */
function isAttributeValueSafe(value: string): boolean {
  if (/[<>]/.test(value)) return false
  if (/javascript:/i.test(value)) return false
  if (/expression\s*\(/i.test(value)) return false
  for (const match of value.matchAll(/url\(\s*['"]?\s*([^'")]*)/gi)) {
    const target = (match[1] ?? '').trim()
    if (!target.startsWith('#')) return false
  }
  return true
}

function isAttributeAllowed(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  // Event handlers — never.
  if (lower.startsWith('on')) return false
  // Links: same-document fragment references only; every external/`javascript:`
  // target is dropped (the engine emits none, so this is purely defensive).
  if (lower === 'href' || lower === 'xlink:href' || lower.endsWith(':href')) {
    return value.trim().startsWith('#')
  }
  const nameOk =
    lower === 'xmlns' ||
    lower.startsWith('xmlns:') ||
    ALLOWED_ATTR_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    ALLOWED_ATTRS.has(lower)
  if (!nameOk) return false
  return isAttributeValueSafe(value)
}

function sanitizeElement(element: Element): void {
  for (const attr of [...element.attributes]) {
    if (!isAttributeAllowed(attr.name, attr.value)) element.removeAttributeNode(attr)
  }
  for (const child of [...element.children]) {
    if (!isElementAllowed(child.localName)) {
      child.remove()
      continue
    }
    sanitizeElement(child)
  }
}

/**
 * Sanitize engine-produced (or any) SVG markup for safe `innerHTML` embedding.
 * Returns the sanitized standalone SVG string. Throws if the input is not
 * well-formed XML or its root element is not `<svg>`.
 *
 * Idempotent on the engine's own output: the engine emits only allowlisted
 * elements/attributes and no `href`, so a clean render round-trips with its
 * `data-epc-*` anchors intact (re-serialization may reorder attributes, but the
 * set of elements and anchors is preserved).
 */
export function sanitizeEpcSvg(markup: string, options: SanitizeEpcSvgOptions = {}): string {
  const { DOMParser: Parser, XMLSerializer: Serializer } = resolveDom(options.dom)
  const doc = new Parser().parseFromString(markup, 'image/svg+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('sanitizeEpcSvg: input is not well-formed SVG/XML.')
  }
  const root = doc.documentElement
  if (!root || root.localName.toLowerCase() !== 'svg') {
    throw new Error(
      `sanitizeEpcSvg: root element must be <svg>, got <${root ? root.localName : 'none'}>.`
    )
  }
  sanitizeElement(root)
  return new Serializer().serializeToString(root)
}

/**
 * A restrictive Content-Security-Policy the verification application should apply
 * (as a response header or a `<meta http-equiv>`), so that even if a handler were
 * ever smuggled past the sanitizer it could not execute. Notably `script-src`
 * carries no `'unsafe-inline'`, so an inline `on*`/`<script>` cannot run, and
 * `default-src 'self'` blocks the external fetches an injected `url(...)`/`href`
 * would attempt. Tighten `img-src`/`style-src` further to taste.
 */
export const RECOMMENDED_VERIFICATION_CSP: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ')
