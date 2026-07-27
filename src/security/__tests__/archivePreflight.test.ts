import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import {
  ArchivePreflightError,
  archiveCrc32,
  extractPreflightedZip,
  extractPreflightedZipSync,
  preflightZip,
  preflightZipAsync,
  type ArchiveErrorCode,
  type ZipSafetyLimits
} from '../archivePreflight'

const LIMITS: ZipSafetyLimits = {
  maxCompressedBytes: 1024 * 1024,
  maxEntries: 10,
  maxCentralDirectoryBytes: 64 * 1024,
  maxEntryNameBytes: 512,
  maxEntryUncompressedBytes: 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 100
}

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
  throw new Error('test fixture has no EOCD')
}

function centralEntries(bytes: Uint8Array): number[] {
  const eocd = findEocd(bytes)
  const count = readU16(bytes, eocd + 10)
  const offsets: number[] = []
  let cursor = readU32(bytes, eocd + 16)
  for (let index = 0; index < count; index += 1) {
    offsets.push(cursor)
    cursor +=
      46 + readU16(bytes, cursor + 28) + readU16(bytes, cursor + 30) + readU16(bytes, cursor + 32)
  }
  return offsets
}

function centralEntryNamed(bytes: Uint8Array, name: string): number {
  const decoder = new TextDecoder()
  for (const central of centralEntries(bytes)) {
    const nameLength = readU16(bytes, central + 28)
    const actual = decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength))
    if (actual === name) return central
  }
  throw new Error(`test fixture has no central entry named ${name}`)
}

function localForCentral(bytes: Uint8Array, central: number): number {
  return readU32(bytes, central + 42)
}

function cloneAndMutate(source: Uint8Array, mutate: (bytes: Uint8Array) => void): Uint8Array {
  const copy = source.slice()
  mutate(copy)
  return copy
}

function stored(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 0 })
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

