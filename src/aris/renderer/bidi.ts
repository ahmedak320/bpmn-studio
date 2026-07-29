/**
 * RTL / bidirectional text direction detection — Plan Section 12.5 (bilingual EN/AR data).
 *
 * Honest limitation: this module classifies a whole text block as `'ltr'` or `'rtl'` using the
 * ARIS `LocaleId` when available, falling back to a Unicode Arabic-script scan of the text
 * itself. It does **not** implement the full Unicode Bidirectional Algorithm (UAX #9): a string
 * that mixes Arabic and Latin/numeric runs (e.g. an Arabic label containing a Latin product
 * code) is assigned a single direction for the whole block, not per-run reordering. That is
 * reported as a `text-wrap-difference`-adjacent limitation rather than silently pretending the
 * renderer does full bidi shaping — see `buildRenderModel.ts`'s attribute-name handling.
 */

import type { RenderTextDirection } from './types'

const ARABIC_SCRIPT = /\p{Script=Arabic}/u

/** True if `text` contains any Arabic-script codepoint. */
export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text)
}

/**
 * True if `text` mixes Arabic-script codepoints with Latin letters or digits — the case where a
 * single-direction assignment is a known approximation of full UAX #9 bidi reordering.
 */
export function hasMixedBidiScripts(text: string): boolean {
  if (!containsArabicScript(text)) return false
  return /[A-Za-z0-9]/.test(text)
}

/**
 * Resolves the text direction for a run of text. `locale` (from the owning `Font`/`FontNode`'s
 * `LocaleId`) wins when known; otherwise the text is scanned for Arabic script.
 */
export function resolveTextDirection(
  text: string,
  locale: 'en' | 'ar' | undefined
): RenderTextDirection {
  if (locale === 'ar') return 'rtl'
  if (locale === 'en') return 'ltr'
  return containsArabicScript(text) ? 'rtl' : 'ltr'
}
