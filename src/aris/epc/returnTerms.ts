import type { EpcLocalizedNames } from './types'
import { normalizeArabic } from './arabicNormalize'

/**
 * Bilingual return/rework/reject outcome vocabulary (plan section 14.3.2).
 *
 * English terms are the four the plan names explicitly (return, returned, modify, rework)
 * plus a small set of directly-adjacent outcome words that showed up in the real AnimalWF
 * fixture's event/function names during research for this module: "rejected" ("Application
 * rejected"), "amendments"/"amend" ("Application returned for amendments"), and "resubmit".
 * These are additions beyond the plan's literal word list, called out here and in the
 * module report.
 *
 * Arabic terms are standard Modern Standard Arabic (MSA) roots for the same concepts,
 * matched after `normalizeArabic()` on both the dictionary term and the candidate text (see
 * `arabicNormalize.ts` for the exact folding rules). Coverage:
 *
 *   - إرجاع / ارجاع (irjāʿ – "return/send back")
 *   - رجوع (rujūʿ – "return/going back")
 *   - إعادة / اعادة (iʿāda – "redo/repeat", incl. "إعادة العمل" "rework the work" and
 *     "إعادة تقديم" "resubmit")
 *   - معاد (muʿād – "returned/redone", passive participle)
 *   - تعديل / تعديلات (taʿdīl – "modification(s)")
 *   - معدل (muʿaddal – "modified" — NOTE: this word is genuinely ambiguous in MSA, since it
 *     is also the ordinary word for "rate" (e.g. "معدل النمو", growth rate). It is included
 *     because it is a correct translation of "modified", but callers should expect an
 *     occasional false positive on this term specifically; see the module report.)
 *   - رفض / مرفوض (rafḍ / marfūḍ – "reject/rejected")
 *
 * IMPORTANT FINDING FROM THE REAL FIXTURE: the AnimalWF export tags very few object names
 * with a genuine Arabic-script value at all (9 distinct Arabic-script strings in the whole
 * file; of the 30 object definitions with any text under the Arabic locale id, all but two
 * are just the English string mistakenly duplicated under the Arabic locale). None of the
 * return/reject/rework outcome nodes in the fixture (`Application rejected`, `Application
 * Returned for modification`, `Application returned for amendments`, ...) carry any Arabic
 * text at all — every real match in this fixture is via the English term list. The Arabic
 * list below is therefore validated by construction/vocabulary review, not by a positive
 * match against this particular fixture; it is still required so the detector works
 * correctly once bilingual data is supplied.
 */

export type ReturnOutcomeConcept = 'return' | 'reject' | 'modify' | 'rework' | 'resubmit'

export interface ReturnTermMatch {
  readonly language: 'en' | 'ar'
  readonly localeId: string
  readonly matchedTerm: string
  readonly concept: ReturnOutcomeConcept
  readonly text: string
}

interface EnglishTermRule {
  readonly pattern: RegExp
  readonly term: string
  readonly concept: ReturnOutcomeConcept
}

const ENGLISH_TERMS: readonly EnglishTermRule[] = [
  { pattern: /\breturn(ed|s|ing)?\b/i, term: 'return', concept: 'return' },
  { pattern: /\bmodif(y|ied|ies|ication|ications)\b/i, term: 'modify', concept: 'modify' },
  { pattern: /\brework(ed|s|ing)?\b/i, term: 'rework', concept: 'rework' },
  { pattern: /\bamend(ed|s|ment|ments|ing)?\b/i, term: 'amend', concept: 'modify' },
  { pattern: /\bre-?submit(ted|s|ting)?\b/i, term: 'resubmit', concept: 'resubmit' },
  { pattern: /\breject(ed|s|ing|ion)?\b/i, term: 'reject', concept: 'reject' }
]

interface ArabicTermRule {
  readonly normalized: string
  readonly term: string
  readonly concept: ReturnOutcomeConcept
}

const ARABIC_TERMS: readonly ArabicTermRule[] = [
  { normalized: normalizeArabic('إرجاع'), term: 'إرجاع', concept: 'return' },
  { normalized: normalizeArabic('رجوع'), term: 'رجوع', concept: 'return' },
  { normalized: normalizeArabic('إعادة تقديم'), term: 'إعادة تقديم', concept: 'resubmit' },
  { normalized: normalizeArabic('إعادة العمل'), term: 'إعادة العمل', concept: 'rework' },
  { normalized: normalizeArabic('إعادة'), term: 'إعادة', concept: 'return' },
  { normalized: normalizeArabic('معاد'), term: 'معاد', concept: 'return' },
  { normalized: normalizeArabic('تعديل'), term: 'تعديل', concept: 'modify' },
  { normalized: normalizeArabic('معدل'), term: 'معدل', concept: 'modify' },
  { normalized: normalizeArabic('مرفوض'), term: 'مرفوض', concept: 'reject' },
  { normalized: normalizeArabic('رفض'), term: 'رفض', concept: 'reject' }
]

/** Finds every return/rework/reject term matched inside any of `names`' localized values. */
export function findReturnOutcomeMatches(names: EpcLocalizedNames): readonly ReturnTermMatch[] {
  const matches: ReturnTermMatch[] = []
  for (const [localeId, text] of Object.entries(names)) {
    if (!text) continue
    for (const rule of ENGLISH_TERMS) {
      if (rule.pattern.test(text)) {
        matches.push({ language: 'en', localeId, matchedTerm: rule.term, concept: rule.concept, text })
      }
    }
    const normalized = normalizeArabic(text)
    if (normalized) {
      for (const rule of ARABIC_TERMS) {
        if (rule.normalized && normalized.includes(rule.normalized)) {
          matches.push({ language: 'ar', localeId, matchedTerm: rule.term, concept: rule.concept, text })
        }
      }
    }
  }
  return matches
}

/** True if any localized name matches a return/rework/reject outcome term. */
export function isReturnOutcomeName(names: EpcLocalizedNames): boolean {
  return findReturnOutcomeMatches(names).length > 0
}
