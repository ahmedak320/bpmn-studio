/**
 * ARIS font mapping — Plan Section 12.1/12.3.
 *
 * Real encodings observed in the AnimalWF export: `FontNode`/`Font`/`LogFont` height is a
 * negative Windows `LOGFONT.lfHeight` (e.g. `Height="-13"`) — by Windows convention the
 * magnitude is the glyph cell height in device units, excluding internal leading. This module
 * treats `abs(height)` as the CSS pixel font size (the export's device space maps 1:1 to model
 * logical units elsewhere, so no additional DPI conversion is applied). `Weight="400"` is
 * already a CSS-compatible numeric font-weight. `Italic`/`Underline`/`StrikeOut` are `"YES"` /
 * `"NO"` strings.
 *
 * Face names seen: `Arial`, `Calibri`, `Times New Roman`, `SansSerif`, and — critically —
 * `Simplified Arabic`, a proprietary Windows font with no open-web equivalent. Per Section 20.2,
 * a missing proprietary font is an explicit blocker: it is never silently substituted without a
 * `missing-font` finding — proven by the fixtures in `font.test.ts` and `fidelity.test.ts`.
 *
 * Honest note on the AnimalWF real-data tally (`animalWfRealData.test.ts`): in that export every
 * element/connection/free-text name with an Arabic value also carries an English value, and
 * `buildRenderModel.ts` prefers English when both are present, so `Simplified Arabic` is never
 * the font actually selected for rendering. The only Arabic-*only*-named source records are
 * Lanes, and the ARIS schema gives `Lane` no `AttrOcc`/`FontStyleSheet` reference to resolve a
 * font from at all — so the real-data missing-font tally is honestly 0 for this export, not a
 * bug in this module.
 */

import { containsArabicScript, resolveTextDirection } from './bidi'
import type { RenderSourceFontParsed } from './input'
import type { ArisRenderFidelityFinding, ResolvedFont } from './types'

const DEFAULT_SIZE_PX = 12
const DEFAULT_WEIGHT = 400

/** Faces the renderer can display faithfully with a native or near-identical web font. */
const SAFE_LATIN_FONTS: Readonly<Record<string, string>> = Object.freeze({
  arial: 'Arial, Helvetica, sans-serif',
  'times new roman': '"Times New Roman", Times, serif',
  calibri: 'Calibri, "Segoe UI", sans-serif',
  tahoma: 'Tahoma, Geneva, sans-serif',
  'segoe ui': '"Segoe UI", Tahoma, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  sansserif: 'sans-serif',
  'sans-serif': 'sans-serif',
  serif: 'serif'
})

const SAFE_ARABIC_FONTS: Readonly<Record<string, string>> = Object.freeze({
  arial: '"Noto Sans Arabic", Arial, sans-serif',
  tahoma: '"Noto Sans Arabic", Tahoma, sans-serif',
  'segoe ui': '"Noto Sans Arabic", "Segoe UI", sans-serif'
})

const FALLBACK_LATIN_STACK = 'Arial, Helvetica, sans-serif'
const FALLBACK_ARABIC_STACK = '"Noto Sans Arabic", Arial, sans-serif'

function normalizeFaceKey(faceName: string): string {
  return faceName.trim().toLowerCase()
}

export interface FontResolution {
  readonly font: ResolvedFont
  readonly findings: readonly ArisRenderFidelityFinding[]
}

/**
 * Resolves a `Font`/`FontNode`/`LogFont` record to a CSS-safe font plus text direction for
 * `sampleText`. A face name outside the OrbitPM safe-font allowlist produces a `missing-font`
 * fidelity finding and falls back to a script-appropriate generic stack — never a silent swap
 * to an unrelated real face.
 */
export function resolveFont(
  source: RenderSourceFontParsed | null,
  sampleText: string,
  identity: {
    readonly modelId: string | null
    readonly elementId: string | null
    readonly sourceId: string | null
  }
): FontResolution {
  const locale = source?.locale
  const isArabicScript = containsArabicScript(sampleText) || locale === 'ar'
  const direction = resolveTextDirection(sampleText, locale)
  const faceName = source?.faceName?.trim() || null
  const findings: ArisRenderFidelityFinding[] = []

  let fontFamily: string
  let faceAvailable: boolean
  if (faceName) {
    const key = normalizeFaceKey(faceName)
    const table = isArabicScript ? SAFE_ARABIC_FONTS : SAFE_LATIN_FONTS
    const mapped = table[key] ?? (isArabicScript ? undefined : SAFE_LATIN_FONTS[key])
    if (mapped) {
      fontFamily = mapped
      faceAvailable = true
    } else {
      fontFamily = isArabicScript ? FALLBACK_ARABIC_STACK : FALLBACK_LATIN_STACK
      faceAvailable = false
      findings.push({
        kind: 'missing-font',
        messageKey: 'aris.fidelity.missingFont',
        modelId: identity.modelId,
        elementId: identity.elementId,
        sourceId: identity.sourceId,
        params: { faceName }
      })
    }
  } else {
    fontFamily = isArabicScript ? FALLBACK_ARABIC_STACK : FALLBACK_LATIN_STACK
    faceAvailable = true
  }

  const sizePx = source?.height ? Math.max(1, Math.abs(source.height)) : DEFAULT_SIZE_PX
  const weight = source?.weight ?? DEFAULT_WEIGHT
  const italic = source?.italic === 'YES'
  const underline = source?.underline === 'YES'
  const strikeOut = source?.strikeOut === 'YES'
  const color = source?.color === undefined ? undefined : arisFontColorToCss(source.color)

  return {
    font: {
      fontFamily,
      requestedFaceName: faceName,
      faceAvailable,
      sizePx,
      weight,
      italic,
      underline,
      strikeOut,
      color,
      locale,
      direction
    },
    findings
  }
}

function arisFontColorToCss(raw: string | null): string | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-1') return undefined
  const value = Number.parseInt(trimmed, 16)
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) return undefined
  return `#${Math.min(value, 0xffffff).toString(16).padStart(6, '0')}`
}
