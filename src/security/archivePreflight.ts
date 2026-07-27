import { Inflate } from 'fflate'

/** Limits are deliberately supplied by each archive consumer. */
export interface ZipSafetyLimits {
  maxCompressedBytes: number
  maxEntries: number
  maxCentralDirectoryBytes: number
  maxEntryNameBytes: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
  maxCompressionRatio: number
}

export type ArchiveErrorCode =
  | 'aborted'
  | 'not-zip'
  | 'malformed'
  | 'compressed-size-limit'
  | 'too-many-entries'
  | 'central-directory-limit'
  | 'entry-name-limit'
  | 'entry-size-limit'
  | 'total-size-limit'
  | 'compression-ratio-limit'
  | 'encrypted-entry'
  | 'unsupported-compression'
  | 'unsupported-entry'
  | 'unsupported-filename-encoding'
  | 'zip64-unsupported'
  | 'multi-disk-unsupported'
  | 'unsafe-path'
  | 'duplicate-path'
  | 'crc-mismatch'

export class ArchivePreflightError extends Error {
  readonly code: ArchiveErrorCode
  readonly entry?: string

  constructor(code: ArchiveErrorCode, message: string, entry?: string) {
    super(message)
    this.name = 'ArchivePreflightError'
    this.code = code
    this.entry = entry
  }
}

export interface ZipPreflightEntry {
  /** Name exactly as decoded from the central directory (fflate's map key). */
  name: string
  /** Slash-normalized, NFC-normalized safe relative path. */
  normalizedName: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: 0 | 8
  crc32: number
  flags: number
  localHeaderOffset: number
  /** Start of the raw compressed payload verified from the local header. */
  dataOffset: number
  directory: boolean
}

export interface ZipPreflightResult {
  compressedSize: number
  totalDeclaredUncompressedSize: number
  centralDirectoryOffset: number
  centralDirectorySize: number
  entries: readonly ZipPreflightEntry[]
}

export interface ExtractPreflightedZipOptions {
  signal?: AbortSignal
  include?: (entry: ZipPreflightEntry) => boolean
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50
const ZIP64_EXTRA_ID = 0x0001
const AES_EXTRA_ID = 0x9901
const MAX_EOCD_COMMENT_BYTES = 0xffff
const ENCRYPTION_FLAGS = 0x2041 // traditional, strong, or central-directory encryption
const DATA_DESCRIPTOR_FLAG = 0x0008
const UTF8_FLAG = 0x0800
const CONTROL_CHARS = /[\x00-\x1f\x7f]/
const INFLATE_INPUT_CHUNK_BYTES = 4 * 1024
const INFLATE_CHUNKS_PER_YIELD = 16

function fail(code: ArchiveErrorCode, message: string, entry?: string): never {
  throw new ArchivePreflightError(code, message, entry)
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail('aborted', 'Archive processing was cancelled')
}

function readU16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) {
    fail('malformed', 'ZIP header ends unexpectedly')
  }
  return data[offset] | (data[offset + 1] << 8)
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) {
    fail('malformed', 'ZIP header ends unexpectedly')
  }
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function bytesEqual(
  data: Uint8Array,
  leftOffset: number,
  rightOffset: number,
  length: number
): boolean {
  if (
    leftOffset < 0 ||
    rightOffset < 0 ||
    leftOffset + length > data.length ||
    rightOffset + length > data.length
  ) {
    return false
  }
  for (let index = 0; index < length; index += 1) {
    if (data[leftOffset + index] !== data[rightOffset + index]) return false
  }
  return true
}

function checkedEnd(start: number, length: number, max: number, what: string): number {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) {
    fail('malformed', `Invalid ${what} offset or length`)
  }
  const end = start + length
  if (!Number.isSafeInteger(end) || end > max) {
    fail('malformed', `${what} extends beyond the archive`)
  }
  return end
}

function validateExtraFields(
  data: Uint8Array,
  start: number,
  length: number,
  entryName: string
): void {
  const end = checkedEnd(start, length, data.length, 'ZIP extra field')
  let cursor = start
  while (cursor < end) {
    if (cursor + 4 > end) {
      fail('malformed', 'Truncated ZIP extra-field header', entryName)
    }
    const id = readU16(data, cursor)
    const fieldLength = readU16(data, cursor + 2)
    cursor += 4
    if (cursor + fieldLength > end) {
      fail('malformed', 'Truncated ZIP extra-field payload', entryName)
    }
    if (id === ZIP64_EXTRA_ID) {
      fail('zip64-unsupported', 'ZIP64 archives are not supported', entryName)
    }
    if (id === AES_EXTRA_ID) {
      fail('encrypted-entry', 'Encrypted ZIP entries are not supported', entryName)
    }
    cursor += fieldLength
  }
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte >= 0x80)) {
    fail('unsupported-filename-encoding', 'Non-ASCII ZIP names must use the UTF-8 filename flag')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('unsupported-filename-encoding', 'ZIP entry name is not valid UTF-8')
  }
}

