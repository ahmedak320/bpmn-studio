// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource } from '../model/buildFromSource'
import {
  ARIS_LABEL_LINE_HEIGHT,
  applyRunOverrides,
  labelFontWeight,
  layoutAnchoredLines,
  layoutLabelLines,
  measureTextWidth,
  normalizeLabelParagraphs,
  resolveAttributePlacementFont,
  resolveFreeTextFont,
  resolveLocalizedEntry,
  resolveOccurrenceCaptionFont,
  styledRunOverrides,
  wrapLabelLines
} from './typography'

describe('normalizeLabelParagraphs', () => {
  it('splits hard breaks, trims AML tab padding and drops empty paragraphs', () => {
    expect(normalizeLabelParagraphs('E-mail\r\n\t\t\t\t\t\t\r\n\t\t\t\r\n')).toEqual(['E-mail'])
    expect(
      normalizeLabelParagraphs('Requirements:\r\n\t- Applicant is 18\t\r\n\t- Has ID')
    ).toEqual(['Requirements:', '- Applicant is 18', '- Has ID'])
    expect(normalizeLabelParagraphs('plain')).toEqual(['plain'])
    expect(normalizeLabelParagraphs('')).toEqual([])
    expect(normalizeLabelParagraphs('  \r\n  ')).toEqual([])
  })
})

describe('wrapLabelLines', () => {
  it('keeps a line that fits, wraps a long one on word boundaries', () => {
    expect(wrapLabelLines('short', 400, 35.278)).toEqual(['short'])
    const lines = wrapLabelLines(
      'Login to TAMM portal and select the Pet Owner Registration',
      250,
      35.278
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe('Login to TAMM portal and select the Pet Owner Registration')
  })

  it('preserves explicit paragraphs and treats a null width as unconstrained', () => {
    expect(wrapLabelLines('one\rtwo', null, 35.278)).toEqual(['one', 'two'])
    expect(wrapLabelLines('a very long single line that never wraps', null, 35.278)).toEqual([
      'a very long single line that never wraps'
    ])
    expect(wrapLabelLines('', 100, 35.278)).toEqual([''])
  })

  it('defaults to the regular Helvetica table, and measures wider (more wraps) with weight="bold"', () => {
    const text = 'Approve the User Terms and Conditions'
    // Un-weighted call keeps today's behavior: regular table, same as passing 'regular'.
    // Width 240 keeps every individual word inside the box (no hard char-break),
    // so the wider bold advances show purely as one extra word-wrap.
    expect(wrapLabelLines(text, 240, 35.278)).toEqual(wrapLabelLines(text, 240, 35.278, 'regular'))
    const regularLines = wrapLabelLines(text, 240, 35.278, 'regular')
    const boldLines = wrapLabelLines(text, 240, 35.278, 'bold')
    expect(boldLines.length).toBeGreaterThan(regularLines.length)
    expect(boldLines.join(' ')).toBe(text)
  })

  it('hard-breaks a single unbreakable token wider than the box, every line fitting the width', () => {
    // `Laws/Policies/Regulations` is the reference free-text title's longest
    // token; with no whitespace to wrap on, the greedy word loop would leave
    // it a single overflowing line without a per-character fallback.
    const lines = wrapLabelLines('Laws/Policies/Regulations', 60, 12)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(measureTextWidth(line, 12)).toBeLessThanOrEqual(60)
    }
  })

  it('hard-breaks an overlong Arabic token into chunks that each fit the width', () => {
    // A 30-char Arabic run with no spaces (the reserve keeps chunks inside 96%
    // of the box, so the painted glyphs never spill past the estimated edge).
    const token = 'مططططططططططططططططططططططططططط' // 29 medium+narrow glyphs, no whitespace
    const lines = wrapLabelLines(token, 50, 12)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(measureTextWidth(line, 12)).toBeLessThanOrEqual(50)
    }
  })

  it('wraps an Arabic paragraph earlier than a same-width Latin control', () => {
    // Same box, same size: the 4% Arabic reserve plus wider medium-tier
    // advances make the Arabic run break into at least as many lines as the
    // Latin control, and strictly more for these matched-length strings.
    const width = 220
    const size = 20
    const arabic = 'قرار رئيس دائرة التخطيط العمراني والبلدية المحلية لمدينة'
    const latin = 'aa aa aa aa aa aa aa aa aa aa aa'
    const arabicLines = wrapLabelLines(arabic, width, size)
    const latinLines = wrapLabelLines(latin, width, size)
    expect(arabicLines.length).toBeGreaterThan(latinLines.length)
  })
})

