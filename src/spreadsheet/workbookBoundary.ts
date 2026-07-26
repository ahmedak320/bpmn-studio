import type {
  ParsedWorkbookData,
  SpreadsheetParseOptions,
  SpreadsheetValidationIssue,
  WorkbookCell,
  WorkbookSheetData,
  XlsxParserAdapter
} from './contracts'
import { cellAddress } from './cellAddress'
import { SpreadsheetError, throwIfAborted } from './errors'
import { validateSpreadsheetInput } from './fileFormat'
import { SPREADSHEET_LIMITS } from './limits'
import { preflightXlsx, type XlsxPreflightResult } from './xlsxPreflight'

export interface WorkbookBoundaryResult {
  readonly workbook: ParsedWorkbookData
  readonly preflight: XlsxPreflightResult
  readonly issues: readonly SpreadsheetValidationIssue[]
}

function displayedCellLength(cell: WorkbookCell): number {
  if (cell.value === null) return 0
  if (cell.value instanceof Date) return cell.value.toISOString().length
  return String(cell.value).length
}

export function validateParsedWorkbookData(
  workbook: ParsedWorkbookData,
  options: SpreadsheetParseOptions = {}
): {
  readonly workbook: ParsedWorkbookData
  readonly issues: readonly SpreadsheetValidationIssue[]
} {
  if (workbook.sheets.length > SPREADSHEET_LIMITS.worksheets) {
    throw new SpreadsheetError('worksheet-limit', {
      actual: workbook.sheets.length,
      limit: SPREADSHEET_LIMITS.worksheets
    })
  }
  const issues: SpreadsheetValidationIssue[] = []
  let totalRows = 0
  let nonEmptyCells = 0

  const sheets: WorkbookSheetData[] = workbook.sheets.map((sheet, sheetIndex) => {
    throwIfAborted(options.signal)
    totalRows += sheet.rows.length
    if (totalRows > SPREADSHEET_LIMITS.inputRows) {
      throw new SpreadsheetError('row-limit', {
        actual: totalRows,
        limit: SPREADSHEET_LIMITS.inputRows
      })
    }
    const rows = sheet.rows.map((row, rowIndex) => {
      if (row.length > SPREADSHEET_LIMITS.columns) {
        throw new SpreadsheetError('column-limit', {
          worksheet: sheet.name,
          row: rowIndex + 1,
          actual: row.length,
          limit: SPREADSHEET_LIMITS.columns
        })
      }
      return Object.freeze(
        row.map((cell, columnIndex) => {
          if (
            !cell ||
            typeof cell !== 'object' ||
            !('value' in cell) ||
            (cell.value !== null &&
              typeof cell.value !== 'string' &&
              typeof cell.value !== 'number' &&
              typeof cell.value !== 'boolean' &&
              !(cell.value instanceof Date))
          ) {
            throw new SpreadsheetError('adapter-contract-violation', {
              contract: 'xlsx-displayed-cell',
              worksheet: sheet.name,
              row: rowIndex + 1,
              column: columnIndex + 1
            })
          }
          const length = displayedCellLength(cell)
          if (length > SPREADSHEET_LIMITS.cellCharacters) {
            throw new SpreadsheetError('cell-length-limit', {
              worksheet: sheet.name,
              address: cellAddress(rowIndex + 1, columnIndex + 1),
              actual: length,
              limit: SPREADSHEET_LIMITS.cellCharacters
            })
          }
          if (cell.value !== null && String(cell.value).length > 0) {
            nonEmptyCells += 1
            if (nonEmptyCells > SPREADSHEET_LIMITS.nonEmptyCells) {
              throw new SpreadsheetError('cell-count-limit', {
                actual: nonEmptyCells,
                limit: SPREADSHEET_LIMITS.nonEmptyCells
              })
            }
          }
          if (cell.formula !== undefined) {
            const address = cellAddress(rowIndex + 1, columnIndex + 1)
            if (cell.cachedValuePresent !== true || cell.value === null) {
              issues.push({
                code: 'formula-without-cache',
                severity: 'error',
                messageKey: 'spreadsheet.validation.formula-without-cache',
                guidanceKey: 'spreadsheet.guidance.replace-formula-with-value',
                worksheet: sheet.name,
                cellAddress: address,
                rawValue: cell.rawValue
              })
            } else {
              issues.push({
                code: 'cached-formula-value',
                severity: 'warning',
                messageKey: 'spreadsheet.validation.cached-formula-value',
                guidanceKey: 'spreadsheet.guidance.verify-cached-formula-value',
                worksheet: sheet.name,
                cellAddress: address,
                rawValue: cell.rawValue,
                normalizedValue: cell.value
              })
            }
          }
          // Copy only the contract fields. Formatting supplied by a worker is
          // intentionally not preserved or interpreted as semantics.
          return Object.freeze({
            value: cell.value,
            ...(cell.rawValue !== undefined ? { rawValue: cell.rawValue } : {}),
            ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
            ...(cell.cachedValuePresent !== undefined
              ? { cachedValuePresent: cell.cachedValuePresent }
              : {})
          })
        })
      )
    })
    options.onProgress?.({
      phase: 'validate',
      completed: sheetIndex + 1,
      total: workbook.sheets.length
    })
    return Object.freeze({ name: sheet.name, rows: Object.freeze(rows) })
  })

  return Object.freeze({
    workbook: Object.freeze({
      sheets: Object.freeze(sheets),
      ...(workbook.customProperties
        ? { customProperties: Object.freeze({ ...workbook.customProperties }) }
        : {})
    }),
    issues: Object.freeze(issues)
  })
}

export async function parseXlsxBoundary(
  fileName: string,
  bytes: Uint8Array,
  adapter: XlsxParserAdapter,
  options: SpreadsheetParseOptions = {}
): Promise<WorkbookBoundaryResult> {
  const format = validateSpreadsheetInput(fileName, bytes.length)
  if (format !== 'xlsx') {
    throw new SpreadsheetError('unsupported-format', { expected: 'xlsx', actual: format })
  }
  throwIfAborted(options.signal)
  options.onProgress?.({ phase: 'preflight', completed: 0, total: bytes.length })
  const preflight = preflightXlsx(bytes)
  options.onProgress?.({ phase: 'preflight', completed: bytes.length, total: bytes.length })
  throwIfAborted(options.signal)
  const parsed = await adapter.parseDisplayedValues(bytes, options)
  throwIfAborted(options.signal)
  const validated = validateParsedWorkbookData(parsed, options)
  return Object.freeze({
    workbook: validated.workbook,
    preflight,
    issues: Object.freeze([
      ...preflight.warnings.map<SpreadsheetValidationIssue>((warning) => ({
        code: warning.code,
        severity: 'warning',
        messageKey: `spreadsheet.validation.${warning.code}`,
        details: { entries: warning.entries.join(',') }
      })),
      ...validated.issues
    ])
  })
}

