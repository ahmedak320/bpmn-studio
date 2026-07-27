import type {
  ParsedWorkbookData,
  ParseProgress,
  SpreadsheetParseOptions,
  SpreadsheetValidationIssue,
  WorkbookCell,
  WorkbookSheetData
} from './contracts'
import { cellAddress } from './cellAddress'
import { SpreadsheetError, throwIfAborted } from './errors'
import { spreadsheetValidationMessageKey } from './issueCatalog'
import { SPREADSHEET_LIMITS } from './limits'

/**
 * The largest amount of row/cell work accepted between event-loop yields.
 *
 * Keeping the ceiling here (instead of trusting an arbitrarily large caller
 * value) makes responsiveness a property of this boundary. A caller can use a
 * smaller value for especially latency-sensitive work.
 */
export const MAX_COOPERATIVE_VALIDATION_CHUNK_SIZE = 4_096
export const DEFAULT_COOPERATIVE_VALIDATION_CHUNK_SIZE = 512

export interface CooperativeValidationOptions extends SpreadsheetParseOptions {
  /**
   * A work unit is either one row boundary or one cell. Values are clamped so
   * a caller cannot accidentally disable cooperative cancellation.
   */
  readonly chunkSize?: number
  /**
   * Test/integration seam. The default yields to a new task, allowing browser
   * input, painting, timers, and AbortSignal listeners to run.
   */
  readonly yieldControl?: () => Promise<void>
}

export interface ParsedWorkbookValidationResult {
  readonly workbook: ParsedWorkbookData
  readonly issues: readonly SpreadsheetValidationIssue[]
}

function displayedCellLength(cell: WorkbookCell): number {
  if (cell.value === null) return 0
  if (cell.value instanceof Date) return cell.value.toISOString().length
  return String(cell.value).length
}

function normalizedChunkSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_COOPERATIVE_VALIDATION_CHUNK_SIZE
  }
  return Math.min(MAX_COOPERATIVE_VALIDATION_CHUNK_SIZE, Math.max(1, Math.floor(value)))
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

function rowProgress(completedRows: number, columnIndex: number, columnCount: number): number {
  if (columnCount === 0) return completedRows
  return completedRows + (columnIndex + 1) / columnCount
}

function copyValidatedCell(
  cell: WorkbookCell,
  worksheet: string,
  rowIndex: number,
  columnIndex: number,
  state: {
    nonEmptyCells: number
    readonly issues: SpreadsheetValidationIssue[]
  }
): Readonly<WorkbookCell> {
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
      worksheet,
      row: rowIndex + 1,
      column: columnIndex + 1
    })
  }

  const length = displayedCellLength(cell)
  if (length > SPREADSHEET_LIMITS.cellCharacters) {
    throw new SpreadsheetError('cell-length-limit', {
      worksheet,
      address: cellAddress(rowIndex + 1, columnIndex + 1),
      actual: length,
      limit: SPREADSHEET_LIMITS.cellCharacters
    })
  }

  if (cell.value !== null && String(cell.value).length > 0) {
    state.nonEmptyCells += 1
    if (state.nonEmptyCells > SPREADSHEET_LIMITS.nonEmptyCells) {
      throw new SpreadsheetError('cell-count-limit', {
        actual: state.nonEmptyCells,
        limit: SPREADSHEET_LIMITS.nonEmptyCells
      })
    }
  }

  if (cell.formula !== undefined) {
    const address = cellAddress(rowIndex + 1, columnIndex + 1)
    if (cell.cachedValuePresent !== true || cell.value === null) {
      state.issues.push({
        code: 'formula-without-cache',
        severity: 'error',
        messageKey: spreadsheetValidationMessageKey('formula-without-cache'),
        guidanceKey: 'spreadsheet.guidance.replace-formula-with-value',
        worksheet,
        cellAddress: address,
        rawValue: cell.rawValue
      })
    } else {
      state.issues.push({
        code: 'cached-formula-value',
        severity: 'warning',
        messageKey: spreadsheetValidationMessageKey('cached-formula-value'),
        guidanceKey: 'spreadsheet.guidance.verify-cached-formula-value',
        worksheet,
        cellAddress: address,
        rawValue: cell.rawValue,
        normalizedValue: cell.value
      })
    }
  }

  // Copy only the adapter contract. Formatting is deliberately non-semantic.
  return Object.freeze({
    value: cell.value,
    ...(cell.rawValue !== undefined ? { rawValue: cell.rawValue } : {}),
    ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
    ...(cell.cachedValuePresent !== undefined
      ? { cachedValuePresent: cell.cachedValuePresent }
      : {})
  })
}

