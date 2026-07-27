import I18NModule from 'diagram-js/lib/i18n'

import { getLang, type Lang } from '../i18n'
import { translateDiagram, type DiagramTranslateReplacements } from './diagramTranslations'

const ACCESSIBLE_PALETTE_PRIORITY = 1
const BEFORE_I18N_PRIORITY = 2_000
const AFTER_I18N_PRIORITY = 1

type DiagramTranslate = (template: string, replacements?: DiagramTranslateReplacements) => string

export interface PaletteEntryLike {
  readonly action: unknown
  readonly className?: string
  readonly group?: string
  readonly html?: string
  readonly imageUrl?: string
  readonly separator?: boolean
  readonly title?: string
}

export type PaletteEntriesLike = Record<string, PaletteEntryLike>

interface PaletteLike {
  registerProvider(
    priority: number,
    provider: {
      getPaletteEntries(): (entries: PaletteEntriesLike) => PaletteEntriesLike
    }
  ): void
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
}

interface MinimapLike {
  isOpen(): boolean
  toggle(): void
}

interface ContextPadLike {
  isOpen(): boolean
  open(target: unknown, force?: boolean): void
}

interface PopupMenuLike {
  isOpen(): boolean
  refresh(): void
}

interface PropertiesPanelGroupLike {
  readonly [key: string]: unknown
  readonly items?: readonly Record<string, unknown>[]
}

interface PropertiesPanelLike {
  registerProvider(
    priority: number,
    provider: {
      getGroups(
        element: unknown
      ): (groups: readonly PropertiesPanelGroupLike[]) => readonly PropertiesPanelGroupLike[]
    }
  ): void
}

interface CanvasLike {
  getContainer(): HTMLElement
}

