import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'

export type SpreadsheetInputFormat = 'xlsx' | 'csv'

const LEGACY_EXTENSIONS = new Set(['xls'])
const MACRO_EXTENSIONS = new Set(['xlsm', 'xlsb', 'xla', 'xlam'])

export function validateSpreadsheetInput(
  fileName: string,
  byteLength: number
): SpreadsheetInputFormat {
  if (byteLength > SPREADSHEET_LIMITS.compressedInputBytes) {
    throw new SpreadsheetError('compressed-size-limit', {
      actual: byteLength,
      limit: SPREADSHEET_LIMITS.compressedInputBytes
    })
  }
  const match = /\.([^.]+)$/.exec(fileName.trim())
  const extension = match?.[1]?.toLocaleLowerCase('en-US') ?? ''
  if (extension === 'xlsx' || extension === 'csv') return extension
  if (LEGACY_EXTENSIONS.has(extension)) {
    throw new SpreadsheetError('legacy-excel-format', { extension })
  }
  if (MACRO_EXTENSIONS.has(extension)) {
    throw new SpreadsheetError('macro-enabled-format', { extension })
  }
  throw new SpreadsheetError('unsupported-format', { extension })
}
