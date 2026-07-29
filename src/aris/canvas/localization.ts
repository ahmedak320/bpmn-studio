/**
 * Locale resolution for canvas captions.
 *
 * ARIS names are per-locale with an explicit fallback. The canvas renders the
 * active locale when present, then the stored fallback, then the first value in
 * insertion order — never an empty caption when *some* text exists.
 *
 * "Active locale" resolution is a DIFFERENT concern from en/ar bilingual
 * classification (`tabs.ts`'s `classifyLocale`, `arisVocabulary.ts`'s
 * `localeKeyToLang`): here the caller names ONE locale it wants
 * (`localeId`, defaulting to `DEFAULT_LOCALE_ID = 'en-US'`), not "give me
 * whichever value is English". But the two concerns still collide in
 * practice: canvas-authored content is keyed literally by `DEFAULT_LOCALE_ID`
 * (`emptyDocument.ts`'s `localizedValue`), so the original exact-match lookup
 * works for it — but a value sourced from real imported AML is keyed by the
 * RAW, unexpanded internal-DTD entity reference (`"&LocaleId.USen;"` /
 * `"&LocaleId.AEar;"`), which never equals `'en-US'`. Confirmed against
 * `reference/AnimalWF/ARISAMLExport.xml`'s one genuinely bilingual object
 * (`ObjDef.-6n37IkhqS5m-p-L`): its Arabic `AttrValue` is written BEFORE the
 * English one, so the old exact-match miss fell through to `fallback` (the
 * first non-empty value seen, in document order) and silently rendered the
 * Arabic name on an English-default canvas. Classifying candidate keys by
 * language with `localeLang` — after the exact match, before the
 * fallback/first-value last resorts — fixes that without changing behavior
 * for canvas-authored content (the exact match still wins when present).
 */

import { localeLang } from '../../library/amlParse'
import type { ArisLocalizedValue } from '../model/types'
import { DEFAULT_LOCALE_ID } from './emptyDocument'

export type ArisContentLanguage = 'en' | 'ar'
export const ARIS_CONTENT_LOCALE_IDS: Readonly<Record<ArisContentLanguage, string>> = Object.freeze(
  { en: DEFAULT_LOCALE_ID /* 'en-US' */, ar: 'ar-AE' }
)

export function readLocalized(
  value: ArisLocalizedValue | null | undefined,
  localeId = DEFAULT_LOCALE_ID
): string {
  if (!value) return ''
  const exact = value.values[localeId]
  if (typeof exact === 'string' && exact.length > 0) return exact
  const wantLang = localeLang(localeId)
  if (wantLang) {
    for (const [key, text] of Object.entries(value.values)) {
      if (typeof text === 'string' && text.length > 0 && localeLang(key) === wantLang) return text
    }
  }
  if (typeof value.fallback === 'string' && value.fallback.length > 0) return value.fallback
  for (const candidate of Object.values(value.values)) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return ''
}
