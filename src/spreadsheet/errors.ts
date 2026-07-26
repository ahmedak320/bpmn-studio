export type SpreadsheetErrorCode =
  | 'unsupported-format'
  | 'legacy-excel-format'
  | 'macro-enabled-format'
  | 'encrypted-workbook'
  | 'malformed-csv'
  | 'invalid-utf8'
  | 'malformed-zip'
  | 'zip64-unsupported'
  | 'multi-disk-zip'
  | 'unsupported-compression'
  | 'unsafe-zip-path'
  | 'duplicate-zip-entry'
  | 'macro-content'
  | 'missing-xlsx-part'
  | 'compressed-size-limit'
  | 'uncompressed-size-limit'
  | 'worksheet-limit'
  | 'row-limit'
  | 'column-limit'
  | 'cell-count-limit'
  | 'cell-length-limit'
  | 'node-process-limit'
  | 'node-transaction-limit'
  | 'formula-without-cache'
  | 'parse-cancelled'
  | 'adapter-contract-violation'
  | 'invalid-mapping-preset'
  | 'blocking-validation'
  | 'transaction-failed'

/**
 * Boundary errors carry stable localization keys and structured details.
 * No user-facing English is baked into the core.
 */
export class SpreadsheetError extends Error {
  readonly code: SpreadsheetErrorCode
  readonly messageKey: `spreadsheet.error.${SpreadsheetErrorCode}`
  readonly details: Readonly<Record<string, string | number | boolean>>

  constructor(
    code: SpreadsheetErrorCode,
    details: Record<string, string | number | boolean> = {},
    options?: ErrorOptions
  ) {
    super(`spreadsheet.error.${code}`, options)
    this.name = 'SpreadsheetError'
    this.code = code
    this.messageKey = `spreadsheet.error.${code}`
    this.details = Object.freeze({ ...details })
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SpreadsheetError('parse-cancelled')
  }
}
