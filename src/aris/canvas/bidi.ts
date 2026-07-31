/**
 * Bidi / RTL text support for the ARIS canvas (plan Wave 6, V8).
 *
 * The AnimalWF labels mix Arabic and Latin freely — Arabic event and function
 * names, the Arabic header labels, and the Reference-Laws cards that embed
 * Latin digits and years (`قرار … رقم (3) لسنة 1983`). SVG text layout
 * applies the Unicode Bidirectional Algorithm when told the paragraph
 * direction; `unicode-bidi: plaintext` derives each paragraph's direction
 * from its first strong character and reorders the mixed runs, which is
 * exactly the GDI behaviour the reference PDFs show (Arabic base direction,
 * numbers and Latin identifiers kept in logical order inside the Arabic run).
 *
 * Anchoring: a centred label keeps `text-anchor: middle` in both directions
 * (the anchor is applied before bidi reordering), so no direction-dependent
 * anchor flip is needed for the CENTER placements AnimalWF uses throughout.
 */

import { containsArabicScript, hasMixedBidiScripts } from '../renderer/bidi'

export { containsArabicScript, hasMixedBidiScripts }

/**
 * The SVG direction attributes for one painted line: RTL base direction with
 * per-paragraph bidi resolution for Arabic text, nothing otherwise — LTR text
 * must not pick up attributes that would change its rendering.
 */
export function bidiTextAttrs(text: string): Readonly<Record<string, string>> {
  return containsArabicScript(text) ? { direction: 'rtl', 'unicode-bidi': 'plaintext' } : {}
}
