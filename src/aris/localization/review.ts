/**
 * Review construction: assemble a `DiagramLocalizationReview` (source `'aris'`)
 * from an `ArisWorkingDocument`, mirroring `inspectDiagramLocalization` MINUS the
 * moddle extraction (we do not import `modelerAdapter`; the type alone is used).
 *
 * Pipeline (exactly as the notation-agnostic core prescribes):
 *   extract → planLocalResourceApplication → (plan folds resolved values into its
 *   returned fields) → planLanguageProjection → buildTranslationQueue.
 *
 * The `'fallback'`-property projection patches are the canvas's job, so they are
 * deliberately excluded from `localUpdates` — the only patches this review hands to
 * the apply stage are the glossary/TM/neutral/source-seed metadata writes, whose
 * `property` carries the ARIS write-locale id.
 */

import { SEEDED_GLOSSARY } from '../../localization/glossary'
import {
  buildTranslationQueue,
  planLanguageProjection,
  planLocalResourceApplication
} from '../../localization/plan'
import type { DiagramLocalizationReview } from '../../localization/modelerAdapter'
import type {
  LocalizationField,
  LocalizationResources,
  ProviderFailure
} from '../../localization/types'
import { hasArabicName, hasEnglishName } from '../chat/locale'
import type { ArisWorkingDocument } from '../model/types'
import {
  extractArisLocalizationFields,
  type ArisLocaleIds,
  type ArisTranslationOwner
} from './fields'

export interface ArisLocalizationReviewInput {
  readonly document: ArisWorkingDocument
  readonly target: 'en' | 'ar'
  readonly active: 'en' | 'ar'
  readonly queueDirections?: 'target' | 'both'
  readonly providerFailures?: readonly ProviderFailure[]
  readonly resources?: LocalizationResources // default: SEEDED_GLOSSARY + empty TM
}

export interface ArisLocalizationReviewResult {
  readonly review: DiagramLocalizationReview // source: 'aris'
  readonly owners: ReadonlyMap<string, ArisTranslationOwner>
  readonly locales: ArisLocaleIds
  readonly sourceSignature: string
  readonly revision: number
}

/**
 * Stable signature of the raw translatable rows (BEFORE glossary/TM folding), so a
 * later stale check can re-extract and compare source text directly.
 */
function arisSourceSignature(fields: readonly LocalizationField[]): string {
  const rows = fields.map((field): [string, string, string | null, string | null] => [
    field.elementId,
    field.field,
    field.value.en ?? null,
    field.value.ar ?? null
  ])
  rows.sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1
  )
  return JSON.stringify(rows)
}

export function buildArisLocalizationReview(
  input: ArisLocalizationReviewInput
): ArisLocalizationReviewResult {
  const resources: LocalizationResources = input.resources ?? {
    glossary: SEEDED_GLOSSARY,
    translationMemory: []
  }
  const extract = extractArisLocalizationFields(input.document, { active: input.active })
  const sourceSignature = arisSourceSignature(extract.fields)
  const failureOptions =
    input.providerFailures === undefined ? {} : { providerFailures: input.providerFailures }

  const plan = planLocalResourceApplication(extract.fields, {
    glossary: resources.glossary,
    translationMemory: resources.translationMemory,
    ...failureOptions
  })
  // `plan.fields` are the folded clones (resolved glossary/TM values applied),
  // so projection and queue see the post-resolution state.
  const projection = planLanguageProjection(plan.fields, input.target)
  const requestedTarget = input.queueDirections === 'both' ? undefined : input.target
  const queue = buildTranslationQueue(plan.fields, failureOptions, requestedTarget)

  const review: DiagramLocalizationReview = {
    source: 'aris',
    target: input.target,
    fields: plan.fields,
    issues: plan.issues,
    queue,
    // Projection ('fallback') patches are the canvas's concern; keep only the
    // ARIS metadata writes. plan.updates never carries a 'fallback' property, so
    // this filter is a documented safety net.
    localUpdates: plan.updates.filter((patch) => patch.property !== 'fallback'),
    projected: projection.projected,
    unchanged: projection.unchanged,
    blockers: projection.blockers,
    complete: projection.complete,
    sourceSignature,
    localResources: {
      glossary: resources.glossary,
      translationMemory: resources.translationMemory
    }
  }

  return {
    review,
    owners: extract.owners,
    locales: extract.locales,
    sourceSignature,
    revision: input.document.revision
  }
}

/**
 * Count named elements missing an English or Arabic counterpart.
 *
 * Intentional delta vs `gapScanner.ts`'s name rules: gapScanner treats a fully
 * unnamed element as a `missingName` gap, NOT a missing counterpart. Here a
 * named-but-missing-counterpart element counts, because a translate run can fix
 * exactly that. An element with no name at all contributes to neither counter.
 */
export function countArisMissingTranslations(document: ArisWorkingDocument): {
  en: number
  ar: number
} {
  let en = 0
  let ar = 0
  const consider = (localized: { readonly values: Readonly<Record<string, string>> }): void => {
    const named = Object.values(localized.values).some((text) => text.trim() !== '')
    if (!named) return
    if (!hasEnglishName(localized)) en += 1
    if (!hasArabicName(localized)) ar += 1
  }
  for (const model of document.models.values()) consider(model.names)
  for (const definition of document.objectDefinitions.values()) consider(definition.names)
  for (const definition of document.connectionDefinitions.values()) consider(definition.names)
  for (const model of document.models.values()) {
    for (const note of model.freeText) consider(note.text)
  }
  return { en, ar }
}