/**
 * Validate and sanitize parsed workbook data without monopolizing the UI
 * thread. For non-aborted input, validation order, errors, issues, and returned
 * data match `validateParsedWorkbookData`.
 *
 * Validation progress is expressed in rows. Fractional completion means the
 * current row is being processed, which keeps progress measurable even for a
 * single large worksheet.
 */
export async function validateParsedWorkbookDataCooperatively(
  workbook: ParsedWorkbookData,
  options: CooperativeValidationOptions = {}
): Promise<ParsedWorkbookValidationResult> {
  if (workbook.sheets.length > SPREADSHEET_LIMITS.worksheets) {
    throw new SpreadsheetError('worksheet-limit', {
      actual: workbook.sheets.length,
      limit: SPREADSHEET_LIMITS.worksheets
    })
  }

  throwIfAborted(options.signal)

  const totalProgressRows = workbook.sheets.reduce((total, sheet) => total + sheet.rows.length, 0)
  const issues: SpreadsheetValidationIssue[] = []
  const sheets: WorkbookSheetData[] = []
  const state = { nonEmptyCells: 0, issues }
  const chunkSize = normalizedChunkSize(options.chunkSize)
  const yieldControl = options.yieldControl ?? defaultYieldControl
  let workRemaining = chunkSize
  let validatedRows = 0
  let totalRows = 0

  const emitProgress = (completed: number): void => {
    const progress: ParseProgress = {
      phase: 'validate',
      completed,
      total: totalProgressRows
    }
    options.onProgress?.(progress)
  }

  const checkpoint = async (completed: number): Promise<void> => {
    throwIfAborted(options.signal)
    emitProgress(completed)
    throwIfAborted(options.signal)
    await yieldControl()
    throwIfAborted(options.signal)
    workRemaining = chunkSize
  }

  emitProgress(0)
  throwIfAborted(options.signal)

  for (const sheet of workbook.sheets) {
    throwIfAborted(options.signal)
    totalRows += sheet.rows.length
    if (totalRows > SPREADSHEET_LIMITS.inputRows) {
      throw new SpreadsheetError('row-limit', {
        actual: totalRows,
        limit: SPREADSHEET_LIMITS.inputRows
      })
    }

    const rows: Readonly<WorkbookCell[]>[] = []
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex]!
      if (row.length > SPREADSHEET_LIMITS.columns) {
        throw new SpreadsheetError('column-limit', {
          worksheet: sheet.name,
          row: rowIndex + 1,
          actual: row.length,
          limit: SPREADSHEET_LIMITS.columns
        })
      }

      workRemaining -= 1
      if (workRemaining === 0) {
        await checkpoint(validatedRows)
      }

      const copiedRow: Readonly<WorkbookCell>[] = []
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        copiedRow.push(
          copyValidatedCell(row[columnIndex]!, sheet.name, rowIndex, columnIndex, state)
        )
        workRemaining -= 1
        if (workRemaining === 0) {
          await checkpoint(rowProgress(validatedRows, columnIndex, row.length))
        }
      }

      rows.push(Object.freeze(copiedRow))
      validatedRows += 1
    }

    sheets.push(Object.freeze({ name: sheet.name, rows: Object.freeze(rows) }))
    emitProgress(validatedRows)
    throwIfAborted(options.signal)
  }

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
