import type { LocalizationAuditOptions } from './audit'
import { auditLocalizationFields } from './audit'
import { extractBpmnLocalization } from './extract'
import {
  buildTranslationQueue,
  planLanguageProjection,
  planLocalResourceApplication,
  type LocalResourcePlanOptions
} from './plan'
import {
  LocalizationSource,
  type LanguageCode,
  type LocalResourcePlan,
  type LocalizationAuditReport,
  type LocalizationSource as LocalizationSourceType,
  type ProjectionPlan,
  type TranslationQueueItem
} from './types'

export interface LocalizationIngestionOptions extends LocalResourcePlanOptions {
  source?: LocalizationSourceType
  target?: LanguageCode
  defaultActive?: LanguageCode
}

/**
 * Read-only adapter shared by every ingestion boundary. It extracts all
 * paired/legacy fields, applies glossary and accepted translation memory in a
 * virtual copy first, audits that result, and prepares an explicit provider
 * queue. It performs no model mutation and cannot contact a network.
 */
export interface LocalizationIngestionReview {
  source: LocalizationSourceType
  target: LanguageCode
  initialAudit: LocalizationAuditReport
  localPlan: LocalResourcePlan
  audit: LocalizationAuditReport
  queue: TranslationQueueItem[]
  projection: ProjectionPlan
}

export function prepareLocalizationIngestion(
  root: unknown,
  options: LocalizationIngestionOptions = {}
): LocalizationIngestionReview {
  const source = options.source ?? LocalizationSource.Xml
  const target = options.target ?? 'ar'
  const fields = extractBpmnLocalization(root, {
    source,
    defaultActive: options.defaultActive
  })
  const auditOptions: LocalizationAuditOptions = {
    glossary: options.glossary,
    approvedNeutralTerms: options.approvedNeutralTerms,
    approvedEnglishBilingualExceptions: options.approvedEnglishBilingualExceptions,
    providerFailures: options.providerFailures
  }
  const initialAudit = auditLocalizationFields(fields, auditOptions)
  const localPlan = planLocalResourceApplication(fields, options)
  const audit = auditLocalizationFields(localPlan.fields, auditOptions)
  return {
    source,
    target,
    initialAudit,
    localPlan,
    audit,
    queue: buildTranslationQueue(localPlan.fields, auditOptions, target),
    projection: planLanguageProjection(localPlan.fields, target, auditOptions)
  }
}
