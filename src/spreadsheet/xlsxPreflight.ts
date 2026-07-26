import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS, XLSX_MAX_ZIP_ENTRIES } from './limits'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const OLE_SIGNATURE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export interface XlsxZipEntry {
  readonly path: string
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly compressionMethod: 0 | 8
  readonly crc32: number
  readonly localHeaderOffset: number
}

export interface XlsxPreflightWarning {
  readonly code: 'external-links-ignored' | 'data-connections-ignored'
  readonly entries: readonly string[]
}

export interface XlsxPreflightResult {
  readonly entries: readonly XlsxZipEntry[]
  readonly worksheetCount: number
  readonly totalDeclaredUncompressedBytes: number
  readonly warnings: readonly XlsxPreflightWarning[]
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const minimum = Math.max(0, bytes.length - (0xffff + 22))
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.length) return offset
  }
  throw new SpreadsheetError('malformed-zip', { reason: 'missing-eocd' })
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((value) => value > 0x7f)) {
    throw new SpreadsheetError('malformed-zip', { reason: 'non-utf8-entry-name' })
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new SpreadsheetError(
      'malformed-zip',
      { reason: 'invalid-entry-name' },
      { cause }
    )
  }
}

function assertSafeZipPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((part) => part === '..') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new SpreadsheetError('unsafe-zip-path', { path })
  }
}

function isMacroOrExecutablePart(path: string): boolean {
  const lower = path.toLocaleLowerCase('en-US')
  return (
    lower === 'xl/vbaproject.bin' ||
    lower.startsWith('xl/activex/') ||
    lower.startsWith('xl/ctrlprops/') ||
    lower.startsWith('xl/embeddings/') ||
    lower.startsWith('customui/') ||
    lower.includes('/macrosheets/') ||
    lower.includes('/xl4macros/')
  )
}

function rangeFits(start: number, length: number, ceiling: number): boolean {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(length) &&
    start >= 0 &&
    length >= 0 &&
    start + length <= ceiling
  )
}

/**
 * Reads only the ZIP central directory and local headers. No entry is inflated
 * before all declared sizes, encryption flags, paths, and executable parts pass.
 */
