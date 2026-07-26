import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { buildLibraryZip, zipFileName } from '../zipExport'
import {
  LIBRARY_ZIP_LIMITS,
  PROCESS_OWNERS_CSV_NAME,
  readLibraryZip,
  readLibraryZipAsync
} from '../zipImport'
import {
  LIBRARY_MANIFEST_NAME,
  serializeLibraryManifest,
  type LibraryManifest
} from '../libraryManifest'
import {
  ArchivePreflightError,
  type ArchiveErrorCode
} from '../../security/archivePreflight'

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

function patchDeclaredSize(
  source: Uint8Array,
  entryName: string,
  declaredSize: number
): Uint8Array {
  const bytes = source.slice()
  const eocd = findEocd(bytes)
  const count = readU16(bytes, eocd + 10)
  let central = readU32(bytes, eocd + 16)
  const decoder = new TextDecoder()
  for (let index = 0; index < count; index += 1) {
    const nameLength = readU16(bytes, central + 28)
    const extraLength = readU16(bytes, central + 30)
    const commentLength = readU16(bytes, central + 32)
    const actualName = decoder.decode(
      bytes.subarray(central + 46, central + 46 + nameLength)
    )
    if (actualName === entryName) {
      writeU32(bytes, central + 24, declaredSize)
      return bytes
    }
    central += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`test fixture has no entry named ${entryName}`)
}

