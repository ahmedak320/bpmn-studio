import { CANONICAL_FIELDS_BY_SHEET, REQUIRED_FIELDS_BY_SHEET, normalizeHeader } from './aliases'
import type {
  CanonicalSheet,
  ParsedWorkbookData,
  SheetSelection,
  SpreadsheetValidationIssue
} from './contracts'
import { OFFICIAL_TEMPLATE_VERSION } from './contracts'
import { headerSignature } from './mapping'

export const OFFICIAL_SHEET_NAMES = Object.freeze({
  processes: 'Processes',
  participants: 'Participants',
  steps: 'Steps',
  flows: 'Flows',
  glossary: 'Glossary'
} satisfies Readonly<Record<CanonicalSheet, string>>)

export interface OfficialTemplateDetection {
  readonly official: boolean
  readonly templateVersion?: string
  readonly confidence: number
  readonly selectedSheets: Readonly<Partial<Record<CanonicalSheet, SheetSelection>>>
  readonly headerSignatures: Readonly<Partial<Record<CanonicalSheet, string>>>
  readonly issues: readonly SpreadsheetValidationIssue[]
}

function cellText(value: unknown): string {
  if (
    value !== null &&
    typeof value === 'object' &&
    'value' in value &&
    (value as { value: unknown }).value !== null
  ) {
    return String((value as { value: unknown }).value)
  }
  return ''
}

function findHeaderRow(
  rows: ParsedWorkbookData['sheets'][number]['rows'],
  fields: readonly string[]
): { row: number; headers: string[] } | undefined {
  const expected = new Set(fields.map(normalizeHeader))
  const maximum = Math.min(rows.length, 20)
  for (let index = 0; index < maximum; index += 1) {
    const headers = rows[index]!.map(cellText)
    const present = new Set(headers.map(normalizeHeader))
    if ([...expected].every((field) => present.has(field))) {
      return { row: index + 1, headers }
    }
  }
  return undefined
}

export function detectOfficialTemplate(workbook: ParsedWorkbookData): OfficialTemplateDetection {
  const issues: SpreadsheetValidationIssue[] = []
  const selectedSheets: Partial<Record<CanonicalSheet, SheetSelection>> = {}
  const headerSignatures: Partial<Record<CanonicalSheet, string>> = {}
  let matchedSheets = 0

  for (const sheetRole of Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]) {
    const name = OFFICIAL_SHEET_NAMES[sheetRole]
    const sheet = workbook.sheets.find((candidate) => candidate.name === name)
    if (!sheet) {
      issues.push({
        code: 'official-template-sheet-missing',
        severity: 'warning',
        messageKey: 'spreadsheet.validation.official-template-sheet-missing',
        details: { sheet: name }
      })
      continue
    }
    const header = findHeaderRow(sheet.rows, CANONICAL_FIELDS_BY_SHEET[sheetRole])
    if (!header) {
      const requiredHeader = findHeaderRow(sheet.rows, REQUIRED_FIELDS_BY_SHEET[sheetRole])
      issues.push({
        code: 'official-template-header-mismatch',
        severity: 'warning',
        messageKey: 'spreadsheet.validation.official-template-header-mismatch',
        worksheet: name,
        details: {
          requiredFieldsFound: Boolean(requiredHeader),
          expectedColumns: CANONICAL_FIELDS_BY_SHEET[sheetRole].length
        }
      })
      continue
    }
    matchedSheets += 1
    selectedSheets[sheetRole] = Object.freeze({ worksheet: name, headerRow: header.row })
    headerSignatures[sheetRole] = headerSignature(header.headers)
  }

  const declaredVersion = workbook.customProperties?.OrbitPMTemplateVersion
  const structuralMatch = matchedSheets === Object.keys(OFFICIAL_SHEET_NAMES).length
  const versionMatches =
    declaredVersion === undefined || declaredVersion === OFFICIAL_TEMPLATE_VERSION
  if (declaredVersion !== undefined && !versionMatches) {
    issues.push({
      code: 'official-template-version-unsupported',
      severity: 'warning',
      messageKey: 'spreadsheet.validation.official-template-version-unsupported',
      rawValue: declaredVersion,
      normalizedValue: OFFICIAL_TEMPLATE_VERSION
    })
  }

  return Object.freeze({
    official: structuralMatch && versionMatches,
    ...(declaredVersion ? { templateVersion: declaredVersion } : {}),
    confidence: structuralMatch
      ? declaredVersion === OFFICIAL_TEMPLATE_VERSION
        ? 1
        : 0.95
      : matchedSheets / 5,
    selectedSheets: Object.freeze(selectedSheets),
    headerSignatures: Object.freeze(headerSignatures),
    issues: Object.freeze(issues)
  })
}
