import { describe, it, expect, vi } from 'vitest'
import {
  classifyImportBoundarySource,
  isBpmnName,
  isAmlName,
  isApcName,
  isXmlName,
  isImportableName,
  looksLikeBpmnXml,
  isInternalDrag,
  collectDroppedBpmn,
  INTERNAL_DND_MIME,
  MAX_DROPPED_IMPORT_BYTES
} from '../workspace/importDrop'

describe('isBpmnName', () => {
  it('matches .bpmn case-insensitively only', () => {
    expect(isBpmnName('order.bpmn')).toBe(true)
    expect(isBpmnName('ORDER.BPMN')).toBe(true)
    expect(isBpmnName('notes.txt')).toBe(false)
    expect(isBpmnName('order.bpmn.txt')).toBe(false)
  })
})

describe('isAmlName / isApcName / isImportableName', () => {
  it('matches .aml case-insensitively', () => {
    expect(isAmlName('model.aml')).toBe(true)
    expect(isAmlName('MODEL.AML')).toBe(true)
    expect(isAmlName('model.xml')).toBe(false)
  })

  it('matches .apc case-insensitively', () => {
    expect(isApcName('model.apc')).toBe(true)
    expect(isApcName('MODEL.APC')).toBe(true)
    expect(isApcName('model.bpmn')).toBe(false)
  })

  it('accepts bpmn, aml, apc, and xml as importable candidates', () => {
    expect(isImportableName('a.bpmn')).toBe(true)
    expect(isImportableName('a.aml')).toBe(true)
    expect(isImportableName('b.apc')).toBe(true)
    expect(isImportableName('c.txt')).toBe(false)
    expect(isImportableName('d.xml')).toBe(true)
  })
})

describe('isXmlName', () => {
  it('matches .xml case-insensitively only', () => {
    expect(isXmlName('order.xml')).toBe(true)
    expect(isXmlName('ORDER.XML')).toBe(true)
    expect(isXmlName('order.Xml')).toBe(true)
    expect(isXmlName('order.bpmn')).toBe(false)
    expect(isXmlName('order.xml.txt')).toBe(false)
    expect(isXmlName('notes.txt')).toBe(false)
  })
})

