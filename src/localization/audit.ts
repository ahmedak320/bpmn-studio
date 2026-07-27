import { extractBpmnLocalization } from './extract'
import { SEEDED_GLOSSARY, approvedNeutralTerms, normalizeLocalizationLookup } from './glossary'
import { classifyScript, createApprovedScriptValueSet, validateTargetScript } from './script'
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
  /**
   * Exact, field-scoped review exceptions. These never become workspace-wide
   * glossary entries and are honored only while the identified value remains
   * byte-for-byte current.
   */
  approvedFieldExceptions?: readonly LocalizationFieldException[]
  providerFailures?: readonly ProviderFailure[]
  /** Reused internally across one extraction/plan/audit/queue derivation. */
  auditContext?: LocalizationAuditContext
}

export interface LocalizationFieldException {
  processId: string
  elementId: string
  field: string
  target: LanguageCode
  value: string
  kind: 'neutral' | 'english-bilingual'
}

export interface AuditBpmnLocalizationOptions extends LocalizationAuditOptions {
  source?: LocalizationSourceType
  defaultActive?: LanguageCode
}

export interface LocalizationAuditContext {
  readonly approvedNeutralTermKeys: ReadonlySet<string>
  readonly approvedEnglishBilingualExceptionKeys: ReadonlySet<string>
  readonly fieldExceptions: ReadonlySet<string>
  readonly providerFailures: readonly ProviderFailure[]
}

function materializeTerms(options: LocalizationAuditOptions): readonly string[] {
  if (options.approvedNeutralTerms !== undefined) {
    return [...options.approvedNeutralTerms].map(String)
  }
  return approvedNeutralTerms(options.glossary ?? SEEDED_GLOSSARY)
}

function fieldLookupKey(
  value: Pick<LocalizationField | ProviderFailure, 'processId' | 'elementId' | 'field'>
): string {
  return `${value.processId}\u0000${value.elementId}\u0000${value.field}`
}

function fieldExceptionKey(
  value: Pick<
    LocalizationFieldException,
    'processId' | 'elementId' | 'field' | 'target' | 'kind' | 'value'
  >
): string {
  return [
    value.processId,
    value.elementId,
    value.field,
    value.target,
    value.kind,
    value.value
  ].join('\u0000')
}

export function createLocalizationAuditContext(
  options: LocalizationAuditOptions = {}
): LocalizationAuditContext {
  if (options.auditContext) return options.auditContext
  return Object.freeze({
    approvedNeutralTermKeys: createApprovedScriptValueSet(materializeTerms(options)),
    approvedEnglishBilingualExceptionKeys: createApprovedScriptValueSet(
      options.approvedEnglishBilingualExceptions ?? []
    ),
    fieldExceptions: new Set((options.approvedFieldExceptions ?? []).map(fieldExceptionKey)),
    providerFailures: Object.freeze(
      (options.providerFailures ?? []).map((failure) => Object.freeze({ ...failure }))
    )
  })
}

function exactFieldException(
  field: LocalizationField,
  target: LanguageCode,
  value: string | undefined,
  kind: LocalizationFieldException['kind'],
  context: LocalizationAuditContext
): boolean {
  if (value === undefined) return false
  return context.fieldExceptions.has(
    fieldExceptionKey({
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      target,
      kind,
      value
    })
  )
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
  options: LocalizationAuditOptions = {},
  context: LocalizationAuditContext = createLocalizationAuditContext(options)
): LocalizationIssue[] {
  const value = field.value[target]
  if (value == null || value.trim() === '') {
    return [issue(field, target, 'missing', value)]
  }

  if (exactFieldException(field, target, value, 'neutral', context)) return []
  const validation = validateTargetScript(value, target, {
    approvedNeutralTermKeys: context.approvedNeutralTermKeys,
    approvedEnglishBilingualExceptionKeys: context.approvedEnglishBilingualExceptionKeys
  })
  if (
    !validation.valid &&
    target === 'en' &&
    validation.script === 'mixed' &&
    exactFieldException(field, target, value, 'english-bilingual', context)
  ) {
    return []
  }
  if (validation.valid) return []
  if (validation.script === 'mixed') {
    return [issue(field, target, 'mixed', value)]
  }
  return [issue(field, target, 'wrong-script', value)]
}

function duplicateIssue(
  field: LocalizationField,
  context: LocalizationAuditContext
): LocalizationIssue | undefined {
  const en = field.value.en
  const ar = field.value.ar
  if (en == null || ar == null) return undefined
  const normalizedEn = normalizeLocalizationLookup(en)
  const normalizedAr = normalizeLocalizationLookup(ar)
  if (!normalizedEn || normalizedEn !== normalizedAr) return undefined

  // Approved complete neutral values are intentionally the same in both
  // languages and must never be reported as duplicated translations.
  const script = classifyScript(normalizedEn, {
    approvedNeutralTermKeys: context.approvedNeutralTermKeys
  })
  if (script === 'neutral') return undefined
  const target: LanguageCode =
    script === 'english'
      ? 'ar'
      : script === 'arabic'
        ? 'en'
        : field.value.active === 'en'
          ? 'ar'
          : 'en'
  if (exactFieldException(field, target, field.value[target], 'neutral', context)) {
    return undefined
  }
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
    incomplete.add(`${current.processId}\u0000${current.elementId}\u0000${current.field}`)
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
  const context = createLocalizationAuditContext(options)
  const issues: LocalizationIssue[] = []
  const seen = new Set<string>()
  const fieldsByIdentity = new Map<string, LocalizationField>()
  const push = (current: LocalizationIssue): void => {
    const key = issueKey(current)
    if (seen.has(key)) return
    seen.add(key)
    issues.push(current)
  }

  for (const field of fields) {
    const identity = fieldLookupKey(field)
    if (!fieldsByIdentity.has(identity)) fieldsByIdentity.set(identity, field)
    for (const target of ['en', 'ar'] as const) {
      for (const current of auditFieldTarget(field, target, options, context)) push(current)
    }
    const duplicate = duplicateIssue(field, context)
    if (duplicate) push(duplicate)
  }

  for (const failure of context.providerFailures) {
    const field = fieldsByIdentity.get(fieldLookupKey(failure))
    const current: LocalizationIssue = {
      source: field?.source ?? fields[0]?.source ?? LocalizationSource.Xml,
      processId: failure.processId,
      elementId: failure.elementId,
      field: failure.field,
      target: failure.target,
      code: 'provider-failed',
      ...(failure.originalValue === undefined ? {} : { originalValue: failure.originalValue })
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