describe('ZIP central-directory preflight', () => {
  it('accepts safe nested/Unicode entries and extracts only the selected files', async () => {
    const archive = stored({
      'nested/diagram.bpmn': strToU8('<definitions/>'),
      'عربي/عملية.bpmn': strToU8('<definitions id="arabic"/>'),
      'notes.txt': strToU8('ignored')
    })

    const preflight = preflightZip(archive, LIMITS)
    expect(preflight.entries.map((entry) => entry.normalizedName)).toEqual([
      'nested/diagram.bpmn',
      'عربي/عملية.bpmn',
      'notes.txt'
    ])
    expect(preflight.totalDeclaredUncompressedSize).toBe(
      strToU8('<definitions/>').length +
        strToU8('<definitions id="arabic"/>').length +
        strToU8('ignored').length
    )

    const includeBpmn = (entry: { normalizedName: string }) =>
      entry.normalizedName.endsWith('.bpmn')
    const syncResult = extractPreflightedZipSync(archive, preflight, {
      include: includeBpmn
    })
    const asyncResult = await extractPreflightedZip(archive, preflight, {
      include: includeBpmn
    })

    expect(Object.keys(syncResult)).toEqual(['nested/diagram.bpmn', 'عربي/عملية.bpmn'])
    expect(Object.keys(asyncResult)).toEqual(Object.keys(syncResult))
    expect(new TextDecoder().decode(asyncResult['nested/diagram.bpmn'])).toBe('<definitions/>')
  })

  it('normalizes ordinary backslash separators but rejects traversal and absolute paths', () => {
    const safe = stored({ 'nested\\diagram.bpmn': strToU8('ok') })
    expect(preflightZip(safe, LIMITS).entries[0].normalizedName).toBe('nested/diagram.bpmn')

    for (const name of ['../escape.bpmn', 'safe\\..\\escape.bpmn', '/abs.bpmn', 'C:\\x.bpmn']) {
      expectArchiveCode(() => preflightZip(stored({ [name]: strToU8('x') }), LIMITS), 'unsafe-path')
    }
  })

  it('rejects compressed input, entry-count, central-directory, and name limits', () => {
    const one = stored({ 'one.txt': strToU8('1') })
    expectArchiveCode(
      () => preflightZip(one, { ...LIMITS, maxCompressedBytes: one.length - 1 }),
      'compressed-size-limit'
    )
    expectArchiveCode(
      () =>
        preflightZip(stored({ 'one.txt': strToU8('1'), 'two.txt': strToU8('2') }), {
          ...LIMITS,
          maxEntries: 1
        }),
      'too-many-entries'
    )
    expectArchiveCode(
      () => preflightZip(one, { ...LIMITS, maxCentralDirectoryBytes: 1 }),
      'central-directory-limit'
    )
    expectArchiveCode(
      () => preflightZip(one, { ...LIMITS, maxEntryNameBytes: 2 }),
      'entry-name-limit'
    )
  })

  it('rejects fake huge declared entries before decompression without a huge fixture', () => {
    const archive = cloneAndMutate(stored({ 'small.txt': strToU8('x') }), (bytes) => {
      const central = centralEntryNamed(bytes, 'small.txt')
      writeU32(bytes, central + 24, LIMITS.maxEntryUncompressedBytes + 1)
    })

    expect(archive.length).toBeLessThan(256)
    expectArchiveCode(() => preflightZip(archive, LIMITS), 'entry-size-limit')
  })

  it('enforces total declared size using tiny stored entries', () => {
    const archive = stored({
      'one.txt': strToU8('12'),
      'two.txt': strToU8('34')
    })
    expectArchiveCode(
      () => preflightZip(archive, { ...LIMITS, maxTotalUncompressedBytes: 3 }),
      'total-size-limit'
    )
  })

  it('rejects an extreme compression ratio with a small decompression-bomb fixture', () => {
    const archive = zipSync({ 'bomb.txt': strToU8('x'.repeat(16_384)) })
    expect(archive.length).toBeLessThan(512)
    expectArchiveCode(
      () => preflightZip(archive, { ...LIMITS, maxCompressionRatio: 10 }),
      'compression-ratio-limit'
    )
  })

  it('rejects duplicate case-folded normalized paths', () => {
    const archive = stored({
      'Folder/Diagram.bpmn': strToU8('one'),
      'folder/diagram.bpmn': strToU8('two')
    })
    expectArchiveCode(() => preflightZip(archive, LIMITS), 'duplicate-path')
  })

  it('rejects encrypted entries before expansion', () => {
    const archive = cloneAndMutate(stored({ 'secret.txt': strToU8('secret') }), (bytes) => {
      const central = centralEntries(bytes)[0]
      const local = localForCentral(bytes, central)
      writeU16(bytes, central + 8, readU16(bytes, central + 8) | 0x0001)
      writeU16(bytes, local + 6, readU16(bytes, local + 6) | 0x0001)
    })

    expectArchiveCode(() => preflightZip(archive, LIMITS), 'encrypted-entry')
  })

  it('rejects unsupported compression methods and ZIP64 metadata', () => {
    const base = stored({ 'file.txt': strToU8('data') })
    const unsupportedMethod = cloneAndMutate(base, (bytes) => {
      const central = centralEntries(bytes)[0]
      const local = localForCentral(bytes, central)
      writeU16(bytes, central + 10, 99)
      writeU16(bytes, local + 8, 99)
    })
    expectArchiveCode(() => preflightZip(unsupportedMethod, LIMITS), 'unsupported-compression')

    const zip64 = cloneAndMutate(base, (bytes) => {
      writeU32(bytes, centralEntries(bytes)[0] + 24, 0xffffffff)
    })
    expectArchiveCode(() => preflightZip(zip64, LIMITS), 'zip64-unsupported')
  })

  it('rejects multi-disk archives and Unix links/special entries', () => {
    const base = stored({ 'file.txt': strToU8('data') })
    const multiDisk = cloneAndMutate(base, (bytes) => {
      writeU16(bytes, findEocd(bytes) + 4, 1)
    })
    expectArchiveCode(() => preflightZip(multiDisk, LIMITS), 'multi-disk-unsupported')

    const symlink = cloneAndMutate(base, (bytes) => {
      const central = centralEntries(bytes)[0]
      const madeBy = readU16(bytes, central + 4)
      writeU16(bytes, central + 4, (3 << 8) | (madeBy & 0xff))
      writeU32(bytes, central + 38, (0xa000 << 16) >>> 0)
    })
    expectArchiveCode(() => preflightZip(symlink, LIMITS), 'unsupported-entry')
  })

  it('rejects ambiguous non-UTF-8 entry names', () => {
    const archive = cloneAndMutate(stored({ 'é.txt': strToU8('data') }), (bytes) => {
      const central = centralEntries(bytes)[0]
      const local = localForCentral(bytes, central)
      writeU16(bytes, central + 8, readU16(bytes, central + 8) & ~0x0800)
      writeU16(bytes, local + 6, readU16(bytes, local + 6) & ~0x0800)
    })
    expectArchiveCode(() => preflightZip(archive, LIMITS), 'unsupported-filename-encoding')
  })

  it('rejects malformed central/local headers and truncated archives', () => {
    const base = stored({ 'file.txt': strToU8('data') })
    const badCentral = cloneAndMutate(base, (bytes) => {
      bytes[centralEntries(bytes)[0]] = 0
    })
    expectArchiveCode(() => preflightZip(badCentral, LIMITS), 'malformed')

    const badLocal = cloneAndMutate(base, (bytes) => {
      const central = centralEntries(bytes)[0]
      bytes[localForCentral(bytes, central)] = 0
    })
    expectArchiveCode(() => preflightZip(badLocal, LIMITS), 'malformed')

    const mismatchedLocal = cloneAndMutate(base, (bytes) => {
      const central = centralEntries(bytes)[0]
      writeU16(bytes, localForCentral(bytes, central) + 8, 8)
    })
    expectArchiveCode(() => preflightZip(mismatchedLocal, LIMITS), 'malformed')
    expectArchiveCode(() => preflightZip(base.slice(0, -1), LIMITS), 'not-zip')
  })

  it('verifies CRC after bounded expansion', () => {
    const archive = cloneAndMutate(stored({ 'file.txt': strToU8('data') }), (bytes) => {
      const central = centralEntries(bytes)[0]
      const local = localForCentral(bytes, central)
      const wrongCrc = (readU32(bytes, central + 16) ^ 1) >>> 0
      writeU32(bytes, central + 16, wrongCrc)
      writeU32(bytes, local + 14, wrongCrc)
    })
    const preflight = preflightZip(archive, LIMITS)
    expectArchiveCode(() => extractPreflightedZipSync(archive, preflight), 'crc-mismatch')
  })

  it('rejects a deflate stream whose real output exceeds matching declared metadata', async () => {
    const archive = cloneAndMutate(
      zipSync({ 'file.txt': strToU8('A'.repeat(16_384)) }),
      (bytes) => {
        const central = centralEntryNamed(bytes, 'file.txt')
        const local = localForCentral(bytes, central)
        const truncated = strToU8('A')
        const truncatedCrc = archiveCrc32(truncated)
        writeU32(bytes, central + 16, truncatedCrc)
        writeU32(bytes, central + 24, truncated.byteLength)
        writeU32(bytes, local + 14, truncatedCrc)
        writeU32(bytes, local + 22, truncated.byteLength)
      }
    )
    const preflight = preflightZip(archive, LIMITS)

    expectArchiveCode(() => extractPreflightedZipSync(archive, preflight), 'malformed')
    await expect(extractPreflightedZip(archive, preflight)).rejects.toMatchObject({
      code: 'malformed',
      entry: 'file.txt'
    })
  })

  it('rejects mismatched local size metadata before expansion', () => {
    const archive = cloneAndMutate(stored({ 'file.txt': strToU8('data') }), (bytes) => {
      const central = centralEntryNamed(bytes, 'file.txt')
      const local = localForCentral(bytes, central)
      writeU32(bytes, local + 22, readU32(bytes, local + 22) + 1)
    })

    expectArchiveCode(() => preflightZip(archive, LIMITS), 'malformed')
  })

  it('provides async preflight/extraction APIs with AbortSignal cancellation', async () => {
    const archive = stored({ 'file.txt': strToU8('data') })
    const preflight = await preflightZipAsync(archive, LIMITS)
    expect(preflight.entries).toHaveLength(1)

    const controller = new AbortController()
    controller.abort()
    await expect(preflightZipAsync(archive, LIMITS, controller.signal)).rejects.toMatchObject({
      code: 'aborted'
    })
    await expect(
      extractPreflightedZip(archive, preflight, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'aborted' })

    const runningController = new AbortController()
    let randomState = 0x12345678
    const incompressible = Uint8Array.from({ length: 512 * 1024 }, () => {
      randomState ^= randomState << 13
      randomState ^= randomState >>> 17
      randomState ^= randomState << 5
      return randomState & 0xff
    })
    const compressed = zipSync({
      'large.bin': incompressible
    })
    const runningPreflight = preflightZip(compressed, LIMITS)
    const extraction = extractPreflightedZip(compressed, runningPreflight, {
      signal: runningController.signal
    })
    runningController.abort()
    await expect(extraction).rejects.toMatchObject({ code: 'aborted' })
  })
})