/**
 * Return a safe relative archive path. Backslashes are treated as separators
 * so Windows-style traversal cannot bypass the checks.
 */
export function normalizeZipEntryPath(rawName: string): string {
  if (rawName === '' || CONTROL_CHARS.test(rawName)) {
    fail('unsafe-path', 'ZIP entry has an empty or control-character path', rawName)
  }
  const slashed = rawName.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    fail('unsafe-path', 'ZIP entry path must be relative', rawName)
  }
  const directory = slashed.endsWith('/')
  const body = directory ? slashed.slice(0, -1) : slashed
  const components = body.split('/')
  if (
    body === '' ||
    components.some((component) => component === '' || component === '.' || component === '..')
  ) {
    fail('unsafe-path', 'ZIP entry path contains an unsafe segment', rawName)
  }
  const normalized = components.map((component) => component.normalize('NFC')).join('/')
  return directory ? `${normalized}/` : normalized
}

function findEocd(data: Uint8Array): number {
  if (data.length < 22) fail('not-zip', 'Not a ZIP archive (missing end record)')
  const minimum = Math.max(0, data.length - 22 - MAX_EOCD_COMMENT_BYTES)
  let sawSignature = false
  for (let offset = data.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(data, offset) !== EOCD_SIGNATURE) continue
    sawSignature = true
    const commentLength = readU16(data, offset + 20)
    if (offset + 22 + commentLength === data.length) return offset
  }
  if (sawSignature) {
    fail('malformed', 'ZIP end record has an invalid comment length')
  }
  fail('not-zip', 'Not a ZIP archive (missing end record)')
}

interface LocalRange {
  start: number
  end: number
  name: string
}

/**
 * Parse and validate the ZIP central directory and every referenced local
 * header without expanding a single entry.
 */
