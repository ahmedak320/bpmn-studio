import { describe, expect, it } from 'vitest'

import {
  ARIS_MODEL_UNITS_PER_POINT,
  arisFontFaceToCssFamily,
  arisLogicalHeightToFontSize,
  arisPointsToFontSize,
  primaryFontNode,
  resolveCatalogFont,
  resolveFontStyleSheetNodes,
  type ArisSourceFontNodeLike
} from './fontStyleSheet'
import type { ArisStyleCatalog } from './types'

/**
 * The `FontStyleSheet` → working-catalog resolution (V8). The size transform
 * is calibrated against the paired AnimalWF PDFs: a `Height="-10"` English
 * Arial node is 35.278 canvas units on the 670-unit function card, which is
 * the cap-height/line-pitch ratio the reference pages show.
 */
describe('arisLogicalHeightToFontSize', () => {
  it('reads a negative LOGFONT height as points, projected to canvas units', () => {
    expect(ARIS_MODEL_UNITS_PER_POINT).toBeCloseTo(254 / 72, 6)
    expect(arisLogicalHeightToFontSize(-10)).toBeCloseTo(35.278, 3)
    expect(arisLogicalHeightToFontSize(-13)).toBeCloseTo(45.861, 3)
    expect(arisLogicalHeightToFontSize(-12)).toBeCloseTo(42.333, 3)
    expect(arisLogicalHeightToFontSize(-11)).toBeCloseTo(38.806, 3)
  })

  it('returns null for an unusable height and takes a positive one at magnitude', () => {
    expect(arisLogicalHeightToFontSize(null)).toBeNull()
    expect(arisLogicalHeightToFontSize(undefined)).toBeNull()
    expect(arisLogicalHeightToFontSize(0)).toBeNull()
    expect(arisLogicalHeightToFontSize(Number.NaN)).toBeNull()
    expect(arisLogicalHeightToFontSize(10)).toBeCloseTo(35.278, 3)
  })

  it('projects an explicit point size identically (a SizeElement run override)', () => {
    expect(arisPointsToFontSize(10)).toBeCloseTo(35.278, 3)
    expect(arisPointsToFontSize(8)).toBeCloseTo(28.222, 3)
  })
})

describe('arisFontFaceToCssFamily', () => {
  it('pins the known faces to metric-compatible stacks', () => {
    expect(arisFontFaceToCssFamily('Arial')).toBe('Arial, Helvetica, sans-serif')
    expect(arisFontFaceToCssFamily('Times New Roman')).toBe('"Times New Roman", Times, serif')
    expect(arisFontFaceToCssFamily('Calibri')).toBe('Calibri, "Segoe UI", sans-serif')
    expect(arisFontFaceToCssFamily('SansSerif')).toBe('sans-serif')
    expect(arisFontFaceToCssFamily('Simplified Arabic')).toBe(
      '"Noto Sans Arabic", Arial, sans-serif'
    )
  })

  it('passes an unknown face through with a generic tail, and null for none', () => {
    expect(arisFontFaceToCssFamily('Exotic Face')).toBe('"Exotic Face", sans-serif')
    expect(arisFontFaceToCssFamily(null)).toBeNull()
    expect(arisFontFaceToCssFamily('  ')).toBeNull()
  })
})

function fontNode(
  ownerSourceId: string,
  overrides: Partial<ArisSourceFontNodeLike['parsed']> = {}
): ArisSourceFontNodeLike {
  return {
    parsed: {
      ownerSourceId,
      localeId: '1033',
      faceName: 'Arial',
      height: -10,
      weight: 400,
      italic: 'NO',
      color: '#000000',
      ...overrides
    }
  }
}

