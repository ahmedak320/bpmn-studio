/**
 * Descriptor-driven DMT drawing library for diagram-js's palette surface.
 *
 * The convention catalog remains the identity/order authority. V10 deliberately
 * applies its "all manual presentations are placeable" override here instead
 * of changing catalog verification metadata.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementFactory from 'diagram-js/lib/core/ElementFactory'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type EventBus from 'diagram-js/lib/core/EventBus'
import type GraphicsFactory from 'diagram-js/lib/core/GraphicsFactory'
import type Create from 'diagram-js/lib/features/create/Create'
import type HandTool from 'diagram-js/lib/features/hand-tool/HandTool'
import type LassoTool from 'diagram-js/lib/features/lasso-tool/LassoTool'
import type Palette from 'diagram-js/lib/features/palette/Palette'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { subscribe, t, type Key } from '../../i18n'
import { dmtLibraryText } from '../shell/dmtLibraryI18n'
import { resolveArisCatalogSymbol, resolveArisSymbol } from '../symbols'
import type { ArisModeling, ArisCreateShapeAttrs } from './arisModeling'
import { ARIS_DOCUMENT_CHANGED } from './commandBridge'
import { descriptorPreviewMarkup } from './descriptorPreview'
import {
  DMT_LIBRARY_GROUPS,
  dmtLibraryItem,
  dmtLibraryItems,
  searchDmtLibrary,
  type DmtLibraryGroupId,
  type DmtLibraryItem
} from './dmtLibrary'
import { ArisDocumentStore } from './documentStore'
import { arisBusinessObject } from './elements'

import './dmtLibrary.css'

export interface ArisPaletteEntry {
  readonly group: string
  readonly className: string
  readonly title: string
  readonly html: string
  readonly action: {
    readonly dragstart?: (event: Event) => void
    readonly click?: (event: Event) => void
  }
  readonly arisObjectType?: string
  readonly arisSymbolNum?: string
  readonly arisCatalogId?: string
  readonly arisDescriptorFingerprint?: string
}

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

const HAND_GLYPH =
  '<g stroke="currentColor" fill="none" stroke-width="1.5"><path d="M7 13V8a1.2 1.2 0 0 1 2.4 0v4m0-5a1.2 1.2 0 0 1 2.4 0v5m0-4a1.2 1.2 0 0 1 2.4 0v4m0-2a1.2 1.2 0 0 1 2.2 0v3a5 5 0 0 1-5 5h-2a4 4 0 0 1-3-1.6L7 16"/></g>'
const LASSO_GLYPH =
  '<g stroke="currentColor" fill="none" stroke-width="1.5"><rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="3 2"/></g>'
const FREE_TEXT_GLYPH =
  '<g stroke="currentColor" fill="none" stroke-width="1.5"><line x1="6" y1="7" x2="18" y2="7"/><line x1="12" y1="7" x2="12" y2="18"/></g>'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function utilityEntryHtml(svgInner: string, label: string): string {
  const escaped = escapeHtml(label)
  return (
    `<button type="button" class="entry aris-palette-entry" draggable="true" aria-label="${escaped}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${svgInner}</svg>` +
    `<span class="aris-palette-entry__label">${escaped}</span>` +
    `</button>`
  )
}

function libraryEntryHtml(target: PaletteTarget): string {
  const escapedLabel = escapeHtml(target.title)
  const aria = escapeHtml(
    dmtLibraryText('aris.library.item.aria', {
      name: target.title,
      variants: target.variantCount
    })
  )
  return (
    `<button type="button" class="entry aris-palette-entry aris-palette-entry--symbol" ` +
    `draggable="true" aria-label="${aria}" data-aris-catalog-id="${escapeHtml(target.catalogId)}" ` +
    `data-aris-variant-count="${target.variantCount}">` +
    descriptorPreviewMarkup(target.catalogId) +
    `<span class="aris-palette-entry__label">${escapedLabel}</span>` +
    `</button>`
  )
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

function visibleEntryButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.group:not([hidden]) > .entry')].filter(
    (entry) => !entry.hidden && !entry.disabled
  )
}

export class ArisPaletteProvider {
  static $inject = [
    'palette',
    'create',
    'elementFactory',
    'arisDocumentStore',
    'modeling',
    'handTool',
    'lassoTool',
    'eventBus',
    'canvas',
    'elementRegistry',
    'graphicsFactory'
  ]

  private readonly presentationByOccurrence = new Map<string, string>()
  private readonly collapsedGroups = new Set<string>()
  private pendingCatalogId: string | null = null
  private placementInvoker: HTMLElement | null = null
  private renderedModelType: string

  constructor(
    palette: Palette,
    private readonly create: Create,
    private readonly elementFactory: ElementFactory,
    private readonly store: ArisDocumentStore,
    private readonly modeling: ArisModeling,
    private readonly handTool: HandTool,
    private readonly lassoTool: LassoTool,
    eventBus: EventBus,
    private readonly canvas: Canvas,
    private readonly elementRegistry: ElementRegistry,
    private readonly graphicsFactory: GraphicsFactory
  ) {
    this.renderedModelType = this.modelType()
    eventBus.on('palette.changed', () => this.enhancePalette())

    // CanvasSync replaces business objects before `elements.changed`. Reapply a
    // provider-owned exact presentation before change-support redraws it.
    eventBus.on('elements.changed', 1500, (event: PaletteChangedEvent) => {
      for (const element of event.elements ?? []) this.applyRememberedPresentation(element)
    })
    eventBus.on(ARIS_DOCUMENT_CHANGED, () => {
      const modelType = this.modelType()
      if (modelType !== this.renderedModelType) {
        this.renderedModelType = modelType
        this.refreshPalette(palette)
      }
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

    const unsubscribeLanguage = subscribe(() => this.refreshPalette(palette))
    eventBus.on('diagram.destroy', unsubscribeLanguage)
    palette.registerProvider(this)
  }

  private modelType(): string {
    return this.store.document.models.get(this.store.activeModelId)?.type ?? 'MT_EEPC'
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

  getPaletteEntries(): Record<string, ArisPaletteEntry> {
    const handLabel = t('aris.palette.hand')
    const lassoLabel = t('aris.palette.lasso')
    const freeTextLabel = t('aris.palette.freeText')
    const entries: Record<string, ArisPaletteEntry> = {
      'hand-tool': {
        group: 'tools',
        className: 'aris-palette-hand-tool',
        title: handLabel,
        html: utilityEntryHtml(HAND_GLYPH, handLabel),
        action: {
          click: (event: Event) => this.handTool.activateHand(event as unknown as MouseEvent)
        }
      },
      'lasso-tool': {
        group: 'tools',
        className: 'aris-palette-lasso-tool',
        title: lassoLabel,
        html: utilityEntryHtml(LASSO_GLYPH, lassoLabel),
        action: {
          click: (event: Event) => this.lassoTool.activateSelection(event as unknown as MouseEvent)
        }
      },
      'create.free-text': {
        group: 'annotations',
        className: 'aris-palette-free-text',
        title: freeTextLabel,
        html: utilityEntryHtml(FREE_TEXT_GLYPH, freeTextLabel),
        action: {
          click: () => this.modeling.createFreeText(freeTextLabel, { x: 0, y: 0 })
        }
      }
    }

    for (const target of this.targets()) {
      const start = (event: Event): void => {
        this.startPlacement(event, target)
      }
      entries[target.id] = {
        group: target.group,
        className: `aris-palette-${target.objectType.toLocaleLowerCase()}`,
        title: dmtLibraryText('aris.library.item.tooltip', {
          name: target.title,
          objectType: target.objectType,
          symbolNum: target.symbolNum
        }),
        html: libraryEntryHtml(target),
        arisObjectType: target.objectType,
        arisSymbolNum: target.symbolNum,
        arisCatalogId: target.catalogId,
        arisDescriptorFingerprint: target.descriptorFingerprint,
        action: { dragstart: start, click: start }
      }
    }
    return entries
  }

  /** Enter diagram-js placement mode for an exact catalog presentation. */
  startPlacement(event: Event, target: PaletteTarget): Shape {
    this.pendingCatalogId = target.catalogId
    this.placementInvoker =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('.entry')
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

  private enhancePalette(): void {
    const palette = this.canvas.getContainer().querySelector<HTMLElement>('.djs-palette')
    const entries = palette?.querySelector<HTMLElement>('.djs-palette-entries')
    if (!palette || !entries) return
    palette.setAttribute('role', 'region')
    palette.setAttribute('aria-label', dmtLibraryText('aris.library.aria'))

    const search = document.createElement('div')
    search.className = 'aris-library-search'
    const input = document.createElement('input')
    input.type = 'search'
    input.className = 'aris-library-search__input'
    input.placeholder = dmtLibraryText('aris.library.search')
    input.setAttribute('aria-label', dmtLibraryText('aris.library.search'))
    input.autocomplete = 'off'
    const status = document.createElement('span')
    status.className = 'aris-library-search__status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    search.append(input, status)
    entries.prepend(search)

    const labels = new Map<string, string>([
      ['tools', dmtLibraryText('aris.library.group.tools')],
      ['annotations', dmtLibraryText('aris.library.group.annotations')],
      ...DMT_LIBRARY_GROUPS.map((group) => [group.id, dmtLibraryText(group.labelKey)] as const)
    ])
    for (const group of entries.querySelectorAll<HTMLElement>(':scope > .group')) {
      const groupId = group.dataset.group ?? ''
      const name = labels.get(groupId)
      if (name === undefined) continue
      const heading = document.createElement('button')
      heading.type = 'button'
      heading.className = 'aris-library-group__toggle'
      const collapsed = this.collapsedGroups.has(groupId)
      heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      heading.textContent = name
      heading.setAttribute(
        'aria-label',
        dmtLibraryText('aris.library.group.toggle', {
          state: dmtLibraryText(
            collapsed ? 'aris.library.group.expand' : 'aris.library.group.collapse'
          ),
          name
        })
      )
      for (const entry of group.querySelectorAll<HTMLElement>(':scope > .entry')) {
        entry.hidden = collapsed
      }
      heading.addEventListener('click', (event) => {
        event.stopPropagation()
        const nextCollapsed = !this.collapsedGroups.has(groupId)
        if (nextCollapsed) this.collapsedGroups.add(groupId)
        else this.collapsedGroups.delete(groupId)
        heading.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true')
        for (const entry of group.querySelectorAll<HTMLElement>(':scope > .entry')) {
          entry.hidden = nextCollapsed
        }
      })
      group.prepend(heading)
    }

    const applyFilter = (): void => {
      const query = input.value
      const matches = new Set(
        searchDmtLibrary(query, this.modelType()).map((item) => item.catalogId)
      )
      const filtering = query.trim().length > 0
      let visible = 0
      for (const group of entries.querySelectorAll<HTMLElement>(':scope > .group')) {
        const isLibraryGroup = DMT_LIBRARY_GROUPS.some(
          (candidate) => candidate.id === group.dataset.group
        )
        let groupVisible = 0
        for (const entry of group.querySelectorAll<HTMLElement>(':scope > .entry')) {
          const catalogId = entry.dataset.arisCatalogId
          const match = !filtering || (catalogId !== undefined && matches.has(catalogId))
          const collapsed = !filtering && this.collapsedGroups.has(group.dataset.group ?? '')
          entry.hidden = !match || collapsed
          if (match && !collapsed) groupVisible += 1
        }
        group.hidden = filtering && (!isLibraryGroup || groupVisible === 0)
        visible += groupVisible
      }
      status.textContent =
        filtering && visible === 0 ? dmtLibraryText('aris.library.noResults') : ''
    }
    input.addEventListener('input', applyFilter)

    entries.addEventListener('keydown', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (event.key === 'Escape' && input.value.length > 0) {
        input.value = ''
        applyFilter()
        input.focus()
        event.preventDefault()
        return
      }
      if (target === input) return
      const buttons = visibleEntryButtons(entries)
      const current = buttons.indexOf(target.closest<HTMLButtonElement>('.entry')!)
      if (current < 0) return
      let next = current
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = (current + 1) % buttons.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = (current - 1 + buttons.length) % buttons.length
      } else if (event.key === 'Home') {
        next = 0
      } else if (event.key === 'End') {
        next = buttons.length - 1
      } else if (event.key.length === 1 && /\S/u.test(event.key)) {
        input.value += event.key
        applyFilter()
        input.focus()
        event.preventDefault()
        return
      } else {
        return
      }
      buttons[next]?.focus()
      event.preventDefault()
    })
  }

  private refreshPalette(palette: Palette): void {
    const refresh = (palette as Palette & { _update?: () => void })._update
    if (typeof refresh === 'function') refresh.call(palette)
  }
}

function property<T = unknown>(source: unknown, key: string): T | undefined {
  if (source && typeof source === 'object' && key in source) {
    return (source as Record<string, unknown>)[key] as T
  }
  return undefined
}
