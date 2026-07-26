import {
  auditFieldTarget,
  auditLocalizationFields,
  type LocalizationAuditOptions
} from './audit'
import {
  SEEDED_GLOSSARY,
  findLocalPair
} from './glossary'
import type {
  GlossaryEntry,
  LanguageCode,
  LocalizationField,
  LocalizationIssue,
  LocalizationPatch,
  LocalResourcePlan,
  ProjectionPlan,
  TranslationMemoryEntry,
  TranslationQueueItem
} from './types'

function cloneField(field: LocalizationField): LocalizationField {
  return {
    ...field,
    value: { ...field.value },
    origins: { ...field.origins },
    storage: { ...field.storage },
    planeIds: [...field.planeIds]
  }
}

function opposite(language: LanguageCode): LanguageCode {
  return language === 'en' ? 'ar' : 'en'
}

function stableAuditOptions(
  options: LocalizationAuditOptions
): LocalizationAuditOptions {
  return {
    ...options,
    approvedNeutralTerms:
      options.approvedNeutralTerms === undefined
        ? undefined
        : [...options.approvedNeutralTerms],
    approvedEnglishBilingualExceptions:
      options.approvedEnglishBilingualExceptions === undefined
        ? undefined
        : [...options.approvedEnglishBilingualExceptions]
  }
}

function fieldIssuesForTarget(
  field: LocalizationField,
  target: LanguageCode,
  options: LocalizationAuditOptions
): LocalizationIssue[] {
  return auditLocalizationFields([field], options).issues.filter(
    (current) => current.target === target
  )
}

function patchForStoredTarget(
  field: LocalizationField,
  target: LanguageCode,
  value: string,
  reason: LocalizationPatch['reason']
): LocalizationPatch {
  const previous =
    field.origins[target] === 'paired' ? field.value[target] : undefined
  return {
    source: field.source,
    processId: field.processId,
    elementId: field.elementId,
    field: field.field,
    property:
      target === 'en' ? field.storage.enProperty : field.storage.arProperty,
    value,
    ...(previous === undefined ? {} : { expectedValue: previous }),
    target,
    reason
  }
}

export interface LocalResourcePlanOptions extends LocalizationAuditOptions {
  glossary?: readonly GlossaryEntry[]
  translationMemory?: readonly TranslationMemoryEntry[]
  targetLanguages?: readonly LanguageCode[]
}

/**
 * Plan deterministic, exact local repairs. Valid targets are immutable here:
 * only missing/invalid sides may receive glossary/TM patches. Valid visible
 * source text is also planned into its paired attribute (`source-seed`).
 */
export function planLocalResourceApplication(
  inputFields: readonly LocalizationField[],
  options: LocalResourcePlanOptions = {}
): LocalResourcePlan {
  const glossary = options.glossary ?? SEEDED_GLOSSARY
  const translationMemory = options.translationMemory ?? []
  const targets = options.targetLanguages ?? (['en', 'ar'] as const)
  const auditOptions = stableAuditOptions(options)
  const fields = inputFields.map(cloneField)
  const updates: LocalizationPatch[] = []
  let glossaryMatches = 0
  let translationMemoryMatches = 0
  let neutralMatches = 0

  for (const field of fields) {
    // Preserve a valid legacy/visible source by seeding only its absent paired
    // metadata. Invalid mixed/wrong-script projections remain review items.
    for (const language of ['en', 'ar'] as const) {
      if (
        (field.origins[language] !== 'projection' &&
          field.origins[language] !== 'script-inferred') ||
        field.value[language] == null ||
        auditFieldTarget(field, language, auditOptions).length > 0
      ) {
        continue
      }
      updates.push(
        patchForStoredTarget(
          field,
          language,
          field.value[language] as string,
          'source-seed'
        )
      )
      field.origins[language] = 'paired'
    }

    for (const target of targets) {
      if (fieldIssuesForTarget(field, target, auditOptions).length === 0) continue
      const source = opposite(target)
      const sourceValue = field.value[source]
      if (
        sourceValue == null ||
        auditFieldTarget(field, source, auditOptions).length > 0
      ) {
        continue
      }

      const match = findLocalPair(
        sourceValue,
        source,
        target,
        glossary,
        translationMemory
      )
      if (!match) {
        // Numeric values, identifiers, URLs, e-mail addresses, one-letter
        // codes, and directly-approved neutral values need no translated
        // resource entry. Copying is allowed only when a full target audit
        // proves the identical candidate is neutral-valid.
        const neutralCandidate = cloneField(field)
        neutralCandidate.value[target] = sourceValue
        neutralCandidate.origins[target] = 'paired'
        if (
          fieldIssuesForTarget(neutralCandidate, target, auditOptions).length === 0
        ) {
          updates.push(
            patchForStoredTarget(field, target, sourceValue, 'neutral')
          )
          field.value[target] = sourceValue
          field.origins[target] = 'paired'
          neutralMatches += 1
        }
        continue
      }

      const candidate = cloneField(field)
      candidate.value[target] = match.value
      candidate.origins[target] = 'paired'
      if (fieldIssuesForTarget(candidate, target, auditOptions).length > 0) continue

      updates.push(
        patchForStoredTarget(
          field,
          target,
          match.value,
          match.resource
        )
      )
      field.value[target] = match.value
      field.origins[target] = 'paired'
      if (match.resource === 'glossary') glossaryMatches += 1
      else translationMemoryMatches += 1
    }
  }

  const audit = auditLocalizationFields(fields, auditOptions)
  return {
    fields,
    updates,
    issues: audit.issues,
    glossaryMatches,
    translationMemoryMatches,
    neutralMatches
  }
}

