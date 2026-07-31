/**
 * Deterministic text measurement and wrapping — Plan Section 12.1/12.3/12.5.
 *
 * ARIS wraps text using the Windows GDI text layout engine and the real metrics of the
 * (possibly proprietary) font face. This renderer has neither GDI nor the licensed font files,
 * so it measures glyphs with a fixed per-character advance-width table instead of loading a real
 * font. That is a deliberate, documented approximation: any time it actually wraps a line (i.e.
 * the measured text does not fit on one line), a `text-wrap-difference` fidelity finding is
 * emitted rather than presenting the wrap as source-accurate. Single-line text has no wrap
 * decision to get wrong, so it produces no finding.
 *
 * ## The width table (plan §6.2)
 *
 * Latin text (ASCII 0x20–0x7E) is measured with the public-domain Adobe core-14 **Helvetica**
 * and **Helvetica-Bold** AFM advance-width tables (below), selected by the `weight` parameter —
 * function captions and numbering are bold in the source. Arial is metrically compatible with
 * Helvetica by design (the historical point of the Arial/Helvetica substitution): AnimalWF's own
 * embedded `ArialMT`/`Arial-BoldMT` glyphs, extracted directly from
 * `Register_Animal_Owner_Profile_Draft03.pdf`'s font program and read via their `hmtx` table,
 * match every width below to the unit. Arabic text is measured with a 3-tier table (§3.6)
 * instead of a flat estimate, classified by codepoint.
 *
 * These are **advance widths with no kerning**. GDI (and the real ArialMT/Arial-BoldMT kern
 * tables) tighten specific glyph pairs when it lays out text for print, so a real ARIS PDF's
 * measured text run is a few percent narrower than the sum of this table's per-character
 * advances — verified directly against the reference PDF: "registration Service" (the start
 * event caption line that motivated this table) sums to ≈301.9 canvas units of un-kerned advance
 * at the −10 English size, vs. ≈292.2 measured in the PDF's own text layer. That residual gap is
 * non-uniform, pair-specific kerning, not a table error: the PDF's own glyph stream shows, e.g.,
 * zero adjustment on `s`→`t`, a −7.5% tightening on `a`→`t`, and a +2.8% widening on the space
 * before `S` — a pattern only kerning produces, and every individual width in the tables below
 * was independently confirmed against AnimalWF's embedded font. Modeling per-pair kerning is out
 * of scope for this deterministic, no-DOM estimator; the AFM table is still a large accuracy
 * gain over the coarse em-class table it replaces, which measured the same string at ≈328 units
 * (a +12% overshoot vs. only +3.3% for the AFM table) — enough to wrap this line one line early.
 */

import type { ArisRenderFidelityFinding, RenderTextLine } from './types'

/** The two Latin advance-width tables this module knows: regular or bold Helvetica/Arial. */
export type ArisTextWeight = 'regular' | 'bold'

/**
 * Adobe core-14 **Helvetica** AFM advance widths, ×1000 units per em, for the 95 printable ASCII
 * characters (0x20–0x7E). Source: `Helvetica.afm` (Adobe Core 14 Font Pack — public domain,
 * bundled with Ghostscript and most PDF toolchains). Cross-checked to the unit against the
 * `ArialMT` glyph program embedded in `Register_Animal_Owner_Profile_Draft03.pdf`.
 */
const HELVETICA_WIDTHS: Readonly<Record<string, number>> = Object.freeze({
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 278,
  '\\': 278,
  ']': 278,
  '^': 469,
  _: 556,
  '`': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '{': 334,
  '|': 260,
  '}': 334,
  '~': 584
})

/**
 * Adobe core-14 **Helvetica-Bold** AFM advance widths, ×1000 units per em. Function captions,
 * numbering ("01"…"14") and other AT_NAME/AT_ID bold runs measure against this table. Source:
 * `Helvetica-Bold.afm` (Adobe Core 14 Font Pack). Cross-checked to the unit against the
 * `Arial-BoldMT` glyph program embedded in the same reference PDF (e.g. the "Login to TAMM
 * portal…Service01" caption + numbering run).
 */
