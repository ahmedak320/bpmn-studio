/**
 * Palette entries for every Section 11.3 object type, plus the three native
 * rule symbols and the free-text tool.
 *
 * The entries drive diagram-js's own `create` module: the dragged draft shape
 * carries `arisAttrs`, which `ArisModeling.createShape` reads to mint the
 * definition/occurrence pair. Default sizes come from the symbol registry so
 * the palette never authors geometry.
 */

import type Create from 'diagram-js/lib/features/create/Create'
import type ElementFactory from 'diagram-js/lib/core/ElementFactory'
import type HandTool from 'diagram-js/lib/features/hand-tool/HandTool'
import type LassoTool from 'diagram-js/lib/features/lasso-tool/LassoTool'
import type Palette from 'diagram-js/lib/features/palette/Palette'
import type { Shape } from 'diagram-js/lib/model/Types'

import { t, type Key } from '../../i18n'
import { getPaletteSymbols } from '../conventions'
import { resolveArisSymbol } from '../symbols'
import type { ArisModeling, ArisCreateShapeAttrs } from './arisModeling'
import { ArisDocumentStore } from './documentStore'
import { ruleOperatorOfSymbol } from './vocabulary'

export interface ArisPaletteEntry {
  readonly group: string
  readonly className: string
  readonly title: string
  /**
   * Custom single-root markup diagram-js's `Palette._addEntry` stamps the
   * `data-action`, `title`, and `aris-palette-*` class onto — so the labeled,
   * iconed affordance replaces the default blank box while every
   * `[data-action=…]` selector keeps resolving.
   */
  readonly html: string
  readonly action: {
    readonly dragstart?: (event: Event) => void
    readonly click?: (event: Event) => void
  }
  /** The ARIS object type this entry creates, for tests and tooling. */
  readonly arisObjectType?: string
  readonly arisSymbolNum?: string
}

/**
 * Escape a string for safe interpolation into an HTML attribute or text node.
 * Ported pattern from `git show main:src/editor/embeddedDiagramControls.ts`
 * (the `escapeAttribute` helper), extended to the five markup-significant
 * characters so the same value is safe as both an attribute and text content.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * A single-root palette affordance: a line-art glyph plus a localized label.
 * `svgInner` is trusted, author-controlled markup (the glyph tables below);
 * `label` is localized copy and is escaped for both the `aria-label` attribute
 * and the visible span.
 */
function paletteEntryHtml(svgInner: string, label: string): string {
  const escaped = escapeHtml(label)
  return (
    `<div class="entry" draggable="true" role="img" aria-label="${escaped}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg>` +
    `<span class="aris-palette-entry__label">${escaped}</span>` +
    `</div>`
  )
}

/**
 * Inline line-art glyphs. These are affordances, not the renderer's official
 * ARIS symbols — fidelity is deliberately not gated. Every path draws with the
 * current text colour so the icon tracks the theme.
 */
const GLYPH_GROUP_OPEN = '<g stroke="currentColor" fill="none" stroke-width="1.5">'
const GLYPH_GROUP_CLOSE = '</g>'

function glyph(inner: string): string {
  return `${GLYPH_GROUP_OPEN}${inner}${GLYPH_GROUP_CLOSE}`
}

function ruleGlyph(mark: string): string {
  return glyph(
    '<circle cx="12" cy="12" r="8"/>' +
      `<text x="12" y="15.5" text-anchor="middle" font-size="10" stroke="none" fill="currentColor">${mark}</text>`
  )
}

const HAND_GLYPH = glyph(
  '<path d="M7 13V8a1.2 1.2 0 0 1 2.4 0v4m0-5a1.2 1.2 0 0 1 2.4 0v5m0-4a1.2 1.2 0 0 1 2.4 0v4m0-2a1.2 1.2 0 0 1 2.2 0v3a5 5 0 0 1-5 5h-2a4 4 0 0 1-3-1.6L7 16"/>'
)
const LASSO_GLYPH = glyph(
  '<rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="3 2"/>'
)
const FREE_TEXT_GLYPH = glyph(
  '<line x1="6" y1="7" x2="18" y2="7"/><line x1="12" y1="7" x2="12" y2="18"/>'
)

/** Fallback affordance for an object type without a dedicated glyph. */
const GENERIC_GLYPH = glyph('<rect x="4" y="6" width="16" height="12" rx="2"/>')

