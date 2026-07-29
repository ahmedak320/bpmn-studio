import { describe, expect, it } from 'vitest'

import { resolveFont } from './font'

const IDENTITY = { modelId: 'Model.1', elementId: 'ObjOcc.1', sourceId: 'ObjOcc.1' }

describe('resolveFont', () => {
  it('maps a safe Latin face to a CSS stack with no fidelity finding', () => {
    const { font, findings } = resolveFont(
      {
        ownerSourceId: 'x',
        localeId: '1033',
        locale: 'en',
        faceName: 'Arial',
        height: -13,
        weight: 400,
        italic: 'NO',
        underline: 'NO',
        strikeOut: 'NO',
        color: '0'
      },
      'Register Owner',
      IDENTITY
    )
    expect(font.fontFamily).toContain('Arial')
    expect(font.faceAvailable).toBe(true)
    expect(font.sizePx).toBe(13)
    expect(font.weight).toBe(400)
    expect(font.direction).toBe('ltr')
    expect(findings).toHaveLength(0)
  })

  it('reports missing-font for a proprietary face outside the allowlist (e.g. "Simplified Arabic")', () => {
    const { font, findings } = resolveFont(
      {
        ownerSourceId: 'x',
        localeId: '14337',
        locale: 'ar',
        faceName: 'Simplified Arabic',
        height: -13,
        weight: 400,
        italic: 'NO',
        underline: 'NO',
        strikeOut: 'NO',
        color: '0'
      },
      'تسجيل المالك',
      IDENTITY
    )
    expect(font.faceAvailable).toBe(false)
    expect(font.requestedFaceName).toBe('Simplified Arabic')
    expect(font.direction).toBe('rtl')
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('missing-font')
    expect(findings[0].params.faceName).toBe('Simplified Arabic')
  })

  it('converts negative LOGFONT height to a positive pixel size', () => {
    const { font } = resolveFont(
      {
        ownerSourceId: 'x',
        localeId: null,
        locale: undefined,
        faceName: 'Arial',
        height: -16,
        weight: 700,
        italic: 'YES',
        underline: 'YES',
        strikeOut: 'NO',
        color: '0'
      },
      'x',
      IDENTITY
    )
    expect(font.sizePx).toBe(16)
    expect(font.weight).toBe(700)
    expect(font.italic).toBe(true)
    expect(font.underline).toBe(true)
    expect(font.strikeOut).toBe(false)
  })

  it('defaults sensibly when no font record is present at all', () => {
    const { font, findings } = resolveFont(null, 'plain text', IDENTITY)
    expect(font.faceAvailable).toBe(true)
    expect(font.sizePx).toBeGreaterThan(0)
    expect(findings).toHaveLength(0)
  })

  it('uses an Arabic-appropriate fallback stack for Arabic script text with no requested face', () => {
    const { font } = resolveFont(null, 'إدارة الحيوان', IDENTITY)
    expect(font.direction).toBe('rtl')
    expect(font.fontFamily.toLowerCase()).toContain('arabic')
  })
})
