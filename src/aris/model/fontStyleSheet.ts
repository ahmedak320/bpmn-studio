/**
 * `FontStyleSheet` resolution (plan Wave 6, V8 — typography).
 *
 * A `<FontStyleSheet>` carries one `<FontNode>` per locale; each node is a
 * Windows `LOGFONT` serialization: `FaceName`, a negative `Height`, `Weight`,
 * `Italic` and a COLORREF `Color`. The semantic index (`src/aris/source/`)
 * parses those records verbatim; this module turns them into the working
 * style catalog's font entries so every text consumer — occurrence captions,
 * connection labels, free text, header labels, RACI letters, numbering —
 * renders at the source's size, weight and colour instead of a blanket
 * 12-unit fallback.
 *
 * ## The size transform
 *
 * `Height="-13"` is a negative `LOGFONT.lfHeight`: by Windows convention the
 * magnitude is the font's em height in *points* (a device-independent logical
 * unit), so `abs(height)` is the point size directly. Canvas coordinates are
 * AML units (tenths of a millimetre), and the plan's own print projection is
 * `points = amlUnits × 72 / 254` at `PrintScale=100`, so the canvas font size
 * is `abs(height) × 254 / 72`.
 *
 * Calibrated against the paired AnimalWF PDFs: at that transform a `-10`
 * English node is 35.278 canvas units, which puts a function caption's
 * cap-height at ~25 units and its single-space line pitch at ~40.7 units —
 * the exact ratios the reference pages show between the 3-line "Login to
 * TAMM…" caption and its 670×240 card (and the explicit
 * `<SizeElement Value="10">` on the same values cross-checks it). A 96-DPI
 * reading of `lfHeight` would land at 26.5 units — measurably too small.
 */

import { localeLang } from '../../library/amlParse'
import type { ArisStyleCatalog, ArisStyleFontNode } from './types'

/** Canvas units (tenths of a millimetre) in one typographic point, at PrintScale 100. */
export const ARIS_MODEL_UNITS_PER_POINT = 254 / 72

/**
 * A negative `LOGFONT.lfHeight` as a canvas-unit em size, `null` for an
 * unusable value. Non-negative heights are taken at their magnitude as well:
 * a positive `lfHeight` is the cell height (em plus internal leading), which
 * is the closest available reading of the same intent.
 */
export function arisLogicalHeightToFontSize(height: number | null | undefined): number | null {
  if (typeof height !== 'number' || !Number.isFinite(height) || height === 0) return null
  return Math.round(Math.abs(height) * ARIS_MODEL_UNITS_PER_POINT * 1000) / 1000
}

/** A point size (e.g. a `<SizeElement Value="10">` run override) as canvas units. */
export function arisPointsToFontSize(points: number): number {
  return Math.round(points * ARIS_MODEL_UNITS_PER_POINT * 1000) / 1000
}

/**
 * A source face name as a CSS `font-family` stack.
 *
 * The faces the AnimalWF export names are pinned to metric-compatible web
 * stacks so layout is deterministic across engines (plan §"Geometry, labels,
 * and print projection": "Bundle or pin metrically compatible fonts"). An
 * unknown face is passed through with a generic fallback appended — the name
 * is source evidence and dropping it would make a genuinely missing font
 * invisible, while the generic tail keeps the canvas legible.
 */
export function arisFontFaceToCssFamily(faceName: string | null | undefined): string | null {
  const trimmed = faceName?.trim() ?? ''
  if (trimmed === '') return null
  switch (trimmed.toLowerCase()) {
    case 'arial':
      return 'Arial, Helvetica, sans-serif'
    case 'times new roman':
      return '"Times New Roman", Times, serif'
    case 'calibri':
      return 'Calibri, "Segoe UI", sans-serif'
    case 'tahoma':
      return 'Tahoma, Geneva, sans-serif'
    case 'segoe ui':
      return '"Segoe UI", Tahoma, sans-serif'
    case 'sansserif':
    case 'sans-serif':
      return 'sans-serif'
    case 'simplified arabic':
      // Proprietary Windows face with no open-web equivalent; Noto Sans Arabic
      // is the metric-honest stand-in (see src/aris/renderer/font.ts).
      return '"Noto Sans Arabic", Arial, sans-serif'
    default:
      return `"${trimmed}", sans-serif`
  }
}

/** The narrow structural view of a parsed `<FontNode>`/`<Font>` record this resolver reads. */
export interface ArisSourceFontNodeLike {
  readonly parsed: {
    readonly ownerSourceId: string | null
    readonly localeId: string | null
    readonly faceName: string | null
    readonly height: number | null
    readonly weight: number | null
    readonly italic: string | null
    readonly color: string | null
  }
}

function yesNoFlag(value: string | null | undefined): boolean {
  return (value ?? '').trim().toUpperCase() === 'YES'
}

/**
 * Resolve every `<FontNode>` of one font style sheet into working-model font
 * entries. The returned list keeps the source's per-locale granularity: the
 * AnimalWF sheets size English text at `-10` and Arabic at `-13`, so a single
 * scalar per sheet cannot represent both.
 */
export function resolveFontStyleSheetNodes(
  fontStyleSheetId: string,
  fonts: readonly ArisSourceFontNodeLike[]
): readonly ArisStyleFontNode[] {
  const nodes: ArisStyleFontNode[] = []
  for (const font of fonts) {
    if (font.parsed.ownerSourceId !== fontStyleSheetId) continue
    nodes.push(
      Object.freeze({
        localeId: font.parsed.localeId,
        fontFamily: arisFontFaceToCssFamily(font.parsed.faceName),
        fontSize: arisLogicalHeightToFontSize(font.parsed.height),
        fontWeight:
          typeof font.parsed.weight === 'number' && Number.isFinite(font.parsed.weight)
            ? String(font.parsed.weight)
            : null,
        fontStyle: yesNoFlag(font.parsed.italic) ? 'italic' : null,
        textColor: font.parsed.color
      })
    )
  }
  return Object.freeze(nodes)
}

/**
 * The node a sheet's scalar catalog fields resolve from: the English node
 * when the sheet has one (the canvas default locale is English), otherwise
 * the first node. Per-locale consumers read `fontNodes` directly instead.
 */
export function primaryFontNode(
  nodes: readonly ArisStyleFontNode[]
): ArisStyleFontNode | undefined {
  return nodes.find((node) => localeLang(node.localeId ?? undefined) === 'en') ?? nodes[0]
}

/**
 * Locale-aware catalog lookup: the sheet's node for `localeId` (exact match
 * first, then a language match, then the sheet's primary node, then the
 * scalar fields an older document resolved before per-locale nodes existed).
 * `null` when the sheet is unknown — the caller keeps its own fallback rather
 * than inventing a face the source never named.
 */
export function resolveCatalogFont(
  catalog: ArisStyleCatalog,
  fontStyleSheetId: string | null | undefined,
  localeId: string | null | undefined
): ArisStyleFontNode | null {
  if (!fontStyleSheetId) return null
  const style = catalog.styles.get(fontStyleSheetId)
  if (!style) return null
  const nodes = style.fontNodes ?? []
  const wantLang = localeId ? localeLang(localeId) : undefined
  const node =
    (localeId ? nodes.find((entry) => entry.localeId === localeId) : undefined) ??
    (wantLang
      ? nodes.find((entry) => localeLang(entry.localeId ?? undefined) === wantLang)
      : undefined) ??
    primaryFontNode(nodes)
  if (node) return node
  return Object.freeze({
    localeId: null,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: null,
    textColor: style.textColor
  })
}
