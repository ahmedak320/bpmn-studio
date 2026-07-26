// Split a bpmn-js saveSVG() document into (a) its root viewBox and (b) the raw
// inner markup, so PrintView can re-wrap that same inner markup inside several
// per-band <svg viewBox=…> elements (one slice of the diagram each).
//
// bpmn-js SVG output is real markup: a root <svg …> carrying xmlns / width /
// height / viewBox, a <defs> block of arrow-head <marker>s, then the diagram
// <g>s. It can also contain NESTED <svg> (e.g. inside a <foreignObject> label),
// so the closing tag we want is the LAST </svg>, never the first.

import type { Rect } from './printLayout'

interface RootTag {
  /** Index of the '<' that starts the root <svg tag. */
  start: number
  /** Index just past the root tag's closing '>'. */
  end: number
  /** Raw attribute text between '<svg' and the closing '>'. */
  attrs: string
}

/**
 * Locate the root <svg …> opening tag: the first `<svg` whose next character is
 * whitespace or `>`, scanned to its closing `>` while respecting quoted
 * attribute values (so a stray `>` inside an attribute can't end the tag early).
 */
function findRootSvgOpen(svg: string): RootTag | null {
  const match = /<svg(\s|>|\/)/i.exec(svg)
  if (!match) return null
  const start = match.index
  let quote: string | null = null
  let i = start + 4 // just past "<svg"
  for (; i < svg.length; i++) {
    const ch = svg[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      break
    }
  }
  if (i >= svg.length) return null // unterminated tag
  return { start, end: i + 1, attrs: svg.slice(start + 4, i) }
}

/** Parse `viewBox="x y w h"` (any whitespace/comma separators) from attr text. */
function parseViewBox(attrs: string): Rect | null {
  const match = /viewBox\s*=\s*(["'])([^"']*)\1/i.exec(attrs)
  if (!match) return null
  const parts = match[2].trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

/**
 * Split an SVG document into its inner markup (everything between the root
 * opening tag and the LAST `</svg>`) and its parsed root viewBox (null when the
 * root has no viewBox attribute or the input isn't an <svg> at all).
 */
export function splitSvg(svg: string): { inner: string; viewBox: Rect | null } {
  const root = findRootSvgOpen(svg)
  if (!root) return { inner: svg, viewBox: null }

  const lastClose = svg.toLowerCase().lastIndexOf('</svg>')
  const inner =
    lastClose >= root.end ? svg.slice(root.end, lastClose) : svg.slice(root.end)

  return { inner, viewBox: parseViewBox(root.attrs) }
}

/** The raw attribute text of the root <svg> tag (future-proofing helper). */
export function svgOpenTagAttrs(svg: string): string {
  const root = findRootSvgOpen(svg)
  return root ? root.attrs.trim() : ''
}
