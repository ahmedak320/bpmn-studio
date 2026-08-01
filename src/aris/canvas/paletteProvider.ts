/**
 * Headless placement service for the descriptor-driven DMT drawing library.
 *
 * The convention catalog remains the identity/order authority. V10 deliberately
 * applies its "all manual presentations are placeable" override here instead
 * of changing catalog verification metadata.
 */

import type ElementFactory from 'diagram-js/lib/core/ElementFactory'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type GraphicsFactory from 'diagram-js/lib/core/GraphicsFactory'
import type Create from 'diagram-js/lib/features/create/Create'
import type HandTool from 'diagram-js/lib/features/hand-tool/HandTool'
import type LassoTool from 'diagram-js/lib/features/lasso-tool/LassoTool'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { t, type Key } from '../../i18n'
import { dmtLibraryText } from '../shell/dmtLibraryI18n'
import { resolveArisCatalogSymbol, resolveArisSymbol } from '../symbols'
import type { ArisModeling, ArisCreateShapeAttrs } from './arisModeling'
import {
  dmtLibraryItem,
  dmtLibraryItems,
  type DmtLibraryGroupId,
  type DmtLibraryItem
} from './dmtLibrary'
import { ArisDocumentStore } from './documentStore'
import { arisBusinessObject } from './elements'

import './dmtLibrary.css'

export interface PaletteTarget {
  readonly id: string
  readonly catalogId: string
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly title: string
  readonly group: DmtLibraryGroupId
  readonly paletteOrder: number
  readonly variantCount: number
  readonly descriptorFingerprint: string
  readonly catalogPlacementEnabled: boolean
  /** Provider-side V10 override; always true for a convention-library item. */
  readonly placementEnabled: true
}

interface PaletteChangedEvent {
  readonly elements?: readonly Element[]
}

interface LegacyPaletteEntry {
  readonly className: string
  readonly title: string
  readonly html: string
  readonly arisObjectType?: string
  readonly arisSymbolNum?: string
}

function safeIdPart(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '.')
    .replace(/^\.+|\.+$/gu, '')
}

function defaultCatalogIdFor(modelType: string, item: DmtLibraryItem): string | null {
  const resolved = resolveArisSymbol({
    modelType,
    objectType: item.objectType,
    symbolNum: ''
  }).descriptor
  return (
    dmtLibraryItems(modelType).find(
      (candidate) =>
        candidate.objectType === item.objectType && candidate.symbolNum === resolved.symbolNum
    )?.catalogId ?? null
  )
}

export class ArisPaletteProvider {
  static $inject = [
    'create',
    'elementFactory',
    'arisDocumentStore',
    'modeling',
    'handTool',
    'lassoTool',
    'eventBus',
    'elementRegistry',
    'graphicsFactory'
  ]

  private readonly presentationByOccurrence = new Map<string, string>()
  private pendingCatalogId: string | null = null
  private placementInvoker: HTMLElement | null = null

  constructor(
    private readonly create: Create,
    private readonly elementFactory: ElementFactory,
    private readonly store: ArisDocumentStore,
    private readonly modeling: ArisModeling,
    private readonly handTool: HandTool,
    private readonly lassoTool: LassoTool,
    eventBus: EventBus,
    private readonly elementRegistry: ElementRegistry,
    private readonly graphicsFactory: GraphicsFactory
  ) {
    // CanvasSync replaces business objects before `elements.changed`. Reapply a
    // provider-owned exact presentation before change-support redraws it.
    eventBus.on('elements.changed', 1500, (event: PaletteChangedEvent) => {
      for (const element of event.elements ?? []) this.applyRememberedPresentation(element)
    })
    // diagram-js's priority-1000 create handler has replaced the draft with the
    // committed occurrence by this point. Patch it before quick-pick (260).
    eventBus.on('create.end', 300, (event: unknown) => {
      const context = property(event, 'context')
      if (property(context, 'canExecute') === false) return
      const shape = property<{ id?: string }>(context, 'shape')
      if (this.pendingCatalogId !== null && typeof shape?.id === 'string') {
        this.rememberCatalogPresentation(shape.id, this.pendingCatalogId)
      }
      this.pendingCatalogId = null
      this.placementInvoker = null
    })
    eventBus.on('create.cancel', () => {
      this.pendingCatalogId = null
      const invoker = this.placementInvoker
      this.placementInvoker = null
      if (invoker?.isConnected) invoker.focus()
    })
  }

  private modelType(): string {
    return this.store.document.models.get(this.store.activeModelId)?.type ?? 'MT_EEPC'
  }

  activateHandTool(event: Event): void {
    this.handTool.activateHand(event as unknown as MouseEvent)
  }

  activateLassoTool(event: Event): void {
    this.lassoTool.activateSelection(event as unknown as MouseEvent)
  }

  createFreeText(label: string): void {
    this.modeling.createFreeText(label, { x: 0, y: 0 })
  }

