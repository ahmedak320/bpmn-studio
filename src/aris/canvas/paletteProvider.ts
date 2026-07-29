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

import { t } from '../../i18n'
import { resolveArisSymbol } from '../symbols'
import type { ArisModeling, ArisCreateShapeAttrs } from './arisModeling'
import { ArisDocumentStore } from './documentStore'
import { ARIS_CANVAS_OBJECT_TYPES, ARIS_RULE_SYMBOLS, type ArisRuleOperator } from './vocabulary'

type PaletteMessageKey = Parameters<typeof t>[0]

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
  )
}

/** Localized name key per ARIS object type (interpolated into `createTitle`). */
const OBJECT_TYPE_NAME_KEYS: Record<string, PaletteMessageKey> = {
  OT_FUNC: 'aris.palette.func',
  OT_EVT: 'aris.palette.evt',
  OT_ENT_TYPE: 'aris.palette.entType',
  OT_INFO_CARR: 'aris.palette.infoCarr',
  OT_BUSINESS_RULE: 'aris.palette.businessRule',
  OT_PERF: 'aris.palette.perf',
  OT_APPL_SYS: 'aris.palette.applSys',
  OT_PERS: 'aris.palette.pers',
  OT_REQUIREMENT: 'aris.palette.requirement',
  OT_POLICY: 'aris.palette.policy',
  OT_PERS_TYPE: 'aris.palette.persType'
}

/** Rule entries carry the operator glyph and name keyed by their entry id. */
const RULE_GLYPHS: Record<string, string> = {
  'create.rule-and': ruleGlyph('∧'),
  'create.rule-or': ruleGlyph('∨'),
  'create.rule-xor': ruleGlyph('×')
}
const RULE_NAME_KEYS: Record<string, PaletteMessageKey> = {
  'create.rule-and': 'aris.palette.rule.and',
  'create.rule-or': 'aris.palette.rule.or',
  'create.rule-xor': 'aris.palette.rule.xor'
}

interface PaletteTarget {
  readonly id: string
  readonly objectType: string
  readonly symbolNum: string
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

  /** Every object type the palette offers, in stable order. */
  targets(): readonly PaletteTarget[] {
    const document = this.store.document
    const model = document.models.get(this.store.activeModelId)
    const modelType = model?.type ?? 'MT_EEPC'
    const entries: PaletteTarget[] = []
    for (const objectType of ARIS_CANVAS_OBJECT_TYPES) {
      if (objectType === 'OT_RULE') {
        for (const operator of Object.keys(ARIS_RULE_SYMBOLS) as ArisRuleOperator[]) {
          entries.push({
            id: `create.rule-${operator.toLowerCase()}`,
            objectType,
            symbolNum: ARIS_RULE_SYMBOLS[operator],
            title: `${operator} rule`,
            group: 'rule'
          })
        }
        continue
      }
      entries.push({
        id: `create.${objectType.toLowerCase()}`,
        objectType,
        symbolNum: defaultSymbolFor(modelType, objectType),
        title: objectType,
        group: objectType === 'OT_FUNC' || objectType === 'OT_EVT' ? 'flow' : 'satellite'
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
      const nameKey =
        target.objectType === 'OT_RULE'
          ? RULE_NAME_KEYS[target.id]
          : OBJECT_TYPE_NAME_KEYS[target.objectType]
      const label = t(nameKey)
      const svgInner =
        target.objectType === 'OT_RULE'
          ? RULE_GLYPHS[target.id]
          : OBJECT_TYPE_GLYPHS[target.objectType]
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
