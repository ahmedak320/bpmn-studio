import { describe, expect, it } from 'vitest'

import { buildTextWrapFinding, measureTextWidth, wrapText } from './textWrap'

describe('wrapText', () => {
  it('keeps short text on one line and reports no wrap', () => {
    const { lines, wrapped } = wrapText('Owner', 200, 13)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Owner')
    expect(wrapped).toBe(false)
  })

  it('wraps long text across multiple lines deterministically', () => {
    const first = wrapText('Register and validate the animal owner application form', 120, 13)
    const second = wrapText('Register and validate the animal owner application form', 120, 13)
    expect(first.lines.length).toBeGreaterThan(1)
    expect(first.wrapped).toBe(true)
    expect(first.lines.map((l) => l.text)).toEqual(second.lines.map((l) => l.text))
  })

  it('treats a null max width as unconstrained (one line per hard break)', () => {
    const { lines, wrapped } = wrapText(
      'A very long line that would otherwise wrap many times over',
      null,
      13
    )
    expect(lines).toHaveLength(1)
    expect(wrapped).toBe(false)
  })

  it('respects explicit hard line breaks independently of width', () => {
    const { lines, wrapped } = wrapText('Line one\nLine two', 500, 13)
    expect(lines.map((l) => l.text)).toEqual(['Line one', 'Line two'])
    expect(wrapped).toBe(true)
  })

  it('hard-breaks a single word wider than the box', () => {
    const { lines } = wrapText('Supercalifragilisticexpialidocious', 40, 13)
    expect(lines.length).toBeGreaterThan(1)
  })

  it('measures width monotonically with text length', () => {
    expect(measureTextWidth('mm', 12)).toBeGreaterThan(measureTextWidth('m', 12))
    expect(measureTextWidth('', 12)).toBe(0)
  })
})

describe('buildTextWrapFinding', () => {
  it('emits a finding only when wrapping actually occurred', () => {
    const identity = { modelId: 'Model.1', elementId: 'ObjOcc.1', sourceId: 'ObjOcc.1' }
    expect(buildTextWrapFinding(false, identity)).toBeNull()
    const finding = buildTextWrapFinding(true, identity)
    expect(finding?.kind).toBe('text-wrap-difference')
    expect(finding?.elementId).toBe('ObjOcc.1')
  })
})
