import {
  CANONICAL_FIELDS_BY_SHEET,
  REQUIRED_FIELDS_BY_SHEET,
  aliasesForField,
  normalizeHeader
} from './aliases'
import type { CanonicalSheet, SpreadsheetValidationIssue } from './contracts'
import { stableHash } from './hash'

export const LOW_CONFIDENCE_REQUIRED_THRESHOLD = 0.9

export interface HeaderMappingSuggestion {
  readonly field: string
  readonly required: boolean
  readonly header?: string
  readonly headerIndex?: number
  readonly confidence: number
  readonly match: 'exact-canonical' | 'exact-alias' | 'token' | 'fuzzy' | 'none'
  readonly confirmationRequired: boolean
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[right.length]!
}

function score(
  header: string,
  field: string
): {
  confidence: number
  match: HeaderMappingSuggestion['match']
} {
  const normalizedHeader = normalizeHeader(header)
  const normalizedCanonical = normalizeHeader(field)
  if (normalizedHeader === normalizedCanonical) {
    return { confidence: 1, match: 'exact-canonical' }
  }
  const aliases = aliasesForField(field).map(normalizeHeader)
  if (aliases.includes(normalizedHeader)) {
    return { confidence: 0.98, match: 'exact-alias' }
  }

  const headerTokens = new Set(normalizedHeader.split(' ').filter(Boolean))
  let bestToken = 0
  let bestFuzzy = 0
  for (const alias of aliases) {
    const aliasTokens = new Set(alias.split(' ').filter(Boolean))
    const intersection = [...aliasTokens].filter((token) => headerTokens.has(token)).length
    const union = new Set([...aliasTokens, ...headerTokens]).size
    if (union > 0) bestToken = Math.max(bestToken, intersection / union)
    const maximumLength = Math.max(alias.length, normalizedHeader.length)
    if (maximumLength > 0) {
      bestFuzzy = Math.max(bestFuzzy, 1 - levenshtein(alias, normalizedHeader) / maximumLength)
    }
  }
  if (bestToken >= 0.66) {
    return { confidence: Number((0.72 + bestToken * 0.16).toFixed(3)), match: 'token' }
  }
  if (bestFuzzy >= 0.58) {
    return { confidence: Number((0.4 + bestFuzzy * 0.4).toFixed(3)), match: 'fuzzy' }
  }
  return { confidence: 0, match: 'none' }
}

export function headerSignature(headers: readonly string[]): string {
  const normalized = headers.map((header) => normalizeHeader(String(header)))
  return `orbitpm-header-v1-${stableHash(JSON.stringify(normalized))}`
}

export function suggestHeaderMappings(
  sheet: CanonicalSheet,
  headers: readonly string[]
): readonly HeaderMappingSuggestion[] {
  const fields = CANONICAL_FIELDS_BY_SHEET[sheet]
  const required = new Set<string>(REQUIRED_FIELDS_BY_SHEET[sheet])
  const candidates = fields.flatMap((field) =>
    headers.map((header, headerIndex) => ({
      field,
      header,
      headerIndex,
      ...score(header, field)
    }))
  )
  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      fields.indexOf(left.field as never) - fields.indexOf(right.field as never) ||
      left.headerIndex - right.headerIndex
  )

  const assignedFields = new Map<string, (typeof candidates)[number]>()
  const assignedHeaders = new Set<number>()
  for (const candidate of candidates) {
    if (candidate.confidence === 0) continue
    if (assignedFields.has(candidate.field) || assignedHeaders.has(candidate.headerIndex)) continue
    assignedFields.set(candidate.field, candidate)
    assignedHeaders.add(candidate.headerIndex)
  }

  return Object.freeze(
    fields.map((field) => {
      const candidate = assignedFields.get(field)
      const isRequired = required.has(field)
      const confidence = candidate?.confidence ?? 0
      return Object.freeze({
        field,
        required: isRequired,
        ...(candidate ? { header: candidate.header, headerIndex: candidate.headerIndex } : {}),
        confidence,
        match: candidate?.match ?? 'none',
        confirmationRequired:
          isRequired && (candidate === undefined || confidence < LOW_CONFIDENCE_REQUIRED_THRESHOLD)
      })
    })
  )
}

export function mappingConfirmationIssues(
  worksheet: string,
  suggestions: readonly HeaderMappingSuggestion[],
  confirmedFields: ReadonlySet<string>
): readonly SpreadsheetValidationIssue[] {
  return Object.freeze(
    suggestions
      .filter(
        (suggestion) =>
          suggestion.required &&
          (suggestion.header === undefined ||
            (suggestion.confirmationRequired && !confirmedFields.has(suggestion.field)))
      )
      .map((suggestion) => ({
        code: suggestion.header ? 'low-confidence-mapping' : 'missing-required-mapping',
        severity: 'review' as const,
        messageKey: suggestion.header
          ? ('spreadsheet.validation.low-confidence-mapping' as const)
          : ('spreadsheet.validation.missing-required-mapping' as const),
        guidanceKey: 'spreadsheet.guidance.confirm-field-mapping' as const,
        worksheet,
        rawValue: suggestion.header,
        normalizedValue: suggestion.field,
        details: { field: suggestion.field, confidence: suggestion.confidence }
      }))
  )
}
