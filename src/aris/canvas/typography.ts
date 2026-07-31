/**
 * Canvas typography (plan Wave 6, V8 — typography, text layout, bidi/RTL).
 *
 * Everything the renderer needs to paint text the way the paired PDFs show
 * it, in one deterministic place:
 *
 * - **Font resolution.** `FontStyleSheet` sizes/families/weights/colours
 *   resolve from the working style catalog (see
 *   `src/aris/model/fontStyleSheet.ts`), locale-aware, and the inline styled
 *   runs of the displayed attribute value (`<Bold/>`, `<Font>`,
 *   `<SizeElement>`) refine them — a function's `AT_NAME` is bold in the
 *   source, so its caption is bold on canvas.
 * - **Wrapping and centering.** Long captions wrap greedily inside their box
 *   and the line block is vertically centred, matching the 2–3 line
 *   function/event captions in the reference PDFs. Measurement uses the
 *   deterministic em-width table (`src/aris/renderer/textWrap.ts`) — no DOM
 *   measurement, so every engine wraps identically.
 * - **Locale of the displayed value.** The font node and the styled runs are
 *   resolved for the locale of the value actually shown (an Arabic fallback
 *   caption on an English canvas still gets the Arabic `-13` node), which is
 *   how ARIS itself picks the FontNode.
 *
 * Value-level run resolution is a documented approximation: a value whose
 * paragraphs carry *different* inline sizes (the requirement cards mix Arial
 * 8 with a Times 7 bullet dash) resolves to the first paragraph's overrides.
 * The dominant cases — whole-value `<Bold/>` names, sized header labels —
 * are exact.
 */

import { localeLang } from '../../library/amlParse'
import {
  arisFontFaceToCssFamily,
  arisPointsToFontSize,
  resolveCatalogFont
} from '../model/fontStyleSheet'
import type { ArisLocalizedValue, ArisWorkingDocument, ArisStyleFontNode } from '../model/types'
import { measureTextWidth, type ArisTextWeight } from '../renderer/textWrap'
import type { ArisLabelFont } from './elements'

/**
 * Em-height of one wrapped line as a multiple of the font size. GDI single
 * spacing is the font's line height plus external leading (≈1.15em for
 * Arial); the paired PDFs show exactly that pitch between wrapped caption
 * lines.
 */
export const ARIS_LABEL_LINE_HEIGHT = 1.15

/** A label font with every field the canvas can paint, `null` when unknown. */
export interface ArisResolvedLabelFont {
  readonly fontFamily: string | null
  readonly fontSize: number | null
  readonly fontWeight: string | null
  readonly fontStyle: string | null
  readonly textColor: string | null
}

/** The text content one `<tspan>` paints, plus its anchor point. */
export interface ArisLabelLine {
  readonly text: string
  readonly x: number
  readonly y: number
}

export interface ArisLabelLayout {
  readonly lines: readonly ArisLabelLine[]
  readonly lineHeight: number
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * The explicit paragraphs of a source value. AML styled text serializes
 * paragraph breaks as literal `\r\n` runs padded with tabs (the XML
 * whitespace between styled elements), so each piece is trimmed and empty
 * paragraphs — the trailing blank paragraphs the export loves
 * (`"E-mail\r\n\t\t\t…"`) — are dropped.
 */
export function normalizeLabelParagraphs(text: string): readonly string[] {
  return Object.freeze(
    text
      .split(/\r\n|\r|\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
  )
}

/**
 * `text` as display lines: explicit paragraphs preserved, each greedily
 * wrapped to `maxWidth` (`null` = no width constraint) at `fontSize` with the
 * deterministic Helvetica/Arabic-tier width table (`src/aris/renderer/textWrap.ts`).
 *
 * `weight` selects the Latin advance table (default `'regular'`, so every
 * pre-existing caller keeps measuring exactly as before); pass `'bold'` for a
 * caption whose resolved font is bold (see `labelFontWeight`) so its wrap
 * decisions measure against the Helvetica-Bold table instead.
 */
export function wrapLabelLines(
  text: string,
  maxWidth: number | null,
  fontSize: number,
  weight: ArisTextWeight = 'regular'
): readonly string[] {
  const paragraphs = normalizeLabelParagraphs(text)
  if (paragraphs.length === 0) return Object.freeze([''])
  const width = maxWidth !== null && Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : null
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraphLines(paragraph, width, fontSize, weight))
  }
  return Object.freeze(lines)
}

