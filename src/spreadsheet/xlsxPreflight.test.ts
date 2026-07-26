import { describe, expect, it, vi } from 'vitest'
import type { ParsedWorkbookData, WorkbookCell } from './contracts'
import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'
import { createOfficialWorkbookTemplate } from './template'
import { parseXlsxBoundary, validateParsedWorkbookData } from './workbookBoundary'
import { preflightXlsx } from './xlsxPreflight'

function clone(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

function findSignature(bytes: Uint8Array, signature: number, start = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = start; offset + 4 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  return -1
}

function firstCentral(bytes: Uint8Array): number {
  const offset = findSignature(bytes, 0x02014b50)
  if (offset < 0) throw new Error('central directory not found')
  return offset
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimum = Math.max(0, bytes.length - (0xffff + 22))
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    if (offset + 22 + view.getUint16(offset + 20, true) === bytes.length) return offset
  }
  throw new Error('end of central directory not found')
}

function centralEntries(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(bytes)
  const count = view.getUint16(eocd + 10, true)
  const entries: number[] = []
  let cursor = view.getUint32(eocd + 16, true)
  for (let index = 0; index < count; index += 1) {
    entries.push(cursor)
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true)
  }
  return entries
}

function insertCentralExtraField(source: Uint8Array, fieldId: number): Uint8Array {
  const bytes = clone(source)
  const sourceView = new DataView(bytes.buffer)
  const central = firstCentral(bytes)
  const fileNameLength = sourceView.getUint16(central + 28, true)
  const extraLength = sourceView.getUint16(central + 30, true)
  const insertionOffset = central + 46 + fileNameLength + extraLength
  const oldEocd = findEocd(bytes)
  const oldCentralSize = sourceView.getUint32(oldEocd + 12, true)
  const result = new Uint8Array(bytes.length + 4)
  result.set(bytes.subarray(0, insertionOffset))
  result.set(bytes.subarray(insertionOffset), insertionOffset + 4)
  const view = new DataView(result.buffer)
  view.setUint16(insertionOffset, fieldId, true)
  view.setUint16(insertionOffset + 2, 0, true)
  view.setUint16(central + 30, extraLength + 4, true)
  view.setUint32(oldEocd + 4 + 12, oldCentralSize + 4, true)
  return result
}

function insertLocalExtraField(source: Uint8Array, fieldId: number): Uint8Array {
  const bytes = clone(source)
  const sourceView = new DataView(bytes.buffer)
  const originalCentralEntries = centralEntries(bytes)
  const central = originalCentralEntries[0]!
  const local = sourceView.getUint32(central + 42, true)
  const localNameLength = sourceView.getUint16(local + 26, true)
  const localExtraLength = sourceView.getUint16(local + 28, true)
  const insertionOffset = local + 30 + localNameLength + localExtraLength
  const oldEocd = findEocd(bytes)
  const oldCentralOffset = sourceView.getUint32(oldEocd + 16, true)
  const result = new Uint8Array(bytes.length + 4)
  result.set(bytes.subarray(0, insertionOffset))
  result.set(bytes.subarray(insertionOffset), insertionOffset + 4)
  const view = new DataView(result.buffer)
  view.setUint16(insertionOffset, fieldId, true)
  view.setUint16(insertionOffset + 2, 0, true)
  view.setUint16(local + 28, localExtraLength + 4, true)

  const newCentralOffset = oldCentralOffset + 4
  const newEocd = oldEocd + 4
  view.setUint32(newEocd + 16, newCentralOffset, true)
  for (const originalCentral of originalCentralEntries) {
    const shiftedCentral = originalCentral + 4
    const originalLocal = sourceView.getUint32(originalCentral + 42, true)
    view.setUint32(
      shiftedCentral + 42,
      originalLocal >= insertionOffset ? originalLocal + 4 : originalLocal,
      true
    )
  }
  return result
}

