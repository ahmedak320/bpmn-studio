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

import { resolveArisSymbol } from '../symbols'
import type { ArisModeling, ArisCreateShapeAttrs } from './arisModeling'
import { ArisDocumentStore } from './documentStore'
import { ARIS_CANVAS_OBJECT_TYPES, ARIS_RULE_SYMBOLS, type ArisRuleOperator } from './vocabulary'

export interface ArisPaletteEntry {
  readonly group: string
  readonly className: string
  readonly title: string
  readonly action: {
    readonly dragstart?: (event: Event) => void
    readonly click?: (event: Event) => void
  }
  /** The ARIS object type this entry creates, for tests and tooling. */
  readonly arisObjectType?: string
  readonly arisSymbolNum?: string
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
    const entries: Record<string, ArisPaletteEntry> = {
      'hand-tool': {
        group: 'tools',
        className: 'aris-palette-hand-tool',
        title: 'Activate hand tool',
        action: {
          click: (event: Event) => this.handTool.activateHand(event as unknown as MouseEvent)
        }
      },
      'lasso-tool': {
        group: 'tools',
        className: 'aris-palette-lasso-tool',
        title: 'Activate lasso tool',
        action: {
          click: (event: Event) => this.lassoTool.activateSelection(event as unknown as MouseEvent)
        }
      },
      'create.free-text': {
        group: 'annotation',
        className: 'aris-palette-free-text',
        title: 'Add free text',
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
      entries[target.id] = {
        group: target.group,
        className: `aris-palette-${target.objectType.toLowerCase()}`,
        title: `Create ${target.title}`,
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