/** Glyph per ARIS object type (the create entries). */
const OBJECT_TYPE_GLYPHS: Record<string, string> = {
  OT_FUNC: glyph('<rect x="3" y="7" width="18" height="10" rx="3"/>'),
  OT_EVT: glyph('<polygon points="6,5 18,5 22,12 18,19 6,19 2,12"/>'),
  OT_ENT_TYPE: glyph('<rect x="4" y="6" width="16" height="12"/>'),
  OT_INFO_CARR: glyph('<path d="M5 5h10l4 4v10H5z"/><path d="M15 5v4h4"/>'),
  OT_BUSINESS_RULE: glyph(
    '<rect x="4" y="6" width="16" height="12"/><line x1="4" y1="12" x2="20" y2="12"/>'
  ),
  OT_PERF: glyph(
    '<line x1="6" y1="18" x2="6" y2="12"/><line x1="12" y1="18" x2="12" y2="8"/><line x1="18" y1="18" x2="18" y2="14"/>'
  ),
  OT_APPL_SYS: glyph(
    '<rect x="5" y="6" width="14" height="12"/><line x1="8" y1="6" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="18"/>'
  ),
  OT_PERS: glyph('<circle cx="12" cy="9" r="3"/><path d="M6 19a6 6 0 0 1 12 0"/>'),
  OT_REQUIREMENT: glyph('<path d="M6 4h9l3 3v13H6z"/><path d="M9 13l2 2 4-4"/>'),
  OT_POLICY: glyph('<path d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z"/>'),
  OT_PERS_TYPE: glyph(
    '<circle cx="9" cy="9" r="2.5"/><path d="M4 18a5 5 0 0 1 10 0"/><circle cx="15" cy="9" r="2.5"/><path d="M11 18a5 5 0 0 1 9 0"/>'
  ),
  OT_ORG_UNIT: glyph('<rect x="4" y="9" width="16" height="9" rx="1"/><path d="M9 9V6h6v3"/>'),
  OT_POS: glyph(
    '<circle cx="12" cy="8" r="2.5"/><rect x="7" y="13" width="10" height="5" rx="1"/>'
  ),
  OT_GRP: glyph(
    '<circle cx="8" cy="9" r="2"/><circle cx="16" cy="9" r="2"/><path d="M4 18a4 4 0 0 1 8 0"/><path d="M12 18a4 4 0 0 1 8 0"/>'
  ),
  OT_RISK: glyph(
    '<path d="M12 4l9 16H3z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.2" r="0.7" stroke="none" fill="currentColor"/>'
  ),
  OT_SERVICE: glyph(
    '<circle cx="12" cy="12" r="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="8" x2="12" y2="16"/>'
  )
}

/** The operator glyph for a rule symbol. */
function ruleGlyphFor(symbolNum: string): string {
  const operator = ruleOperatorOfSymbol(symbolNum)
  if (operator === 'OR') return ruleGlyph('∨')
  if (operator === 'XOR') return ruleGlyph('×')
  return ruleGlyph('∧')
}

/**
 * The line-art affordance for an object type / symbol, reused by both the
 * palette entries and the post-placement quick-pick members so a swap target
 * looks the same in both surfaces.
 */
export function arisPaletteGlyph(objectType: string, symbolNum: string): string {
  if (objectType === 'OT_RULE') return ruleGlyphFor(symbolNum)
  return OBJECT_TYPE_GLYPHS[objectType] ?? GENERIC_GLYPH
}

interface PaletteTarget {
  readonly id: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly title: string
  readonly group: string
}

function defaultSymbolFor(modelType: string, objectType: string): string {
  // Ask the registry which symbol it would resolve for this type; the
  // descriptor's own `symbolNum` is the canonical default.
  return resolveArisSymbol({ modelType, objectType, symbolNum: '' }).descriptor.symbolNum
}

export class ArisPaletteProvider {
  static $inject = [
    'palette',
    'create',
    'elementFactory',
    'arisDocumentStore',
    'modeling',
    'handTool',
    'lassoTool'
  ]

  constructor(
    palette: Palette,
    private readonly create: Create,
    private readonly elementFactory: ElementFactory,
    private readonly store: ArisDocumentStore,
    private readonly modeling: ArisModeling,
    private readonly handTool: HandTool,
    private readonly lassoTool: LassoTool
  ) {
    palette.registerProvider(this)
  }