function addDataDescriptor(source: Uint8Array): {
  bytes: Uint8Array
  descriptorOffset: number
} {
  const bytes = clone(source)
  const sourceView = new DataView(bytes.buffer)
  const originalCentralEntries = centralEntries(bytes)
  const selectedCentral = originalCentralEntries.reduce((selected, candidate) =>
    sourceView.getUint32(candidate + 42, true) > sourceView.getUint32(selected + 42, true)
      ? candidate
      : selected
  )
  const local = sourceView.getUint32(selectedCentral + 42, true)
  const localNameLength = sourceView.getUint16(local + 26, true)
  const localExtraLength = sourceView.getUint16(local + 28, true)
  const compressedBytes = sourceView.getUint32(selectedCentral + 20, true)
  const descriptorOffset = local + 30 + localNameLength + localExtraLength + compressedBytes
  const oldEocd = findEocd(bytes)
  const oldCentralOffset = sourceView.getUint32(oldEocd + 16, true)
  expect(descriptorOffset).toBe(oldCentralOffset)

  const result = new Uint8Array(bytes.length + 16)
  result.set(bytes.subarray(0, descriptorOffset))
  result.set(bytes.subarray(descriptorOffset), descriptorOffset + 16)
  const view = new DataView(result.buffer)
  view.setUint32(descriptorOffset, 0x08074b50, true)
  view.setUint32(descriptorOffset + 4, sourceView.getUint32(selectedCentral + 16, true), true)
  view.setUint32(descriptorOffset + 8, compressedBytes, true)
  view.setUint32(descriptorOffset + 12, sourceView.getUint32(selectedCentral + 24, true), true)
  view.setUint16(local + 6, sourceView.getUint16(local + 6, true) | 0x0008, true)
  view.setUint32(local + 14, 0, true)
  view.setUint32(local + 18, 0, true)
  view.setUint32(local + 22, 0, true)

  const shiftedSelectedCentral = selectedCentral + 16
  view.setUint16(
    shiftedSelectedCentral + 8,
    sourceView.getUint16(selectedCentral + 8, true) | 0x0008,
    true
  )
  view.setUint32(oldEocd + 16 + 16, oldCentralOffset + 16, true)
  return { bytes: result, descriptorOffset }
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length)
  const result = clone(bytes)
  const oldBytes = new TextEncoder().encode(from)
  const newBytes = new TextEncoder().encode(to)
  let replacements = 0
  for (let offset = 0; offset <= result.length - oldBytes.length; offset += 1) {
    if (oldBytes.every((value, index) => result[offset + index] === value)) {
      result.set(newBytes, offset)
      replacements += 1
      offset += oldBytes.length - 1
    }
  }
  expect(replacements).toBeGreaterThanOrEqual(2)
  return result
}

function expectCode(action: () => unknown, code: SpreadsheetError['code']): void {
  try {
    action()
    throw new Error('Expected SpreadsheetError')
  } catch (error) {
    expect(error).toBeInstanceOf(SpreadsheetError)
    expect((error as SpreadsheetError).code).toBe(code)
  }
}