describe('looksLikeBpmnXml', () => {
  const NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL'

  it('accepts a standard bpmn:-prefixed definitions root', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="${NS}" id="Definitions_1"><bpmn:process id="p" /></bpmn:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts a bpmn2:-prefixed definitions root (Camunda/Eclipse style)', () => {
    const xml = `<bpmn2:definitions xmlns:bpmn2="${NS}"><bpmn2:process id="p" /></bpmn2:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts an unprefixed definitions root with a default xmlns', () => {
    const xml = `<definitions xmlns="${NS}"><process id="p" /></definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts an arbitrary prefix bound to the MODEL namespace', () => {
    const xml = `<foo:definitions xmlns:foo="${NS}"></foo:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts single-quoted attributes', () => {
    const xml = `<bpmn:definitions xmlns:bpmn='${NS}'></bpmn:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts arbitrary attribute order around the namespace declaration', () => {
    const xml = `<bpmn:definitions id="Definitions_1" exporter="Camunda Modeler" exporterVersion="5.0" targetNamespace="http://example.com" xmlns:bpmn="${NS}"></bpmn:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts a leading BOM, XML declaration, comments and processing instructions before the root', () => {
    const bom = String.fromCharCode(0xfeff)
    const xml =
      bom +
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!-- exported by Some Tool --><?some-pi data?>\n' +
      `<bpmn:definitions xmlns:bpmn="${NS}"></bpmn:definitions>`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('accepts CRLF line endings', () => {
    const xml = `<?xml version="1.0"?>\r\n<bpmn:definitions xmlns:bpmn="${NS}">\r\n  <bpmn:process id="p" />\r\n</bpmn:definitions>\r\n`
    expect(looksLikeBpmnXml(xml)).toBe(true)
  })

  it('rejects random XML with no definitions element', () => {
    expect(looksLikeBpmnXml('<project><target name="build"/></project>')).toBe(false)
  })

  it('rejects HTML', () => {
    expect(looksLikeBpmnXml('<!DOCTYPE html><html><head></head><body>hi</body></html>')).toBe(false)
  })

  it('rejects SVG', () => {
    expect(
      looksLikeBpmnXml(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
      )
    ).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(looksLikeBpmnXml('')).toBe(false)
  })

  it('rejects whitespace-only text', () => {
    expect(looksLikeBpmnXml('   \n\t  ')).toBe(false)
  })

  it('rejects text that only mentions the namespace in a comment, with no definitions element', () => {
    const xml = `<!-- schema: ${NS} --><project/>`
    expect(looksLikeBpmnXml(xml)).toBe(false)
  })

  it('rejects a definitions-like element whose name is not exactly "definitions"', () => {
    expect(looksLikeBpmnXml(`<bpmn:definitionsSet xmlns:bpmn="${NS}" />`)).toBe(false)
  })

  it('rejects a definitions element with no BPMN namespace anywhere in the document', () => {
    expect(
      looksLikeBpmnXml('<definitions xmlns="http://example.com/not-bpmn"><process/></definitions>')
    ).toBe(false)
  })
})

describe('classifyImportBoundarySource', () => {
  it('rejects .bpmn extensions immediately at the ARIS-only boundary', () => {
    expect(classifyImportBoundarySource('legacy.bpmn', '<not-even-bpmn/>')).toBe('reject-bpmn')
  })

  it('rejects BPMN XML carried under a plain .xml extension', () => {
    expect(
      classifyImportBoundarySource(
        'legacy.xml',
        '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" />'
      )
    ).toBe('reject-bpmn')
  })

  it('keeps ARIS AML candidates flowing to the planner', () => {
    expect(classifyImportBoundarySource('landscape.aml', '<AML/>')).toBe('candidate')
  })

  it('leaves non-BPMN .xml content to the planner for later unsupported-content handling', () => {
    expect(classifyImportBoundarySource('notes.xml', '<notes/>')).toBe('candidate')
  })
})

describe('isInternalDrag', () => {
  it('detects our internal move mime among the drag types', () => {
    expect(isInternalDrag({ types: [INTERNAL_DND_MIME, 'text/plain'] })).toBe(true)
    expect(isInternalDrag({ types: ['Files'] })).toBe(false)
    expect(isInternalDrag({ types: undefined as unknown as string[] })).toBe(false)
  })
})

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = Uint8Array.from(bytes)
  return owned.buffer
}

function fakeFile(
  name: string,
  text: string
): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytesBuffer(bytes) }
}

function fakeByteFile(
  name: string,
  bytes: Uint8Array
): { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytesBuffer(bytes) }
}

describe('collectDroppedBpmn — flat files fallback', () => {
  it('keeps only importable candidate files from DataTransfer.files', async () => {
    const dt = {
      items: [],
      files: [
        fakeFile('a.bpmn', 'A'),
        fakeFile('b.txt', 'B'),
        fakeFile('c.BPMN', 'C'),
        fakeFile('d.aml', 'D')
      ]
    }
    const out = await collectDroppedBpmn(dt)
    expect(out.map((d) => d.name).sort()).toEqual(['a.bpmn', 'c.BPMN', 'd.aml'])
    expect(await out[0].getText()).toBe('A')
  })

  it('handles a missing items list', async () => {
    const dt = { files: [fakeFile('x.bpmn', 'X')] }
    const out = await collectDroppedBpmn(dt)
    expect(out).toHaveLength(1)
    expect(out[0].relPath).toBe('x.bpmn')
  })

  it('also collects .aml and .apc files for ARIS import', async () => {
    const dt = {
      items: [],
      files: [
        fakeFile('a.bpmn', 'A'),
        fakeFile('m.apc', 'M'),
        fakeFile('l.aml', 'L'),
        fakeFile('n.txt', 'N')
      ]
    }
    const out = await collectDroppedBpmn(dt)
    expect(out.map((d) => d.name).sort()).toEqual(['a.bpmn', 'l.aml', 'm.apc'])
  })

  it('also collects .xml files by name, leaving content-sniffing to the caller', async () => {
    const dt = {
      items: [],
      files: [
        fakeFile('a.bpmn', 'A'),
        fakeFile(
          'process.xml',
          '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" />'
        ),
        fakeFile('PROCESS2.XML', 'not actually bpmn content'),
        fakeFile('n.txt', 'N')
      ]
    }
    const out = await collectDroppedBpmn(dt)
    // Both .xml files come through here regardless of their content — this
    // module only filters by name (isImportableName); the App-level caller
    // is the one that runs looksLikeBpmnXml and skips a false-positive name.
    expect(out.map((d) => d.name).sort()).toEqual(['PROCESS2.XML', 'a.bpmn', 'process.xml'])
  })

  it('mixes .bpmn, .aml, .apc and .xml in one drop without disturbing one another', async () => {
    const dt = {
      items: [],
      files: [
        fakeFile('a.bpmn', 'A'),
        fakeFile('b.aml', 'B'),
        fakeFile('b.apc', 'B'),
        fakeFile('c.xml', 'C'),
        fakeFile('d.txt', 'D')
      ]
    }
    const out = await collectDroppedBpmn(dt)
    expect(out.map((d) => d.name).sort()).toEqual(['a.bpmn', 'b.aml', 'b.apc', 'c.xml'])
  })

  it('rejects malformed UTF-8 with a stable error code instead of replacement characters', async () => {
    const out = await collectDroppedBpmn({
      items: [],
      files: [fakeByteFile('broken.bpmn', new Uint8Array([0x3c, 0xff, 0x3e]))]
    })

    await expect(out[0]!.getText()).rejects.toMatchObject({
      code: 'invalid-encoding',
      operation: 'read',
      path: 'broken.bpmn',
      message: 'could not decode'
    })
  })

  it('rejects oversized File metadata before allocating its bytes', async () => {
    const arrayBuffer = vi.fn(async () => {
      throw new Error('oversized dropped import must not be read')
    })
    const out = await collectDroppedBpmn({
      items: [],
      files: [
        {
          name: 'oversized.bpmn',
          size: MAX_DROPPED_IMPORT_BYTES + 1,
          arrayBuffer
        }
      ]
    })

    await expect(out[0]!.getText()).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'read',
      path: 'oversized.bpmn'
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})

describe('collectDroppedBpmn — handle walk (folder support)', () => {
  it('walks a dropped folder recursively, preserving its subtree, ignoring non-bpmn', async () => {
    const fileHandle = (name: string, text: string): unknown => ({
      kind: 'file',
      name,
      getFile: async () => fakeFile(name, text)
    })
    const dirHandle = {
      kind: 'directory',
      name: 'Sub',
      async *entries(): AsyncIterableIterator<[string, unknown]> {
        yield ['inner.bpmn', fileHandle('inner.bpmn', 'INNER')]
        yield ['skip.txt', fileHandle('skip.txt', 'NOPE')]
      }
    }
    const dt = {
      items: [
        { kind: 'file', getAsFileSystemHandle: async () => fileHandle('order.bpmn', 'ORDER') },
        { kind: 'file', getAsFileSystemHandle: async () => dirHandle }
      ]
    }
    const out = await collectDroppedBpmn(dt as never)
    const byPath = Object.fromEntries(
      await Promise.all(out.map(async (d) => [d.relPath, await d.getText()]))
    )
    expect(byPath).toEqual({ 'order.bpmn': 'ORDER', 'Sub/inner.bpmn': 'INNER' })
  })

  it('walks a dropped folder containing .xml and .apc files alongside .bpmn', async () => {
    const fileHandle = (name: string, text: string): unknown => ({
      kind: 'file',
      name,
      getFile: async () => fakeFile(name, text)
    })
    const dirHandle = {
      kind: 'directory',
      name: 'Sub',
      async *entries(): AsyncIterableIterator<[string, unknown]> {
        yield ['inner.xml', fileHandle('inner.xml', 'INNER_XML')]
        yield ['legacy.apc', fileHandle('legacy.apc', 'LEGACY_APC')]
        yield ['skip.txt', fileHandle('skip.txt', 'NOPE')]
      }
    }
    const dt = {
      items: [
        { kind: 'file', getAsFileSystemHandle: async () => fileHandle('order.xml', 'ORDER_XML') },
        { kind: 'file', getAsFileSystemHandle: async () => dirHandle }
      ]
    }
    const out = await collectDroppedBpmn(dt as never)
    const byPath = Object.fromEntries(
      await Promise.all(out.map(async (d) => [d.relPath, await d.getText()]))
    )
    expect(byPath).toEqual({
      'order.xml': 'ORDER_XML',
      'Sub/inner.xml': 'INNER_XML',
      'Sub/legacy.apc': 'LEGACY_APC'
    })
  })
})
