/**
 * ARIS localization adapter: wires the notation-agnostic `src/localization` core
 * to the `ArisWorkingDocument` — field extraction, review construction, provider
 * run, and one-gesture apply.
 */

export {
  detectArisLocaleIds,
  extractArisLocalizationFields,
  type ArisLocaleIds,
  type ArisLocalizationExtract,
  type ArisTranslationOwner
} from './fields'
export {
  buildArisLocalizationReview,
  countArisMissingTranslations,
  type ArisLocalizationReviewInput,
  type ArisLocalizationReviewResult
} from './review'
export { runArisReviewedTranslation, type ArisTranslationRunResult } from './run'
export { makeArisAiTranslateTexts } from './aiTranslateTexts'
export {
  applyArisTranslations,
  toArisTranslationUpdates,
  type ArisTranslationUpdate
} from './apply'
