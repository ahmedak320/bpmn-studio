import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'

import { buildLibraryZip, zipFileName } from '../zipExport'
import { readLibraryZip } from '../zipImport'

const SAMPLE_BPMN = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><definitions id="${name}"><process id="p_${name}" /></definitions>`

// Same idea as SAMPLE_BPMN, but shaped like what a tool exports under a bare
// .xml name: prefixed elements plus the BPMN 2.0 MODEL namespace, which is
// what looksLikeBpmnXml sniffs for (see importDrop.ts). SAMPLE_BPMN itself
// deliberately omits the namespace, since it's only ever used under a
// `.bpmn` name, which readLibraryZip has always accepted by extension alone
// without looking at content.
const SAMPLE_BPMN_XML = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="${name}"><bpmn:process id="p_${name}" /></bpmn:definitions>`

describe('buildLibraryZip / readLibraryZip round-trip', () => {
  it('round-trips nested folders and Arabic filenames', () => {
    const files = [
      { relPath: 'top.bpmn', xml: SAMPLE_BPMN('top') },
      { relPath: 'nested/child.bpmn', xml: SAMPLE_BPMN('child') },
      { relPath: 'nested/deep/grandchild.bpmn', xml: SAMPLE_BPMN('grandchild') },
      { relPath: 'عربي/عملية.bpmn', xml: SAMPLE_BPMN('arabic') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.skipped).toEqual([])
    expect(result.entries).toHaveLength(files.length)

    const byPath = new Map(result.entries.map((e) => [e.relPath, e.xml]))
    for (const f of files) {
      expect(byPath.get(f.relPath)).toBe(f.xml)
    }
  })

  it('produces deterministic entry order regardless of input order', () => {
    const filesA = [
      { relPath: 'b.bpmn', xml: SAMPLE_BPMN('b') },
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
    ]
    const filesB = [
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
      { relPath: 'b.bpmn', xml: SAMPLE_BPMN('b') },
    ]

    const zipA = buildLibraryZip(filesA)
    const zipB = buildLibraryZip(filesB)

    expect(Array.from(zipA)).toEqual(Array.from(zipB))
  })

  it('includes extras in the zip, and import lists them as not-bpmn skipped', () => {
    const files = [{ relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') }]
    const extras = [{ relPath: 'manifest.csv', content: 'relPath,size\na.bpmn,123\n' }]

    const zip = buildLibraryZip(files, extras)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('a.bpmn')

    expect(result.skipped).toContainEqual({ path: 'manifest.csv', reason: 'not-bpmn' })
  })

  it('skips unsafe paths with reason unsafe-path', () => {
    const files = [
      { relPath: '../x.bpmn', xml: SAMPLE_BPMN('escape') },
      { relPath: '/abs.bpmn', xml: SAMPLE_BPMN('abs') },
      { relPath: 'C:\\evil.bpmn', xml: SAMPLE_BPMN('winabs') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toHaveLength(3)
    for (const s of result.skipped) {
      expect(s.reason).toBe('unsafe-path')
    }
  })

  it('skips oversize entries with reason too-large', () => {
    const bigXml = 'x'.repeat(5 * 1024 * 1024 + 1)
    const files = [
      { relPath: 'huge.bpmn', xml: bigXml },
      { relPath: 'small.bpmn', xml: SAMPLE_BPMN('small') },
    ]

    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('small.bpmn')
    expect(result.skipped).toContainEqual({ path: 'huge.bpmn', reason: 'too-large' })
  })

  it('skips non-bpmn files with reason not-bpmn', () => {
    const files = [{ relPath: 'notes.txt', xml: 'hello' }]
    // buildLibraryZip is typed around {relPath, xml} so reuse it for a non-bpmn entry.
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'notes.txt', reason: 'not-bpmn' }])
  })

  it('throws when total accepted size exceeds 50MB', () => {
    const chunk = 'x'.repeat(5 * 1024 * 1024) // exactly at per-entry cap
    const files = Array.from({ length: 11 }, (_, i) => ({
      relPath: `f${i}.bpmn`,
      xml: chunk,
    }))

    const zip = buildLibraryZip(files)
    expect(() => readLibraryZip(zip)).toThrow(/Library too large/)
  })
})

describe('readLibraryZip — bare .xml entries (BPMN 2.0 exported without a .bpmn extension)', () => {
  it('imports a .xml entry whose content sniffs as BPMN 2.0, landing under a .bpmn relPath', () => {
    const files = [{ relPath: 'diagram.xml', xml: SAMPLE_BPMN_XML('diagram') }]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.skipped).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('diagram.bpmn')
    expect(result.entries[0].xml).toBe(SAMPLE_BPMN_XML('diagram'))
  })

  it('preserves a nested folder path when renaming .xml to .bpmn', () => {
    const files = [{ relPath: 'nested/deep/diagram.xml', xml: SAMPLE_BPMN_XML('deep') }]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].relPath).toBe('nested/deep/diagram.bpmn')
  })

  it('skips a .xml entry whose content does not sniff as BPMN, with reason not-bpmn', () => {
    const files = [{ relPath: 'notes.xml', xml: '<project><target name="build"/></project>' }]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'notes.xml', reason: 'not-bpmn' }])
  })

  it('reuses the not-bpmn reason (no dedicated dictionary key) for .xml that only mentions the namespace in a comment', () => {
    const files = [
      {
        relPath: 'fake.xml',
        xml: '<!-- schema: http://www.omg.org/spec/BPMN/20100524/MODEL --><project/>'
      }
    ]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'fake.xml', reason: 'not-bpmn' }])
  })

  it('imports a mix of native .bpmn and BPMN-shaped .xml, skipping non-BPMN .xml alongside', () => {
    const files = [
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
      { relPath: 'b.xml', xml: SAMPLE_BPMN_XML('b') },
      { relPath: 'c.xml', xml: '<html><body>not bpmn</body></html>' }
    ]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries.map((e) => e.relPath).sort()).toEqual(['a.bpmn', 'b.bpmn'])
    expect(result.skipped).toEqual([{ path: 'c.xml', reason: 'not-bpmn' }])
  })

  it('still applies the too-large cap to a .xml entry before ever sniffing its content', () => {
    const bigXml = 'x'.repeat(5 * 1024 * 1024 + 1)
    const files = [{ relPath: 'huge.xml', xml: bigXml }]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'huge.xml', reason: 'too-large' }])
  })

  it('still applies unsafe-path rejection to a .xml entry', () => {
    const files = [{ relPath: '../escape.xml', xml: SAMPLE_BPMN_XML('escape') }]
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: '../escape.xml', reason: 'unsafe-path' }])
  })

  it('reports decode-failed for a .xml entry with invalid UTF-8 bytes, built directly with fflate', () => {
    // JPEG magic bytes: never a valid UTF-8 lead byte, so TextDecoder's
    // fatal:true decode throws — this is built with raw fflate.zipSync
    // (rather than buildLibraryZip, which only ever writes real strings)
    // specifically to get undecodable bytes into an entry.
    const invalidUtf8 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const zip = zipSync({ 'broken.xml': invalidUtf8 })
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'broken.xml', reason: 'decode-failed' }])
  })
})

describe('zipFileName', () => {
  it('slugifies the root name and formats the date deterministically', () => {
    const date = new Date(2026, 6, 23) // 2026-07-23 (local, month is 0-indexed)
    expect(zipFileName('My Process Library', date)).toBe('process-library-My-Process-Library-2026-07-23.zip')
  })

  it('strips characters outside letters/numbers/._- after replacing spaces', () => {
    const date = new Date(2024, 0, 5)
    expect(zipFileName('  Root: Name! (v2)  ', date)).toBe('process-library-Root-Name-v2-2024-01-05.zip')
  })

  it('falls back to "workspace" for an empty/whitespace-only name', () => {
    const date = new Date(2024, 0, 5)
    expect(zipFileName('   ', date)).toBe('process-library-workspace-2024-01-05.zip')
  })

  it('is deterministic for a fixed injected Date', () => {
    const date = new Date(2025, 11, 1)
    const first = zipFileName('workspace', date)
    const second = zipFileName('workspace', date)
    expect(first).toBe(second)
    expect(first).toBe('process-library-workspace-2025-12-01.zip')
  })
})
