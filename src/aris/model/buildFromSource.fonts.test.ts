import { describe, expect, it } from 'vitest'

import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { buildFromSource } from './buildFromSource'

/**
 * The working style catalog's font resolution from real `<FontStyleSheet>` /
 * `<FontNode>` records (V8): family, size (negative `LOGFONT` height as
 * points), weight, italic and colour — per locale, since ARIS sizes English
 * and Arabic text differently in the same sheet.
 */
const FONT_SHEET_AML = `<AML>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.1" Model.Type="MT_EEPC" />
  </Group>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <FontNode LocaleId="14337" FaceName="Arial" Height="-13" Weight="400" Italic="NO" Color="0" />
    <FontNode LocaleId="1033" FaceName="Arial" Height="-10" Weight="400" Italic="NO" Color="0" />
  </FontStyleSheet>
  <FontStyleSheet FontSS.ID="FontSS.2">
    <FontNode LocaleId="1033" FaceName="Times New Roman" Height="-11" Weight="700" Italic="YES" Color="ff" />
  </FontStyleSheet>
</AML>`

function buildDocumentFromXml(xml: string) {
  const semantic = buildSemanticArisDocument(tokenizeXmlDocument(xml))
  return buildFromSource(semantic.index)
}

describe('buildFromSource — FontStyleSheet resolution (V8)', () => {
  it('resolves family, size, weight, italic and colour per locale node', () => {
    const document = buildDocumentFromXml(FONT_SHEET_AML)
    const sheet = document.styleCatalog.styles.get('FontSS.1')
    expect(sheet?.fontNodes).toHaveLength(2)
    const arabic = sheet?.fontNodes?.find((node) => node.localeId === '14337')
    const english = sheet?.fontNodes?.find((node) => node.localeId === '1033')
    expect(arabic).toMatchObject({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 45.861,
      fontWeight: '400',
      fontStyle: null,
      textColor: '#000000'
    })
    expect(english).toMatchObject({ fontSize: 35.278, textColor: '#000000' })
  })

  it('keeps the English node as the sheet scalar for the default canvas locale', () => {
    const document = buildDocumentFromXml(FONT_SHEET_AML)
    const sheet = document.styleCatalog.styles.get('FontSS.1')
    expect(sheet).toMatchObject({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 35.278,
      fontWeight: '400',
      textColor: '#000000'
    })
  })

  it('decodes COLORREF colours and maps faces, weights and italics', () => {
    const document = buildDocumentFromXml(FONT_SHEET_AML)
    const sheet = document.styleCatalog.styles.get('FontSS.2')
    expect(sheet).toMatchObject({
      fontFamily: '"Times New Roman", Times, serif',
      fontSize: 38.806,
      fontWeight: '700',
      textColor: '#ff0000'
    })
    expect(sheet?.fontNodes?.[0]?.fontStyle).toBe('italic')
  })
})