describe('XLSX ZIP central-directory preflight', () => {
  it('accepts the deterministic macro-free template', () => {
    const result = preflightXlsx(createOfficialWorkbookTemplate('blank'))
    expect(result.worksheetCount).toBe(5)
    expect(result.entries.every(({ compressionMethod }) => compressionMethod === 0)).toBe(true)
  })

  it('recognizes OLE/encrypted containers and malformed archives before inflation', () => {
    expectCode(
      () =>
        preflightXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])),
      'encrypted-workbook'
    )
    expectCode(() => preflightXlsx(new Uint8Array([1, 2, 3])), 'malformed-zip')
  })

  it('rejects an encryption flag in both the local and central metadata', () => {
    const bytes = clone(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = firstCentral(bytes)
    const local = view.getUint32(central + 42, true)
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true)
    view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true)
    expectCode(() => preflightXlsx(bytes), 'encrypted-workbook')
  })

  it('rejects central-directory encryption and AES extra fields before inflation', () => {
    const encrypted = clone(createOfficialWorkbookTemplate('blank'))
    const encryptedView = new DataView(encrypted.buffer)
    const encryptedCentral = firstCentral(encrypted)
    encryptedView.setUint16(
      encryptedCentral + 8,
      encryptedView.getUint16(encryptedCentral + 8, true) | 0x2000,
      true
    )
    expectCode(() => preflightXlsx(encrypted), 'encrypted-workbook')

    expectCode(
      () => preflightXlsx(insertCentralExtraField(createOfficialWorkbookTemplate('blank'), 0x9901)),
      'encrypted-workbook'
    )
    expectCode(
      () => preflightXlsx(insertLocalExtraField(createOfficialWorkbookTemplate('blank'), 0x9901)),
      'encrypted-workbook'
    )
  })

  it('rejects local flags, method, CRC, and size fields that disagree with central metadata', () => {
    const template = createOfficialWorkbookTemplate('blank')
    const mutations: Array<(view: DataView, central: number, local: number) => void> = [
      (view, _central, local) =>
        view.setUint16(local + 6, view.getUint16(local + 6, true) ^ 0x0800, true),
      (view, _central, local) =>
        view.setUint16(local + 8, view.getUint16(local + 8, true) === 0 ? 8 : 0, true),
      (view, _central, local) =>
        view.setUint32(local + 14, (view.getUint32(local + 14, true) ^ 1) >>> 0, true),
      (view, _central, local) =>
        view.setUint32(local + 18, view.getUint32(local + 18, true) + 1, true),
      (view, _central, local) =>
        view.setUint32(local + 22, view.getUint32(local + 22, true) + 1, true)
    ]

    for (const mutate of mutations) {
      const bytes = clone(template)
      const view = new DataView(bytes.buffer)
      const central = firstCentral(bytes)
      const local = view.getUint32(central + 42, true)
      mutate(view, central, local)
      expectCode(() => preflightXlsx(bytes), 'malformed-zip')
    }
  })

  it('validates data descriptors and preserves a valid descriptor-based workbook', () => {
    const descriptorFixture = addDataDescriptor(createOfficialWorkbookTemplate('blank'))
    expect(preflightXlsx(descriptorFixture.bytes).worksheetCount).toBe(5)

    const mismatched = clone(descriptorFixture.bytes)
    const mismatchedView = new DataView(mismatched.buffer)
    mismatchedView.setUint32(
      descriptorFixture.descriptorOffset + 4,
      (mismatchedView.getUint32(descriptorFixture.descriptorOffset + 4, true) ^ 1) >>> 0,
      true
    )
    expectCode(() => preflightXlsx(mismatched), 'malformed-zip')

    const missing = clone(createOfficialWorkbookTemplate('blank'))
    const missingView = new DataView(missing.buffer)
    const central = centralEntries(missing).at(-1)!
    const local = missingView.getUint32(central + 42, true)
    missingView.setUint16(central + 8, missingView.getUint16(central + 8, true) | 0x0008, true)
    missingView.setUint16(local + 6, missingView.getUint16(local + 6, true) | 0x0008, true)
    expectCode(() => preflightXlsx(missing), 'malformed-zip')
  })

  it('rejects local header and compressed-data ranges outside the ZIP data area', () => {
    const bytes = clone(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = firstCentral(bytes)
    const local = view.getUint32(central + 42, true)
    view.setUint16(local + 28, 0xffff, true)
    expectCode(() => preflightXlsx(bytes), 'malformed-zip')
  })

  it('rejects declared decompression bombs before reading a local payload', () => {
    const bytes = clone(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = firstCentral(bytes)
    view.setUint32(central + 24, SPREADSHEET_LIMITS.declaredUncompressedBytes + 1, true)
    expectCode(() => preflightXlsx(bytes), 'uncompressed-size-limit')
  })

  it('rejects executable/macro parts even when the extension says xlsx', () => {
    const macro = replaceAscii(
      createOfficialWorkbookTemplate('blank'),
      'docProps/app.xml',
      'xl/activeX/a.xml'
    )
    expectCode(() => preflightXlsx(macro), 'macro-content')
  })

  it('detects ignored external links and data connections as warnings', () => {
    const external = replaceAscii(
      createOfficialWorkbookTemplate('blank'),
      'docProps/custom.xml',
      'xl/externalLinks/aa'
    )
    expect(preflightXlsx(external).warnings).toEqual([
      { code: 'external-links-ignored', entries: ['xl/externalLinks/aa'] }
    ])

    const connected = replaceAscii(
      createOfficialWorkbookTemplate('blank'),
      'xl/styles.xml',
      'xl/model/aa.x'
    )
    expect(preflightXlsx(connected).warnings).toEqual([
      { code: 'data-connections-ignored', entries: ['xl/model/aa.x'] }
    ])
  })

  it('rejects missing required package parts and unsupported compression', () => {
    const missing = replaceAscii(
      createOfficialWorkbookTemplate('blank'),
      'xl/workbook.xml',
      'xl/notebook.xml'
    )
    expectCode(() => preflightXlsx(missing), 'missing-xlsx-part')

    const bytes = clone(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = firstCentral(bytes)
    const local = view.getUint32(central + 42, true)
    view.setUint16(central + 10, 99, true)
    view.setUint16(local + 8, 99, true)
    expectCode(() => preflightXlsx(bytes), 'unsupported-compression')
  })
})

describe('XLSX displayed-value parser boundary', () => {
  const template = createOfficialWorkbookTemplate('blank')

  it('runs preflight first, then preserves cached values and reports formulas', async () => {
    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'Steps',
          rows: [
            [
              { value: 'cached', formula: '1+1', cachedValuePresent: true },
              { value: null, formula: '2+2', cachedValuePresent: false }
            ]
          ]
        }
      ]
    }
    const adapter = { parseDisplayedValues: vi.fn(async () => workbook) }
    const result = await parseXlsxBoundary('book.xlsx', template, adapter)

    expect(adapter.parseDisplayedValues).toHaveBeenCalledOnce()
    expect(result.issues.map(({ code }) => code)).toEqual([
      'cached-formula-value',
      'formula-without-cache'
    ])
    expect(result.workbook.sheets[0]!.rows[0]![0]!.value).toBe('cached')
  })

  it('does not invoke the parser adapter for a malformed container', async () => {
    const adapter = { parseDisplayedValues: vi.fn() }
    await expect(
      parseXlsxBoundary('book.xlsx', new Uint8Array([1, 2, 3]), adapter)
    ).rejects.toMatchObject({ code: 'malformed-zip' })
    expect(adapter.parseDisplayedValues).not.toHaveBeenCalled()
  })

  it('ignores formatting properties supplied outside the adapter contract', () => {
    const cell = {
      value: 'displayed',
      rawValue: 'raw',
      style: { bold: true, color: 'red' }
    } as WorkbookCell
    const result = validateParsedWorkbookData({
      sheets: [{ name: 'Sheet1', rows: [[cell]] }]
    })
    expect(result.workbook.sheets[0]!.rows[0]![0]).toEqual({
      value: 'displayed',
      rawValue: 'raw'
    })
    expect(result.workbook.sheets[0]!.rows[0]![0]).not.toHaveProperty('style')
  })

  it('enforces worksheet, row, column, and cell length limits after parsing', () => {
    expectCode(
      () =>
        validateParsedWorkbookData({
          sheets: Array.from({ length: SPREADSHEET_LIMITS.worksheets + 1 }, (_, index) => ({
            name: `Sheet${index}`,
            rows: []
          }))
        }),
      'worksheet-limit'
    )
    expectCode(
      () =>
        validateParsedWorkbookData({
          sheets: [
            {
              name: 'Rows',
              rows: Array.from({ length: SPREADSHEET_LIMITS.inputRows + 1 }, () => [])
            }
          ]
        }),
      'row-limit'
    )
    expectCode(
      () =>
        validateParsedWorkbookData({
          sheets: [
            {
              name: 'Columns',
              rows: [
                Array.from({ length: SPREADSHEET_LIMITS.columns + 1 }, () => ({
                  value: null
                }))
              ]
            }
          ]
        }),
      'column-limit'
    )
    expectCode(
      () =>
        validateParsedWorkbookData({
          sheets: [
            {
              name: 'Cells',
              rows: [[{ value: 'x'.repeat(SPREADSHEET_LIMITS.cellCharacters + 1) }]]
            }
          ]
        }),
      'cell-length-limit'
    )
  })
})