  /** Every model-appropriate convention item, including catalog-disabled rows. */
  targets(): readonly PaletteTarget[] {
    const modelType = this.modelType()
    const entries: PaletteTarget[] = []
    const usedIds = new Set<string>()
    const defaultAssigned = new Set<string>()

    for (const item of dmtLibraryItems(modelType)) {
      const isDefault =
        defaultCatalogIdFor(modelType, item) === item.catalogId &&
        !defaultAssigned.has(item.objectType)
      let id = isDefault
        ? `create.${item.objectType.toLocaleLowerCase()}`
        : `create.${item.objectType.toLocaleLowerCase()}.${item.symbolNum.toLocaleLowerCase()}`
      if (isDefault) defaultAssigned.add(item.objectType)
      if (usedIds.has(id)) id = `${id}.${safeIdPart(item.catalogId)}`
      let ordinal = 2
      const base = id
      while (usedIds.has(id)) {
        id = `${base}.${ordinal}`
        ordinal += 1
      }
      usedIds.add(id)
      entries.push(
        Object.freeze({
          id,
          catalogId: item.catalogId,
          objectType: item.objectType,
          symbolNum: item.symbolNum,
          labelKey: item.labelKey,
          title: t(item.labelKey as Key),
          group: item.group,
          paletteOrder: item.paletteOrder,
          variantCount: item.variantCount,
          descriptorFingerprint: item.descriptorFingerprint,
          catalogPlacementEnabled: item.catalogPlacementEnabled,
          placementEnabled: true
        })
      )
    }
    return Object.freeze(entries)
  }

  /**
   * Metadata-only compatibility for the pre-rail objectTypes characterization.
   * Nothing consumes this at runtime and no diagram-js Palette service exists.
   */
  getPaletteEntries(): Readonly<Record<string, LegacyPaletteEntry>> {
    const labelMarkup = (label: string): string =>
      `<span class="aris-palette-entry__label">${label}</span>`
    const entries: Record<string, LegacyPaletteEntry> = {
      'hand-tool': {
        className: 'aris-palette-hand-tool',
        title: t('aris.palette.hand'),
        html: labelMarkup(t('aris.palette.hand'))
      },
      'lasso-tool': {
        className: 'aris-palette-lasso-tool',
        title: t('aris.palette.lasso'),
        html: labelMarkup(t('aris.palette.lasso'))
      },
      'create.free-text': {
        className: 'aris-palette-free-text',
        title: t('aris.palette.freeText'),
        html: labelMarkup(t('aris.palette.freeText'))
      }
    }
    for (const target of this.targets()) {
      entries[target.id] = {
        className: `aris-palette-${target.objectType.toLocaleLowerCase()}`,
        title: dmtLibraryText('aris.library.item.tooltip', { name: target.title }),
        html: labelMarkup(target.title),
        arisObjectType: target.objectType,
        arisSymbolNum: target.symbolNum
      }
    }
    return Object.freeze(entries)
  }

  /** Enter diagram-js placement mode for an exact catalog presentation. */
  startPlacement(event: Event, target: PaletteTarget): Shape {
    this.pendingCatalogId = target.catalogId
    this.placementInvoker =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-action]')
          : null
    const draft = this.draftShape(target)
    this.create.start(event as unknown as MouseEvent, draft)
    return draft
  }

  /** Draft ghost rendered from the exact catalog descriptor, not a pair guess. */
  draftShape(target: Pick<PaletteTarget, 'catalogId' | 'objectType' | 'symbolNum'>): Shape {
    const modelType = this.modelType()
    const descriptor =
      resolveArisCatalogSymbol(target.catalogId) ??
      resolveArisSymbol({
        modelType,
        objectType: target.objectType,
        symbolNum: target.symbolNum
      }).descriptor
    const arisAttrs: ArisCreateShapeAttrs = {
      objectType: target.objectType,
      symbolNum: target.symbolNum
    }
    const shape = this.elementFactory.createShape({
      width: descriptor.defaultBounds.width,
      height: descriptor.defaultBounds.height,
      businessObject: {
        kind: 'occurrence',
        modelId: this.store.activeModelId,
        modelType,
        occurrenceId: 'draft',
        definitionId: 'draft',
        objectType: target.objectType,
        symbolNum: target.symbolNum,
        catalogId: target.catalogId,
        name: '',
        style: {
          fillColor: null,
          strokeColor: null,
          strokeWidth: null,
          lineStyle: null
        }
      }
    }) as Shape & { arisAttrs?: ArisCreateShapeAttrs }
    shape.arisAttrs = arisAttrs
    return shape
  }

  /** Exact live presentation selected by this provider/quick-pick. */
  catalogIdFor(elementId: string): string | null {
    const businessObject = arisBusinessObject(this.elementRegistry.get(elementId))
    if (businessObject?.kind !== 'occurrence') return null
    return businessObject.catalogId ?? this.presentationByOccurrence.get(elementId) ?? null
  }

  rememberCatalogPresentation(elementId: string, catalogId: string): void {
    if (dmtLibraryItem(catalogId) === null) return
    this.presentationByOccurrence.set(elementId, catalogId)
    const element = this.elementRegistry.get(elementId) as Element | undefined
    if (element) this.applyRememberedPresentation(element, true)
  }

  private applyRememberedPresentation(element: Element, redraw = false): void {
    const catalogId = this.presentationByOccurrence.get(element.id)
    if (catalogId === undefined) return
    const businessObject = arisBusinessObject(element)
    if (businessObject?.kind !== 'occurrence' || businessObject.catalogId === catalogId) return
    ;(element as Element & { businessObject: unknown }).businessObject = Object.freeze({
      ...businessObject,
      catalogId
    })
    if (!redraw) return
    const graphics = this.elementRegistry.getGraphics(element)
    if (graphics) this.graphicsFactory.update('shape', element, graphics)
  }
}

function property<T = unknown>(source: unknown, key: string): T | undefined {
  if (source && typeof source === 'object' && key in source) {
    return (source as Record<string, unknown>)[key] as T
  }
  return undefined
}