function wrapParagraphLines(
  paragraph: string,
  maxWidth: number | null,
  fontSize: number,
  weight: ArisTextWeight
): readonly string[] {
  if (maxWidth === null) return Object.freeze([paragraph])
  if (measureTextWidth(paragraph, fontSize, weight) <= maxWidth) return Object.freeze([paragraph])
  const words = paragraph.split(/\s+/).filter((word) => word.length > 0)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (current !== '' && measureTextWidth(candidate, fontSize, weight) > maxWidth) {
      lines.push(current)
      current = word
      continue
    }
    current = candidate
  }
  if (current !== '') lines.push(current)
  return Object.freeze(lines.length === 0 ? [''] : lines)
}

/**
 * A resolved CSS `font-weight` (`'700'`, `'bold'`, a numeric string, `null`)
 * as the wrap engine's two-tier `ArisTextWeight`. `>=600` (the CSS
 * "semi-bold and up" convention) reads as bold, matching how `applyRunOverrides`
 * emits `'700'` for a `<Bold/>` run and a resolved sheet's own numeric
 * `FontNode Weight` (AnimalWF uses `400`/`700`).
 */
export function labelFontWeight(fontWeight: string | null | undefined): ArisTextWeight {
  if (!fontWeight) return 'regular'
  const normalized = fontWeight.trim().toLowerCase()
  if (normalized === 'bold') return 'bold'
  const numeric = Number.parseInt(normalized, 10)
  return Number.isFinite(numeric) && numeric >= 600 ? 'bold' : 'regular'
}

export type ArisLabelAnchor = 'start' | 'middle' | 'end'

function anchorX(anchor: ArisLabelAnchor, box: ArisLabelBox): number {
  switch (anchor) {
    case 'start':
      return box.x
    case 'end':
      return box.x + box.width
    default:
      return box.x + box.width / 2
  }
}

export interface ArisLabelBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Vertically centre the line block in `box` and anchor each line horizontally
 * per `anchor`. Line `y` is the line's own centreline (the renderer paints
 * with `dominant-baseline: middle`).
 */
export function layoutLabelLines(
  lines: readonly string[],
  box: ArisLabelBox,
  fontSize: number,
  anchor: ArisLabelAnchor = 'middle'
): ArisLabelLayout {
  const lineHeight = round(fontSize * ARIS_LABEL_LINE_HEIGHT)
  const centerY = box.y + box.height / 2
  const x = round(anchorX(anchor, box))
  return Object.freeze({
    lineHeight,
    lines: Object.freeze(
      lines.map((text, index) =>
        Object.freeze({
          text,
          x,
          y: round(centerY + (index - (lines.length - 1) / 2) * lineHeight)
        })
      )
    )
  })
}

/**
 * Anchor the line block at a point instead of a box — the
 * `Alignment`-anchored auto-size placement of an unsized free-text note,
 * whose `Position` is the text block's anchor (its centre for AnimalWF's
 * all-CENTER notes, so the caller pairs this with `text-anchor: middle`;
 * LEFT/RIGHT notes keep the same point with their own anchor).
 */
export function layoutAnchoredLines(
  lines: readonly string[],
  point: { readonly x: number; readonly y: number },
  fontSize: number
): ArisLabelLayout {
  const lineHeight = round(fontSize * ARIS_LABEL_LINE_HEIGHT)
  return Object.freeze({
    lineHeight,
    lines: Object.freeze(
      lines.map((text, index) =>
        Object.freeze({
          text,
          x: round(point.x),
          y: round(point.y + (index - (lines.length - 1) / 2) * lineHeight)
        })
      )
    )
  })
}

// --- styled-run overrides ----------------------------------------------------

/** The narrow view of one styled-run record (`src/aris/source` keeps the full one). */
export interface ArisStyledRunLike {
  readonly elementName: string
  readonly rawAttributes: Readonly<Record<string, string>>
  readonly text?: string
}

export interface ArisRunOverrides {
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strikeOut: boolean
  readonly faceName: string | null
  readonly sizePoints: number | null
}

/**
 * The inline formatting one attribute value declares, rolled up to value
 * level: `<Bold/>`/`<Italic/>`/`<Underline/>`/`<StrikeOut/>` wrappers apply
 * to the whole value; the first `<Font Name="…">` and the first
 * `<SizeElement Value="…">` (a point size) win. `null` when the value
 * declares no formatting at all.
 */
export function styledRunOverrides(
  runs: readonly ArisStyledRunLike[] | null | undefined
): ArisRunOverrides | null {
  if (!runs || runs.length === 0) return null
  let bold = false
  let italic = false
  let underline = false
  let strikeOut = false
  let faceName: string | null = null
  let sizePoints: number | null = null
  for (const run of runs) {
    switch (run.elementName) {
      case 'Bold':
        bold = true
        break
      case 'Italic':
        italic = true
        break
      case 'Underline':
        underline = true
        break
      case 'StrikeOut':
        strikeOut = true
        break
      case 'Font':
        if (faceName === null) {
          const name = run.rawAttributes['Name']?.trim()
          if (name) faceName = name
        }
        break
      case 'SizeElement':
        if (sizePoints === null) {
          const value = Number.parseFloat(run.rawAttributes['Value'] ?? '')
          if (Number.isFinite(value) && value > 0) sizePoints = value
        }
        break
      default:
        break
    }
  }
  if (!bold && !italic && !underline && !strikeOut && faceName === null && sizePoints === null) {
    return null
  }
  return Object.freeze({ bold, italic, underline, strikeOut, faceName, sizePoints })
}

