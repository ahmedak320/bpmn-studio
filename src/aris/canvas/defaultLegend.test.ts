/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'

import type { DefaultsByKind } from '../canonical/defaults'
import { DEFAULT_LEGEND_CLASS, buildDefaultLegendLines, paintDefaultLegend } from './defaultLegend'
import { SVG_NS } from './svg'

const DEFAULTS: DefaultsByKind = {
  owner: { id: 'r-team', names: { en: 'Survey Team', ar: 'فريق الاستبيانات' } },
  system: { id: 's-email', names: { en: 'Email', ar: 'البريد الإلكتروني' } }
}

describe('buildDefaultLegendLines', () => {
  it('emits EN labels in fixed kind order', () => {
    const lines = buildDefaultLegendLines(DEFAULTS, 'en')
    expect(lines.map((line) => line.kind)).toEqual(['owner', 'system'])
    expect(lines[0]).toEqual({ kind: 'owner', label: 'Owner', value: 'Survey Team' })
    expect(lines[1]).toEqual({ kind: 'system', label: 'System', value: 'Email' })
  })

  it('emits AR labels + AR values on an AR render', () => {
    const lines = buildDefaultLegendLines(DEFAULTS, 'ar')
    expect(lines[0]).toEqual({ kind: 'owner', label: 'المالك', value: 'فريق الاستبيانات' })
    expect(lines[1].label).toBe('النظام')
  })

  it('falls back to the other locale when the requested one is absent', () => {
    const lines = buildDefaultLegendLines({ owner: { id: 'r', names: { en: 'Only EN' } } }, 'ar')
    expect(lines[0]?.value).toBe('Only EN')
  })

  it('skips kinds with no detected default', () => {
    const lines = buildDefaultLegendLines({ system: DEFAULTS.system }, 'en')
    expect(lines.map((line) => line.kind)).toEqual(['system'])
  })
})

describe('paintDefaultLegend', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 800 }

  function layer(): SVGGElement {
    return document.createElementNS(SVG_NS, 'g')
  }

  it('appends one legend group with the marker class and one text row per line', () => {
    const parent = layer()
    const group = paintDefaultLegend(parent, buildDefaultLegendLines(DEFAULTS, 'en'), bounds, 'en')
    expect(group).not.toBeNull()
    expect(parent.querySelectorAll(`g.${DEFAULT_LEGEND_CLASS}`).length).toBe(1)
    const texts = parent.querySelectorAll('text')
    expect(texts.length).toBe(2)
    // Right-anchored so the block hugs the top-right corner.
    expect(texts[0].getAttribute('text-anchor')).toBe('end')
    expect(texts[0].getAttribute('data-legend-kind')).toBe('owner')
    expect(parent.textContent).toContain('Owner')
    expect(parent.textContent).toContain('Survey Team')
  })

  it('marks Arabic rows rtl', () => {
    const parent = layer()
    paintDefaultLegend(parent, buildDefaultLegendLines(DEFAULTS, 'ar'), bounds, 'ar')
    const text = parent.querySelector('text')
    expect(text?.getAttribute('direction')).toBe('rtl')
    expect(parent.textContent).toContain('المالك')
  })

  it('places the block inside the right edge of the content bounds', () => {
    const parent = layer()
    paintDefaultLegend(parent, buildDefaultLegendLines(DEFAULTS, 'en'), bounds, 'en')
    const rect = parent.querySelector('rect')
    const x = Number(rect?.getAttribute('x'))
    const width = Number(rect?.getAttribute('width'))
    // Right edge sits at/inside bounds.x + bounds.width; box grows leftward.
    expect(x + width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(x).toBeGreaterThan(bounds.x)
  })

  it('is a no-op for an empty line set', () => {
    const parent = layer()
    expect(paintDefaultLegend(parent, [], bounds, 'en')).toBeNull()
    expect(parent.childNodes.length).toBe(0)
  })
})
