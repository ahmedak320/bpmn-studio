import { describe, expect, it } from 'vitest'

import { tokenizeXmlDocument, XmlTokenizerError } from './xmlTokenizer'

describe('tokenizeXmlDocument', () => {
  it('captures declaration, doctype, comments, cdata, pi, and element nesting', () => {
    const document = tokenizeXmlDocument(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML [
  <!ENTITY Company "OrbitPM">
]>
<!-- header -->
<AML>
  <Header-Info DatabaseName="DMT" />
  <?orbitpm keep="yes"?>
  <Name><![CDATA[OrbitPM & Company]]></Name>
</AML>`)

    expect(document.rootElementName).toBe('AML')
    expect(document.nodeCount).toBeGreaterThan(4)
    expect(document.declaration?.encoding).toBe('UTF-8')
    expect(document.doctype?.name).toBe('AML')
    expect(document.doctype?.entityDeclarations).toHaveLength(1)
    expect(document.doctype?.entityDeclarations[0]?.name).toBe('Company')
    const root = document.children.find(
      (node): node is Extract<(typeof document.children)[number], { kind: 'element' }> =>
        node.kind === 'element'
    )
    if (!root || root.kind !== 'element') throw new Error('expected AML root element')
    expect(document.children.some((child) => child.kind === 'comment')).toBe(true)
    expect(root.children.some((child) => child.kind === 'processing-instruction')).toBe(true)
    expect(document.tokens.map((token) => token.kind)).toEqual(
      expect.arrayContaining([
        'xml-declaration',
        'doctype',
        'comment',
        'start-tag',
        'empty-tag',
        'processing-instruction',
        'cdata',
        'end-tag'
      ])
    )
    expect(document.maxDepth).toBe(2)
  })

  it('rejects duplicate attributes', () => {
    expect(() => tokenizeXmlDocument('<AML><Node a="1" a="2" /></AML>')).toThrowError(
      XmlTokenizerError
    )
    expect(() => tokenizeXmlDocument('<AML><Node a="1" a="2" /></AML>')).toThrow(
      /Duplicate XML attribute/u
    )
  })

  it('preserves external doctype ids without attempting to resolve them', () => {
    const document = tokenizeXmlDocument('<!DOCTYPE AML SYSTEM "ARIS-Export.dtd"><AML />')
    expect(document.doctype?.externalIdKind).toBe('system')
    expect(document.doctype?.externalIdLiteral).toBe('ARIS-Export.dtd')
    expect(document.children[0]).toMatchObject({ kind: 'element', name: 'AML' })
  })

  it('rejects malformed nesting', () => {
    expect(() => tokenizeXmlDocument('<AML><A></AML>')).toThrowError(XmlTokenizerError)
    expect(() => tokenizeXmlDocument('<AML><A></AML>')).toThrow(/does not match/u)
  })
})
