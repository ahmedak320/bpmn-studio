// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { ar, en } from '../../i18n/dictionaries'
import { ARIS_CONVENTION_SYMBOLS, conventionDefaultFill } from '../conventions/catalog'
import { buildArisLegend, drawArisLegend, drawLegendSymbol, type PrintFrameRect } from './legend'
import { SVG_NS } from './svg'

/**
 * The DMT bottom legend: the lane's 22 catalog presentations in the reference
 * sheet's arrangement, bilingual names from the registered dictionaries, and
 * the four-row RACI key. Drawn from shared symbol descriptors, never from
 * palette widget artwork.
 */

const BOUNDS: PrintFrameRect = Object.freeze({ x: 450, y: 8139, width: 3800, height: 622 })

/** The 22 presentations the DMT sheet lists, per the lane contract. */
const EXPECTED_CATALOG_IDS = [
  'epc.event',
  'decision.and',
  'decision.xor',
  'decision.or',
  'epc.process-interface',
  'epc.function',
  'epc.system-function',
  'information.document',
  'information.email',
  'information.sms',
  'information.letter',
  'technology.application-system',
  'performance.measure',
  'data.requirement',
  'governance.risk',
  'organization.committee-team',
  'organization.related-entity',
  'organization.external-person',
  'organization.role',
  'governance.business-rule',
  'governance.law-regulation',
  'service.product-service'
]

describe('buildArisLegend — layout and content', () => {
  it('lays out exactly the 22 DMT presentations plus the four RACI rows', () => {
    const legend = buildArisLegend(BOUNDS)
    expect(legend.tiles.map((tile) => tile.catalogId).sort()).toEqual(
      [...EXPECTED_CATALOG_IDS].sort()
    )
    expect(legend.raci.rows.map((row) => row.letter)).toEqual(['R', 'A', 'C', 'I'])
  })

  it('keeps four rows so no existing tile narrows when the operator tiles are added', () => {
    const legend = buildArisLegend(BOUNDS)
    // inset = round(622 * 0.08) = 50; four rows ⇒ (622 − 100) / 4 = 130.5. The
    // operator circles append under Event in column 1, which already matched the
    // four-row columns, so the row count — and every tile's height — is unchanged.
    const heights = new Set(legend.tiles.map((tile) => tile.bounds.height))
    expect(heights).toEqual(new Set([130.5]))
  })

  it('keeps every tile and the RACI block inside the legend bounds', () => {
    const legend = buildArisLegend(BOUNDS)
    for (const tile of legend.tiles) {
      expect(tile.bounds.x).toBeGreaterThanOrEqual(BOUNDS.x)
      expect(tile.bounds.y).toBeGreaterThanOrEqual(BOUNDS.y)
      expect(tile.bounds.x + tile.bounds.width).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width)
      expect(tile.bounds.y + tile.bounds.height).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height)
    }
    expect(legend.raci.bounds.x + raciRight(legend)).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.width)
  })

  it('names every tile from the registered dictionaries in both languages', () => {
    const legend = buildArisLegend(BOUNDS)
    for (const tile of legend.tiles) {
      const entry = ARIS_CONVENTION_SYMBOLS.find((symbol) => symbol.catalogId === tile.catalogId)
      expect(entry, tile.catalogId).toBeDefined()
      const key = entry!.labelKey as keyof typeof en
      expect(tile.nameEn).toBe(en[key])
      expect(tile.nameAr).toBe(ar[key])
    }
    expect(legend.tiles.find((tile) => tile.catalogId === 'epc.function')?.nameEn).toBe('Function')
  })

  it('labels the RACI rows with their convention names', () => {
    const legend = buildArisLegend(BOUNDS)
    expect(legend.raci.rows.map((row) => row.label)).toEqual([
      'Responsible',
      'Approval',
      'Consulted',
      'Informed'
    ])
  })
})

function raciRight(legend: ReturnType<typeof buildArisLegend>): number {
  return legend.raci.bounds.width
}

describe('drawLegendSymbol — descriptor painting', () => {
  it('draws every legend presentation from its shared descriptor', () => {
    for (const catalogId of EXPECTED_CATALOG_IDS) {
      const symbol = drawLegendSymbol(catalogId, 140, 90)
      expect(symbol, catalogId).not.toBeNull()
      expect(symbol!.getAttribute('data-aris-legend-symbol')).toBe(catalogId)
      expect(symbol!.childElementCount).toBeGreaterThan(0)
    }
  })

  it('paints the accent from the same catalog contract the canvas uses', () => {
    const fn = drawLegendSymbol('epc.function', 140, 90)!
    const event = drawLegendSymbol('epc.event', 140, 90)!
    const accentFill = (root: SVGElement): string | null =>
      root.querySelector('[data-aris-part="accent"]')?.getAttribute('fill') ??
      root.querySelector('[data-aris-part="band"]')?.getAttribute('fill') ??
      null
    // The descriptor-authored accent, not a guessed constant: the legend must
    // match whatever the convention catalog makes the canvas paint.
    expect(accentFill(fn)).toBe(conventionDefaultFill('OT_FUNC', 'ST_FUNC'))
    expect(accentFill(fn)).toBe('#339933')
    expect(accentFill(event)).toBe(conventionDefaultFill('OT_EVT', 'ST_EV'))
    expect(accentFill(event)).toBe('#edbbdc')
  })

  it('returns null for an unknown catalog id rather than inventing artwork', () => {
    expect(drawLegendSymbol('no.such-presentation', 140, 90)).toBeNull()
  })
})

describe('drawArisLegend — SVG output', () => {
  it('appends the framed legend with one group per tile and the RACI key', () => {
    const parent = document.createElementNS(SVG_NS, 'g')
    drawArisLegend(parent, buildArisLegend(BOUNDS))
    const group = parent.querySelector('[data-aris-print-frame-legend]')
    expect(group).not.toBeNull()
    expect(group!.querySelectorAll('[data-aris-legend-symbol]')).toHaveLength(22)
    const raci = group!.querySelector('[data-aris-print-frame-raci]')
    expect(raci).not.toBeNull()
    expect(raci!.textContent).toContain('RACI')
    for (const letter of ['R', 'A', 'C', 'I']) {
      expect(raci!.textContent).toContain(letter)
    }
  })
})