export function preflightZip(
  data: Uint8Array,
  limits: ZipSafetyLimits,
  signal?: AbortSignal
): ZipPreflightResult {
  assertNotAborted(signal)
  if (data.byteLength > limits.maxCompressedBytes) {
    fail('compressed-size-limit', `Compressed archive exceeds ${limits.maxCompressedBytes} bytes`)
  }

  const eocdOffset = findEocd(data)
  const diskNumber = readU16(data, eocdOffset + 4)
  const centralDisk = readU16(data, eocdOffset + 6)
  const entriesOnDisk = readU16(data, eocdOffset + 8)
  const entryCount = readU16(data, eocdOffset + 10)
  const centralSize = readU32(data, eocdOffset + 12)
  const centralOffset = readU32(data, eocdOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail('multi-disk-unsupported', 'Multi-disk ZIP archives are not supported')
  }
  if (
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fail('zip64-unsupported', 'ZIP64 archives are not supported')
  }
  if (entryCount > limits.maxEntries) {
    fail('too-many-entries', `ZIP has ${entryCount} entries (max ${limits.maxEntries})`)
  }
  if (centralSize > limits.maxCentralDirectoryBytes) {
    fail(
      'central-directory-limit',
      `ZIP central directory exceeds ${limits.maxCentralDirectoryBytes} bytes`
    )
  }
  const centralEnd = checkedEnd(centralOffset, centralSize, data.length, 'ZIP central directory')
  if (centralEnd !== eocdOffset) {
    fail('malformed', 'ZIP central directory does not end at the end record')
  }

  const entries: ZipPreflightEntry[] = []
  const localRanges: LocalRange[] = []
  const normalizedPaths = new Set<string>()
  let totalUncompressed = 0
  let cursor = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    assertNotAborted(signal)
    if (cursor + 46 > centralEnd || readU32(data, cursor) !== CENTRAL_SIGNATURE) {
      fail('malformed', `Invalid central-directory entry ${index + 1}`)
    }

    const madeByVersion = readU16(data, cursor + 4)
    const neededVersion = readU16(data, cursor + 6)
    const flags = readU16(data, cursor + 8)
    const method = readU16(data, cursor + 10)
    const crc = readU32(data, cursor + 16)
    const compressedSize = readU32(data, cursor + 20)
    const uncompressedSize = readU32(data, cursor + 24)
    const nameLength = readU16(data, cursor + 28)
    const extraLength = readU16(data, cursor + 30)
    const commentLength = readU16(data, cursor + 32)
    const diskStart = readU16(data, cursor + 34)
    const externalAttributes = readU32(data, cursor + 38)
    const localHeaderOffset = readU32(data, cursor + 42)

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      fail('zip64-unsupported', 'ZIP64 entries are not supported')
    }
    if (diskStart !== 0) {
      fail('multi-disk-unsupported', 'Multi-disk ZIP entries are not supported')
    }
    if (neededVersion > 63) {
      fail('unsupported-entry', `ZIP entry requires unsupported version ${neededVersion / 10}`)
    }
    if ((flags & ENCRYPTION_FLAGS) !== 0) {
      fail('encrypted-entry', 'Encrypted ZIP entries are not supported')
    }
    if (method !== 0 && method !== 8) {
      fail('unsupported-compression', `ZIP compression method ${method} is not supported`)
    }
    if (nameLength === 0 || nameLength > limits.maxEntryNameBytes) {
      fail('entry-name-limit', `ZIP entry name length exceeds ${limits.maxEntryNameBytes} bytes`)
    }

    const variableLength = nameLength + extraLength + commentLength
    const nextCursor = checkedEnd(
      cursor + 46,
      variableLength,
      centralEnd,
      'central-directory entry'
    )
    const nameStart = cursor + 46
    const name = decodeEntryName(
      data.subarray(nameStart, nameStart + nameLength),
      (flags & UTF8_FLAG) !== 0
    )
    const normalizedName = normalizeZipEntryPath(name)
    validateExtraFields(data, nameStart + nameLength, extraLength, name)

    const madeBySystem = madeByVersion >>> 8
    if (madeBySystem === 3) {
      const unixType = (externalAttributes >>> 16) & 0xf000
      if (unixType !== 0 && unixType !== 0x4000 && unixType !== 0x8000) {
        fail('unsupported-entry', 'ZIP links and special files are not supported', name)
      }
    }

    const collisionKey = normalizedName.toLocaleLowerCase('en-US')
    if (normalizedPaths.has(collisionKey)) {
      fail('duplicate-path', 'ZIP contains duplicate normalized entry paths', normalizedName)
    }
    normalizedPaths.add(collisionKey)

    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      fail(
        'entry-size-limit',
        `ZIP entry exceeds ${limits.maxEntryUncompressedBytes} declared bytes`,
        normalizedName
      )
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      fail(
        'total-size-limit',
        `ZIP declared content exceeds ${limits.maxTotalUncompressedBytes} bytes`,
        normalizedName
      )
    }
    if (method === 0 && compressedSize !== uncompressedSize) {
      fail('malformed', 'Stored ZIP entry has inconsistent sizes', normalizedName)
    }
    const ratio =
      uncompressedSize === 0
        ? 0
        : compressedSize === 0
          ? Number.POSITIVE_INFINITY
          : uncompressedSize / compressedSize
    if (ratio > limits.maxCompressionRatio) {
      fail(
        'compression-ratio-limit',
        `ZIP entry compression ratio ${ratio.toFixed(1)} exceeds ${limits.maxCompressionRatio}`,
        normalizedName
      )
    }

    if (localHeaderOffset + 30 > centralOffset) {
      fail('malformed', 'ZIP local header points outside the data area', normalizedName)
    }
    if (readU32(data, localHeaderOffset) !== LOCAL_SIGNATURE) {
      fail('malformed', 'ZIP local-header signature is invalid', normalizedName)
    }
    const localFlags = readU16(data, localHeaderOffset + 6)
    const localMethod = readU16(data, localHeaderOffset + 8)
    const localCrc = readU32(data, localHeaderOffset + 14)
    const localCompressedSize = readU32(data, localHeaderOffset + 18)
    const localUncompressedSize = readU32(data, localHeaderOffset + 22)
    const localNameLength = readU16(data, localHeaderOffset + 26)
    const localExtraLength = readU16(data, localHeaderOffset + 28)

    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength) {
      fail('malformed', 'ZIP local and central headers disagree', normalizedName)
    }
    const localNameStart = localHeaderOffset + 30
    if (!bytesEqual(data, localNameStart, nameStart, nameLength)) {
      fail('malformed', 'ZIP local and central filenames disagree', normalizedName)
    }
    validateExtraFields(data, localNameStart + localNameLength, localExtraLength, normalizedName)
    const dataStart = checkedEnd(
      localNameStart + localNameLength,
      localExtraLength,
      centralOffset,
      'ZIP local header'
    )
    const dataEnd = checkedEnd(dataStart, compressedSize, centralOffset, 'ZIP compressed entry')

    let localRecordEnd = dataEnd
    if ((flags & DATA_DESCRIPTOR_FLAG) === 0) {
      if (
        localCrc !== crc ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize
      ) {
        fail('malformed', 'ZIP local and central sizes or CRC disagree', normalizedName)
      }
    } else {
      const localFieldsAreEmpty =
        localCrc === 0 && localCompressedSize === 0 && localUncompressedSize === 0
      const localFieldsMatch =
        localCrc === crc &&
        localCompressedSize === compressedSize &&
        localUncompressedSize === uncompressedSize
      if (!localFieldsAreEmpty && !localFieldsMatch) {
        fail('malformed', 'ZIP local header disagrees with its data descriptor', normalizedName)
      }

      const unsignedDescriptorEnd = checkedEnd(dataEnd, 12, centralOffset, 'ZIP data descriptor')
      const unsignedDescriptorMatches =
        readU32(data, dataEnd) === crc &&
        readU32(data, dataEnd + 4) === compressedSize &&
        readU32(data, dataEnd + 8) === uncompressedSize
      const signedDescriptorMatches =
        readU32(data, dataEnd) === DATA_DESCRIPTOR_SIGNATURE &&
        dataEnd + 16 <= centralOffset &&
        readU32(data, dataEnd + 4) === crc &&
        readU32(data, dataEnd + 8) === compressedSize &&
        readU32(data, dataEnd + 12) === uncompressedSize
      if (!unsignedDescriptorMatches && !signedDescriptorMatches) {
        fail('malformed', 'ZIP data descriptor disagrees with the central header', normalizedName)
      }
      localRecordEnd = signedDescriptorMatches ? dataEnd + 16 : unsignedDescriptorEnd
    }

    const directory = normalizedName.endsWith('/')
    entries.push({
      name,
      normalizedName,
      compressedSize,
      uncompressedSize,
      compressionMethod: method,
      crc32: crc,
      flags,
      localHeaderOffset,
      dataOffset: dataStart,
      directory
    })
    localRanges.push({ start: localHeaderOffset, end: localRecordEnd, name: normalizedName })
    cursor = nextCursor
  }

  if (cursor !== centralEnd) {
    fail('malformed', 'ZIP central-directory size does not match its entries')
  }
  localRanges.sort((left, right) => left.start - right.start)
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) {
      fail('malformed', 'ZIP local entry ranges overlap', localRanges[index].name)
    }
  }

  return {
    compressedSize: data.byteLength,
    totalDeclaredUncompressedSize: totalUncompressed,
    centralDirectoryOffset: centralOffset,
    centralDirectorySize: centralSize,
    entries
  }
}