describe('labelFontWeight', () => {
  it("reads a resolved CSS font-weight as the wrap engine's two-tier weight", () => {
    expect(labelFontWeight('700')).toBe('bold')
    expect(labelFontWeight('600')).toBe('bold')
    expect(labelFontWeight('bold')).toBe('bold')
    expect(labelFontWeight('Bold')).toBe('bold')
    expect(labelFontWeight('400')).toBe('regular')
    expect(labelFontWeight('normal')).toBe('regular')
    expect(labelFontWeight(null)).toBe('regular')
    expect(labelFontWeight(undefined)).toBe('regular')
  })
})

describe('layoutLabelLines', () => {
  it('centres the block vertically and anchors horizontally', () => {
    const layout = layoutLabelLines(['a', 'b', 'c'], { x: 10, y: 20, width: 100, height: 60 }, 20)
    expect(layout.lineHeight).toBeCloseTo(20 * ARIS_LABEL_LINE_HEIGHT, 3)
    expect(layout.lines.map((line) => line.x)).toEqual([60, 60, 60])
    const ys = layout.lines.map((line) => line.y)
    expect(ys[1]).toBeCloseTo(50, 3)
    expect(ys[0]).toBeCloseTo(50 - layout.lineHeight, 3)
    expect(ys[2]).toBeCloseTo(50 + layout.lineHeight, 3)
  })

  it('anchors at a point for unsized free-text notes', () => {
    const layout = layoutAnchoredLines(['a', 'b'], { x: 987, y: 114 }, 35.278)
    expect(layout.lines[0]?.x).toBe(987)
    expect((layout.lines[0]!.y + layout.lines[1]!.y) / 2).toBeCloseTo(114, 3)
  })
})

describe('styledRunOverrides', () => {
  const run = (elementName: string, rawAttributes: Record<string, string> = {}) => ({
    elementName,
    rawAttributes
  })

  it('reads Bold/Italic, the first Font face and the first SizeElement', () => {
    expect(
      styledRunOverrides([
        run('StyledElement'),
        run('Bold'),
        run('StyledElement'),
        run('Font', { Name: 'Arial' }),
        run('StyledElement'),
        run('SizeElement', { Value: '10' }),
        run('StyledElement'),
        run('PlainText', { TextValue: 'Process Code:' })
      ])
    ).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strikeOut: false,
      faceName: 'Arial',
      sizePoints: 10
    })
  })

  it('returns null for unformatted text and for no runs', () => {
    expect(
      styledRunOverrides([run('StyledElement'), run('Paragraph'), run('PlainText')])
    ).toBeNull()
    expect(styledRunOverrides([])).toBeNull()
    expect(styledRunOverrides(null)).toBeNull()
    expect(styledRunOverrides(undefined)).toBeNull()
  })

  it('layers overrides over a FontStyleSheet base', () => {
    const base = Object.freeze({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 35.278,
      fontWeight: '400',
      fontStyle: null,
      textColor: '#000000'
    })
    expect(
      applyRunOverrides(base, {
        bold: true,
        italic: false,
        underline: false,
        strikeOut: false,
        faceName: null,
        sizePoints: null
      })
    ).toMatchObject({ fontWeight: '700', fontSize: 35.278 })
    expect(
      applyRunOverrides(base, {
        bold: false,
        italic: false,
        underline: false,
        strikeOut: false,
        faceName: 'Times New Roman',
        sizePoints: 8
      })
    ).toMatchObject({
      fontFamily: '"Times New Roman", Times, serif',
      fontSize: 28.222,
      fontWeight: '400'
    })
    expect(applyRunOverrides(base, null)).toBe(base)
  })
})

// --- document-level resolution ------------------------------------------------

