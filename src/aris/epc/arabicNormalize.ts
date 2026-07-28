/**
 * Arabic text normalization for return/rework outcome matching (plan section 14.3.2).
 *
 * This is a small, dependency-free normalizer, not a general Arabic NLP stemmer. It exists
 * to make substring matching against a short list of return/rework/reject root terms
 * resilient to the spelling variance real ARIS exports exhibit:
 *
 *   - Diacritics (tashkeel) and tatweel are stripped, since they never carry lexical
 *     meaning for this kind of keyword match and Arabic authors frequently omit or include
 *     them inconsistently within the same document.
 *   - Alef variants (أ إ آ ٱ) collapse to bare alef (ا), and alef maqsura (ى) collapses to
 *     yeh (ي), so a term written with or without hamzat-qat' still matches (e.g. "ارجاع" and
 *     "إرجاع" both normalize the same way).
 *   - Hamza-on-carrier letters (ؤ ئ) collapse to their carrier (و / ي) for the same reason.
 *   - Teh marbuta (ة) collapses to heh (ه) so a feminine/participle form (e.g. "مرفوضة")
 *     still contains the same root substring as its masculine form ("مرفوض").
 *   - A leading definite-article prefix ("ال") is stripped from each *word* (not from the
 *     whole string) so "الإرجاع" ("the return") matches the bare root "ارجاع". The prefix is
 *     only stripped when the remaining word is still at least 2 characters, so "ال" alone or
 *     a 3-letter word that merely starts with those two letters is not mangled into nothing.
 */

const DIACRITICS_AND_TATWEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g

const CHAR_MAP: ReadonlyMap<string, string> = new Map([
  ['أ', 'ا'],
  ['إ', 'ا'],
  ['آ', 'ا'],
  ['ٱ', 'ا'],
  ['ى', 'ي'],
  ['ؤ', 'و'],
  ['ئ', 'ي'],
  ['ة', 'ه']
])

function stripLeadingDefiniteArticle(word: string): string {
  if (word.length > 3 && word.startsWith('ال')) {
    return word.slice(2)
  }
  return word
}

/**
 * Normalizes Arabic text for loose substring matching: strips diacritics/tatweel, folds
 * alef/hamza/teh-marbuta variants, strips a leading definite article per word, and
 * lowercases (a no-op for Arabic script, but keeps behavior sane for any Latin text mixed
 * into the same string). Never mutates its input; always returns a new string.
 */
export function normalizeArabic(input: string): string {
  const stripped = input.replace(DIACRITICS_AND_TATWEEL, '')
  let folded = ''
  for (const ch of stripped) {
    folded += CHAR_MAP.get(ch) ?? ch
  }
  const words = folded.split(/(\s+)/).map((token) => (/\s/.test(token) ? token : stripLeadingDefiniteArticle(token)))
  return words.join('').toLowerCase().trim()
}