export interface ProjectionPlanOptions extends LocalizationAuditOptions {
  /**
   * Explicit partial-preview choice. False/omitted never projects an
   * opposite-language fallback.
   */
  allowPartial?: boolean
}

/**
 * Plan projection of valid paired values onto legacy visible/name/detail
 * properties. Incomplete target language is reported via blockers and is
 * never silently presented as a successful switch.
 */
export function planLanguageProjection(
  fields: readonly LocalizationField[],
  language: LanguageCode,
  options: ProjectionPlanOptions = {}
): ProjectionPlan {
  const auditOptions = stableAuditOptions(options)
  const report = auditLocalizationFields(fields, auditOptions)
  const blockers = report.issues.filter(
    (current) => current.target === language
  )
  const updates: LocalizationPatch[] = []
  let projected = 0
  let unchanged = 0
  let fallbackCount = 0

  for (const field of fields) {
    const targetIssues = blockers.filter(
      (current) =>
        current.processId === field.processId &&
        current.elementId === field.elementId &&
        current.field === field.field
    )
    let value: string | undefined
    let reason: LocalizationPatch['reason'] = 'projection'

    if (targetIssues.length === 0) {
      value = field.value[language]
      projected += 1
    } else if (options.allowPartial) {
      const fallback = opposite(language)
      if (auditFieldTarget(field, fallback, auditOptions).length === 0) {
        value = field.value[fallback]
        reason = 'partial-fallback'
        fallbackCount += 1
      }
    }
    if (value == null) continue
    if (field.projection === value) {
      unchanged += 1
      continue
    }
    updates.push({
      source: field.source,
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      property: field.storage.projectionProperty,
      value,
      ...(field.projection === undefined
        ? {}
        : { expectedValue: field.projection }),
      target: language,
      reason
    })
  }

  return {
    language,
    complete: blockers.length === 0,
    updates,
    blockers,
    projected,
    unchanged,
    fallbackCount
  }
}

/**
 * Build the explicit unresolved worklist consumed by a later manual/provider
 * review. This function executes no translation and sends no text anywhere.
 */
export function buildTranslationQueue(
  fields: readonly LocalizationField[],
  options: LocalizationAuditOptions = {},
  requestedTarget?: LanguageCode
): TranslationQueueItem[] {
  const auditOptions = stableAuditOptions(options)
  const report = auditLocalizationFields(fields, auditOptions)
  const output: TranslationQueueItem[] = []
  for (const field of fields) {
    for (const target of ['en', 'ar'] as const) {
      if (requestedTarget && target !== requestedTarget) continue
      const issues = report.issues.filter(
        (current) =>
          current.processId === field.processId &&
          current.elementId === field.elementId &&
          current.field === field.field &&
          current.target === target
      )
      if (issues.length === 0) continue
      const sourceLanguage = opposite(target)
      const sourceValue = field.value[sourceLanguage]
      if (sourceValue == null) continue
      const sourceIssues = auditFieldTarget(
        field,
        sourceLanguage,
        auditOptions
      )
      if (sourceIssues.length > 0) {
        if (sourceIssues.every((current) => current.code === 'mixed')) {
          output.push({
            source: field.source,
            processId: field.processId,
            elementId: field.elementId,
            field: field.field,
            sourceLanguage,
            sourceValue,
            target,
            issues: [...issues, ...sourceIssues],
            requiresSegmentationReview: true
          })
        }
        continue
      }
      output.push({
        source: field.source,
        processId: field.processId,
        elementId: field.elementId,
        field: field.field,
        sourceLanguage,
        sourceValue,
        target,
        issues
      })
    }
  }
  return output
}
