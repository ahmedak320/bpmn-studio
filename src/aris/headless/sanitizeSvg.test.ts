/**
 * Security test for `sanitizeEpcSvg` (production-hardening: safe SVG embedding).
 *
 * Runs under the DEFAULT node environment (no jsdom docblock). The unit cases
 * inject a jsdom DOM explicitly; the integration cases reuse the global DOM that
 * `renderCanonicalProcess` boots via `ensureHeadlessDom`.
 */

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { VALID_CANONICAL_FULL } from '../canonical/fixtures'
import { renderCanonicalProcess } from './render'
import {
  RECOMMENDED_VERIFICATION_CSP,
  sanitizeEpcSvg,
  type SvgSanitizerDom
} from './sanitizeSvg'

// A standalone jsdom DOM so the unit cases never depend on globals or on a prior
// render having booted the headless DOM.
const jsdomWindow = new JSDOM().window
const dom: SvgSanitizerDom = {
  DOMParser: jsdomWindow.DOMParser as unknown as typeof DOMParser,
  XMLSerializer: jsdomWindow.XMLSerializer as unknown as typeof XMLSerializer
}
const clean = (markup: string): string => sanitizeEpcSvg(markup, { dom })
// `xmlns:xlink` is declared so the `xlink:href` cases are well-formed XML.
const svg = (inner: string): string =>
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  `viewBox="0 0 10 10">${inner}</svg>`

describe('sanitizeEpcSvg — element allowlist', () => {
  it('drops <script> and keeps sibling shapes', () => {
    const out = clean(svg('<script>alert(1)</script><rect x="1" y="1" width="2" height="2"/>'))
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out.toLowerCase()).not.toContain('alert(1)')
    expect(out.toLowerCase()).toContain('<rect')
  })

  it('drops <foreignObject> with its entire (HTML) subtree', () => {
    const out = clean(
      svg(
        '<foreignObject width="10" height="10">' +
          '<div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div>' +
          '</foreignObject><rect x="1" y="1" width="2" height="2"/>'
      )
    )
    const lower = out.toLowerCase()
    expect(lower).not.toContain('foreignobject')
    expect(lower).not.toContain('onerror')
    expect(lower).not.toContain('<img')
    expect(lower).toContain('<rect')
  })

  it('drops <image>, <style>, and <a> (external ref / CSS / link vectors)', () => {
    const image = clean(svg('<image href="https://evil.example/track.png" width="1" height="1"/>'))
    expect(image.toLowerCase()).not.toContain('<image')
    expect(image.toLowerCase()).not.toContain('evil.example')

    const style = clean(svg('<style>@import url(https://evil.example/x.css);</style><rect/>'))
    expect(style.toLowerCase()).not.toContain('<style')
    expect(style.toLowerCase()).not.toContain('evil.example')

    // <a> is disallowed and dropped WITH its subtree (a safe over-approximation —
    // the engine never wraps shapes in a link).
    const link = clean(svg('<a href="javascript:alert(1)"><rect/></a>'))
    expect(link.toLowerCase()).not.toContain('<a ')
    expect(link.toLowerCase()).not.toContain('javascript:')
  })
})

describe('sanitizeEpcSvg — attribute allowlist', () => {
  it('strips on* event handlers but keeps the element and its presentation attrs', () => {
    const out = clean(svg('<rect onclick="steal()" onmouseover="x()" fill="red" x="1"/>'))
    const lower = out.toLowerCase()
    expect(lower).not.toContain('onclick')
    expect(lower).not.toContain('onmouseover')
    expect(lower).toContain('<rect')
    expect(lower).toContain('fill="red"')
  })

  it('preserves data-epc-node / data-epc-edge anchors and aria/data attributes', () => {
    const out = clean(
      svg('<g data-epc-node="n-1" data-aris-kind="event" aria-label="Start"><circle r="3"/></g>')
    )
    expect(out).toContain('data-epc-node="n-1"')
    expect(out).toContain('data-aris-kind="event"')
    expect(out).toContain('aria-label="Start"')
  })

  it('drops href/xlink:href unless it is a same-document #fragment', () => {
    const external = clean(svg('<use href="https://evil.example/x#y" x="1"/>'))
    expect(external.toLowerCase()).not.toContain('evil.example')
    const js = clean(svg('<use xlink:href="javascript:alert(1)" x="1"/>'))
    expect(js.toLowerCase()).not.toContain('javascript:')
    // Internal fragment survives (e.g. a marker/def reference).
    const internal = clean(svg('<use href="#marker-1" x="1"/>'))
    expect(internal).toContain('href="#marker-1"')
  })

  it('allows internal url(#id) refs but drops external url(...) and expression()', () => {
    const internal = clean(svg('<rect clip-path="url(#aris-caption-clip-1)" x="1"/>'))
    expect(internal).toContain('clip-path="url(#aris-caption-clip-1)"')

    const external = clean(svg('<rect clip-path="url(https://evil.example/x)" fill="red" x="1"/>'))
    expect(external.toLowerCase()).not.toContain('evil.example')
    expect(external.toLowerCase()).toContain('fill="red"') // unrelated attr kept

    const styleExternal = clean(svg('<rect style="fill:url(https://evil.example/x)" x="1"/>'))
    expect(styleExternal.toLowerCase()).not.toContain('evil.example')
    const styleSafe = clean(svg('<rect style="fill:red;stroke:black" x="1"/>'))
    expect(styleSafe.toLowerCase()).toContain('fill:red')

    const expr = clean(svg('<rect style="width:expression(alert(1))" x="1"/>'))
    expect(expr.toLowerCase()).not.toContain('expression(')
  })
})