const TYPOGRAPHY_AML = `<AML>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.1" TypeNum="OT_FUNC">
      <AttrDef AttrDef.Type="AT_NAME">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="Login to TAMM portal"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
        <AttrValue LocaleId="14337">
          <StyledElement>
            <Paragraph Alignment="UNDEFINED" Indent="0"/>
              <StyledElement>
                <PlainText TextValue="تسجيل الدخول إلى TAMM"/>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
      <AttrDef AttrDef.Type="AT_ID">
        <AttrValue LocaleId="1033">
          <StyledElement>
            <Bold/>
              <StyledElement>
                <Paragraph Alignment="UNDEFINED" Indent="0"/>
                  <StyledElement>
                    <PlainText TextValue="01"/>
                  </StyledElement>
              </StyledElement>
          </StyledElement>
        </AttrValue>
      </AttrDef>
    </ObjDef>
    <Model Model.ID="Model.1" Model.Type="MT_EEPC">
      <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" SymbolNum="ST_FUNC">
        <Position Pos.X="765" Pos.Y="1707" />
        <Size Size.dX="670" Size.dY="240" />
        <AttrOcc AttrTypeNum="AT_ID" OffsetX="215" OffsetY="150" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
        <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" />
      </ObjOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="16">
        <Position Pos.X="987" Pos.Y="114" />
      </FFTextOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1" IsModelAttr="TEXT">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033">
        <StyledElement>
          <Bold/>
            <StyledElement>
              <SizeElement Value="10"/>
                <StyledElement>
                  <Font Name="Arial"/>
                    <StyledElement>
                      <Paragraph Alignment="UNDEFINED" Indent="0"/>
                        <StyledElement>
                          <PlainText TextValue="Process Code:"/>
                        </StyledElement>
                    </StyledElement>
                </StyledElement>
            </StyledElement>
        </StyledElement>
      </AttrValue>
    </AttrDef>
  </FFTextDef>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <FontNode LocaleId="14337" FaceName="Arial" Height="-13" Weight="400" Italic="NO" Color="0" />
    <FontNode LocaleId="1033" FaceName="Arial" Height="-10" Weight="400" Italic="NO" Color="0" />
  </FontStyleSheet>
</AML>`

const document = buildFromSource(
  buildSemanticArisDocument(tokenizeXmlDocument(TYPOGRAPHY_AML)).index
)

describe('resolveLocalizedEntry', () => {
  it('resolves the value the canvas displays, with the locale that supplied it', () => {
    const names = document.objectDefinitions.get('ObjDef.1')?.names
    expect(resolveLocalizedEntry(names, 'en-US')).toMatchObject({
      text: 'Login to TAMM portal',
      localeId: '1033'
    })
    expect(resolveLocalizedEntry(names, 'ar-AE')).toMatchObject({
      text: 'تسجيل الدخول إلى TAMM',
      localeId: '14337'
    })
    expect(resolveLocalizedEntry(null, 'en-US')).toBeNull()
  })
})

describe('resolveOccurrenceCaptionFont', () => {
  it('resolves the AT_NAME placement sheet plus the bold name runs, per locale', () => {
    expect(resolveOccurrenceCaptionFont(document, 'Model.1', 'ObjOcc.1', 'en-US')).toMatchObject({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 35.278,
      fontWeight: '700',
      textColor: '#000000'
    })
    // The Arabic name value is not bold in the source and uses the -13 node.
    expect(resolveOccurrenceCaptionFont(document, 'Model.1', 'ObjOcc.1', 'ar-AE')).toMatchObject({
      fontSize: 45.861,
      fontWeight: '400'
    })
  })

  it('returns null for an unknown occurrence', () => {
    expect(resolveOccurrenceCaptionFont(document, 'Model.1', 'ObjOcc.missing', 'en-US')).toBeNull()
  })
})

describe('resolveAttributePlacementFont', () => {
  it('resolves the numbering placement font: bold Arial from the AT_ID runs', () => {
    expect(
      resolveAttributePlacementFont(document, 'Model.1', 'ObjOcc.1', 'AT_ID', 'en-US')
    ).toMatchObject({ fontSize: 35.278, fontWeight: '700' })
  })
})

describe('resolveFreeTextFont', () => {
  it('resolves the header label: Bold + SizeElement 10 runs over the sheet', () => {
    expect(
      resolveFreeTextFont(
        document,
        'Model.1',
        document.models.get('Model.1')!.freeText[0]!.id,
        'en-US'
      )
    ).toMatchObject({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 35.278,
      fontWeight: '700'
    })
  })
})
