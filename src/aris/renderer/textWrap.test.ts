import { describe, expect, it } from 'vitest'

import { buildTextWrapFinding, measureTextWidth, wrapText } from './textWrap'

describe('wrapText', () => {
  it('keeps short text on one line and reports no wrap', () => {
    const { lines, wrapped } = wrapText('Owner', 200, 13)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Owner')
    expect(wrapped).toBe(false)
  })

  it('wraps long text across multiple lines deterministically', () => {
    const first = wrapText('Register and validate the animal owner application form', 120, 13)
    const second = wrapText('Register and validate the animal owner application form', 120, 13)
    expect(first.lines.length).toBeGreaterThan(1)
    expect(first.wrapped).toBe(true)
    expect(first.lines.map((l) => l.text)).toEqual(second.lines.map((l) => l.text))
  })

  it('treats a null max width as unconstrained (one line per hard break)', () => {
    const { lines, wrapped } = wrapText(
      'A very long line that would otherwise wrap many times over',
      null,
      13
    )
    expect(lines).toHaveLength(1)
    expect(wrapped).toBe(false)
  })

  it('respects explicit hard line breaks independently of width', () => {
    const { lines, wrapped } = wrapText('Line one\nLine two', 500, 13)
    expect(lines.map((l) => l.text)).toEqual(['Line one', 'Line two'])
    expect(wrapped).toBe(true)
  })

  it('hard-breaks a single word wider than the box', () => {
    const { lines } = wrapText('Supercalifragilisticexpialidocious', 40, 13)
    expect(lines.length).toBeGreaterThan(1)
  })

  it('measures width monotonically with text length', () => {
    expect(measureTextWidth('mm', 12)).toBeGreaterThan(measureTextWidth('m', 12))
    expect(measureTextWidth('', 12)).toBe(0)
  })
})

describe('buildTextWrapFinding', () => {
  it('emits a finding only when wrapping actually occurred', () => {
    const identity = { modelId: 'Model.1', elementId: 'ObjOcc.1', sourceId: 'ObjOcc.1' }
    expect(buildTextWrapFinding(false, identity)).toBeNull()
    const finding = buildTextWrapFinding(true, identity)
    expect(finding?.kind).toBe('text-wrap-difference')
    expect(finding?.elementId).toBe('ObjOcc.1')
  })
})

// --- Helvetica AFM fidelity (plan §6.2, fixplan §6.2) ------------------------
//
// `arisLogicalHeightToFontSize(-10)` (fontStyleSheet.ts) is 35.278 canvas units — the size the
// AnimalWF start-event caption (and every −10 English body-text run) measures at. This is the
// canonical fixture value already used throughout typography.test.ts.
const EN_MINUS_10_SIZE = 35.278

