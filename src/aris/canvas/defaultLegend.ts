/**
 * The top-right "default owner" legend (rendering campaign 2026-08-08).
 *
 * A process that assigns the same owner / system / information carrier / control
 * to most of its steps would otherwise repeat that satellite on every function.
 * `computeDefaults` (`../canonical/defaults`) finds the ONE dominating value per
 * kind; this module declares it ONCE in a block pinned to the top-right corner
 * of the diagram (e.g. «Owner: Survey Team»), while the render collapses the
 * matching per-step satellites. The AML is untouched — this is SVG-only.
 *
 * Two entry points:
 *  - `paintDefaultLegend` — the pure painter: given a target `<g>`/layer, the
 *    lines, and the content bounds, it draws `<g class="orbitpm-default-legend">`.
 *  - `ArisDefaultLegend` — the diagram-js service (registered in
 *    `ArisCanvasModule`) that owns a dedicated canvas layer and repaints on
 *    `import.done` / `commandStack.changed`, or on an explicit `setDefaults`
 *    seam call (the headless render drives it that way for determinism).
 *
 * Language: the legend matches the render language — EN labels on an EN render,
 * AR labels on an AR render — chosen by the caller (`setDefaults(defaults,
 * language)`), never forced bilingual side-by-side.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type { Element } from 'diagram-js/lib/model/Types'

import type { DefaultEntry, DefaultKind, DefaultsByKind } from '../canonical/defaults'
import { arisContentBounds } from './fitView'
import { svgAppend, svgElement } from './svg'

export type DefaultLegendLanguage = 'en' | 'ar'

/** The dedicated canvas layer the legend paints into (above the base layer). */
export const DEFAULT_LEGEND_LAYER = 'orbitpm-default-legend'
/** Marker class on the legend root `<g>` — assertable, strip-safe. */
export const DEFAULT_LEGEND_CLASS = 'orbitpm-default-legend'

/** Kinds rendered, in fixed top-to-bottom order. */
const LEGEND_ORDER: readonly DefaultKind[] = ['owner', 'system', 'informationObject', 'control']

/** Bilingual field labels. `owner`'s EN label is "Owner", AR "المالك". */
const LABELS: Readonly<Record<DefaultKind, Readonly<Record<DefaultLegendLanguage, string>>>> =
  Object.freeze({
    owner: { en: 'Owner', ar: 'المالك' },
    system: { en: 'System', ar: 'النظام' },
    informationObject: { en: 'Information', ar: 'المعلومة' },
    control: { en: 'Control', ar: 'الضابط' }
  })

export interface DefaultLegendLine {
  readonly kind: DefaultKind
  readonly label: string
  readonly value: string
}

function localizedValue(names: DefaultEntry['names'], language: DefaultLegendLanguage): string {
  if (language === 'ar') return names.ar ?? names.en ?? ''
  return names.en ?? names.ar ?? ''
}

/**
 * The legend lines for a set of defaults, in `LEGEND_ORDER`, in `language`. A
 * kind with no detected default (or an empty localized name) yields no line.
 */
export function buildDefaultLegendLines(
  defaults: DefaultsByKind,
  language: DefaultLegendLanguage
): readonly DefaultLegendLine[] {
  const lines: DefaultLegendLine[] = []
  for (const kind of LEGEND_ORDER) {
    const entry = defaults[kind]
    if (!entry) continue
    const value = localizedValue(entry.names, language)
    if (value.length === 0) continue
    lines.push({ kind, label: LABELS[kind][language], value })
  }
  return lines
}

const LEGEND_FILL = '#ffffff'
const LEGEND_STROKE = '#c8c8c8'
const LEGEND_LABEL_FILL = '#0b5aa2'
const LEGEND_VALUE_FILL = '#1a1a1a'

function isArabic(text: string): boolean {
  return /\p{Script=Arabic}/u.test(text)
}

/** Legend geometry derived deterministically from the content bounds. */
function legendMetrics(bounds: { width: number; height: number }): {
  fontSize: number
  lineHeight: number
  pad: number
  margin: number
} {
  const extent = Math.min(bounds.width, bounds.height)
  const fontSize = Math.min(28, Math.max(14, Math.round(extent * 0.02)))
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.5),
    pad: Math.round(fontSize * 0.6),
    margin: Math.round(fontSize * 0.8)
  }
}

/**
 * Paint the default-legend into `layer` at the top-right of `bounds` (model
 * space). Idempotent per call: it does NOT clear the layer (the service does),
 * it only appends one `<g class="orbitpm-default-legend">`. No lines → no-op.
 */
