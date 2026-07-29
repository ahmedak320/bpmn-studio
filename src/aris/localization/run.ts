/**
 * Provider run: send the review's translation queue through a `TranslateTextsFn`
 * and classify each positional result into a validated proposal or a
 * `ProviderFailure`.
 *
 * Mirrors the directional loop of `translateReviewedDiagramWithTexts` (`ar` then
 * `en`, one batched request per required direction, segmentation-review items
 * excluded). Unlike that helper this applies nothing: it returns proposals for a
 * separate acceptance decision, exactly as the reviewed pipeline separates
 * "consent to send" from "accept returned text".
 */

import { classifierOptionsFromGlossary, validateTargetScript } from '../../localization/script'
import type { DiagramLocalizationReview } from '../../localization/modelerAdapter'
import type { LanguageCode, ProviderFailure } from '../../localization/types'
import type { TranslateTextsFn } from '../../ai/translate'
import type { TranslationOutputProposal } from '../../localization/TranslationReviewDialog'

export interface ArisTranslationRunResult {
  readonly proposals: readonly TranslationOutputProposal[]
  readonly failures: readonly ProviderFailure[]
}

const DIRECTIONS: readonly LanguageCode[] = ['ar', 'en']

export async function runArisReviewedTranslation(
  review: DiagramLocalizationReview,
  translateTexts: TranslateTextsFn,
  signal?: AbortSignal
): Promise<ArisTranslationRunResult> {
  const scriptOptions = classifierOptionsFromGlossary(review.localResources.glossary)
  const proposals: TranslationOutputProposal[] = []
  const failures: ProviderFailure[] = []

  for (const target of DIRECTIONS) {
    signal?.throwIfAborted()
    const directional = review.queue.filter(
      (item) => item.target === target && item.requiresSegmentationReview !== true
    )
    if (directional.length === 0) continue
    const source: LanguageCode = target === 'ar' ? 'en' : 'ar'
    // A whole-service failure (e.g. FreeTranslateError) throws here and
    // propagates unhandled, exactly like the reviewed transports.
    const results = await translateTexts(
      directional.map((item) => item.sourceValue),
      source,
      target,
      signal
    )
    for (let index = 0; index < directional.length; index += 1) {
      const item = directional[index]
      const raw = results[index]
      const value = typeof raw === 'string' ? raw.trim() : undefined
      const validation =
        value === undefined ? { valid: false } : validateTargetScript(value, target, scriptOptions)
      // Positional miss / empty / wrong-script / unchanged-from-source ⇒ failure.
      if (value === undefined || value === '' || value === item.sourceValue || !validation.valid) {
        failures.push({
          processId: item.processId,
          elementId: item.elementId,
          field: item.field,
          target,
          originalValue: item.sourceValue
        })
        continue
      }
      proposals.push({
        processId: item.processId,
        elementId: item.elementId,
        field: item.field,
        sourceLanguage: item.sourceLanguage,
        sourceValue: item.sourceValue,
        target,
        value
      })
    }
  }

  return { proposals, failures }
}
