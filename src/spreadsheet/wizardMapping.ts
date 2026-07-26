import { CANONICAL_FIELDS_BY_SHEET, REQUIRED_FIELDS_BY_SHEET, normalizeHeader } from './aliases'
import {
  MAPPING_PRESET_VERSION,
  type CanonicalSheet,
  type MappingPreset,
  type ParsedWorkbookData,
  type SheetSelection,
  type SpreadsheetLocale,
  type SpreadsheetValidationIssue
} from './contracts'
import { DEFAULT_LIST_DELIMITERS } from './limits'
import {
  LOW_CONFIDENCE_REQUIRED_THRESHOLD,
  headerSignature,
  suggestHeaderMappings
} from './mapping'

export const WIZARD_SHEET_ROLES: readonly CanonicalSheet[] = Object.freeze([
  'processes',
  'participants',
  'steps',
  'flows',
  'glossary'
])

function displayed(value: ParsedWorkbookData['sheets'][number]['rows'][number][number]): string {
  if (value.value === null) return ''
  if (value.value instanceof Date) return value.value.toISOString()
  return String(value.value).trim()
}

export function headersForSelection(
  workbook: ParsedWorkbookData,
  selection: SheetSelection | undefined
): readonly string[] {
  if (!selection) return Object.freeze([])
  const row = workbook.sheets.find(({ name }) => name === selection.worksheet)?.rows[
    selection.headerRow - 1
  ]
  return Object.freeze((row ?? []).map(displayed))
}

interface Candidate {
  readonly selection: SheetSelection
  readonly headers: readonly string[]
  readonly requiredFound: number
  readonly requiredTotal: number
  readonly anchorFound: number
  readonly sheetNameMatches: boolean
  readonly averageConfidence: number
}

const ROLE_ANCHOR_FIELDS: Readonly<Record<CanonicalSheet, readonly string[]>> = Object.freeze({
  processes: Object.freeze([
    'description_en',
    'description_ar',
    'owner_en',
    'owner_ar',
    'folder',
    'active_language'
  ]),
  participants: Object.freeze(['participant_id', 'parent_id']),
  steps: Object.freeze([
    'step_id',
    'order',
    'lane_id',
    'next_step_id',
    'next_step_ids',
    'called_process_id',
    'event_definition'
  ]),
  flows: Object.freeze(['flow_id', 'source_step_id', 'target_step_id']),
  glossary: Object.freeze(['english', 'arabic'])
})

const ROLE_SHEET_NAMES: Readonly<Record<CanonicalSheet, readonly string[]>> = Object.freeze({
  processes: Object.freeze(['processes', 'process', 'العمليات', 'عملية']),
  participants: Object.freeze([
    'participants',
    'participant',
    'lanes',
    'pools',
    'المشاركون',
    'المسارات'
  ]),
  steps: Object.freeze(['steps', 'activities', 'tasks', 'nodes', 'الخطوات', 'الأنشطة', 'المهام']),
  flows: Object.freeze(['flows', 'sequence flows', 'transitions', 'التدفقات', 'الانتقالات']),
  glossary: Object.freeze(['glossary', 'terms', 'المصطلحات', 'قاموس'])
})

function candidates(workbook: ParsedWorkbookData, role: CanonicalSheet): readonly Candidate[] {
  const required = new Set(REQUIRED_FIELDS_BY_SHEET[role])
  const anchors = new Set(ROLE_ANCHOR_FIELDS[role])
  const result: Candidate[] = []
  for (const sheet of workbook.sheets) {
    const maximum = Math.min(20, sheet.rows.length)
    for (let rowIndex = 0; rowIndex < maximum; rowIndex += 1) {
      const headers = sheet.rows[rowIndex]!.map(displayed)
      if (headers.every((header) => !header)) continue
      const suggestions = suggestHeaderMappings(role, headers)
      const requiredSuggestions = suggestions.filter(({ field }) => required.has(field))
      const found = requiredSuggestions.filter(({ header }) => header !== undefined)
      const anchorFound = suggestions.filter(
        ({ field, header, confidence }) =>
          anchors.has(field) && header !== undefined && confidence >= 0.72
      ).length
      result.push({
        selection: { worksheet: sheet.name, headerRow: rowIndex + 1 },
        headers,
        requiredFound: found.length,
        requiredTotal: required.size,
        anchorFound,
        sheetNameMatches: ROLE_SHEET_NAMES[role]
          .map(normalizeHeader)
          .includes(normalizeHeader(sheet.name)),
        averageConfidence:
          found.length === 0
            ? 0
            : found.reduce((total, suggestion) => total + suggestion.confidence, 0) / found.length
      })
    }
  }
  return result.sort(
    (left, right) =>
      right.requiredFound - left.requiredFound ||
      right.averageConfidence - left.averageConfidence ||
      left.selection.headerRow - right.selection.headerRow ||
      left.selection.worksheet.localeCompare(right.selection.worksheet)
  )
}

function shouldSelect(role: CanonicalSheet, candidate: Candidate): boolean {
  if (role === 'steps') {
    return (
      candidate.sheetNameMatches ||
      candidate.anchorFound > 0 ||
      candidate.requiredFound === candidate.requiredTotal
    )
  }
  return (
    candidate.requiredFound === candidate.requiredTotal &&
    candidate.averageConfidence >= 0.72 &&
    (candidate.sheetNameMatches || candidate.anchorFound > 0)
  )
}

