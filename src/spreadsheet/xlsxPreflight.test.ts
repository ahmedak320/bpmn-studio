import { describe, expect, it, vi } from 'vitest'
import type { ParsedWorkbookData, WorkbookCell } from './contracts'
import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'
import { createOfficialWorkbookTemplate } from './template'
import {
  parseXlsxBoundary,
  validateParsedWorkbookData
} from './workbookBoundary'
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
        preflightXlsx(
          new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
        ),
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

  it('rejects declared decompression bombs before reading a local payload', () => {
    const bytes = clone(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = firstCentral(bytes)
    view.setUint32(
      central + 24,
      SPREADSHEET_LIMITS.declaredUncompressedBytes + 1,
      true
    )
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

