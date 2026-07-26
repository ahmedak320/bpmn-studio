import type { CsvParserAdapter, ParsedWorkbookData, SpreadsheetParseOptions } from './contracts'
import { SpreadsheetError, throwIfAborted } from './errors'
import { validateSpreadsheetInput } from './fileFormat'
import { SPREADSHEET_LIMITS } from './limits'

export interface CsvParseOptions extends SpreadsheetParseOptions {
  readonly delimiter?: string
  readonly adapter?: CsvParserAdapter
}

function validateDelimiter(delimiter: string): void {
  if (
    delimiter.length !== 1 ||
    delimiter === '"' ||
    delimiter === '\r' ||
    delimiter === '\n' ||
    delimiter === '\u0000'
  ) {
    throw new SpreadsheetError('adapter-contract-violation', { contract: 'csv-delimiter' })
  }
}

export function decodeUtf8Csv(bytes: Uint8Array): string {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  } catch (cause) {
    throw new SpreadsheetError('invalid-utf8', {}, { cause })
  }
}

function limitCell(value: string, row: number, column: number): void {
  if (value.length > SPREADSHEET_LIMITS.cellCharacters) {
    throw new SpreadsheetError('cell-length-limit', {
      row,
      column,
      actual: value.length,
      limit: SPREADSHEET_LIMITS.cellCharacters
    })
  }
}

export function validateCsvRows(
  input: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  if (input.length > SPREADSHEET_LIMITS.inputRows) {
    throw new SpreadsheetError('row-limit', {
      actual: input.length,
      limit: SPREADSHEET_LIMITS.inputRows
    })
  }
  let nonEmptyCells = 0
  return input.map((sourceRow, rowIndex) => {
    if (sourceRow.length > SPREADSHEET_LIMITS.columns) {
      throw new SpreadsheetError('column-limit', {
        row: rowIndex + 1,
        actual: sourceRow.length,
        limit: SPREADSHEET_LIMITS.columns
      })
    }
    return Object.freeze(
      sourceRow.map((value, columnIndex) => {
        if (typeof value !== 'string') {
          throw new SpreadsheetError('adapter-contract-violation', {
            contract: 'csv-string-cell',
            row: rowIndex + 1,
            column: columnIndex + 1
          })
        }
        limitCell(value, rowIndex + 1, columnIndex + 1)
        if (value.length > 0) {
          nonEmptyCells += 1
          if (nonEmptyCells > SPREADSHEET_LIMITS.nonEmptyCells) {
            throw new SpreadsheetError('cell-count-limit', {
              actual: nonEmptyCells,
              limit: SPREADSHEET_LIMITS.nonEmptyCells
            })
          }
        }
        return value
      })
    )
  })
}

/**
 * Strict RFC-4180-style parser used by tests and as the no-dependency fallback.
 * It preserves line breaks inside quoted fields and never executes/formula-
 * interprets cell text.
 */
