import { describe, it, expect } from 'vitest'
import { splitSvg, svgOpenTagAttrs } from '../svgSlice'

// A realistic bpmn-js saveSVG() shape: multi-line root tag with xmlns attrs, a
// <defs> block of markers, and — critically — a NESTED <svg> inside a
// <foreignObject> label whose own </svg> comes BEFORE the root's closing tag.
const SAVE_SVG = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="800" height="400"
     viewBox="0 0 800 400" version="1.1">
  <defs>
    <marker id="sequenceflow-end" markerWidth="20" markerHeight="20"><path d="M 1 5 L 11 10"/></marker>
  </defs>
  <g class="viewport">
    <foreignObject width="90" height="20">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 20"><rect width="90" height="20"/></svg>
    </foreignObject>
    <rect class="djs-outline" x="0" y="0" width="120" height="80"/>
  </g>
</svg>`

const NO_VIEWBOX = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="1" y="1"/></svg>`

describe('splitSvg', () => {
  it('parses the root viewBox from a realistic saveSVG document', () => {
    const { viewBox } = splitSvg(SAVE_SVG)
    expect(viewBox).toEqual({ x: 0, y: 0, width: 800, height: 400 })
  })

  it('splits on the LAST </svg>, keeping the nested <svg> and later content in inner', () => {
    const { inner } = splitSvg(SAVE_SVG)
    // <defs>/marker round-trips into inner.
    expect(inner).toContain('sequenceflow-end')
    expect(inner).toContain('<defs>')
    // The nested foreignObject <svg> (and its own </svg>) survive…
    expect(inner).toContain('<foreignObject')
    expect(inner).toContain('viewBox="0 0 90 20"')
    // …AND content that comes AFTER the nested </svg> is retained, proving we
    // cut at the LAST </svg> (the root's), not the first (the nested one).
    expect(inner).toContain('djs-outline')
    // The root opening tag itself is not part of inner.
    expect(inner).not.toContain('version="1.1"')
  })

  it('returns null viewBox when the root <svg> has no viewBox attribute', () => {
    const { inner, viewBox } = splitSvg(NO_VIEWBOX)
    expect(viewBox).toBeNull()
    expect(inner).toContain('<rect')
  })

  it('returns null viewBox and echoes input when there is no <svg> at all', () => {
    const { inner, viewBox } = splitSvg('<div>not an svg</div>')
    expect(viewBox).toBeNull()
    expect(inner).toBe('<div>not an svg</div>')
  })
})

describe('svgOpenTagAttrs', () => {
  it('returns the raw root-tag attribute text', () => {
    const attrs = svgOpenTagAttrs(SAVE_SVG)
    expect(attrs).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(attrs).toContain('viewBox="0 0 800 400"')
    expect(attrs).toContain('version="1.1"')
    // It must not include the enclosing angle brackets.
    expect(attrs.startsWith('<')).toBe(false)
    expect(attrs.endsWith('>')).toBe(false)
  })

  it('returns an empty string when there is no <svg>', () => {
    expect(svgOpenTagAttrs('<p>hi</p>')).toBe('')
  })
})