export function paintDefaultLegend(
  layer: SVGElement,
  lines: readonly DefaultLegendLine[],
  bounds: { x: number; y: number; width: number; height: number },
  language: DefaultLegendLanguage
): SVGGElement | null {
  if (lines.length === 0) return null
  const { fontSize, lineHeight, pad, margin } = legendMetrics(bounds)

  // Estimate width from the widest "label: value" line (jsdom has no text
  // metrics; a per-glyph advance keeps this deterministic and layout-free).
  const widest = lines.reduce((max, line) => {
    const chars = line.label.length + 2 + line.value.length
    return Math.max(max, chars)
  }, 0)
  const boxWidth = Math.round(widest * fontSize * 0.56 + pad * 2)
  const boxHeight = lines.length * lineHeight + pad * 2

  const right = bounds.x + bounds.width - margin
  const top = bounds.y + margin
  const left = right - boxWidth

  const group = svgElement('g', {
    class: DEFAULT_LEGEND_CLASS,
    'data-orbitpm-default-legend': String(lines.length),
    role: 'img',
    'aria-label': lines.map((line) => `${line.label}: ${line.value}`).join('; ')
  })

  svgAppend(
    group,
    svgElement('rect', {
      x: Math.round(left),
      y: Math.round(top),
      width: boxWidth,
      height: boxHeight,
      rx: pad,
      ry: pad,
      fill: LEGEND_FILL,
      stroke: LEGEND_STROKE,
      'stroke-width': 2,
      'fill-opacity': 0.92
    })
  )

  // Right-anchored rows so the block hugs the top-right corner and grows left.
  const textRight = Math.round(right - pad)
  lines.forEach((line, index) => {
    const baseline = Math.round(top + pad + lineHeight * (index + 0.5) + fontSize * 0.35)
    const full = `${line.label}: ${line.value}`
    const node = svgElement('text', {
      x: textRight,
      y: baseline,
      'text-anchor': 'end',
      'font-size': fontSize,
      'font-family': 'Arial, sans-serif',
      fill: LEGEND_VALUE_FILL,
      'data-legend-kind': line.kind
    })
    if (language === 'ar' || isArabic(full)) {
      node.setAttribute('direction', 'rtl')
      node.setAttribute('unicode-bidi', 'plaintext')
    }
    // Bold label + normal value, kept as one line via a leading tspan.
    const labelSpan = svgElement('tspan', {
      'font-weight': 'bold',
      fill: LEGEND_LABEL_FILL
    })
    labelSpan.textContent = `${line.label}: `
    const valueSpan = svgElement('tspan', {})
    valueSpan.textContent = line.value
    node.appendChild(labelSpan)
    node.appendChild(valueSpan)
    svgAppend(group, node)
  })

  svgAppend(layer, group)
  return group
}

/**
 * diagram-js service that paints the default legend into its own canvas layer.
 *
 * Seam-driven: `setDefaults(defaults, language)` stores the payload and repaints
 * immediately (the headless render calls this after layout, so the content
 * bounds are final and the result is deterministic). It also repaints on
 * `import.done` and `commandStack.changed` so the live studio keeps the legend
 * in sync after an import or an edit, using whatever defaults were last set.
 */
export class ArisDefaultLegend {
  static $inject = ['eventBus', 'canvas', 'elementRegistry']

  private defaults: DefaultsByKind = {}
  private language: DefaultLegendLanguage = 'en'

  constructor(
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly elementRegistry: ElementRegistry
  ) {
    eventBus.on(['import.done', 'commandStack.changed'], () => this.paint())
  }

  /** Set the detected defaults + render language and repaint. */
  setDefaults(defaults: DefaultsByKind, language: DefaultLegendLanguage): void {
    this.defaults = defaults
    this.language = language
    this.paint()
  }

  /** Clear and repaint the legend layer from the current defaults. */
  paint(): void {
    const layer = this.canvas.getLayer(DEFAULT_LEGEND_LAYER, DEFAULT_LEGEND_LAYER_INDEX) as
      SVGElement | undefined
    if (!layer) return
    while (layer.firstChild) layer.removeChild(layer.firstChild)

    const lines = buildDefaultLegendLines(this.defaults, this.language)
    if (lines.length === 0) return
    const bounds = arisContentBounds(this.elementRegistry.getAll() as Element[])
    if (!bounds) return
    paintDefaultLegend(layer, lines, bounds, this.language)
  }
}

/** Layer index above the base plane (base uses index 0) so the legend sits on top. */
const DEFAULT_LEGEND_LAYER_INDEX = 100