export function parseCsvText(
  text: string,
  options: Omit<CsvParseOptions, 'adapter'> = {}
): readonly (readonly string[])[] {
  const delimiter = options.delimiter ?? ','
  validateDelimiter(delimiter)
  throwIfAborted(options.signal)

  if (text.length === 0) return Object.freeze([])

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let afterClosingQuote = false
  let fieldStarted = false
  let nonEmptyCells = 0

  const finishField = (): void => {
    const rowNumber = rows.length + 1
    const columnNumber = row.length + 1
    limitCell(field, rowNumber, columnNumber)
    if (field.length > 0) {
      nonEmptyCells += 1
      if (nonEmptyCells > SPREADSHEET_LIMITS.nonEmptyCells) {
        throw new SpreadsheetError('cell-count-limit', {
          actual: nonEmptyCells,
          limit: SPREADSHEET_LIMITS.nonEmptyCells
        })
      }
    }
    row.push(field)
    if (row.length > SPREADSHEET_LIMITS.columns) {
      throw new SpreadsheetError('column-limit', {
        row: rowNumber,
        actual: row.length,
        limit: SPREADSHEET_LIMITS.columns
      })
    }
    field = ''
    afterClosingQuote = false
    fieldStarted = false
  }

  const finishRow = (): void => {
    finishField()
    rows.push(row)
    if (rows.length > SPREADSHEET_LIMITS.inputRows) {
      throw new SpreadsheetError('row-limit', {
        actual: rows.length,
        limit: SPREADSHEET_LIMITS.inputRows
      })
    }
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    if ((index & 0x3fff) === 0) {
      throwIfAborted(options.signal)
      options.onProgress?.({ phase: 'parse', completed: index, total: text.length })
    }
    const character = text[index]!

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
          afterClosingQuote = true
        }
      } else if (character === '\r') {
        field += '\n'
        if (text[index + 1] === '\n') index += 1
      } else {
        field += character
      }
      limitCell(field, rows.length + 1, row.length + 1)
      continue
    }

    if (afterClosingQuote) {
      if (character === delimiter) {
        finishField()
        continue
      }
      if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1
        finishRow()
        continue
      }
      throw new SpreadsheetError('malformed-csv', {
        row: rows.length + 1,
        column: row.length + 1,
        offset: index
      })
    }

    if (character === '"') {
      if (fieldStarted || field.length > 0) {
        throw new SpreadsheetError('malformed-csv', {
          row: rows.length + 1,
          column: row.length + 1,
          offset: index
        })
      }
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (character === delimiter) {
      finishField()
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      finishRow()
      continue
    }
    field += character
    fieldStarted = true
    limitCell(field, rows.length + 1, row.length + 1)
  }

  if (inQuotes) {
    throw new SpreadsheetError('malformed-csv', {
      row: rows.length + 1,
      column: row.length + 1,
      offset: text.length
    })
  }
  // A terminal record separator already finalized the final row. Otherwise,
  // retain even a final empty field (e.g. "a,").
  const endedWithRecordSeparator = text.endsWith('\n') || text.endsWith('\r')
  if (!endedWithRecordSeparator || row.length > 0 || field.length > 0 || afterClosingQuote) {
    finishRow()
  }
  options.onProgress?.({ phase: 'parse', completed: text.length, total: text.length })
  return Object.freeze(rows.map((entry) => Object.freeze(entry.slice())))
}

export async function parseCsvBoundary(
  fileName: string,
  bytes: Uint8Array,
  options: CsvParseOptions = {}
): Promise<readonly (readonly string[])[]> {
  const format = validateSpreadsheetInput(fileName, bytes.length)
  if (format !== 'csv') {
    throw new SpreadsheetError('unsupported-format', { expected: 'csv', actual: format })
  }
  const delimiter = options.delimiter ?? ','
  validateDelimiter(delimiter)
  throwIfAborted(options.signal)

  // Always perform a fatal UTF-8 decode before an injected adapter gets the
  // bytes, so worker implementations cannot silently accept a legacy encoding.
  const decoded = decodeUtf8Csv(bytes)
  if (!options.adapter) {
    return parseCsvText(decoded, options)
  }
  const normalizedBytes = new TextEncoder().encode(decoded)
  const rows = await options.adapter.parseUtf8(normalizedBytes, {
    delimiter,
    signal: options.signal,
    onProgress: options.onProgress
  })
  throwIfAborted(options.signal)
  return Object.freeze(validateCsvRows(rows))
}

/** Converts parser output to the common displayed-value workbook contract. */
export function csvRowsToWorkbookData(
  rows: readonly (readonly string[])[],
  worksheet = 'CSV'
): ParsedWorkbookData {
  const validated = validateCsvRows(rows)
  return Object.freeze({
    sheets: Object.freeze([
      Object.freeze({
        name: worksheet,
        rows: Object.freeze(
          validated.map((row) =>
            Object.freeze(row.map((value) => Object.freeze({ value, rawValue: value })))
          )
        )
      })
    ])
  })
}

export async function parseCsvWorkbookBoundary(
  fileName: string,
  bytes: Uint8Array,
  worksheet: string,
  options: CsvParseOptions = {}
): Promise<ParsedWorkbookData> {
  return csvRowsToWorkbookData(await parseCsvBoundary(fileName, bytes, options), worksheet)
}
