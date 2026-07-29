/**
 * Locale classification for `ArisChatLocalizedValue`. Small, deliberately duplicated vocabulary
 * (rather than importing `src/aris/assistant/arisVocabulary.ts`, which this lane must not
 * couple to) — the Windows LCID sets ARIS AML exports use for English/Arabic, plus the short
 * `en`/`ar` tags this codebase's UI layer uses (see `src/i18n`).
 *
 * The exact-match sets below only ever match numeric LCIDs and short tags. A real ARIS export's
 * `LocaleId` attribute is neither: it is the RAW, unexpanded internal-DTD entity reference
 * (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`), because the tokenizer/semantic-index layers only
 * expand entities inside element text, never attribute values (see `tabs.ts`'s `classifyLocale`
 * for the full explanation). Without also classifying that raw form, `hasEnglishName` /
 * `hasArabicName` misreport every real import as missing an Arabic name whenever the export uses
 * entity references — which `gapScanner.ts` then surfaces as a false `missingArabicName` gap on
 * every model. `localeLang` (`src/library/amlParse.ts`, not `arisVocabulary.ts`) is the shared
 * classifier that already handles this; importing it does not couple this lane to
 * `arisVocabulary.ts`.
 */

import { localeLang } from '../../library/amlParse'

/** Windows LCID strings for English locales, as observed in ARIS AML exports. */
export const DEFAULT_ENGLISH_LOCALE_IDS: ReadonlySet<string> = new Set([
  'en',
  '1033',
  '2057',
  '3081',
  '4105',
  '5129',
  '6153',
  '9225'
])

/** Windows LCID strings for Arabic locales, as observed in ARIS AML exports. */
export const DEFAULT_ARABIC_LOCALE_IDS: ReadonlySet<string> = new Set([
  'ar',
  '1025',
  '2049',
  '3073',
  '4097',
  '5121',
  '6145',
  '14337',
  '15361'
])

function hasNonEmptyValueForAnyLocale(
  localized: { readonly values: Readonly<Record<string, string>> },
  localeIds: ReadonlySet<string>,
  lang: 'en' | 'ar'
): boolean {
  for (const [localeId, text] of Object.entries(localized.values)) {
    if (text.trim().length === 0) continue
    if (localeIds.has(localeId)) return true
    if (localeLang(localeId) === lang) return true
  }
  return false
}

export function hasEnglishName(
  localized: { readonly values: Readonly<Record<string, string>> },
  englishLocaleIds: ReadonlySet<string> = DEFAULT_ENGLISH_LOCALE_IDS
): boolean {
  return hasNonEmptyValueForAnyLocale(localized, englishLocaleIds, 'en')
}

export function hasArabicName(
  localized: { readonly values: Readonly<Record<string, string>> },
  arabicLocaleIds: ReadonlySet<string> = DEFAULT_ARABIC_LOCALE_IDS
): boolean {
  return hasNonEmptyValueForAnyLocale(localized, arabicLocaleIds, 'ar')
}