export function suggestedMappingPreset(
  workbook: ParsedWorkbookData,
  options: {
    readonly name?: string
    readonly locale?: SpreadsheetLocale
  } = {}
): MappingPreset {
  const selectedSheets: Partial<Record<CanonicalSheet, SheetSelection>> = {}
  const fieldMappings: Partial<Record<CanonicalSheet, Readonly<Record<string, string>>>> = {}
  const headerSignatures: Partial<Record<CanonicalSheet, string>> = {}

  for (const role of WIZARD_SHEET_ROLES) {
    const best = candidates(workbook, role)[0]
    if (!best || !shouldSelect(role, best)) continue
    selectedSheets[role] = Object.freeze(best.selection)
    headerSignatures[role] = headerSignature(best.headers)
    fieldMappings[role] = Object.freeze(
      Object.fromEntries(
        suggestHeaderMappings(role, best.headers)
          .filter(
            (suggestion): suggestion is typeof suggestion & { readonly header: string } =>
              suggestion.header !== undefined && suggestion.confidence > 0
          )
          .map(({ field, header }) => [field, header])
      )
    )
  }

  // A mapping wizard cannot operate without a Steps role. Fall back to the
  // first non-empty row and let explicit review surface missing required fields.
  if (!selectedSheets.steps && workbook.sheets[0]) {
    const sheet = workbook.sheets[0]
    const rowIndex = Math.max(
      0,
      sheet.rows.findIndex((row) => row.some((cell) => displayed(cell) !== ''))
    )
    const headers = sheet.rows[rowIndex]?.map(displayed) ?? []
    selectedSheets.steps = Object.freeze({
      worksheet: sheet.name,
      headerRow: rowIndex + 1
    })
    headerSignatures.steps = headerSignature(headers)
    fieldMappings.steps = Object.freeze(
      Object.fromEntries(
        suggestHeaderMappings('steps', headers)
          .filter(
            (suggestion): suggestion is typeof suggestion & { readonly header: string } =>
              suggestion.header !== undefined
          )
          .map(({ field, header }) => [field, header])
      )
    )
  }

  return Object.freeze({
    version: MAPPING_PRESET_VERSION,
    name: options.name?.trim() || 'Spreadsheet mapping',
    headerSignatures: Object.freeze(headerSignatures),
    selectedSheets: Object.freeze(selectedSheets),
    fieldMappings: Object.freeze(fieldMappings),
    delimiters: Object.freeze({ list: DEFAULT_LIST_DELIMITERS }),
    inference: Object.freeze({
      flowMode: 'auto',
      syntheticBoundaries: 'review',
      requireGatewayConditions: true
    }),
    locale: options.locale ?? 'en'
  })
}

export function mappingReviewIssues(
  workbook: ParsedWorkbookData,
  preset: MappingPreset,
  confirmed: ReadonlySet<string>,
  options: { readonly defaultProcessId?: string } = {}
): readonly SpreadsheetValidationIssue[] {
  const issues: SpreadsheetValidationIssue[] = []
  for (const role of WIZARD_SHEET_ROLES) {
    const selection = preset.selectedSheets[role]
    if (!selection) {
      if (role === 'steps') {
        issues.push({
          code: 'missing-steps-sheet',
          severity: 'review',
          messageKey: 'spreadsheet.validation.missing-steps-sheet'
        })
      }
      continue
    }
    const headers = headersForSelection(workbook, selection)
    const mapping = preset.fieldMappings[role] ?? {}
    const suggestions = new Map(
      suggestHeaderMappings(role, headers).map((suggestion) => [suggestion.field, suggestion])
    )
    for (const field of REQUIRED_FIELDS_BY_SHEET[role]) {
      if (role === 'steps' && field === 'process_id' && options.defaultProcessId?.trim()) {
        continue
      }
      const mappedHeader = mapping[field]
      const key = `${role}.${field}`
      if (!mappedHeader || !headers.includes(mappedHeader)) {
        issues.push({
          code: 'missing-required-mapping',
          severity: 'review',
          messageKey: 'spreadsheet.validation.missing-required-mapping',
          guidanceKey: 'spreadsheet.guidance.confirm-field-mapping',
          worksheet: selection.worksheet,
          normalizedValue: field,
          details: { role, field }
        })
        continue
      }
      const suggestion = suggestions.get(field)
      const confidence = suggestion?.header === mappedHeader ? suggestion.confidence : 0
      if (confidence < LOW_CONFIDENCE_REQUIRED_THRESHOLD && !confirmed.has(key)) {
        issues.push({
          code: 'low-confidence-mapping',
          severity: 'review',
          messageKey: 'spreadsheet.validation.low-confidence-mapping',
          guidanceKey: 'spreadsheet.guidance.confirm-field-mapping',
          worksheet: selection.worksheet,
          rawValue: mappedHeader,
          normalizedValue: field,
          details: { role, field, confidence }
        })
      }
    }
  }
  return Object.freeze(issues)
}

export function allMappedRequiredFields(preset: MappingPreset): ReadonlySet<string> {
  const result = new Set<string>()
  for (const role of WIZARD_SHEET_ROLES) {
    if (!preset.selectedSheets[role]) continue
    for (const field of REQUIRED_FIELDS_BY_SHEET[role]) {
      if (preset.fieldMappings[role]?.[field]) result.add(`${role}.${field}`)
    }
  }
  return result
}

export function canonicalFieldsForRole(role: CanonicalSheet): readonly string[] {
  return CANONICAL_FIELDS_BY_SHEET[role]
}