export function preflightXlsx(bytes: Uint8Array): XlsxPreflightResult {
  if (bytes.length > SPREADSHEET_LIMITS.compressedInputBytes) {
    throw new SpreadsheetError('compressed-size-limit', {
      actual: bytes.length,
      limit: SPREADSHEET_LIMITS.compressedInputBytes
    })
  }
  if (hasPrefix(bytes, OLE_SIGNATURE)) {
    throw new SpreadsheetError('encrypted-workbook', { container: 'ole' })
  }
  if (bytes.length < 22) {
    throw new SpreadsheetError('malformed-zip', { reason: 'too-short' })
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEocd(bytes, view)
  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDisk = view.getUint16(eocdOffset + 6, true)
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralSize = view.getUint32(eocdOffset + 12, true)
  const centralOffset = view.getUint32(eocdOffset + 16, true)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new SpreadsheetError('multi-disk-zip')
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffff_ffff ||
    centralOffset === 0xffff_ffff
  ) {
    throw new SpreadsheetError('zip64-unsupported')
  }
  if (entryCount > XLSX_MAX_ZIP_ENTRIES) {
    throw new SpreadsheetError('malformed-zip', {
      reason: 'entry-count',
      actual: entryCount,
      limit: XLSX_MAX_ZIP_ENTRIES
    })
  }
  if (!rangeFits(centralOffset, centralSize, eocdOffset)) {
    throw new SpreadsheetError('malformed-zip', { reason: 'central-directory-range' })
  }

  const entries: XlsxZipEntry[] = []
  const names = new Set<string>()
  let cursor = centralOffset
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (!rangeFits(cursor, 46, centralOffset + centralSize)) {
      throw new SpreadsheetError('malformed-zip', { reason: 'truncated-central-entry' })
    }
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new SpreadsheetError('malformed-zip', { reason: 'central-entry-signature' })
    }
    const flags = view.getUint16(cursor + 8, true)
    const compressionMethod = view.getUint16(cursor + 10, true)
    const crc32 = view.getUint32(cursor + 16, true)
    const compressedBytes = view.getUint32(cursor + 20, true)
    const uncompressedBytes = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const startDisk = view.getUint16(cursor + 34, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)
    const entryLength = 46 + fileNameLength + extraLength + commentLength

    if (!rangeFits(cursor, entryLength, centralOffset + centralSize)) {
      throw new SpreadsheetError('malformed-zip', { reason: 'central-entry-range' })
    }
    if (startDisk !== 0) throw new SpreadsheetError('multi-disk-zip')
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new SpreadsheetError('encrypted-workbook', { entry: index })
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new SpreadsheetError('unsupported-compression', {
        method: compressionMethod,
        entry: index
      })
    }
    if (
      compressedBytes === 0xffff_ffff ||
      uncompressedBytes === 0xffff_ffff ||
      localHeaderOffset === 0xffff_ffff
    ) {
      throw new SpreadsheetError('zip64-unsupported')
    }

    const path = decodeName(
      bytes.subarray(cursor + 46, cursor + 46 + fileNameLength),
      (flags & 0x0800) !== 0
    )
    assertSafeZipPath(path)
    if (names.has(path)) throw new SpreadsheetError('duplicate-zip-entry', { path })
    names.add(path)
    if (isMacroOrExecutablePart(path)) {
      throw new SpreadsheetError('macro-content', { path })
    }

    totalUncompressed += uncompressedBytes
    if (
      !Number.isSafeInteger(totalUncompressed) ||
      totalUncompressed > SPREADSHEET_LIMITS.declaredUncompressedBytes
    ) {
      throw new SpreadsheetError('uncompressed-size-limit', {
        actual: totalUncompressed,
        limit: SPREADSHEET_LIMITS.declaredUncompressedBytes
      })
    }

    if (!rangeFits(localHeaderOffset, 30, centralOffset)) {
      throw new SpreadsheetError('malformed-zip', { reason: 'local-header-range', path })
    }
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_SIGNATURE) {
      throw new SpreadsheetError('malformed-zip', { reason: 'local-header-signature', path })
    }
    const localFlags = view.getUint16(localHeaderOffset + 6, true)
    const localMethod = view.getUint16(localHeaderOffset + 8, true)
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    if (localFlags !== flags || localMethod !== compressionMethod) {
      throw new SpreadsheetError('malformed-zip', { reason: 'local-central-mismatch', path })
    }
    if (!rangeFits(dataOffset, compressedBytes, centralOffset)) {
      throw new SpreadsheetError('malformed-zip', { reason: 'compressed-data-range', path })
    }
    const localPath = decodeName(
      bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength),
      (localFlags & 0x0800) !== 0
    )
    if (localPath !== path) {
      throw new SpreadsheetError('malformed-zip', { reason: 'entry-name-mismatch', path })
    }

    entries.push(
      Object.freeze({
        path,
        compressedBytes,
        uncompressedBytes,
        compressionMethod,
        crc32,
        localHeaderOffset
      }) as XlsxZipEntry
    )
    cursor += entryLength
  }

  if (cursor !== centralOffset + centralSize) {
    throw new SpreadsheetError('malformed-zip', { reason: 'central-directory-size' })
  }

  for (const required of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']) {
    if (!names.has(required)) {
      throw new SpreadsheetError('missing-xlsx-part', { path: required })
    }
  }

  const worksheetEntries = entries.filter(
    ({ path }) => /^xl\/worksheets\/[^/]+\.xml$/i.test(path) && !path.endsWith('/')
  )
  if (worksheetEntries.length > SPREADSHEET_LIMITS.worksheets) {
    throw new SpreadsheetError('worksheet-limit', {
      actual: worksheetEntries.length,
      limit: SPREADSHEET_LIMITS.worksheets
    })
  }

  const externalLinks = entries
    .map(({ path }) => path)
    .filter((path) => path.toLocaleLowerCase('en-US').startsWith('xl/externallinks/'))
  const dataConnections = entries
    .map(({ path }) => path)
    .filter((path) => {
      const lower = path.toLocaleLowerCase('en-US')
      return (
        lower === 'xl/connections.xml' ||
        lower.startsWith('xl/querytables/') ||
        lower.startsWith('xl/model/')
      )
    })
  const warnings: XlsxPreflightWarning[] = []
  if (externalLinks.length > 0) {
    warnings.push({
      code: 'external-links-ignored',
      entries: Object.freeze(externalLinks.slice().sort())
    })
  }
  if (dataConnections.length > 0) {
    warnings.push({
      code: 'data-connections-ignored',
      entries: Object.freeze(dataConnections.slice().sort())
    })
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    worksheetCount: worksheetEntries.length,
    totalDeclaredUncompressedBytes: totalUncompressed,
    warnings: Object.freeze(warnings)
  })
}

