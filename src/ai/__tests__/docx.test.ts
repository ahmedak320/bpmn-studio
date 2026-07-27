import { describe, it, expect, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parseDocxFileInWorker, type DocxWorkerFactory } from '../browserDocxParser'
import {
  DOCX_ARCHIVE_LIMITS,
  DocxParseError,
  MAX_DOCX_TEXT_CHARS,
  extractDocxText,
  extractDocxTextAsync
} from '../docx'
import { handleDocxWorkerRequest } from '../docx.worker'
import type { DocxWorkerResponse } from '../docxWorkerProtocol'

// --- synthetic .docx builders ----------------------------------------------
// vitest runs in a plain node environment, so the fixtures are built HERE with
// fflate's zipSync (the mirror of the unzipSync the extractor uses) instead of
// checking binary .docx files into the repo: a minimal OPC package with a
// word/document.xml whose body we control per test.

function docxOf(bodyXml: string, level: 0 | 6 = 6): Uint8Array {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body></w:document>`
  return zipSync(
    {
      // A real docx has more parts ([Content_Types].xml, _rels, …); the extractor
      // only needs word/document.xml, but we include one sibling to keep the zip
      // realistic.
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8(documentXml)
    },
    { level }
  )
}

/** One paragraph wrapping raw run XML. */
const p = (inner: string): string => `<w:p>${inner}</w:p>`
/** One run with a single text node (optional extra attributes on w:t). */
const r = (text: string, tAttrs = ''): string => `<w:r><w:t${tAttrs}>${text}</w:t></w:r>`

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function findEocd(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readU32(bytes, offset) === 0x06054b50) return offset
  }
  throw new Error('test fixture has no ZIP end record')
}

function findCentralEntry(bytes: Uint8Array, entryName: string): number {
  const eocd = findEocd(bytes)
  const count = readU16(bytes, eocd + 10)
  let central = readU32(bytes, eocd + 16)
  const decoder = new TextDecoder()
  for (let index = 0; index < count; index += 1) {
    const nameLength = readU16(bytes, central + 28)
    const extraLength = readU16(bytes, central + 30)
    const commentLength = readU16(bytes, central + 32)
    const actualName = decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength))
    if (actualName === entryName) return central
    central += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`test fixture has no entry named ${entryName}`)
}

function mutateEntry(
  source: Uint8Array,
  entryName: string,
  mutate: (bytes: Uint8Array, central: number, local: number) => void
): Uint8Array {
  const bytes = source.slice()
  const central = findCentralEntry(bytes, entryName)
  mutate(bytes, central, readU32(bytes, central + 42))
  return bytes
}

class FakeDocxWorker {
  readonly posted: unknown[] = []
  terminated = false
  private readonly messages = new Set<(event: MessageEvent<DocxWorkerResponse>) => void>()
  private readonly errors = new Set<(event: ErrorEvent) => void>()

  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messages.add(listener)
    else this.errors.add(listener)
  }
  removeEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.messages.delete(listener)
    else this.errors.delete(listener)
  }
  respond(response: DocxWorkerResponse): void {
    for (const listener of this.messages) {
      listener({ data: response } as MessageEvent<DocxWorkerResponse>)
    }
  }
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

// --- happy-path structure ---------------------------------------------------

describe('extractDocxText — structure', () => {
  it('joins runs within a paragraph and separates paragraphs with newlines', () => {
    const bytes = docxOf(p(r('Hello ') + r('world')) + p(r('Second paragraph')))
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
    // Stored on purpose: this is an output-cap test, not a compression-ratio
    // bomb test (covered independently below).
    const bytes = docxOf(p(r('x'.repeat(MAX_DOCX_TEXT_CHARS + 500))), 0)
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
    const zipButNotDocx = zipSync({
      'hello.txt': strToU8('hi'),
      'word/styles.xml': strToU8('<a/>')
    })
    try {
      extractDocxText(zipButNotDocx)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DocxParseError)
      expect((err as DocxParseError).code).toBe('no-document-xml')
    }
  })
})

describe('extractDocxText — archive preflight security', () => {
  it('offers async parity and rejects a pre-cancelled operation', async () => {
    const bytes = docxOf(p(r('Async document')))
    await expect(extractDocxTextAsync(bytes)).resolves.toBe('Async document')

    const controller = new AbortController()
    controller.abort()
    await expect(extractDocxTextAsync(bytes, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted'
    })
  })

  it('rejects encrypted document.xml before expansion', () => {
    const bytes = mutateEntry(
      docxOf(p(r('Secret')), 0),
      'word/document.xml',
      (archive, central, local) => {
        writeU16(archive, central + 8, readU16(archive, central + 8) | 0x0001)
        writeU16(archive, local + 6, readU16(archive, local + 6) | 0x0001)
      }
    )

    expect(() => extractDocxText(bytes)).toThrowError(DocxParseError)
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected the encrypted archive')
    } catch (error) {
      expect((error as DocxParseError).code).toBe('encrypted-archive')
    }
  })

  it('rejects a small high-ratio decompression-bomb fixture', () => {
    const bytes = docxOf(p(r('x'.repeat(200_000))))
    expect(bytes.length).toBeLessThan(2_048)
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected the compression ratio')
    } catch (error) {
      expect(error).toBeInstanceOf(DocxParseError)
      expect((error as DocxParseError).code).toBe('archive-too-large')
    }
  })

  it('rejects a fake huge declared document without allocating huge content', () => {
    const bytes = mutateEntry(docxOf(p(r('small')), 0), 'word/document.xml', (archive, central) => {
      writeU32(archive, central + 24, DOCX_ARCHIVE_LIMITS.maxEntryUncompressedBytes + 1)
    })
    expect(bytes.length).toBeLessThan(1024)
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected the declared size')
    } catch (error) {
      expect(error).toBeInstanceOf(DocxParseError)
      expect((error as DocxParseError).code).toBe('archive-too-large')
    }
  })

  it('rejects unsafe paths anywhere in the OPC archive', () => {
    const bytes = zipSync(
      {
        '../escape.txt': strToU8('no'),
        'word/document.xml': strToU8(
          '<w:document><w:body><w:p><w:r><w:t>safe</w:t></w:r></w:p></w:body></w:document>'
        )
      },
      { level: 0 }
    )
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected the unsafe entry')
    } catch (error) {
      expect(error).toBeInstanceOf(DocxParseError)
      expect((error as DocxParseError).code).toBe('unsafe-archive')
    }
  })

  it('maps malformed local headers to malformed-archive', () => {
    const bytes = mutateEntry(
      docxOf(p(r('broken')), 0),
      'word/document.xml',
      (archive, _central, local) => {
        archive[local] = 0
      }
    )
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected the malformed local header')
    } catch (error) {
      expect(error).toBeInstanceOf(DocxParseError)
      expect((error as DocxParseError).code).toBe('malformed-archive')
    }
  })

  it('rejects invalid UTF-8 in document.xml after bounded extraction', () => {
    const bytes = zipSync(
      {
        'word/document.xml': new Uint8Array([0xff, 0xfe, 0xfd])
      },
      { level: 0 }
    )
    try {
      extractDocxText(bytes)
      expect.unreachable('should have rejected invalid document XML bytes')
    } catch (error) {
      expect(error).toBeInstanceOf(DocxParseError)
      expect((error as DocxParseError).code).toBe('malformed-archive')
    }
  })
})

describe('browser DOCX worker boundary', () => {
  it('runs full DOCX extraction inside the worker handler', () => {
    const responses: DocxWorkerResponse[] = []
    handleDocxWorkerRequest(
      {
        type: 'parse',
        requestId: 'docx-worker',
        bytes: transferableBuffer(docxOf(p(r('Worker document'))))
      },
      (response) => responses.push(response)
    )
    expect(responses).toEqual([
      {
        type: 'result',
        requestId: 'docx-worker',
        text: 'Worker document'
      }
    ])
  })

  it('transfers bounded bytes and returns the worker result', async () => {
    const worker = new FakeDocxWorker()
    const bytes = docxOf(p(r('Transferred document')))
    const parse = parseDocxFileInWorker(
      {
        size: bytes.byteLength,
        arrayBuffer: async () => transferableBuffer(bytes)
      },
      { workerFactory: (() => worker) as DocxWorkerFactory }
    )
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1))
    const request = worker.posted[0] as { requestId: string }
    worker.respond({
      type: 'result',
      requestId: request.requestId,
      text: 'Transferred document'
    })

    await expect(parse).resolves.toBe('Transferred document')
    expect(worker.terminated).toBe(true)
  })

  it('rejects oversized File metadata before reading or creating a worker', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const workerFactory = vi.fn()
    await expect(
      parseDocxFileInWorker(
        {
          size: DOCX_ARCHIVE_LIMITS.maxCompressedBytes + 1,
          arrayBuffer
        },
        { workerFactory }
      )
    ).rejects.toMatchObject({ code: 'archive-too-large' })
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(workerFactory).not.toHaveBeenCalled()
  })

  it('terminates the parser worker when the caller aborts', async () => {
    const worker = new FakeDocxWorker()
    const controller = new AbortController()
    const bytes = docxOf(p(r('Cancelled document')))
    const parse = parseDocxFileInWorker(
      {
        size: bytes.byteLength,
        arrayBuffer: async () => transferableBuffer(bytes)
      },
      {
        signal: controller.signal,
        workerFactory: (() => worker) as DocxWorkerFactory
      }
    )
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1))
    controller.abort()

    await expect(parse).rejects.toMatchObject({ code: 'aborted' })
    expect(worker.terminated).toBe(true)
  })
})