const HELVETICA_BOLD_WIDTHS: Readonly<Record<string, number>> = Object.freeze({
  ' ': 278,
  '!': 333,
  '"': 474,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 722,
  "'": 238,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 333,
  ';': 333,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 611,
  '@': 975,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 333,
  '\\': 278,
  ']': 333,
  '^': 584,
  _: 556,
  '`': 333,
  a: 556,
  b: 611,
  c: 556,
  d: 611,
  e: 556,
  f: 333,
  g: 611,
  h: 611,
  i: 278,
  j: 278,
  k: 556,
  l: 278,
  m: 889,
  n: 611,
  o: 611,
  p: 611,
  q: 611,
  r: 389,
  s: 556,
  t: 333,
  u: 611,
  v: 556,
  w: 778,
  x: 556,
  y: 556,
  z: 500,
  '{': 389,
  '|': 280,
  '}': 389,
  '~': 584
})

/** Em width of one AFM table entry (the table stores ×1000-of-em integers). */
const AFM_UNITS_PER_EM = 1000

// --- Arabic tier table (plan §3.6) -------------------------------------------

/** The 3-tier Arabic advance-width table's em values, approximated from Noto Sans Arabic. */
const ARABIC_NARROW_EM = 0.28
const ARABIC_MEDIUM_EM = 0.5
const ARABIC_WIDE_EM = 0.62

/**
 * Narrow/joiner tier: combining diacritics (tashkeel — zero-width in real shaping; this
 * non-shaping estimator gives them the narrow floor rather than zero so a diacritic-only token
 * never vanishes from a wrap decision), the pure joining stroke (tatweel), the non-connecting
 * alef family (a single upright stroke in every position), ayn/ghayn, meem and the heh family
 * (small loop bodies), and Arabic punctuation. Measured against `NotoSansArabic-Regular.ttf`'s
 * `hmtx` table (isolated-form advances): alef forms 235–238/1000 em, ayn/ghayn 507 (≈254 at the
 * roughly-half-width a medial/initial form typically draws), meem 484 (≈242 medial), heh 405
 * (≈203 medial) — all cluster near the narrow tier once joining context is accounted for.
 */
function isArabicNarrow(codePoint: number): boolean {
  return (
    (codePoint >= 0x0610 && codePoint <= 0x061a) || // Arabic marks (honorifics, small high marks)
    (codePoint >= 0x064b && codePoint <= 0x065f) || // tashkeel: fatha/damma/kasra/shadda/sukun…
    codePoint === 0x0670 || // superscript alef
    (codePoint >= 0x06d6 && codePoint <= 0x06ed) || // Quranic annotation / small marks
    codePoint === 0x0640 || // tatweel (kashida) — a pure joining stroke
    codePoint === 0x0621 || // hamza alone (non-joining)
    codePoint === 0x0622 ||
    codePoint === 0x0623 ||
    codePoint === 0x0625 ||
    codePoint === 0x0627 || // alef + hamza/madda variants
    (codePoint >= 0x0671 && codePoint <= 0x0675) || // alef wasla / high-hamza alef forms
    codePoint === 0x0639 ||
    codePoint === 0x063a ||
    codePoint === 0x06a0 ||
    codePoint === 0x06fc || // ayn/ghayn
    codePoint === 0x0645 || // meem
    codePoint === 0x0647 ||
    (codePoint >= 0x06c0 && codePoint <= 0x06c3) ||
    codePoint === 0x06ff || // heh forms
    codePoint === 0x060c ||
    codePoint === 0x061b ||
    codePoint === 0x061f // Arabic comma/semicolon/question mark
  )
}

/**
 * Wide tier: the seen/sheen and sad/dad letter families, whose medial forms still carry
 * pronounced teeth/loop geometry. Measured (isolated-form `hmtx`): seen/sheen 1209/1000 em,
 * sad/dad 1306/1000 em — roughly double every other letter's isolated width, so even a
 * medial-form discount leaves them the widest tier.
 */
function isArabicWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x0633 && codePoint <= 0x0634) ||
    (codePoint >= 0x069a && codePoint <= 0x069c) ||
    codePoint === 0x06fa || // seen/sheen
    (codePoint >= 0x0635 && codePoint <= 0x0636) ||
    (codePoint >= 0x069d && codePoint <= 0x069e) ||
    codePoint === 0x06fb // sad/dad
  )
}

/** One Arabic-script character's tier width, in em. Every other Arabic letter is the medium tier. */
function arabicCharWidthEm(ch: string): number {
  const codePoint = ch.codePointAt(0) ?? 0
  if (isArabicNarrow(codePoint)) return ARABIC_NARROW_EM
  if (isArabicWide(codePoint)) return ARABIC_WIDE_EM
  return ARABIC_MEDIUM_EM
}