describe('measureTextWidth (real Helvetica AFM metrics, fixplan §6.2)', () => {
  // "registration Service" is the start-event caption line the fixplan measured to motivate this
  // table. The coarse em-class table this table replaces (lowercase 0.5, uppercase 0.68, narrow
  // 0.28…) measures this string at 328.09 canvas units at the −10 English size — a +12.3%
  // overshoot against the reference PDF's own measured text-layer run — which wrapped the start
  // event's caption one line early (4 lines vs. the original's 3; fixplan §6.2/§0).
  it('measures "registration Service" via the exact AFM sum (regression guard on the table)', () => {
    // r333 e556 g556 i222 s500 t278 r333 a556 t278 i222 o556 n556 ' '278 S667 e556 r333 v500
    // i222 c500 e556 = 8558 (‰ em) → 8.558 em × 35.278 px = 301.909… canvas units.
    expect(measureTextWidth('registration Service', EN_MINUS_10_SIZE)).toBeCloseTo(301.909, 3)
  })

  it('lands far closer to the reference PDF than the coarse table it replaces', () => {
    const width = measureTextWidth('registration Service', EN_MINUS_10_SIZE)

    // Reference: Register_Animal_Owner_Profile_Draft03.pdf, page 1, the "registration Service"
    // span — ArialMT @ 4.2pt, text-layer bbox width 34.78654pt (pymupdf `get_text("dict")`).
    // Canvas units = pt / 0.11906 (fixplan §0's print-mapping constant at this document's 42%
    // PrintScale) ≈ 292.18.
    const REFERENCE_PDF_MEASURED_WIDTH = 292.18
    // The coarse table's estimate for the same string/size (see file history / fixplan §6.2).
    const OLD_TABLE_WIDTH = 328.09

    const relativeError =
      Math.abs(width - REFERENCE_PDF_MEASURED_WIDTH) / REFERENCE_PDF_MEASURED_WIDTH
    const oldRelativeError =
      Math.abs(OLD_TABLE_WIDTH - REFERENCE_PDF_MEASURED_WIDTH) / REFERENCE_PDF_MEASURED_WIDTH

    // NOTE on the fixplan's illustrative "±2% of 291": this table computes an *un-kerned*
    // advance-width sum. The reference PDF's run is real GDI output with pair kerning applied —
    // confirmed directly by walking the PDF's own embedded-font glyph stream, where each
    // inter-glyph advance is a *non-uniform*, pair-specific fraction of this table's per-char
    // widths (e.g. 's'→'t' has zero adjustment, 'a'→'t' is tightened ~7.5%, the space before 'S'
    // is *widened* ~2.8% — a pattern only kerning produces). Every individual width in this
    // table was independently confirmed against AnimalWF's own embedded ArialMT/Arial-BoldMT
    // `hmtx` tables, so the residual gap is kerning, not a mis-measured table. Modeling per-pair
    // kerning is out of scope for this deterministic, no-DOM estimator (see the file header), so
    // ±2% of the kerned reference isn't reachable by construction — this asserts the real,
    // substantial improvement that *is* achieved instead (+12.3% overshoot → +3.3%).
    expect(relativeError).toBeLessThan(0.04)
    expect(relativeError).toBeLessThan(oldRelativeError)
    expect(width).toBeLessThan(OLD_TABLE_WIDTH)
  })
})

describe('measureTextWidth weight parameter', () => {
  it('defaults to the regular Helvetica table when weight is omitted', () => {
    expect(measureTextWidth('Service', EN_MINUS_10_SIZE)).toBe(
      measureTextWidth('Service', EN_MINUS_10_SIZE, 'regular')
    )
  })

  it('measures wider with the bold table (function captions/numbering are bold)', () => {
    const regular = measureTextWidth('Service', EN_MINUS_10_SIZE, 'regular')
    const bold = measureTextWidth('Service', EN_MINUS_10_SIZE, 'bold')
    expect(bold).toBeGreaterThan(regular)
  })
})

describe('measureTextWidth Arabic tiers (fixplan §3.6)', () => {
  it('measures narrow, medium and wide Arabic letters distinctly instead of a flat estimate', () => {
    const narrow = measureTextWidth('م', 40) // meem — narrow tier (~0.28 em)
    const medium = measureTextWidth('ت', 40) // teh — medium tier (~0.50 em, the default)
    const wide = measureTextWidth('س', 40) // seen — wide tier (~0.62 em)
    expect(narrow).toBeLessThan(medium)
    expect(medium).toBeLessThan(wide)
  })

  it('gives combining diacritics and tatweel the narrow floor rather than a flat 0.55', () => {
    const fatha = measureTextWidth('َ', 40) // ARABIC FATHA (combining diacritic)
    const tatweel = measureTextWidth('ـ', 40) // ARABIC TATWEEL (joining stroke)
    const OLD_FLAT_ARABIC_WIDTH = 0.55 * 40
    expect(fatha).toBeLessThan(OLD_FLAT_ARABIC_WIDTH)
    expect(tatweel).toBeLessThan(OLD_FLAT_ARABIC_WIDTH)
  })
})
