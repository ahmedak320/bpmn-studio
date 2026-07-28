/**
 * Locale classification for `ArisChatLocalizedValue`. Small, deliberately duplicated vocabulary
 * (rather than importing `src/aris/assistant/arisVocabulary.ts`, which this lane must not
 * couple to) — the Windows LCID sets ARIS AML exports use for English/Arabic, plus the short
 * `en`/`ar` tags this codebase's UI layer uses (see `src/i18n`).
 */

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
  localeIds: ReadonlySet<string>
): boolean {
  for (const [localeId, text] of Object.entries(localized.values)) {
    if (localeIds.has(localeId) && text.trim().length > 0) return true
  }
  return false
}

export function hasEnglishName(
  localized: { readonly values: Readonly<Record<string, string>> },
  englishLocaleIds: ReadonlySet<string> = DEFAULT_ENGLISH_LOCALE_IDS
): boolean {
  return hasNonEmptyValueForAnyLocale(localized, englishLocaleIds)
}

export function hasArabicName(
  localized: { readonly values: Readonly<Record<string, string>> },
  arabicLocaleIds: ReadonlySet<string> = DEFAULT_ARABIC_LOCALE_IDS
): boolean {
  return hasNonEmptyValueForAnyLocale(localized, arabicLocaleIds)
}