function expectArchiveCode(action: () => unknown, code: ArchiveErrorCode): void {
  try {
    action()
    expect.unreachable(`expected ArchivePreflightError(${code})`)
  } catch (error) {
    expect(error).toBeInstanceOf(ArchivePreflightError)
    expect((error as ArchivePreflightError).code).toBe(code)
  }
}

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

  it('rejects the whole archive when any entry has an unsafe path', () => {
    const files = [
      { relPath: '../x.bpmn', xml: SAMPLE_BPMN('escape') },
      { relPath: '/abs.bpmn', xml: SAMPLE_BPMN('abs') },
      { relPath: 'C:\\evil.bpmn', xml: SAMPLE_BPMN('winabs') },
    ]

    const zip = buildLibraryZip(files)
    expectArchiveCode(() => readLibraryZip(zip), 'unsafe-path')
  })

  it('rejects a huge declared entry before expansion without allocating it', () => {
    const files = [
      { relPath: 'huge.bpmn', xml: SAMPLE_BPMN('huge') },
      { relPath: 'small.bpmn', xml: SAMPLE_BPMN('small') },
    ]

    const zip = patchDeclaredSize(
      buildLibraryZip(files),
      'huge.bpmn',
      LIBRARY_ZIP_LIMITS.maxEntryUncompressedBytes + 1
    )
    expect(zip.length).toBeLessThan(1024)
    expectArchiveCode(() => readLibraryZip(zip), 'entry-size-limit')
  })

  it('skips non-bpmn files with reason not-bpmn', () => {
    const files = [{ relPath: 'notes.txt', xml: 'hello' }]
    // buildLibraryZip is typed around {relPath, xml} so reuse it for a non-bpmn entry.
    const zip = buildLibraryZip(files)
    const result = readLibraryZip(zip)

    expect(result.entries).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: 'notes.txt', reason: 'not-bpmn' }])
  })

  it('rejects a compact high-ratio decompression-bomb fixture', () => {
    const zip = zipSync({ 'bomb.bpmn': strToU8('x'.repeat(100_000)) })
    expect(zip.length).toBeLessThan(1024)
    expectArchiveCode(() => readLibraryZip(zip), 'compression-ratio-limit')
  })

  it('exposes async parity and a cancellation seam', async () => {
    const zip = buildLibraryZip([
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
      { relPath: 'nested/b.bpmn', xml: SAMPLE_BPMN('b') }
    ])
    await expect(readLibraryZipAsync(zip)).resolves.toEqual(readLibraryZip(zip))

    const controller = new AbortController()
    controller.abort()
    await expect(
      readLibraryZipAsync(zip, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('readLibraryZip — root-level library extras (manifest + owners CSV)', () => {
  const MANIFEST: LibraryManifest = {
    version: 1,
    generator: 'orbitpm-lite',
    files: ['a.bpmn', 'nested/b.bpmn'],
    hierarchy: [
      {
        parentFile: 'a.bpmn',
        parentProcessId: 'p_a',
        childFile: 'nested/b.bpmn',
        childProcessId: 'p_b',
        via: 'callActivity'
      }
    ]
  }
  const OWNERS_CSV = 'relPath,processId,owner\na.bpmn,p_a,أحمد\nnested/b.bpmn,p_b,Sara\n'

  it('recognizes both extras — parsed manifest + verbatim CSV, neither skipped', () => {
    const files = [
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
      { relPath: 'nested/b.bpmn', xml: SAMPLE_BPMN('b') },
    ]
    const extras = [
      { relPath: LIBRARY_MANIFEST_NAME, content: serializeLibraryManifest(MANIFEST) },
      { relPath: PROCESS_OWNERS_CSV_NAME, content: OWNERS_CSV },
    ]

    const result = readLibraryZip(buildLibraryZip(files, extras))

    expect(result.skipped).toEqual([])
    expect(result.entries.map((e) => e.relPath).sort()).toEqual(['a.bpmn', 'nested/b.bpmn'])
    expect(result.manifest).toEqual(MANIFEST)
    expect(result.ownersCsv).toBe(OWNERS_CSV)
  })

  it('leaves manifest/ownersCsv unset for zips without the extras', () => {
    const result = readLibraryZip(buildLibraryZip([{ relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') }]))
    expect(result.manifest).toBeUndefined()
    expect(result.ownersCsv).toBeUndefined()
  })

  it('falls back to the ordinary skip for an unparseable library-manifest.json', () => {
    const extras = [{ relPath: LIBRARY_MANIFEST_NAME, content: '{broken json' }]
    const result = readLibraryZip(buildLibraryZip([], extras))

    expect(result.manifest).toBeUndefined()
    expect(result.skipped).toEqual([{ path: LIBRARY_MANIFEST_NAME, reason: 'not-bpmn' }])
  })

  it("skips a FOREIGN zip's same-named manifest whose JSON has the wrong shape", () => {
    const extras = [{ relPath: LIBRARY_MANIFEST_NAME, content: '{"name":"someone-elses"}' }]
    const result = readLibraryZip(buildLibraryZip([], extras))

    expect(result.manifest).toBeUndefined()
    expect(result.skipped).toEqual([{ path: LIBRARY_MANIFEST_NAME, reason: 'not-bpmn' }])
  })

  it('only recognizes the extras at the zip ROOT — nested copies stay skipped', () => {
    const extras = [
      { relPath: `sub/${LIBRARY_MANIFEST_NAME}`, content: serializeLibraryManifest(MANIFEST) },
      { relPath: `sub/${PROCESS_OWNERS_CSV_NAME}`, content: OWNERS_CSV },
    ]
    const result = readLibraryZip(buildLibraryZip([], extras))

    expect(result.manifest).toBeUndefined()
    expect(result.ownersCsv).toBeUndefined()
    expect(result.skipped).toEqual([
      { path: `sub/${LIBRARY_MANIFEST_NAME}`, reason: 'not-bpmn' },
      { path: `sub/${PROCESS_OWNERS_CSV_NAME}`, reason: 'not-bpmn' },
    ])
  })

  it('keeps zip bytes deterministic with extras regardless of input order', () => {
    const files = [
      { relPath: 'b.bpmn', xml: SAMPLE_BPMN('b') },
      { relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') },
    ]
    const extras = [
      { relPath: PROCESS_OWNERS_CSV_NAME, content: OWNERS_CSV },
      { relPath: LIBRARY_MANIFEST_NAME, content: serializeLibraryManifest(MANIFEST) },
    ]
    const zipA = buildLibraryZip(files, extras)
    const zipB = buildLibraryZip([...files].reverse(), [...extras].reverse())
    expect(Array.from(zipA)).toEqual(Array.from(zipB))
  })

  it('reports decode-failed for an undecodable process-owners.csv', () => {
    const invalidUtf8 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const zip = zipSync({ [PROCESS_OWNERS_CSV_NAME]: invalidUtf8 })
    const result = readLibraryZip(zip)

    expect(result.ownersCsv).toBeUndefined()
    expect(result.skipped).toEqual([{ path: PROCESS_OWNERS_CSV_NAME, reason: 'decode-failed' }])
  })

  it('still lists any OTHER non-bpmn extra as skipped (foreign zips unaffected)', () => {
    const extras = [{ relPath: 'README.txt', content: 'hello' }]
    const result = readLibraryZip(buildLibraryZip([{ relPath: 'a.bpmn', xml: SAMPLE_BPMN('a') }], extras))

    expect(result.entries).toHaveLength(1)
    expect(result.skipped).toEqual([{ path: 'README.txt', reason: 'not-bpmn' }])
    expect(result.manifest).toBeUndefined()
    expect(result.ownersCsv).toBeUndefined()
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

  it('rejects an oversized declared .xml entry before expansion or content sniffing', () => {
    const zip = patchDeclaredSize(
      buildLibraryZip([{ relPath: 'huge.xml', xml: SAMPLE_BPMN_XML('huge') }]),
      'huge.xml',
      LIBRARY_ZIP_LIMITS.maxEntryUncompressedBytes + 1
    )
    expectArchiveCode(() => readLibraryZip(zip), 'entry-size-limit')
  })

  it('rejects the whole archive for an unsafe .xml entry path', () => {
    const files = [{ relPath: '../escape.xml', xml: SAMPLE_BPMN_XML('escape') }]
    const zip = buildLibraryZip(files)
    expectArchiveCode(() => readLibraryZip(zip), 'unsafe-path')
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
