/**
 * Hard limits for the ARIS-native Excel pipeline (aris_transformation.md §15.4).
 *
 * The numbers are duplicated here rather than imported so the ARIS lane owns a
 * self-describing contract, but `limits.test.ts` asserts parity with the shared
 * `SPREADSHEET_LIMITS`/`XLSX_MAX_ZIP_ENTRIES` used by the reused secure ZIP
 * preflight. Any drift between the two is a test failure, never a silent
 * weakening of the boundary.
 */
export const ARIS_EXCEL_LIMITS = Object.freeze({
  /** 20 MiB compressed input. */
  compressedInputBytes: 20 * 1024 * 1024,
  /** 100 MiB declared uncompressed across all ZIP entries. */
  declaredUncompressedBytes: 100 * 1024 * 1024,
  /** 10,000 ZIP entries. */
  zipEntries: 10_000,
  /** 25 worksheets. */
  sheets: 25,
  /** 50,000 rows across the workbook. */
  rows: 50_000,
  /** 256 columns per row. */
  columns: 256,
  /** 500,000 non-empty cells across the workbook. */
  nonEmptyCells: 500_000,
  /** 32,767 characters per cell. */
  cellCharacters: 32_767,
  /** 1,000 control-flow objects per model. */
  controlFlowObjectsPerModel: 1_000,
  /** 5,000 objects per import transaction. */
  objectsPerTransaction: 5_000,
  /** Warn (do not reject) above 250 control-flow objects in one model. */
  controlFlowObjectWarningThreshold: 250
} as const)

export type ArisExcelLimits = typeof ARIS_EXCEL_LIMITS
