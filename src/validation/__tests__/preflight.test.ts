import { describe, expect, it } from 'vitest'
import {
  DEFAULT_XML_PREFLIGHT_LIMITS,
  preflightXml,
  sourceLocationAt
} from '../preflight'

const SAFE =
  '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:test"><process id="P"/></definitions>'

describe('secure XML preflight', () => {
  it('accepts bounded UTF-8 BPMN without mutating its text', () => {
    const result = preflightXml(`\uFEFF${SAFE}`)
    expect(result.safeToParse).toBe(true)
    expect(result.xml).toBe(SAFE)
    expect(result.metrics.elements).toBe(2)
    expect(result.summary.stages.preflight).toBe('passed')
  })

  it.each([
    ['DOCTYPE', `<!DOCTYPE definitions SYSTEM "https://attacker.invalid/bpmn.dtd">${SAFE}`, 'xml.doctype'],
    [
      'entity declarations',
      `<!DOCTYPE definitions [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${SAFE}`,
      'xml.entity-declaration'
    ],
    [
      'XInclude',
      SAFE.replace('<process id="P"/>', '<xi:include xmlns:xi="urn:xi" href="https://attacker.invalid/x"/>'),
      'xml.external-include'
    ],
    [
      'processing instructions',
      `<?xml-stylesheet href="https://attacker.invalid/x"?>>${SAFE}`,
      'xml.processing-instruction'
    ],
    [
      'non-UTF text declarations',
      `<?xml version="1.0" encoding="ISO-8859-1"?>${SAFE}`,
      'xml.unsupported-encoding'
    ],
    ['illegal XML controls', SAFE.replace('id="P"', 'id="P\u0000"'), 'xml.illegal-character']
  ])('rejects %s before parser invocation', (_label, xml, expectedCode) => {
    const result = preflightXml(xml)
    expect(result.safeToParse).toBe(false)
    expect(result.summary.issues.map((issue) => issue.code)).toContain(expectedCode)
    expect(result.summary.xmlWellFormed).toBe(false)
  })

  it('enforces independent byte, element, depth, attribute and text limits', () => {
    expect(preflightXml(SAFE, { maxBytes: 5 }).summary.issues[0].code).toBe(
      'xml.size-limit'
    )
    expect(preflightXml('<a><b/><c/></a>', { maxElements: 2 }).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xml.element-count-limit' })])
    )
    expect(preflightXml('<a><b><c/></b></a>', { maxDepth: 2 }).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xml.depth-limit' })])
    )
    expect(preflightXml('<a x="1" y="2"/>', { maxAttributesPerElement: 1 }).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xml.attribute-count-limit' })])
    )
    expect(preflightXml('<a x="long"/>', { maxAttributeValueLength: 3 }).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xml.attribute-value-limit' })])
    )
    expect(preflightXml('<a>12345</a>', { maxTextNodeLength: 4 }).summary.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'xml.text-limit' })])
    )
  })

  it('does not count markup-looking CDATA as XML elements', () => {
    const result = preflightXml('<a><![CDATA[<fake><nested/></fake>]]><b/></a>')
    expect(result.safeToParse).toBe(true)
    expect(result.metrics.elements).toBe(2)
  })

  it('reports one-based source locations', () => {
    expect(sourceLocationAt('one\ntwo\nthree', 8)).toEqual({
      line: 3,
      column: 1,
      offset: 8
    })
  })

  it('publishes conservative production defaults', () => {
    expect(DEFAULT_XML_PREFLIGHT_LIMITS.maxBytes).toBe(20 * 1024 * 1024)
    expect(DEFAULT_XML_PREFLIGHT_LIMITS.maxDepth).toBeLessThanOrEqual(256)
    expect(DEFAULT_XML_PREFLIGHT_LIMITS.maxAttributeValueLength).toBe(32_767)
  })
})
