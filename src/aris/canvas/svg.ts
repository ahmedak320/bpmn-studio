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