interface DiagramEventBusLike {
  on(event: string, priority: number, callback: (event?: unknown) => void): void
  off(event: string, callback: (event?: unknown) => void): void
  fire(event: string, payload?: unknown): unknown
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function readableActionName(id: string): string {
  return id
    .replaceAll('.', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

/**
 * Preserve custom entry content (notably Create/Append Anything's SVG icon)
 * while replacing its root with a semantic button. diagram-js continues to
 * add data-action, title and icon classes after parsing this HTML.
 */
export function accessiblePaletteButtonHtml(
  html: string | undefined,
  accessibleName: string
): string {
  const source = html?.trim()
  const root = source?.match(/^<([A-Za-z][\w:-]*)([^>]*)>([\s\S]*)<\/\1>\s*$/)
  const attributes = root?.[2] ?? ''
  const content = root?.[3] ?? ''
  const classMatch = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)
  const classes = new Set((classMatch?.[2] ?? '').split(/\s+/).filter(Boolean))
  classes.add('entry')
  const preservedAttributes = attributes
    .replace(/\bclass\s*=\s*(["']).*?\1/gi, '')
    .replace(/\btype\s*=\s*(["']).*?\1/gi, '')
    .replace(/\bdraggable\s*=\s*(["']).*?\1/gi, '')
    .replace(/\baria-label\s*=\s*(["']).*?\1/gi, '')
    .trim()
  const suffix = preservedAttributes ? ` ${preservedAttributes}` : ''
  const language = getLang()

  return (
    `<button type="button" class="${escapeAttribute([...classes].join(' '))}" ` +
    `draggable="true" aria-label="${escapeAttribute(accessibleName)}" ` +
    `lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"${suffix}>` +
    `${content}</button>`
  )
}

/**
 * A final, low-priority updater receives the complete palette assembled by
 * bpmn-js and third-party providers. It changes only presentation markup;
 * action objects, entry IDs, groups and drag/click handlers remain identical.
 */
export class AccessiblePaletteProvider {
  static $inject = ['palette']

  constructor(palette: PaletteLike) {
    palette.registerProvider(ACCESSIBLE_PALETTE_PRIORITY, this)
  }

  getPaletteEntries(): (entries: PaletteEntriesLike) => PaletteEntriesLike {
    return (entries) => {
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.separator) continue
        entries[id] = {
          ...entry,
          html: accessiblePaletteButtonHtml(entry.html, entry.title ?? readableActionName(id))
        }
      }
      return entries
    }
  }
}

/**
 * @bpmn-io's generic Group/ListGroup chrome accepts a `translate` property,
 * but the base BPMN provider does not attach it. Add it to the final public
 * group definitions so section/list controls use the same live translator.
 */
export class LocalizedPropertiesPanelProvider {
  static $inject = ['propertiesPanel', 'translate']

  constructor(
    propertiesPanel: PropertiesPanelLike,
    private readonly translate: DiagramTranslate
  ) {
    propertiesPanel.registerProvider(ACCESSIBLE_PALETTE_PRIORITY, this)
  }

  getGroups(): (
    groups: readonly PropertiesPanelGroupLike[]
  ) => readonly PropertiesPanelGroupLike[] {
    return (groups) =>
      groups.map((group) => ({
        ...group,
        translate: this.translate,
        items: group.items?.map((item) => ({
          ...item,
          translate: this.translate
        }))
      }))
  }
}

interface PaletteCreateEvent {
  readonly container?: HTMLElement
}

interface ContextPadOpenEvent {
  readonly current?: {
    readonly target?: unknown
  }
}

const EMBEDDED_UI_ROOTS =
  '.djs-palette, .djs-context-pad, .djs-popup, .djs-minimap, .bio-properties-panel'
const TECHNICAL_TEXT_TARGETS =
  'code, [title], [aria-label], .bio-properties-panel-entry-label, ' +
  '.bio-properties-panel-description, .djs-popup-label, .djs-popup-title'
const ARABIC_CHARACTER = /[\u0600-\u06ff]/
const TECHNICAL_ENGLISH = /\b(?:BPMN|FEEL|JSON|XML|QName|ISO(?:\s*8601)?|UTC|cron|URL|ID)\b/i

/**
 * Embedded controls live in an intentionally LTR canvas coordinate system.
 * Localize their own text roots explicitly, and isolate only recognized
 * technical tokens/examples as English inside Arabic UI.
 */
export function applyEmbeddedControlLanguage(container: HTMLElement, language: Lang): void {
  for (const root of container.querySelectorAll<HTMLElement>(EMBEDDED_UI_ROOTS)) {
    root.lang = language
    root.dir = language === 'ar' ? 'rtl' : 'ltr'

    for (const element of root.querySelectorAll<HTMLElement>(TECHNICAL_TEXT_TARGETS)) {
      const text = [
        element.textContent ?? '',
        element.getAttribute('title') ?? '',
        element.getAttribute('aria-label') ?? ''
      ].join(' ')
      const isTechnicalEnglish =
        language === 'ar' &&
        !ARABIC_CHARACTER.test(text) &&
        (element.localName === 'code' || TECHNICAL_ENGLISH.test(text))

      if (isTechnicalEnglish) {
        element.dataset.orbitpmTechnicalEnglish = 'true'
        element.lang = 'en'
        element.dir = 'ltr'
      } else if (element.dataset.orbitpmTechnicalEnglish === 'true') {
        delete element.dataset.orbitpmTechnicalEnglish
        element.removeAttribute('lang')
        element.removeAttribute('dir')
      }
    }
  }
}

/**
 * Coordinates live-language refresh and the accessibility semantics that the
 * installed palette/minimap versions do not provide themselves.
 */
export class EmbeddedDiagramControlBehavior {
  static $inject = [
    'eventBus',
    'canvas',
    'palette',
    'minimap',
    'contextPad',
    'popupMenu',
    'translate'
  ]

  private readonly keyboardListeners = new Map<HTMLElement, EventListener>()
  private paletteOpenBeforeLanguageChange: boolean | null = null
  private contextPadTarget: unknown
  private destroyed = false

  constructor(
    private readonly eventBus: DiagramEventBusLike,
    private readonly canvas: CanvasLike,
    private readonly palette: PaletteLike,
    private readonly minimap: MinimapLike,
    private readonly contextPad: ContextPadLike,
    private readonly popupMenu: PopupMenuLike,
    private readonly translate: DiagramTranslate
  ) {
    eventBus.on('palette.create', 1_500, this.onPaletteCreate)
    eventBus.on('palette.changed', AFTER_I18N_PRIORITY, this.refreshPaletteToggle)
    eventBus.on('minimap.toggle', AFTER_I18N_PRIORITY, this.refreshMinimapToggle)
    eventBus.on('contextPad.open', AFTER_I18N_PRIORITY, this.onContextPadOpen)
    eventBus.on('contextPad.close', AFTER_I18N_PRIORITY, this.onContextPadClose)
    eventBus.on('propertiesPanel.rendered', AFTER_I18N_PRIORITY, this.refreshLanguageMarkup)
    eventBus.on('popupMenu.opened', AFTER_I18N_PRIORITY, this.refreshLanguageMarkup)
    eventBus.on('popupMenu.refresh', AFTER_I18N_PRIORITY, this.refreshLanguageMarkup)
    eventBus.on('i18n.changed', BEFORE_I18N_PRIORITY, this.capturePaletteState)
    eventBus.on('i18n.changed', AFTER_I18N_PRIORITY, this.refreshTranslatedControls)
    eventBus.on('diagram.init', AFTER_I18N_PRIORITY, this.initialize)
    eventBus.on('diagram.destroy', BEFORE_I18N_PRIORITY, this.destroy)

    // Minimap creates its DOM synchronously in its constructor. Palette DOM
    // arrives later through palette.create/diagram.init.
    this.installMinimapToggle()
  }

  private readonly initialize = (): void => {
    this.installPaletteToggle()
    this.installMinimapToggle()
    this.refreshAllControls()
  }

  private readonly onPaletteCreate = (event?: unknown): void => {
    const container = (event as PaletteCreateEvent | undefined)?.container
    const toggle = container?.querySelector<HTMLElement>('.djs-palette-toggle')
    if (toggle) this.installKeyboardToggle(toggle, () => this.palette.toggle())
    this.refreshPaletteToggle()
  }

  private readonly onContextPadOpen = (event?: unknown): void => {
    this.contextPadTarget = (event as ContextPadOpenEvent | undefined)?.current?.target
    this.refreshLanguageMarkup()
  }

  private readonly onContextPadClose = (): void => {
    this.contextPadTarget = undefined
  }

  private readonly capturePaletteState = (): void => {
    this.paletteOpenBeforeLanguageChange = this.palette.isOpen()
  }

  private readonly refreshTranslatedControls = (): void => {
    if (this.paletteOpenBeforeLanguageChange === false && this.palette.isOpen()) {
      // Palette._update() always opens. Restore the user's reviewed state.
      this.palette.close()
    }
    this.paletteOpenBeforeLanguageChange = null

    if (this.contextPadTarget !== undefined && this.contextPad.isOpen()) {
      const target = this.contextPadTarget
      this.contextPad.open(target, true)
    }
    if (this.popupMenu.isOpen()) this.popupMenu.refresh()

    // This is the event the properties panel itself uses when providers change;
    // it re-renders the current selection without touching the model.
    this.eventBus.fire('propertiesPanel.providersChanged')
    this.refreshAllControls()
    queueMicrotask(() => this.refreshAllControls())
  }

  private installPaletteToggle(): void {
    const toggle = this.canvas.getContainer().querySelector<HTMLElement>('.djs-palette-toggle')
    if (toggle) this.installKeyboardToggle(toggle, () => this.palette.toggle())
  }

  private installMinimapToggle(): void {
    const toggle = this.canvas.getContainer().querySelector<HTMLElement>('.djs-minimap .toggle')
    if (toggle) this.installKeyboardToggle(toggle, () => this.minimap.toggle())
  }

  private installKeyboardToggle(element: HTMLElement, activate: () => void): void {
    if (this.keyboardListeners.has(element)) return
    element.setAttribute('role', 'button')
    element.tabIndex = 0
    const onKeyDown: EventListener = (rawEvent) => {
      const event = rawEvent as KeyboardEvent
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      event.stopPropagation()
      activate()
    }
    element.addEventListener('keydown', onKeyDown)
    this.keyboardListeners.set(element, onKeyDown)
  }

  private readonly refreshPaletteToggle = (): void => {
    const toggle = this.canvas.getContainer().querySelector<HTMLElement>('.djs-palette-toggle')
    if (!toggle) return
    this.installKeyboardToggle(toggle, () => this.palette.toggle())
    this.setToggleAttributes(toggle, this.palette.isOpen(), 'palette')
  }

  private readonly refreshMinimapToggle = (): void => {
    const toggle = this.canvas.getContainer().querySelector<HTMLElement>('.djs-minimap .toggle')
    if (!toggle) return
    this.installKeyboardToggle(toggle, () => this.minimap.toggle())
    this.setToggleAttributes(toggle, this.minimap.isOpen(), 'minimap')
  }

  private setToggleAttributes(
    toggle: HTMLElement,
    open: boolean,
    control: 'palette' | 'minimap'
  ): void {
    const label = this.translate(
      `${open ? 'Close' : 'Open'} ${control === 'palette' ? 'palette' : 'minimap'}`
    )
    const language = getLang()
    toggle.setAttribute('title', label)
    toggle.setAttribute('aria-label', label)
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('lang', language)
    toggle.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
  }

  private readonly refreshLanguageMarkup = (): void => {
    if (this.destroyed) return
    const canvasContainer = this.canvas.getContainer()
    const editorRoot = canvasContainer.closest<HTMLElement>('.orbitpm-editor') ?? canvasContainer
    applyEmbeddedControlLanguage(editorRoot, getLang())
  }

  private refreshAllControls(): void {
    if (this.destroyed) return
    this.refreshPaletteToggle()
    this.refreshMinimapToggle()
    this.refreshLanguageMarkup()
  }

  private readonly destroy = (): void => {
    this.destroyed = true
    for (const [element, listener] of this.keyboardListeners) {
      element.removeEventListener('keydown', listener)
    }
    this.keyboardListeners.clear()

    this.eventBus.off('palette.create', this.onPaletteCreate)
    this.eventBus.off('palette.changed', this.refreshPaletteToggle)
    this.eventBus.off('minimap.toggle', this.refreshMinimapToggle)
    this.eventBus.off('contextPad.open', this.onContextPadOpen)
    this.eventBus.off('contextPad.close', this.onContextPadClose)
    this.eventBus.off('propertiesPanel.rendered', this.refreshLanguageMarkup)
    this.eventBus.off('popupMenu.opened', this.refreshLanguageMarkup)
    this.eventBus.off('popupMenu.refresh', this.refreshLanguageMarkup)
    this.eventBus.off('i18n.changed', this.capturePaletteState)
    this.eventBus.off('i18n.changed', this.refreshTranslatedControls)
    this.eventBus.off('diagram.init', this.initialize)
    this.eventBus.off('diagram.destroy', this.destroy)
  }
}

/**
 * Final additional module: adds the public diagram-js i18n service absent
 * from stock bpmn-js, overrides its translate value, then installs semantics
 * and live-refresh behaviors.
 */
export const EmbeddedDiagramControlsModule = {
  __depends__: [I18NModule],
  __init__: [
    'orbitpmAccessiblePaletteProvider',
    'orbitpmLocalizedPropertiesPanelProvider',
    'orbitpmEmbeddedDiagramControls'
  ],
  translate: ['value', translateDiagram],
  orbitpmAccessiblePaletteProvider: ['type', AccessiblePaletteProvider],
  orbitpmLocalizedPropertiesPanelProvider: ['type', LocalizedPropertiesPanelProvider],
  orbitpmEmbeddedDiagramControls: ['type', EmbeddedDiagramControlBehavior]
} as const
