import {
  LocalizationSource,
  SEEDED_GLOSSARY,
  reviewBpmnXmlLocalization,
  type LanguageCode,
  type LocalizationResources,
  type LocalizationSource as LocalizationSourceType,
  type ReviewedXmlIngestionEvidence,
  type ReviewedXmlIngestionReviewer
} from '../localization'
import type { BpmnValidationAdapter, ValidationSummary } from '../validation'

export interface ReviewedBpmnIngestionOptions {
  readonly source: LocalizationSourceType
  readonly target: LanguageCode
  readonly resources: LocalizationResources
  readonly knownProcessIds: readonly string[]
  readonly validationAdapters: readonly BpmnValidationAdapter[]
  readonly review?: ReviewedXmlIngestionReviewer
  readonly signal?: AbortSignal
  readonly isCurrent?: () => boolean | Promise<boolean>
}

export interface CompletedReviewedBpmnIngestion {
  readonly xml: string
  readonly digest: string
  readonly reviewDigest: string
  readonly validation: ValidationSummary
  readonly evidence: ReviewedXmlIngestionEvidence
}

export type ReviewedBpmnIngestionPort = (
  xml: string,
  options: ReviewedBpmnIngestionOptions
) => Promise<CompletedReviewedBpmnIngestion>

export type ReviewedBpmnBoundaryErrorCode = 'review-required' | 'review-cancelled'

export class ReviewedBpmnBoundaryError extends Error {
  readonly code: ReviewedBpmnBoundaryErrorCode

  constructor(code: ReviewedBpmnBoundaryErrorCode, message: string) {
    super(message)
    this.name = 'ReviewedBpmnBoundaryError'
    this.code = code
  }
}

export function defaultLocalizationResources(): LocalizationResources {
  return {
    glossary: SEEDED_GLOSSARY,
    translationMemory: Object.freeze([])
  }
}

export const secureReviewedBpmnIngestion: ReviewedBpmnIngestionPort = async (
  xml,
  options
) => {
  const outcome = await reviewBpmnXmlLocalization(xml, {
    source: options.source,
    target: options.target,
    resources: options.resources,
    validation: {
      adapters: options.validationAdapters,
      knownProcessIds: options.knownProcessIds,
      requireDi: true
    },
    validationAction: 'commit-import',
    review: options.review,
    signal: options.signal,
    isCurrent: options.isCurrent
  })
  if (outcome.status === 'review-required') {
    throw new ReviewedBpmnBoundaryError(
      'review-required',
      'BPMN bilingual localization requires completed explicit review.'
    )
  }
  if (outcome.status === 'cancelled') {
    throw new ReviewedBpmnBoundaryError(
      'review-cancelled',
      'BPMN bilingual localization review was cancelled.'
    )
  }
  return Object.freeze({
    xml: outcome.xml,
    digest: outcome.digest,
    reviewDigest: outcome.reviewDigest,
    validation: outcome.evidence.outputValidation,
    evidence: outcome.evidence
  })
}

export function localizationSourceForImport(
  sourceKind: 'bpmn' | 'aml' | 'library'
): LocalizationSourceType {
  return sourceKind === 'aml' ? LocalizationSource.Aris : LocalizationSource.Xml
}
