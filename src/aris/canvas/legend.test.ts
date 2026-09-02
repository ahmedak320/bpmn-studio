// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { ar, en } from '../../i18n/dictionaries'
import { ARIS_CONVENTION_SYMBOLS, conventionDefaultFill } from '../conventions/catalog'
import { buildArisLegend, drawArisLegend, drawLegendSymbol, type PrintFrameRect } from './legend'
import { SVG_NS } from './svg'
import { measureTextWidth } from './typography'

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

  it('labels the RACI rows bilingually from the registered dictionaries', () => {
    const legend = buildArisLegend(BOUNDS)
    expect(legend.raci.rows.map((row) => row.labelEn)).toEqual([
      'Responsible',
      'Approval',
      'Consulted',
      'Informed'
    ])
    expect(legend.raci.rows.map((row) => row.labelAr)).toEqual([
      'مسؤول عن التنفيذ',
      'الموافقة والاعتماد',
      'يستشار عند التنفيذ',
      'يُعلم بالتنفيذ أو النتيجة'
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

  it('draws each RACI row bilingual with the label right-pinned inside the box', () => {
    const legend = buildArisLegend(BOUNDS)
    const parent = document.createElementNS(SVG_NS, 'g')
    drawArisLegend(parent, legend)
    const raci = parent.querySelector('[data-aris-print-frame-raci]')!
    // Document order: the title text first, then per row a letter node
    // followed by its bilingual label node (mirrors the append order below).
    const texts = [...raci.querySelectorAll('text')]
    legend.raci.rows.forEach((row, index) => {
      const letterNode = texts[1 + index * 2]!
      const labelNode = texts[2 + index * 2]!
      expect(letterNode.textContent).toBe(`${row.letter}:`)
      expect(labelNode.textContent).toBe(`${row.labelAr}/${row.labelEn}`)
      expect(labelNode.textContent).toContain('/')
      // RTL layout: the bold badge letter sits to the right of its
      // right-pinned bilingual label, matching the printed legend.
      expect(Number(letterNode.getAttribute('x'))).toBeGreaterThan(
        Number(labelNode.getAttribute('x'))
      )
      // The label is Arabic (rtl); to pin its physical RIGHT edge at the anchor
      // and let it extend LEFT into the box, SVG needs `start` — NOT `end`
      // (which flips to the left edge under rtl and spills the text out).
      expect(labelNode.getAttribute('text-anchor')).toBe('start')
      expect(labelNode.getAttribute('direction')).toBe('rtl')
    })
  })

  it('keeps every RACI label inside the red box for narrow and wide legends', () => {
    // Issue 1B: the bilingual label extent must stay within the RACI box for a
    // tiny box (the 614-unit generated processes) and a huge one alike.
    for (const bounds of [
      Object.freeze({ x: 0, y: 0, width: 614, height: 110 }),
      Object.freeze({ x: 12, y: 40, width: 30657, height: 900 })
    ] as const) {
      const legend = buildArisLegend(bounds)
      const parent = document.createElementNS(SVG_NS, 'g')
      drawArisLegend(parent, legend)
      const raci = parent.querySelector('[data-aris-print-frame-raci]')!
      const box = legend.raci.bounds
      const labels = [...raci.querySelectorAll('text')].slice(1).filter((_node, i) => i % 2 === 1)
      expect(labels.length).toBe(legend.raci.rows.length)
      for (const label of labels) {
        const anchor = label.getAttribute('text-anchor')
        const rtl = label.getAttribute('direction') === 'rtl'
        const x = Number(label.getAttribute('x'))
        const font = Number(label.getAttribute('font-size'))
        const width = measureTextWidth(label.textContent ?? '', font)
        // For an rtl label drawn with `start`, x is the RIGHT edge; the run
        // extends left. Derive [left,right] from the anchor and assert the
        // extent lies inside the box.
        const right = anchor === 'start' && rtl ? x : anchor === 'end' ? x : x + width / 2
        const left = anchor === 'start' && rtl ? x - width : anchor === 'end' ? x - width : x - width / 2
        expect(left).toBeGreaterThanOrEqual(box.x - 0.5)
        expect(right).toBeLessThanOrEqual(box.x + box.width + 0.5)
      }
    }
  })

  it('draws the bilingual RACI title sized to fit the box', () => {
    const legend = buildArisLegend(BOUNDS)
    const parent = document.createElementNS(SVG_NS, 'g')
    drawArisLegend(parent, legend)
    const raci = parent.querySelector('[data-aris-print-frame-raci]')!
    const title = raci.querySelectorAll('text')[0]!
    expect(title.textContent).toBe(ar['aris.printFrame.raci.title'])
    const rowHeight = legend.raci.bounds.height / (legend.raci.rows.length + 1)
    expect(Number(title.getAttribute('font-size'))).toBeCloseTo(rowHeight * 0.34, 3)
  })
})