/** Relative glyph width in em, for one character, at the given weight. */
function charWidthEm(ch: string, weight: ArisTextWeight): number {
  const table = weight === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  const afmWidth = table[ch]
  if (afmWidth !== undefined) return afmWidth / AFM_UNITS_PER_EM
  if (/\p{Script=Arabic}/u.test(ch)) return arabicCharWidthEm(ch)
  // Any other non-Latin, non-Arabic glyph (rare on AnimalWF's sheets): a reasonable
  // middle-of-the-road estimate rather than a per-glyph guess.
  return 0.5
}

/**
 * Deterministic width estimate in px for `text` at `sizePx` and `weight` (default `'regular'` —
 * every pre-existing caller that does not pass a weight keeps measuring against the Helvetica
 * table, unchanged). Never calls into DOM/canvas.
 */
export function measureTextWidth(
  text: string,
  sizePx: number,
  weight: ArisTextWeight = 'regular'
): number {
  let widthEm = 0
  for (const ch of text) {
    widthEm += charWidthEm(ch, weight)
  }
  return widthEm * sizePx
}

function splitHardLines(text: string): readonly string[] {
  return text.split(/\r\n|\r|\n/)
}

/** Greedily wraps a single hard line of text to `maxWidthPx`, breaking on whitespace. */
function wrapSingleLine(
  line: string,
  maxWidthPx: number,
  sizePx: number,
  weight: ArisTextWeight
): string[] {
  if (line === '') return ['']
  const words = line.split(/(\s+)/).filter((token) => token !== '')
  const lines: string[] = []
  let current = ''
  let currentWidth = 0

  for (const word of words) {
    const wordWidth = measureTextWidth(word, sizePx, weight)
    if (current !== '' && currentWidth + wordWidth > maxWidthPx) {
      lines.push(current.trimEnd())
      current = word.trimStart()
      currentWidth = measureTextWidth(current, sizePx, weight)
      continue
    }
    if (wordWidth > maxWidthPx && word.trim() !== '') {
      // A single word is wider than the box: hard-break it by character.
      if (current !== '') {
        lines.push(current.trimEnd())
        current = ''
        currentWidth = 0
      }
      let chunk = ''
      let chunkWidth = 0
      for (const ch of word) {
        const chWidth = measureTextWidth(ch, sizePx, weight)
        if (chunkWidth + chWidth > maxWidthPx && chunk !== '') {
          lines.push(chunk)
          chunk = ''
          chunkWidth = 0
        }
        chunk += ch
        chunkWidth += chWidth
      }
      current = chunk
      currentWidth = chunkWidth
      continue
    }
    current += word
    currentWidth += wordWidth
  }
  if (current !== '' || lines.length === 0) {
    lines.push(current.trimEnd())
  }
  return lines
}

export interface TextWrapResult {
  readonly lines: readonly RenderTextLine[]
  readonly wrapped: boolean
}

/**
 * Wraps `text` to `maxWidthPx` (or leaves it as one line per hard break when `maxWidthPx` is
 * `null`, meaning the source placed no width constraint on this text). `weight` selects the
 * Helvetica advance table (default `'regular'`, so every pre-existing caller is unchanged).
 */
export function wrapText(
  text: string,
  maxWidthPx: number | null,
  sizePx: number,
  weight: ArisTextWeight = 'regular'
): TextWrapResult {
  const hardLines = splitHardLines(text)
  const wrappedLines: string[] = []
  let anyWrapped = hardLines.length > 1
  for (const hardLine of hardLines) {
    if (maxWidthPx === null) {
      wrappedLines.push(hardLine)
      continue
    }
    const pieces = wrapSingleLine(hardLine, maxWidthPx, sizePx, weight)
    if (pieces.length > 1) anyWrapped = true
    wrappedLines.push(...pieces)
  }
  return {
    lines: wrappedLines.map((lineText) => ({
      text: lineText,
      width: measureTextWidth(lineText, sizePx, weight)
    })),
    wrapped: anyWrapped
  }
}

/** Builds the `text-wrap-difference` finding for text whose layout required a wrap decision. */
export function buildTextWrapFinding(
  wrapped: boolean,
  identity: {
    readonly modelId: string | null
    readonly elementId: string | null
    readonly sourceId: string | null
  }
): ArisRenderFidelityFinding | null {
  if (!wrapped) return null
  return {
    kind: 'text-wrap-difference',
    messageKey: 'aris.fidelity.textWrapDifference',
    modelId: identity.modelId,
    elementId: identity.elementId,
    sourceId: identity.sourceId,
    params: {}
  }
}