describe('sanitizeEpcSvg — input guards', () => {
  it('throws on non-<svg> root', () => {
    expect(() => clean('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toThrow(
      /root element must be <svg>/
    )
  })

  it('throws on malformed XML', () => {
    expect(() => clean('<svg><rect></svg>')).toThrow(/not well-formed/)
  })
})

describe('RECOMMENDED_VERIFICATION_CSP', () => {
  it('carries no unsafe-inline script-src and locks down the dangerous fetch surfaces', () => {
    expect(RECOMMENDED_VERIFICATION_CSP).toContain("default-src 'self'")
    expect(RECOMMENDED_VERIFICATION_CSP).toContain("script-src 'self'")
    expect(RECOMMENDED_VERIFICATION_CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(RECOMMENDED_VERIFICATION_CSP).toContain("object-src 'none'")
    expect(RECOMMENDED_VERIFICATION_CSP).toContain("base-uri 'none'")
  })
})

const countTag = (markup: string, tag: string): number =>
  (markup.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length

describe('sanitizeEpcSvg — real engine output', () => {
  it('is non-destructive on a clean render: all anchors + every <path>/<text>/<rect> preserved', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')
    // Default DOM: renderCanonicalProcess already booted the headless globals.
    const out = sanitizeEpcSvg(result.svg)

    for (const node of VALID_CANONICAL_FULL.nodes) {
      expect(out).toContain(`data-epc-node="${node.id}"`)
    }
    for (const edge of VALID_CANONICAL_FULL.edges) {
      expect(out).toContain(`data-epc-edge="${edge.id}"`)
    }
    // The allowlist covers the engine's real vocabulary — no legit shapes dropped.
    expect(countTag(out, 'path')).toBe(countTag(result.svg, 'path'))
    expect(countTag(out, 'text')).toBe(countTag(result.svg, 'text'))
    expect(countTag(out, 'rect')).toBe(countTag(result.svg, 'rect'))
  })

  it('neutralizes dangerous markup injected into real engine output, keeping anchors', async () => {
    const result = await renderCanonicalProcess(VALID_CANONICAL_FULL)
    if (!result.ok) throw new Error('expected a successful render')

    // Defense in depth: the engine escapes its OWN labels, so live markup cannot
    // arise on its happy path — which is exactly why a portal must not rely on
    // that. Simulate a tampered / future-changed SVG by splicing a <script>, a
    // <foreignObject>-wrapped handler, and an inline on* handler onto an existing
    // anchored element, then prove the sanitizer removes all of it.
    const tampered = result.svg
      .replace(
        /(<svg\b[^>]*>)/,
        '$1<script>steal()</script>' +
          '<foreignObject width="10" height="10">' +
          '<div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="steal()"/></div>' +
          '</foreignObject>'
      )
      .replace(/data-epc-node="n-start"/, 'data-epc-node="n-start" onclick="steal()"')

    const out = sanitizeEpcSvg(tampered)
    const parsed = new dom.DOMParser().parseFromString(out, 'image/svg+xml')
    expect(parsed.getElementsByTagName('parsererror').length).toBe(0)

    const dangerous = new Set(['script', 'foreignobject', 'style', 'image', 'a', 'iframe'])
    for (const element of Array.from(parsed.getElementsByTagName('*'))) {
      expect(dangerous.has(element.localName.toLowerCase())).toBe(false)
      for (const attr of Array.from(element.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false)
        if (attr.name.toLowerCase().endsWith('href')) {
          expect(attr.value.trim().startsWith('#')).toBe(true)
        }
      }
    }
    // The anchors (the whole point of inlining the SVG) survive sanitization.
    for (const node of VALID_CANONICAL_FULL.nodes) {
      expect(out).toContain(`data-epc-node="${node.id}"`)
    }
    for (const edge of VALID_CANONICAL_FULL.edges) {
      expect(out).toContain(`data-epc-edge="${edge.id}"`)
    }
  })
})
