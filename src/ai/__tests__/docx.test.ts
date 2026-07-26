import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { extractDocxText, DocxParseError, MAX_DOCX_TEXT_CHARS } from '../docx'

// --- synthetic .docx builders ----------------------------------------------
// vitest runs in a plain node environment, so the fixtures are built HERE with
// fflate's zipSync (the mirror of the unzipSync the extractor uses) instead of
// checking binary .docx files into the repo: a minimal OPC package with a
// word/document.xml whose body we control per test.

function docxOf(bodyXml: string): Uint8Array {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body></w:document>`
  return zipSync({
    // A real docx has more parts ([Content_Types].xml, _rels, …); the extractor
    // only needs word/document.xml, but we include one sibling to keep the zip
    // realistic.
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(documentXml)
  })
}

/** One paragraph wrapping raw run XML. */
const p = (inner: string): string => `<w:p>${inner}</w:p>`
/** One run with a single text node (optional extra attributes on w:t). */
const r = (text: string, tAttrs = ''): string => `<w:r><w:t${tAttrs}>${text}</w:t></w:r>`

// --- happy-path structure ---------------------------------------------------

describe('extractDocxText — structure', () => {
  it('joins runs within a paragraph and separates paragraphs with newlines', () => {
    const bytes = docxOf(
      p(r('Hello ') + r('world')) + p(r('Second paragraph'))
    )
    expect(extractDocxText(bytes)).toBe('Hello world\nSecond paragraph')
  })

  it('turns <w:tab/> runs into tab characters', () => {
    const bytes = docxOf(p(r('Step') + '<w:r><w:tab/><w:t>Details</w:t></w:r>'))
    expect(extractDocxText(bytes)).toBe('Step\tDetails')
  })

  it('does NOT treat tab-stop definitions (<w:tab w:val=…/> inside <w:tabs>) as tabs', () => {
    const bytes = docxOf(
      p('<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' + r('X'))
    )
    expect(extractDocxText(bytes)).toBe('X')
  })

  it('turns <w:br/> (and attributed page breaks) into newlines', () => {
    const bytes = docxOf(
      p('<w:r><w:t>line1</w:t><w:br/><w:t>line2</w:t></w:r>') +
        p('<w:r><w:br w:type="page"/><w:t>after page break</w:t></w:r>')
    )
    // Paragraph break + the second paragraph's leading page-break newline give
    // one blank line between the two blocks.
    expect(extractDocxText(bytes)).toBe('line1\nline2\n\nafter page break')
  })

  it('collapses runs of empty paragraphs to a single blank line', () => {
    const bytes = docxOf(p(r('A')) + p('') + p('') + p('') + p(r('B')))
    expect(extractDocxText(bytes)).toBe('A\n\nB')
  })

  it('ignores self-closing (empty) <w:t/> runs', () => {
    const bytes = docxOf(p('<w:r><w:t/></w:r>' + r('kept')))
    expect(extractDocxText(bytes)).toBe('kept')
  })
})

// --- entities + xml:space ---------------------------------------------------

describe('extractDocxText — entities and whitespace', () => {
  it('decodes the five named XML entities', () => {
    const bytes = docxOf(p(r('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')))
    expect(extractDocxText(bytes)).toBe('a & b <c> "d" \'e\'')
  })

  it('decodes decimal and hex numeric character references', () => {
    // &#65; = 'A', &#x62; = 'b', &#x1F600; = 😀 (astral plane, fromCodePoint path)
    const bytes = docxOf(p(r('&#65;&#x62; &#x1F600;')))
    expect(extractDocxText(bytes)).toBe('Ab \u{1F600}')
  })

  it('decodes in a single pass — a double-escaped &amp;lt; yields the literal "&lt;"', () => {
    const bytes = docxOf(p(r('&amp;lt;')))
    expect(extractDocxText(bytes)).toBe('&lt;')
  })

  it('leaves malformed/out-of-range references untouched instead of throwing', () => {
    const bytes = docxOf(p(r('ok &#x110000; still ok')))
    expect(extractDocxText(bytes)).toBe('ok &#x110000; still ok')
  })

  it('preserves run-internal spaces (xml:space="preserve" runs)', () => {
    const bytes = docxOf(
      p(r('lead', ' xml:space="preserve"') + r('  mid  ', ' xml:space="preserve"') + r('tail'))
    )
    expect(extractDocxText(bytes)).toBe('lead  mid  tail')
  })

  it('round-trips Arabic (RTL) text through zip + extraction verbatim', () => {
    const arabic = 'عملية الموافقة على الفاتورة'
    const bytes = docxOf(p(r(arabic)))
    expect(extractDocxText(bytes)).toBe(arabic)
  })
})

// --- caps + degenerate inputs ----------------------------------------------

describe('extractDocxText — caps and failure modes', () => {
  it('caps the output at MAX_DOCX_TEXT_CHARS (100k)', () => {
    expect(MAX_DOCX_TEXT_CHARS).toBe(100_000)
    const bytes = docxOf(p(r('x'.repeat(MAX_DOCX_TEXT_CHARS + 500))))
    const text = extractDocxText(bytes)
    expect(text.length).toBe(MAX_DOCX_TEXT_CHARS)
    expect(text).toBe('x'.repeat(MAX_DOCX_TEXT_CHARS))
  })

  it('returns an empty string for a document with no text (caller shows docxEmpty)', () => {
    expect(extractDocxText(docxOf(''))).toBe('')
    expect(extractDocxText(docxOf(p('')))).toBe('')
  })

  it('throws DocxParseError(code "not-zip") for bytes that are not a zip', () => {
    const notZip = strToU8('This is plain text, definitely not a zip archive.')
    expect(() => extractDocxText(notZip)).toThrowError(DocxParseError)
    try {
      extractDocxText(notZip)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DocxParseError)
      expect((err as DocxParseError).code).toBe('not-zip')
    }
  })

  it('throws DocxParseError(code "no-document-xml") for a zip without word/document.xml', () => {
    const zipButNotDocx = zipSync({ 'hello.txt': strToU8('hi'), 'word/styles.xml': strToU8('<a/>') })
    try {
      extractDocxText(zipButNotDocx)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DocxParseError)
      expect((err as DocxParseError).code).toBe('no-document-xml')
    }
  })
})
