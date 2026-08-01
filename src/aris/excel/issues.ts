/**
 * Structured, localizable issue reporting for the ARIS Excel pipeline.
 *
 * Every rejection path in this module produces an `ArisExcelIssue`. No English
 * user-facing copy is produced here: an issue carries a stable `messageKey`
 * (and optional `guidanceKey`) that the UI resolves through `src/i18n`, exactly
 * like `SpreadsheetError.messageKey` does for the BPMN pipeline.
 */

export const ARIS_EXCEL_ISSUE_CODES = Object.freeze([
  // --- Input / container -------------------------------------------------
  'unsupported-file-extension',
  'unsupported-mime-type',
  'compressed-size-limit',
  'uncompressed-size-limit',
  'zip-entry-limit',
  'sheet-limit',
  'malformed-zip',
  'zip64-unsupported',
  'multi-disk-zip',
  'unsupported-compression',
  'unsafe-zip-path',
  'duplicate-zip-entry',
  'encrypted-workbook',
  'macro-content',
  'executable-content',
  'missing-xlsx-part',
  'expanded-size-mismatch',
  'external-links-ignored',
  'data-connections-ignored',
  // --- Template identity -------------------------------------------------
  'template-version-missing',
  'template-version-unsupported',
  'legacy-bpmn-workbook',
  // --- Structure ---------------------------------------------------------
  'sheet-missing',
  'sheet-unknown',
  'column-missing',
  'column-unknown',
  'header-row-missing',
  'row-limit',
  'column-limit',
  'cell-count-limit',
  'cell-length-limit',
  // --- Formulas ----------------------------------------------------------
  'formula-without-cached-value',
  'cached-formula-value',
  // --- Values ------------------------------------------------------------
  'value-required',
  'value-not-a-number',
  'value-not-an-integer',
  'value-not-a-boolean',
  'value-not-allowed',
  'unknown-object-type',
  'unknown-symbol-type',
  'symbol-type-inferred',
  'invalid-symbol-type',
  'invalid-connection-type',
  'invalid-attribute-type',
  'invalid-color',
  'invalid-route-points',
  // --- Identity and references -------------------------------------------
  'duplicate-id',
  'missing-reference',
  'reference-normalized',
  'object-definition-conflict',
  'connection-endpoint-cycle',
  // --- Model limits ------------------------------------------------------
  'control-flow-object-limit',
  'control-flow-object-warning',
  'object-transaction-limit',
  'connections-auto-chained',
  // --- Whole-workbook ----------------------------------------------------
  'empty-workbook',
  'internal-error'
] as const)

export type ArisExcelIssueCode = (typeof ARIS_EXCEL_ISSUE_CODES)[number]

export type ArisExcelIssueSeverity = 'error' | 'warning' | 'info'

export type ArisExcelIssueMessageKey = `aris.excel.issue.${ArisExcelIssueCode}`
export type ArisExcelGuidanceKey = `aris.excel.guidance.${ArisExcelIssueCode}`

export interface ArisExcelIssue {
  readonly code: ArisExcelIssueCode
  readonly severity: ArisExcelIssueSeverity
  /** i18n key; never a rendered English string. */
  readonly messageKey: ArisExcelIssueMessageKey
  /** Optional i18n key for a "how to fix it" hint. */
  readonly guidanceKey?: ArisExcelGuidanceKey
  /** Worksheet name the issue was found on, when it is sheet-scoped. */
  readonly sheet?: string
  /** A1-style cell address, when the issue is cell-scoped. */
  readonly cell?: string
  readonly row?: number
  readonly column?: string
  /** The offending value exactly as it appeared in the workbook. */
  readonly value?: string
  /** Structured, already-localizable interpolation data. */
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

export function arisExcelIssueMessageKey(code: ArisExcelIssueCode): ArisExcelIssueMessageKey {
  return `aris.excel.issue.${code}`
}

export function arisExcelGuidanceKey(code: ArisExcelIssueCode): ArisExcelGuidanceKey {
  return `aris.excel.guidance.${code}`
}

/** Issue codes that also carry actionable remediation guidance. */
const GUIDED_CODES: ReadonlySet<ArisExcelIssueCode> = new Set([
  'legacy-bpmn-workbook',
  'template-version-missing',
  'template-version-unsupported',
  'formula-without-cached-value',
  'cached-formula-value',
  'value-required',
  'missing-reference',
  'duplicate-id',
  'unknown-object-type',
  'unknown-symbol-type',
  'symbol-type-inferred',
  'reference-normalized',
  'connections-auto-chained',
  'invalid-route-points',
  'control-flow-object-limit',
  'control-flow-object-warning',
  'object-transaction-limit'
])

export interface ArisExcelIssueInit {
  readonly sheet?: string
  readonly cell?: string
  readonly row?: number
  readonly column?: string
  readonly value?: string
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

export function createArisExcelIssue(
  code: ArisExcelIssueCode,
  severity: ArisExcelIssueSeverity,
  init: ArisExcelIssueInit = {}
): ArisExcelIssue {
  return Object.freeze({
    code,
    severity,
    messageKey: arisExcelIssueMessageKey(code),
    ...(GUIDED_CODES.has(code) ? { guidanceKey: arisExcelGuidanceKey(code) } : {}),
    ...(init.sheet !== undefined ? { sheet: init.sheet } : {}),
    ...(init.cell !== undefined ? { cell: init.cell } : {}),
    ...(init.row !== undefined ? { row: init.row } : {}),
    ...(init.column !== undefined ? { column: init.column } : {}),
    ...(init.value !== undefined ? { value: init.value } : {}),
    ...(init.details !== undefined ? { details: Object.freeze({ ...init.details }) } : {})
  })
}

/**
 * Every message/guidance key this module can emit. The UI lane registers these
 * in `src/i18n/dictionaries.ts`; this list is the authoritative source so the
 * dictionary can never silently drift from the emitted keys.
 */
export const ARIS_EXCEL_MESSAGE_KEYS: readonly string[] = Object.freeze([
  ...ARIS_EXCEL_ISSUE_CODES.map(arisExcelIssueMessageKey),
  ...ARIS_EXCEL_ISSUE_CODES.filter((code) => GUIDED_CODES.has(code)).map(arisExcelGuidanceKey)
])

/**
 * Internal control-flow carrier for a rejection. It never escapes the module
 * boundary as a thrown value: `parseArisWorkbook` converts it into the returned
 * issue list, so callers never see a raw thrown string or an English message.
 */
export class ArisExcelIssueError extends Error {
  readonly issue: ArisExcelIssue

  constructor(issue: ArisExcelIssue, options?: ErrorOptions) {
    super(issue.messageKey, options)
    this.name = 'ArisExcelIssueError'
    this.issue = issue
  }
}

export function throwArisExcelIssue(
  code: ArisExcelIssueCode,
  init: ArisExcelIssueInit = {},
  options?: ErrorOptions
): never {
  throw new ArisExcelIssueError(createArisExcelIssue(code, 'error', init), options)
}

export function hasBlockingIssue(issues: readonly ArisExcelIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

export function countIssues(issues: readonly ArisExcelIssue[]): {
  readonly errors: number
  readonly warnings: number
  readonly infos: number
} {
  let errors = 0
  let warnings = 0
  let infos = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else if (issue.severity === 'warning') warnings += 1
    else infos += 1
  }
  return Object.freeze({ errors, warnings, infos })
}
