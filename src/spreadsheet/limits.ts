/**
 * Security and complexity limits from fix_plan §3.5.
 *
 * Keep these values in one dependency-free module so the UI, worker adapters,
 * preflight, model validator, and release tests all enforce the same boundary.
 */
export const SPREADSHEET_LIMITS = Object.freeze({
  compressedInputBytes: 20 * 1024 * 1024,
  declaredUncompressedBytes: 100 * 1024 * 1024,
  worksheets: 25,
  inputRows: 50_000,
  columns: 256,
  nonEmptyCells: 500_000,
  cellCharacters: 32_767,
  nodesPerProcess: 1_000,
  nodesPerTransaction: 5_000,
  diagramReadabilityWarningNodes: 250
} as const)

/** A defensive metadata-entry ceiling for a ZIP that can contain at most 25 sheets. */
export const XLSX_MAX_ZIP_ENTRIES = 10_000

/** Spreadsheet import never treats comma as a list delimiter by default. */
export const DEFAULT_LIST_DELIMITERS = Object.freeze(['\n', ';'] as const)

