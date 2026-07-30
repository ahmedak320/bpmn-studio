/**
 * Minimal SVG helpers.
 *
 * diagram-js uses `tiny-svg` internally, but that is a transitive dependency of
 * `diagram-js` rather than a declared dependency of this app. Creating three
 * elements with `createElementNS` avoids adding a direct dependency for a
 * handful of calls, and keeps the production dependency graph exactly as
 * Section 5.4 wants it: generic `diagram-js` and nothing else from that vendor.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string | number>> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value))
  }
  return element
}

export function svgAppend(parent: SVGElement, ...children: readonly SVGElement[]): void {
  for (const child of children) parent.appendChild(child)
}

/** The nearest ancestor `<svg>` of a node, or the node itself when it has no `<svg>` ancestor. */
function svgRoot(node: SVGElement): SVGElement {
  let current: Node | null = node
  while (current) {
    if ((current as Element).nodeName?.toLowerCase() === 'svg') return current as SVGElement
    current = current.parentNode
  }
  return node
}

/**
 * Ensure an arrowhead `<marker>` for `color` exists in the diagram's shared `<defs>`, and return
 * its id for a `marker-end="url(#id)"` reference.
 *
 * The marker is authored once per stroke colour and reused: connections are drawn one at a time,
 * so without the idempotency guard every connection would mint its own duplicate `<defs><marker>`.
 * A `url(#id)` reference resolves document-wide, so the marker lives on the single `<svg>` root that
 * every connection shares. This is OrbitPM canvas furniture — a neutral filled triangle — never
 * traced from ARIS artwork.
 */
export function ensureArrowMarker(node: SVGElement, color: string): string {
  const root = svgRoot(node)
  const id = `aris-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`
  if (root.querySelector(`#${id}`)) return id
  let defs = root.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs')
    root.insertBefore(defs, root.firstChild)
  }
  const marker = svgElement('marker', {
    id,
    markerWidth: 10,
    markerHeight: 8,
    refX: 9,
    refY: 4,
    orient: 'auto',
    markerUnits: 'userSpaceOnUse'
  })
  marker.appendChild(svgElement('path', { d: 'M0,0 L10,4 L0,8 z', fill: color }))
  defs.appendChild(marker)
  return id
}