export async function preflightZipAsync(
  data: Uint8Array,
  limits: ZipSafetyLimits,
  signal?: AbortSignal
): Promise<ZipPreflightResult> {
  assertNotAborted(signal)
  // Give a worker/message-loop caller a cancellation point before the bounded
  // central-directory scan begins.
  await Promise.resolve()
  return preflightZip(data, limits, signal)
}

let crcTable: Uint32Array | undefined

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  crcTable = table
  return table
}

export function archiveCrc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function selectedEntries(
  preflight: ZipPreflightResult,
  include?: (entry: ZipPreflightEntry) => boolean
): ZipPreflightEntry[] {
  return preflight.entries.filter((entry) => !entry.directory && (!include || include(entry)))
}

function compressedEntryBytes(data: Uint8Array, entry: ZipPreflightEntry): Uint8Array {
  const end = checkedEnd(
    entry.dataOffset,
    entry.compressedSize,
    data.length,
    'ZIP compressed entry'
  )
  return data.subarray(entry.dataOffset, end)
}

function validateExpandedEntry(
  bytes: Uint8Array,
  entry: ZipPreflightEntry,
  signal?: AbortSignal
): Uint8Array {
  assertNotAborted(signal)
  if (bytes.byteLength !== entry.uncompressedSize) {
    fail('malformed', 'Expanded ZIP entry does not match its declared size', entry.normalizedName)
  }
  if (archiveCrc32(bytes) !== entry.crc32) {
    fail('crc-mismatch', 'Expanded ZIP entry failed its CRC check', entry.normalizedName)
  }
  return bytes
}

interface BoundedEntryInflater {
  readonly push: (chunk: Uint8Array, final: boolean) => void
  readonly finish: () => Uint8Array
}

/**
 * Allocate only the reviewed output size, then copy streamed inflate chunks
 * into that buffer while counting every actual byte. Compressed input is fed
 * in small pieces so a lying deflate stream is stopped after a bounded amount
 * of work instead of being fully expanded before the caller regains control.
 */