/** Layer inline run overrides over a `FontStyleSheet`-resolved base font. */
export function applyRunOverrides(
  base: ArisResolvedLabelFont | null,
  overrides: ArisRunOverrides | null
): ArisResolvedLabelFont | null {
  if (overrides === null) return base
  return Object.freeze({
    fontFamily: arisFontFaceToCssFamily(overrides.faceName) ?? base?.fontFamily ?? null,
    fontSize:
      overrides.sizePoints !== null
        ? arisPointsToFontSize(overrides.sizePoints)
        : (base?.fontSize ?? null),
    fontWeight: overrides.bold ? '700' : (base?.fontWeight ?? null),
    fontStyle: overrides.italic ? 'italic' : (base?.fontStyle ?? null),
    textColor: base?.textColor ?? null
  })
}

// --- locale-aware resolution against the working document --------------------

/** The value the canvas displays for `value` at `localeId`, with the locale that supplied it. */
export function resolveLocalizedEntry(
  value: ArisLocalizedValue | null | undefined,
  localeId: string
): { readonly text: string; readonly localeId: string | null } | null {
  if (!value) return null
  const exact = value.values[localeId]
  if (typeof exact === 'string' && exact.length > 0) {
    return Object.freeze({ text: exact, localeId })
  }
  const wantLang = localeLang(localeId)
  if (wantLang) {
    for (const [key, text] of Object.entries(value.values)) {
      if (typeof text === 'string' && text.length > 0 && localeLang(key) === wantLang) {
        return Object.freeze({ text, localeId: key })
      }
    }
  }
  for (const [key, text] of Object.entries(value.values)) {
    if (typeof text === 'string' && text.length > 0) {
      return Object.freeze({ text, localeId: key })
    }
  }
  return null
}

/** The styled runs of one owner's attribute value in (approximately) `localeId`. */
function sourceAttributeRuns(
  document: ArisWorkingDocument,
  ownerSourceId: string | null | undefined,
  attributeType: string,
  localeId: string | null | undefined
): readonly ArisStyledRunLike[] {
  if (!ownerSourceId) return Object.freeze([])
  for (const attribute of document.sourceIndex.attributes) {
    if (attribute.parsed.ownerSourceId !== ownerSourceId) continue
    if (attribute.parsed.attributeType !== attributeType) continue
    const values = attribute.parsed.values as readonly {
      readonly localeId: string | null
      readonly runs?: readonly ArisStyledRunLike[]
    }[]
    const wantLang = localeId ? localeLang(localeId) : undefined
    const value =
      (localeId ? values.find((entry) => entry.localeId === localeId) : undefined) ??
      (wantLang
        ? values.find((entry) => localeLang(entry.localeId ?? undefined) === wantLang)
        : undefined) ??
      values.find((entry) => Array.isArray(entry.runs) && entry.runs.length > 0)
    if (value?.runs) return value.runs
  }
  return Object.freeze([])
}

function composeFont(
  base: ArisStyleFontNode | null,
  overrides: ArisRunOverrides | null
): ArisResolvedLabelFont | null {
  const resolved = applyRunOverrides(
    base === null
      ? null
      : Object.freeze({
          fontFamily: base.fontFamily,
          fontSize: base.fontSize,
          fontWeight: base.fontWeight,
          fontStyle: base.fontStyle,
          textColor: base.textColor
        }),
    overrides
  )
  if (resolved === null) return null
  if (
    resolved.fontFamily === null &&
    resolved.fontSize === null &&
    resolved.fontWeight === null &&
    resolved.fontStyle === null &&
    resolved.textColor === null
  ) {
    return null
  }
  return resolved
}

const AT_NAME = 'AT_NAME'

/**
 * The caption font of one object occurrence: the `AT_NAME` placement's
 * `FontStyleSheet` (falling back to the occurrence's own) resolved in the
 * locale of the displayed name, refined by the name value's inline runs.
 */
