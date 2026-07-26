import { extractBpmnLocalization } from './extract'
import {
  SEEDED_GLOSSARY,
  approvedNeutralTerms,
  normalizeLocalizationLookup
} from './glossary'
import {
  classifyScript,
  validateTargetScript,
  type TargetValidationOptions
} from './script'
import {
  LocalizationSource,
  type GlossaryEntry,
  type LanguageCode,
  type LocalizationAuditReport,
  type LocalizationAuditSummary,
  type LocalizationField,
  type LocalizationIssue,
  type LocalizationIssueCode,
  type LocalizationSource as LocalizationSourceType,
  type ProviderFailure
} from './types'

export interface LocalizationAuditOptions {
  /**
   * Supplying a glossary uses exactly its neutral entries. Omitting it uses
   * the reviewed seed. This lets a workspace edit/remove seed terms.
   */
  glossary?: readonly GlossaryEntry[]
  approvedNeutralTerms?: Iterable<string>
  approvedEnglishBilingualExceptions?: Iterable<string>
  providerFailures?: readonly ProviderFailure[]
}

export interface AuditBpmnLocalizationOptions
  extends LocalizationAuditOptions {
  source?: LocalizationSourceType
  defaultActive?: LanguageCode
}

function materializeTerms(
  options: LocalizationAuditOptions
): readonly string[] {
  if (options.approvedNeutralTerms !== undefined) {
    return [...options.approvedNeutralTerms].map(String)
  }
  return approvedNeutralTerms(options.glossary ?? SEEDED_GLOSSARY)
}

function targetOptions(
  options: LocalizationAuditOptions
): TargetValidationOptions {
  return {
    approvedNeutralTerms: materializeTerms(options),
    approvedEnglishBilingualExceptions:
      options.approvedEnglishBilingualExceptions
  }
}

function issue(
  field: LocalizationField,
  target: LanguageCode,
  code: LocalizationIssueCode,
  originalValue?: string
): LocalizationIssue {
  return {
    source: field.source,
    processId: field.processId,
    elementId: field.elementId,
    field: field.field,
    target,
    code,
    ...(originalValue === undefined ? {} : { originalValue })
  }
}

export function auditFieldTarget(
  field: LocalizationField,
  target: LanguageCode,
  options: LocalizationAuditOptions = {}
): LocalizationIssue[] {
  const value = field.value[target]
  if (value == null || value.trim() === '') {
    return [issue(field, target, 'missing', value)]
  }

  const validation = validateTargetScript(value, target, targetOptions(options))
  if (validation.valid) return []
  if (validation.script === 'mixed') {
    return [issue(field, target, 'mixed', value)]
  }
  return [issue(field, target, 'wrong-script', value)]
}

function duplicateIssue(
  field: LocalizationField,
  options: LocalizationAuditOptions
): LocalizationIssue | undefined {
  const en = field.value.en
  const ar = field.value.ar
  if (en == null || ar == null) return undefined
  const normalizedEn = normalizeLocalizationLookup(en)
  const normalizedAr = normalizeLocalizationLookup(ar)
  if (!normalizedEn || normalizedEn !== normalizedAr) return undefined

  // Approved complete neutral values are intentionally the same in both
  // languages and must never be reported as duplicated translations.
  if (
    classifyScript(normalizedEn, {
      approvedNeutralTerms: materializeTerms(options)
    }) === 'neutral'
  ) {
    return undefined
  }

  const script = classifyScript(normalizedEn, {
    approvedNeutralTerms: materializeTerms(options)
  })
  const target: LanguageCode =
    script === 'english'
      ? 'ar'
      : script === 'arabic'
        ? 'en'
        : field.value.active === 'en'
          ? 'ar'
          : 'en'
  return issue(field, target, 'duplicate-counterpart', field.value[target])
}

function issueKey(value: LocalizationIssue): string {
  return [
    value.source,
    value.processId,
    value.elementId,
    value.field,
    value.target,
    value.code
  ].join('\u0000')
}

function summarize(
  fields: readonly LocalizationField[],
  issues: readonly LocalizationIssue[]
): LocalizationAuditSummary {
  const byCode: Record<LocalizationIssueCode, number> = {
    missing: 0,
    'wrong-script': 0,
    'duplicate-counterpart': 0,
    mixed: 0,
    'provider-failed': 0
  }
  const byTarget: Record<LanguageCode, number> = { en: 0, ar: 0 }
  const incomplete = new Set<string>()
  for (const current of issues) {
    byCode[current.code] += 1
    byTarget[current.target] += 1
    incomplete.add(
      `${current.processId}\u0000${current.elementId}\u0000${current.field}`
    )
  }
  return {
    totalFields: fields.length,
    completeFields: Math.max(0, fields.length - incomplete.size),
    issueCount: issues.length,
    byCode,
    byTarget
  }
}

/**
 * Pure issue-driven bilingual audit. No provider, storage, modeler, or network
 * operation can occur here.
 */
export function auditLocalizationFields(
  fields: readonly LocalizationField[],
  options: LocalizationAuditOptions = {}
): LocalizationAuditReport {
  // Materialize arbitrary iterables once. Generator-backed user preferences
  // must behave exactly like arrays across the many field/target checks.
  const stableOptions: LocalizationAuditOptions = {
    ...options,
    approvedNeutralTerms: materializeTerms(options),
    approvedEnglishBilingualExceptions:
      options.approvedEnglishBilingualExceptions === undefined
        ? undefined
        : [...options.approvedEnglishBilingualExceptions]
  }
  const issues: LocalizationIssue[] = []
  const seen = new Set<string>()
  const push = (current: LocalizationIssue): void => {
    const key = issueKey(current)
    if (seen.has(key)) return
    seen.add(key)
    issues.push(current)
  }

  for (const field of fields) {
    for (const target of ['en', 'ar'] as const) {
      for (const current of auditFieldTarget(field, target, stableOptions)) push(current)
    }
    const duplicate = duplicateIssue(field, stableOptions)
    if (duplicate) push(duplicate)
  }

  for (const failure of stableOptions.providerFailures ?? []) {
    const field = fields.find(
      (candidate) =>
        candidate.processId === failure.processId &&
        candidate.elementId === failure.elementId &&
        candidate.field === failure.field
    )
    const current: LocalizationIssue = {
      source: field?.source ?? fields[0]?.source ?? LocalizationSource.Xml,
      processId: failure.processId,
      elementId: failure.elementId,
      field: failure.field,
      target: failure.target,
      code: 'provider-failed',
      ...(failure.originalValue === undefined
        ? {}
        : { originalValue: failure.originalValue })
    }
    push(current)
  }

  return {
    fields: fields.map((field) => ({
      ...field,
      value: { ...field.value },
      origins: { ...field.origins },
      storage: { ...field.storage },
      planeIds: [...field.planeIds]
    })),
    issues,
    summary: summarize(fields, issues)
  }
}

export function auditBpmnLocalization(
  root: unknown,
  options: AuditBpmnLocalizationOptions = {}
): LocalizationAuditReport {
  const fields = extractBpmnLocalization(root, {
    source: options.source,
    defaultActive: options.defaultActive
  })
  return auditLocalizationFields(fields, options)
}