describe('resolveFontStyleSheetNodes', () => {
  it('resolves every node of the sheet, per locale', () => {
    const nodes = resolveFontStyleSheetNodes('FontSS.1', [
      fontNode('FontSS.1', { localeId: '14337', height: -13 }),
      fontNode('FontSS.1'),
      fontNode('FontSS.other')
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      localeId: '14337',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 45.861,
      fontWeight: '400',
      fontStyle: null,
      textColor: '#000000'
    })
    expect(nodes[1]).toMatchObject({ localeId: '1033', fontSize: 35.278 })
  })

  it('marks italic nodes and leaves weight null when the source omits it', () => {
    const nodes = resolveFontStyleSheetNodes('FontSS.1', [
      fontNode('FontSS.1', { italic: 'YES', weight: null })
    ])
    expect(nodes[0]?.fontStyle).toBe('italic')
    expect(nodes[0]?.fontWeight).toBeNull()
  })
})

describe('primaryFontNode', () => {
  it('prefers the English node, then the first', () => {
    const english = Object.freeze({
      localeId: '1033',
      fontFamily: null,
      fontSize: 35.278,
      fontWeight: null,
      fontStyle: null,
      textColor: null
    })
    const arabic = Object.freeze({ ...english, localeId: '14337', fontSize: 45.861 })
    expect(primaryFontNode([arabic, english])).toBe(english)
    expect(primaryFontNode([arabic])).toBe(arabic)
    expect(primaryFontNode([])).toBeUndefined()
  })
})

describe('resolveCatalogFont', () => {
  const catalog: ArisStyleCatalog = Object.freeze({
    styles: Object.freeze(
      new Map([
        [
          'FontSS.1',
          Object.freeze({
            id: 'FontSS.1',
            fillColor: null,
            strokeColor: null,
            strokeWidth: null,
            lineStyle: null,
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: 35.278,
            fontWeight: '400',
            textColor: '#000000',
            zOrder: null,
            fontNodes: Object.freeze([
              Object.freeze({
                localeId: '14337',
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: 45.861,
                fontWeight: '400',
                fontStyle: null,
                textColor: '#000000'
              }),
              Object.freeze({
                localeId: '1033',
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: 35.278,
                fontWeight: '400',
                fontStyle: null,
                textColor: '#ff0000'
              })
            ])
          })
        ]
      ])
    )
  })

  it('picks the node for the requested locale, by exact id then by language', () => {
    expect(resolveCatalogFont(catalog, 'FontSS.1', '1033')).toMatchObject({ fontSize: 35.278 })
    expect(resolveCatalogFont(catalog, 'FontSS.1', 'en-US')).toMatchObject({ fontSize: 35.278 })
    expect(resolveCatalogFont(catalog, 'FontSS.1', 'ar-AE')).toMatchObject({ fontSize: 45.861 })
    expect(resolveCatalogFont(catalog, 'FontSS.1', '14337')).toMatchObject({ fontSize: 45.861 })
  })

  it('keeps per-locale text colors', () => {
    expect(resolveCatalogFont(catalog, 'FontSS.1', 'en-US')?.textColor).toBe('#ff0000')
    expect(resolveCatalogFont(catalog, 'FontSS.1', 'ar-AE')?.textColor).toBe('#000000')
  })

  it('falls back to the scalar fields and to null for unknown sheets', () => {
    const legacy: ArisStyleCatalog = Object.freeze({
      styles: Object.freeze(
        new Map([
          [
            'FontSS.legacy',
            Object.freeze({
              id: 'FontSS.legacy',
              fillColor: null,
              strokeColor: null,
              strokeWidth: null,
              lineStyle: null,
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              fontWeight: '700',
              textColor: '#123456',
              zOrder: null
            })
          ]
        ])
      )
    })
    expect(resolveCatalogFont(legacy, 'FontSS.legacy', 'en-US')).toMatchObject({
      fontFamily: 'Arial, sans-serif',
      fontSize: 9,
      fontWeight: '700',
      textColor: '#123456'
    })
    expect(resolveCatalogFont(catalog, 'FontSS.missing', 'en-US')).toBeNull()
    expect(resolveCatalogFont(catalog, null, 'en-US')).toBeNull()
  })
})
