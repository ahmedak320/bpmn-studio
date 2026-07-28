/**
 * ARIS pen/brush/color mapping — Plan Section 12.1/12.3.
 *
 * Real encodings observed in the AnimalWF export (`../../../AnimalWF/ARISAMLExport.xml`,
 * read-only, never committed/copied — see the OrbitPM AI safety brief for this lane):
 *
 * - `Pen`/`Brush`/`FontNode` `Color`/`Color2` attributes are a *variable-length* lowercase hex
 *   string with no `#` prefix and no leading-zero padding — e.g. `Color="0"`, `Color="99"`,
 *   `Color="339900"`, `Color="d7c49d"`. This is what you get from serializing an unsigned
 *   integer with a naive `toString(16)`: the value is `0xRRGGBB` and short strings are the
 *   left-zero-padded-away high byte(s) (`"99"` == `0x000099`, i.e. blue, not `0x999900`).
 *   Byte order was confirmed empirically against known ARIS defaults: `Brush Color="b6dce9"`
 *   (a lane fill) reads as pale blue `#b6dce9` under RRGGBB, and as a nonsensical pale-tan under
 *   BGR — so this module treats the value as `0xRRGGBB`, left-pads to 6 hex digits, and emits
 *   `#rrggbb`.
 * - `Model.BackColor="-1"` is the Windows `CLR_NONE`-style sentinel for "no override" — it is
 *   not a color to parse, and does not produce a fidelity finding.
 * - `Brush BrushType="TRANSPARENT"` always has `Color="0"`; the brush renders as no fill
 *   regardless of the numeric color.
 * - `Pen Style="0"` (solid) is the only style value present in the AnimalWF export. The renderer
 *   still maps the full documented Windows `PS_*` pen-style enum (0 solid, 1 dash, 2 dot,
 *   3 dash-dot, 4 dash-dot-dot, 5 null/invisible) because ARIS exposes all of them in the
 *   authoring UI; anything outside that range is an unsupported pen effect.
 * - `BrushType` values present are `SOLID` and `TRANSPARENT`. ARIS also supports hatch/pattern
 *   brush types (`BDIAGONAL`, `FDIAGONAL`, `CROSS`, `DIAGCROSS`, `HORIZONTAL`, `VERTICAL`, …);
 *   none appear in AnimalWF, but the mapper recognizes them and reports an unsupported-brush
 *   fidelity finding with a solid-fill fallback rather than silently rendering solid.
 */

import type { ArisRenderFidelityFinding, ResolvedBrush, ResolvedPen, RenderPenStyle } from './types'
import type { RenderSourceBrushParsed, RenderSourcePenParsed } from './input'

const NO_COLOR_SENTINEL = '-1'

/** Parses an ARIS unpadded hex color integer into `#rrggbb`, or `undefined` for "no color". */
export function arisColorToCss(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === NO_COLOR_SENTINEL) return undefined
  const value = Number.parseInt(trimmed, 16)
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) return undefined
  const clamped = Math.min(value, 0xffffff)
  return `#${clamped.toString(16).padStart(6, '0')}`
}

const PEN_STYLE_BY_CODE: Readonly<Record<string, RenderPenStyle>> = Object.freeze({
  '0': 'solid',
  '1': 'dash',
  '2': 'dot',
  '3': 'dashdot',
  '4': 'dashdotdot',
  '5': 'invisible'
})

const DASHARRAY_BY_STYLE: Readonly<Record<RenderPenStyle, string | null>> = Object.freeze({
  solid: null,
  dash: '8 4',
  dot: '2 3',
  dashdot: '8 3 2 3',
  dashdotdot: '8 3 2 3 2 3',
  invisible: null
})

export interface PenResolution {
  readonly pen: ResolvedPen
  readonly findings: readonly ArisRenderFidelityFinding[]
}

/**
 * Resolves an ARIS `Pen` record. `identity` locates the finding if the style code is outside
 * the known `PS_*` range (an unsupported pen effect).
 */
export function resolvePen(
  source: RenderSourcePenParsed | null,
  identity: { readonly modelId: string | null; readonly elementId: string | null; readonly sourceId: string | null }
): PenResolution {
  if (!source) {
    return {
      pen: { color: undefined, style: 'solid', width: 1, dasharray: null, visible: true, source: null },
      findings: []
    }
  }
  const color = arisColorToCss(source.color)
  const width = source.width ?? 1
  const styleCode = (source.style ?? '0').trim()
  const known = PEN_STYLE_BY_CODE[styleCode]
  const findings: ArisRenderFidelityFinding[] = []
  const style = known ?? 'solid'
  if (!known) {
    findings.push({
      kind: 'unsupported-pen-effect',
      messageKey: 'aris.fidelity.unsupportedPenEffect',
      modelId: identity.modelId,
      elementId: identity.elementId,
      sourceId: identity.sourceId,
      params: { style: styleCode }
    })
  }
  return {
    pen: {
      color,
      style,
      width,
      dasharray: DASHARRAY_BY_STYLE[style],
      visible: style !== 'invisible',
      source: { color: source.color, style: source.style, width: source.width }
    },
    findings
  }
}

const KNOWN_BRUSH_TYPES = new Set(['SOLID', 'TRANSPARENT'])

export interface BrushResolution {
  readonly brush: ResolvedBrush
  readonly findings: readonly ArisRenderFidelityFinding[]
}

/** Resolves an ARIS `Brush` record. Unknown `BrushType` values (hatch/pattern) fall back to solid. */
export function resolveBrush(
  source: RenderSourceBrushParsed | null,
  identity: { readonly modelId: string | null; readonly elementId: string | null; readonly sourceId: string | null }
): BrushResolution {
  if (!source) {
    return {
      brush: { fill: 'none', kind: 'transparent', source: null },
      findings: []
    }
  }
  const brushType = (source.brushType ?? 'SOLID').trim().toUpperCase()
  const color = arisColorToCss(source.color)
  const findings: ArisRenderFidelityFinding[] = []

  if (brushType === 'TRANSPARENT') {
    return {
      brush: {
        fill: 'none',
        kind: 'transparent',
        source: { color: source.color, color2: source.color2, brushType: source.brushType }
      },
      findings
    }
  }

  if (!KNOWN_BRUSH_TYPES.has(brushType)) {
    findings.push({
      kind: 'unsupported-brush-effect',
      messageKey: 'aris.fidelity.unsupportedBrushEffect',
      modelId: identity.modelId,
      elementId: identity.elementId,
      sourceId: identity.sourceId,
      params: { brushType }
    })
    return {
      brush: {
        fill: color ?? '#ffffff',
        kind: 'unsupported-pattern',
        source: { color: source.color, color2: source.color2, brushType: source.brushType }
      },
      findings
    }
  }

  return {
    brush: {
      fill: color ?? '#ffffff',
      kind: 'solid',
      source: { color: source.color, color2: source.color2, brushType: source.brushType }
    },
    findings
  }
}