function createBoundedEntryInflater(entry: ZipPreflightEntry): BoundedEntryInflater {
  let output: Uint8Array
  try {
    output = new Uint8Array(entry.uncompressedSize)
  } catch (error) {
    fail(
      'entry-size-limit',
      `Could not allocate the bounded ZIP entry output: ${
        error instanceof Error ? error.message : String(error)
      }`,
      entry.normalizedName
    )
  }
  let written = 0
  let overflow = false
  const inflater = new Inflate((chunk) => {
    if (overflow) return
    if (written + chunk.byteLength > output.byteLength) {
      overflow = true
      return
    }
    output.set(chunk, written)
    written += chunk.byteLength
  })

  return {
    push(chunk, final) {
      try {
        inflater.push(chunk, final)
      } catch (error) {
        fail(
          'malformed',
          `ZIP decompression failed: ${error instanceof Error ? error.message : String(error)}`,
          entry.normalizedName
        )
      }
      if (overflow) {
        fail('malformed', 'Expanded ZIP entry exceeds its declared size', entry.normalizedName)
      }
    },
    finish() {
      if (written !== output.byteLength) {
        fail(
          'malformed',
          'Expanded ZIP entry does not match its declared size',
          entry.normalizedName
        )
      }
      return output
    }
  }
}

function extractEntrySync(
  data: Uint8Array,
  entry: ZipPreflightEntry,
  signal?: AbortSignal
): Uint8Array {
  const compressed = compressedEntryBytes(data, entry)
  if (entry.compressionMethod === 0) return compressed.slice()
  const bounded = createBoundedEntryInflater(entry)
  if (compressed.byteLength === 0) {
    assertNotAborted(signal)
    bounded.push(compressed, true)
  }
  for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_INPUT_CHUNK_BYTES) {
    assertNotAborted(signal)
    const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.byteLength)
    bounded.push(compressed.subarray(offset, end), end === compressed.byteLength)
  }
  return bounded.finish()
}

async function extractEntry(
  data: Uint8Array,
  entry: ZipPreflightEntry,
  signal?: AbortSignal
): Promise<Uint8Array> {
  assertNotAborted(signal)
  const compressed = compressedEntryBytes(data, entry)
  if (entry.compressionMethod === 0) return compressed.slice()
  const bounded = createBoundedEntryInflater(entry)
  if (compressed.byteLength === 0) {
    bounded.push(compressed, true)
  }
  let chunkOrdinal = 0
  for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_INPUT_CHUNK_BYTES) {
    assertNotAborted(signal)
    const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.byteLength)
    bounded.push(compressed.subarray(offset, end), end === compressed.byteLength)
    chunkOrdinal += 1
    if (end < compressed.byteLength && chunkOrdinal % INFLATE_CHUNKS_PER_YIELD === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }
  }
  assertNotAborted(signal)
  return bounded.finish()
}

/**
 * Compatibility seam for current synchronous callers. Preflight must already
 * have succeeded; only selected, bounded entries are expanded.
 */
export function extractPreflightedZipSync(
  data: Uint8Array,
  preflight: ZipPreflightResult,
  options: ExtractPreflightedZipOptions = {}
): Record<string, Uint8Array> {
  assertNotAborted(options.signal)
  if (data.byteLength !== preflight.compressedSize) {
    fail('malformed', 'Archive bytes do not match their preflight result')
  }
  const selected = selectedEntries(preflight, options.include)
  if (selected.length === 0) return {}
  const result: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const entry of selected) {
    assertNotAborted(options.signal)
    result[entry.normalizedName] = validateExpandedEntry(
      extractEntrySync(data, entry, options.signal),
      entry,
      options.signal
    )
  }
  return result
}

/**
 * Async/worker-friendly bounded extraction with a real termination seam for
 * fflate's worker-backed inflaters.
 */
export async function extractPreflightedZip(
  data: Uint8Array,
  preflight: ZipPreflightResult,
  options: ExtractPreflightedZipOptions = {}
): Promise<Record<string, Uint8Array>> {
  assertNotAborted(options.signal)
  if (data.byteLength !== preflight.compressedSize) {
    fail('malformed', 'Archive bytes do not match their preflight result')
  }

  const selected = selectedEntries(preflight, options.include)
  const result: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const entry of selected) {
    assertNotAborted(options.signal)
    const expanded = await extractEntry(data, entry, options.signal)
    result[entry.normalizedName] = validateExpandedEntry(expanded, entry, options.signal)
  }
  return result
}