export function resolveOccurrenceCaptionFont(
  document: ArisWorkingDocument,
  modelId: string,
  occurrenceId: string,
  localeId: string
): ArisResolvedLabelFont | null {
  const model = document.models.get(modelId)
  const occurrence = model?.occurrences.find((entry) => entry.id === occurrenceId)
  if (!occurrence) return null
  const definition = document.objectDefinitions.get(occurrence.definitionId)
  const placement = occurrence.attributeOccurrences.find((entry) => entry.attributeType === AT_NAME)
  const fontStyleSheetId = placement?.fontStyleSheetId ?? occurrence.style.fontStyleSheetId
  const entry = resolveLocalizedEntry(definition?.names, localeId)
  const fontLocale = entry?.localeId ?? localeId
  const base = resolveCatalogFont(document.styleCatalog, fontStyleSheetId, fontLocale)
  return composeFont(
    base,
    styledRunOverrides(sourceAttributeRuns(document, definition?.id, AT_NAME, fontLocale))
  )
}

/**
 * The font of one non-`AT_NAME` attribute placement (the function `AT_ID` /
 * process-code numbering): the placement's `FontStyleSheet`, refined by the
 * stored attribute value's inline runs (the AnimalWF `01`/`02` numbers are
 * `<Bold/>`).
 */
export function resolveAttributePlacementFont(
  document: ArisWorkingDocument,
  modelId: string,
  occurrenceId: string,
  attributeType: string,
  localeId: string
): ArisResolvedLabelFont | null {
  const model = document.models.get(modelId)
  const occurrence = model?.occurrences.find((entry) => entry.id === occurrenceId)
  if (!occurrence) return null
  const placement = occurrence.attributeOccurrences.find(
    (entry) => entry.attributeType === attributeType
  )
  const fontStyleSheetId = placement?.fontStyleSheetId ?? occurrence.style.fontStyleSheetId
  const base = resolveCatalogFont(document.styleCatalog, fontStyleSheetId, localeId)
  // An occurrence-local value wins over the definition's, exactly as the
  // attribute-label text resolution does (canvasSync.resolveOccurrenceAttributeText).
  const runs = sourceAttributeRuns(document, occurrence.id, attributeType, localeId)
  const definitionRuns =
    runs.length > 0
      ? runs
      : sourceAttributeRuns(document, occurrence.definitionId, attributeType, localeId)
  return composeFont(base, styledRunOverrides(definitionRuns))
}

/**
 * The font of one free-text note: the `<FFTextOcc>`'s `FontStyleSheet` in the
 * locale of the displayed note text, refined by the note definition's inline
 * runs (the header labels are `<Bold/>` + `<SizeElement Value="10">`).
 */
export function resolveFreeTextFont(
  document: ArisWorkingDocument,
  modelId: string,
  freeTextId: string,
  localeId: string
): ArisResolvedLabelFont | null {
  const model = document.models.get(modelId)
  const note = model?.freeText.find((entry) => entry.id === freeTextId)
  if (!note) return null
  const entry = resolveLocalizedEntry(note.text, localeId)
  const fontLocale = entry?.localeId ?? localeId
  const base = resolveCatalogFont(document.styleCatalog, note.style.fontStyleSheetId, fontLocale)
  return composeFont(
    base,
    styledRunOverrides(sourceAttributeRuns(document, note.definitionId, AT_NAME, fontLocale))
  )
}

/**
 * The font of one connection label placement (relation text, RACI letter):
 * the placement's `FontStyleSheet` in the display locale. Connection label
 * text has no occurrence-local styled runs, so no run resolution here.
 */
export function resolveConnectionPlacementFont(
  document: ArisWorkingDocument,
  fontStyleSheetId: string | null,
  localeId: string
): ArisResolvedLabelFont | null {
  const base = resolveCatalogFont(document.styleCatalog, fontStyleSheetId, localeId)
  return composeFont(base, null)
}

/** Merge a document-resolved font over the business object's own (older sync path). */
export function preferResolvedFont(
  resolved: ArisResolvedLabelFont | null,
  fallback: ArisLabelFont | null | undefined
): ArisResolvedLabelFont | null {
  if (resolved === null) {
    return fallback === null || fallback === undefined
      ? null
      : Object.freeze({
          fontFamily: fallback.fontFamily,
          fontSize: fallback.fontSize,
          fontWeight: fallback.fontWeight,
          fontStyle: null,
          textColor: fallback.textColor
        })
  }
  return Object.freeze({
    fontFamily: resolved.fontFamily ?? fallback?.fontFamily ?? null,
    fontSize: resolved.fontSize ?? fallback?.fontSize ?? null,
    fontWeight: resolved.fontWeight ?? fallback?.fontWeight ?? null,
    fontStyle: resolved.fontStyle,
    textColor: resolved.textColor ?? fallback?.textColor ?? null
  })
}

/** Deterministic label width estimate, re-exported for the renderer's callers. */
export { measureTextWidth }
export type { ArisTextWeight }