  /**
   * Every symbol the palette offers for the active model type, in catalog
   * order (R1). One entry per `getPaletteSymbols(modelType)` row: the object
   * type's default symbol keeps the stable `create.<ot>` id, every other symbol
   * is a variant keyed `create.<ot>.<st>` (numeric-suffixed on the rare catalog
   * rows that share an object type + SymbolNum, so ids stay unique).
   */
  targets(): readonly PaletteTarget[] {
    const document = this.store.document
    const model = document.models.get(this.store.activeModelId)
    const modelType = model?.type ?? 'MT_EEPC'
    const entries: PaletteTarget[] = []
    const usedIds = new Set<string>()
    const defaultAssigned = new Set<string>()
    for (const symbol of getPaletteSymbols(modelType)) {
      const defaultSymbol = defaultSymbolFor(modelType, symbol.objectType)
      let id: string
      if (symbol.symbolNum === defaultSymbol && !defaultAssigned.has(symbol.objectType)) {
        id = `create.${symbol.objectType.toLowerCase()}`
        defaultAssigned.add(symbol.objectType)
      } else {
        const base = `create.${symbol.objectType.toLowerCase()}.${symbol.symbolNum.toLowerCase()}`
        id = base
        let ordinal = 2
        while (usedIds.has(id)) {
          id = `${base}.${ordinal}`
          ordinal += 1
        }
      }
      usedIds.add(id)
      entries.push({
        id,
        objectType: symbol.objectType,
        symbolNum: symbol.symbolNum,
        labelKey: symbol.labelKey,
        title: t(symbol.labelKey as Key),
        group: symbol.paletteGroup
      })
    }
    return Object.freeze(entries)
  }

  getPaletteEntries(): Record<string, ArisPaletteEntry> {
    // Titles and labels resolve when `getPaletteEntries()` runs (canvas boot).
    // A mid-session UI-language switch is picked up only on the next canvas
    // boot — accepted, because the canvas deliberately never re-boots.
    const handLabel = t('aris.palette.hand')
    const lassoLabel = t('aris.palette.lasso')
    const freeTextLabel = t('aris.palette.freeText')
    const entries: Record<string, ArisPaletteEntry> = {
      'hand-tool': {
        group: 'tools',
        className: 'aris-palette-hand-tool',
        title: handLabel,
        html: paletteEntryHtml(HAND_GLYPH, handLabel),
        action: {
          click: (event: Event) => this.handTool.activateHand(event as unknown as MouseEvent)
        }
      },
      'lasso-tool': {
        group: 'tools',
        className: 'aris-palette-lasso-tool',
        title: lassoLabel,
        html: paletteEntryHtml(LASSO_GLYPH, lassoLabel),
        action: {
          click: (event: Event) => this.lassoTool.activateSelection(event as unknown as MouseEvent)
        }
      },
      'create.free-text': {
        group: 'annotation',
        className: 'aris-palette-free-text',
        title: freeTextLabel,
        html: paletteEntryHtml(FREE_TEXT_GLYPH, freeTextLabel),
        action: {
          click: () => {
            this.modeling.createFreeText('Text', { x: 0, y: 0 })
          }
        }
      }
    }

    for (const target of this.targets()) {
      const start = (event: Event): void => {
        this.create.start(event as unknown as MouseEvent, this.draftShape(target))
      }
      const label = target.title
      const svgInner = arisPaletteGlyph(target.objectType, target.symbolNum)
      entries[target.id] = {
        group: target.group,
        className: `aris-palette-${target.objectType.toLowerCase()}`,
        title: t('aris.palette.createTitle', { name: label }),
        html: paletteEntryHtml(svgInner, label),
        arisObjectType: target.objectType,
        arisSymbolNum: target.symbolNum,
        action: { dragstart: start, click: start }
      }
    }
    return entries
  }

  /** The draft element dragged from the palette. */
  draftShape(target: Pick<PaletteTarget, 'objectType' | 'symbolNum'>): Shape {
    const model = this.store.document.models.get(this.store.activeModelId)
    const modelType = model?.type ?? 'MT_EEPC'
    const resolution = resolveArisSymbol({
      modelType,
      objectType: target.objectType,
      symbolNum: target.symbolNum
    })
    const arisAttrs: ArisCreateShapeAttrs = {
      objectType: target.objectType,
      symbolNum: target.symbolNum
    }
    const shape = this.elementFactory.createShape({
      width: resolution.descriptor.defaultBounds.width,
      height: resolution.descriptor.defaultBounds.height,
      // Rendered by `ArisRenderer` during the create preview.
      businessObject: {
        kind: 'occurrence',
        modelId: this.store.activeModelId,
        modelType,
        occurrenceId: 'draft',
        definitionId: 'draft',
        objectType: target.objectType,
        symbolNum: target.symbolNum,
        name: ''
      }
    }) as Shape & { arisAttrs?: ArisCreateShapeAttrs }
    shape.arisAttrs = arisAttrs
    return shape
  }
}
