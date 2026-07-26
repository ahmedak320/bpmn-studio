import { describe, expect, it, vi } from 'vitest'
import {
  csvRowsToWorkbookData,
  parseCsvBoundary,
  parseCsvText,
  parseCsvWorkbookBoundary,
  validateCsvRows
} from './csv'
import { SpreadsheetError } from './errors'
import { validateSpreadsheetInput } from './fileFormat'
import { SPREADSHEET_LIMITS } from './limits'

const encoder = new TextEncoder()

function expectCode(action: () => unknown, code: SpreadsheetError['code']): void {
  try {
    action()
    throw new Error('Expected SpreadsheetError')
  } catch (error) {
    expect(error).toBeInstanceOf(SpreadsheetError)
    expect((error as SpreadsheetError).code).toBe(code)
  }
}

describe('CSV boundary', () => {
  it('parses a UTF-8 BOM, Arabic Unicode, escaped quotes, and quoted multiline fields', async () => {
    const text =
      '\ufeffprocess_id,name_en,name_ar,notes\n' +
      'leave,"Approve, request","الموافقة على الطلب","Line one\r\nLine ""two"""\r\n'
    const rows = await parseCsvBoundary('processes.CSV', encoder.encode(text))

    expect(rows).toEqual([
      ['process_id', 'name_en', 'name_ar', 'notes'],
      ['leave', 'Approve, request', 'الموافقة على الطلب', 'Line one\nLine "two"']
    ])
  })

  it('retains empty fields and does not add a phantom row for a terminal newline', () => {
    expect(parseCsvText('a,b,\n1,,3\n')).toEqual([
      ['a', 'b', ''],
      ['1', '', '3']
    ])
    expect(parseCsvText(',')).toEqual([['', '']])
  })

  it('rejects malformed quoting instead of repairing workbook data silently', () => {
    expectCode(() => parseCsvText('"unterminated'), 'malformed-csv')
    expectCode(() => parseCsvText('"closed"junk'), 'malformed-csv')
    expectCode(() => parseCsvText('un"quoted'), 'malformed-csv')
  })

  it('rejects invalid UTF-8 before an injected worker adapter runs', async () => {
    const adapter = { parseUtf8: vi.fn() }
    await expect(
      parseCsvBoundary('bad.csv', new Uint8Array([0xc3, 0x28]), { adapter })
    ).rejects.toMatchObject({ code: 'invalid-utf8' })
    expect(adapter.parseUtf8).not.toHaveBeenCalled()
  })

  it('normalizes away the BOM before invoking a Papa-worker seam and validates its result', async () => {
    const adapter = {
      parseUtf8: vi.fn(async (bytes: Uint8Array) => {
        expect(new TextDecoder().decode(bytes)).toBe('a,b')
        return [['a', 'b']] as const
      })
    }
    await expect(
      parseCsvBoundary('data.csv', encoder.encode('\ufeffa,b'), { adapter })
    ).resolves.toEqual([['a', 'b']])
    expect(adapter.parseUtf8).toHaveBeenCalledOnce()

    const invalidAdapter = {
      parseUtf8: vi.fn(async () => [[42 as unknown as string]])
    }
    await expect(
      parseCsvBoundary('data.csv', encoder.encode('a'), { adapter: invalidAdapter })
    ).rejects.toMatchObject({ code: 'adapter-contract-violation' })
  })

  it('bridges CSV rows into the common displayed-value workbook model', async () => {
    const workbook = await parseCsvWorkbookBoundary(
      'data.csv',
      encoder.encode('id,name\n1,One'),
      'Activities'
    )
    expect(workbook).toEqual(
      csvRowsToWorkbookData(
        [
          ['id', 'name'],
          ['1', 'One']
        ],
        'Activities'
      )
    )
    expect(workbook.sheets[0]!.rows[1]![1]).toEqual({
      value: 'One',
      rawValue: 'One'
    })
  })

  it('supports cancellation and cancelable progress', () => {
    const controller = new AbortController()
    const onProgress = vi.fn(() => controller.abort())
    expectCode(
      () =>
        parseCsvText(`header\n${'value\n'.repeat(5_000)}`, {
          signal: controller.signal,
          onProgress
        }),
      'parse-cancelled'
    )
    expect(onProgress).toHaveBeenCalled()
  })

  it('enforces row, column, cell-length, and non-empty-cell boundaries', () => {
    expectCode(
      () => parseCsvText('x'.repeat(SPREADSHEET_LIMITS.cellCharacters + 1)),
      'cell-length-limit'
    )
    expectCode(
      () => parseCsvText(Array(SPREADSHEET_LIMITS.columns + 1).fill('x').join(',')),
      'column-limit'
    )
    expectCode(
      () =>
        validateCsvRows(
          Array.from({ length: SPREADSHEET_LIMITS.inputRows + 1 }, () => [''])
        ),
      'row-limit'
    )
    const wideRows = Array.from(
      { length: SPREADSHEET_LIMITS.inputRows },
      () => Array(10).fill('x') as string[]
    )
    wideRows[0]!.push('x')
    expectCode(() => validateCsvRows(wideRows), 'cell-count-limit')
  })

  it('accepts only macro-free XLSX and UTF-8 CSV extensions with the exact 20 MB cap', () => {
    expect(validateSpreadsheetInput('book.xlsx', 1)).toBe('xlsx')
    expect(validateSpreadsheetInput('book.CSV', 1)).toBe('csv')
    expect(validateSpreadsheetInput('book.xlsx', SPREADSHEET_LIMITS.compressedInputBytes)).toBe(
      'xlsx'
    )
    expectCode(() => validateSpreadsheetInput('book.xls', 1), 'legacy-excel-format')
    for (const extension of ['xlsm', 'xlsb', 'xlam']) {
      expectCode(
        () => validateSpreadsheetInput(`book.${extension}`, 1),
        'macro-enabled-format'
      )
    }
    expectCode(() => validateSpreadsheetInput('book.ods', 1), 'unsupported-format')
    expectCode(
      () =>
        validateSpreadsheetInput(
          'book.csv',
          SPREADSHEET_LIMITS.compressedInputBytes + 1
        ),
      'compressed-size-limit'
    )
  })
})
