import { describe, expect, it } from 'vitest'

import { arisColorToCss, resolveBrush, resolvePen } from './color'

const NOWHERE = { modelId: 'Model.1', elementId: 'ObjOcc.1', sourceId: 'ObjOcc.1' }

describe('arisColorToCss — real AnimalWF hex encodings', () => {
  it('parses unpadded lowercase hex as 0xRRGGBB and left-pads to 6 digits', () => {
    expect(arisColorToCss('339900')).toBe('#339900')
    expect(arisColorToCss('d7c49d')).toBe('#d7c49d')
    // Short strings are missing high-byte zeros, not a 2-digit gray: "99" == 0x000099 (blue).
    expect(arisColorToCss('99')).toBe('#000099')
    expect(arisColorToCss('0')).toBe('#000000')
  })

  it('treats "-1" as the Windows CLR_NONE "no override" sentinel, not a color', () => {
    expect(arisColorToCss('-1')).toBeUndefined()
  })

  it('treats null/empty as no color', () => {
    expect(arisColorToCss(null)).toBeUndefined()
    expect(arisColorToCss('')).toBeUndefined()
  })
})

describe('resolvePen', () => {
  it('maps Style="0" to solid with no dash pattern', () => {
    const { pen, findings } = resolvePen({ ownerSourceId: 'x', color: '996600', style: '0', width: 1 }, NOWHERE)
    expect(pen.color).toBe('#996600')
    expect(pen.style).toBe('solid')
    expect(pen.dasharray).toBeNull()
    expect(pen.visible).toBe(true)
    expect(findings).toHaveLength(0)
  })

  it('maps the documented PS_* style codes 1-5 to dash/dot/invisible', () => {
    expect(resolvePen({ ownerSourceId: 'x', color: '0', style: '1', width: 1 }, NOWHERE).pen.style).toBe('dash')
    expect(resolvePen({ ownerSourceId: 'x', color: '0', style: '2', width: 1 }, NOWHERE).pen.style).toBe('dot')
    expect(resolvePen({ ownerSourceId: 'x', color: '0', style: '5', width: 1 }, NOWHERE).pen.style).toBe('invisible')
    expect(resolvePen({ ownerSourceId: 'x', color: '0', style: '5', width: 1 }, NOWHERE).pen.visible).toBe(false)
  })

  it('reports unsupported-pen-effect and falls back to solid for codes outside 0-5', () => {
    const { pen, findings } = resolvePen({ ownerSourceId: 'x', color: '0', style: '42', width: 1 }, NOWHERE)
    expect(pen.style).toBe('solid')
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('unsupported-pen-effect')
    expect(findings[0].params.style).toBe('42')
  })

  it('returns a default pen with no findings when the source carries no Pen at all', () => {
    const { pen, findings } = resolvePen(null, NOWHERE)
    expect(pen.color).toBeUndefined()
    expect(pen.source).toBeNull()
    expect(findings).toHaveLength(0)
  })
})

describe('resolveBrush', () => {
  it('renders TRANSPARENT as no fill regardless of the numeric color', () => {
    const { brush, findings } = resolveBrush({ ownerSourceId: 'x', color: '0', color2: '0', brushType: 'TRANSPARENT' }, NOWHERE)
    expect(brush.fill).toBe('none')
    expect(brush.kind).toBe('transparent')
    expect(findings).toHaveLength(0)
  })

  it('renders SOLID with the mapped color', () => {
    const { brush } = resolveBrush({ ownerSourceId: 'x', color: 'b6dce9', color2: '0', brushType: 'SOLID' }, NOWHERE)
    expect(brush.fill).toBe('#b6dce9')
    expect(brush.kind).toBe('solid')
  })

  it('reports unsupported-brush-effect for hatch/pattern brush types and falls back to solid', () => {
    const { brush, findings } = resolveBrush({ ownerSourceId: 'x', color: '996600', color2: '0', brushType: 'BDIAGONAL' }, NOWHERE)
    expect(brush.kind).toBe('unsupported-pattern')
    expect(brush.fill).toBe('#996600')
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('unsupported-brush-effect')
    expect(findings[0].params.brushType).toBe('BDIAGONAL')
  })
})
