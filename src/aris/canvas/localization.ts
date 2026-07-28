/**
 * Locale resolution for canvas captions.
 *
 * ARIS names are per-locale with an explicit fallback. The canvas renders the
 * active locale when present, then the stored fallback, then the first value in
 * insertion order — never an empty caption when *some* text exists.
 */

import type { ArisLocalizedValue } from '../model/types'
import { DEFAULT_LOCALE_ID } from './emptyDocument'

export function readLocalized(value: ArisLocalizedValue | null | undefined, localeId = DEFAULT_LOCALE_ID): string {
  if (!value) return ''
  const exact = value.values[localeId]
  if (typeof exact === 'string' && exact.length > 0) return exact
  if (typeof value.fallback === 'string' && value.fallback.length > 0) return value.fallback
  for (const candidate of Object.values(value.values)) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return ''
}
