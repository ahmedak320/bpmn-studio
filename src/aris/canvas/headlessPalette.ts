/**
 * DOM-free implementation of diagram-js's `palette` service contract.
 *
 * ARIS renders its tools in the docked React rail, but diagram-js extensions
 * may still resolve the conventional `palette` service or register providers.
 * Keeping that API available avoids coupling the injector graph to a floating
 * `.djs-palette` element.
 */

import type EventBus from 'diagram-js/lib/core/EventBus'
import type PaletteProvider from 'diagram-js/lib/features/palette/PaletteProvider'
import type {
  PaletteEntries,
  PaletteEntry,
  PaletteEntryAction
} from 'diagram-js/lib/features/palette/PaletteProvider'

const DEFAULT_PRIORITY = 1000

interface PaletteProvidersEvent {
  readonly providers: PaletteProvider[]
}

interface ToolManagerUpdateEvent {
  readonly tool?: string
}

interface DelegatedPaletteEvent extends Event {
  readonly delegateTarget?: EventTarget | null
  readonly originalEvent?: Event
}

/** The public diagram-js Palette API, without any DOM creation or attachment. */
export class HeadlessPalette {
  static $inject = ['eventBus']

  private opened = false
  private activeTool: string | null = null

  constructor(private readonly eventBus: EventBus) {
    eventBus.on<ToolManagerUpdateEvent>('tool-manager.update', (event) => {
      this.updateToolHighlight(event.tool ?? null)
    })
  }

  registerProvider(provider: PaletteProvider): void
  registerProvider(priority: number, provider: PaletteProvider): void
  registerProvider(
    priorityOrProvider: number | PaletteProvider,
    registeredProvider?: PaletteProvider
  ): void {
    const priority = typeof priorityOrProvider === 'number' ? priorityOrProvider : DEFAULT_PRIORITY
    const provider =
      typeof priorityOrProvider === 'number' ? registeredProvider : priorityOrProvider

    if (provider === undefined) return

    this.eventBus.on<PaletteProvidersEvent>('palette.getProviders', priority, (event) => {
      event.providers.push(provider)
    })
    this._update()
  }

  getEntries(): PaletteEntries {
    const providers: PaletteProvider[] = []
    this.eventBus.fire('palette.getProviders', { providers })

    return providers.reduce<PaletteEntries>((entries, provider) => {
      const entriesOrUpdater = provider.getPaletteEntries()

      if (typeof entriesOrUpdater === 'function') return entriesOrUpdater(entries)

      return Object.assign(entries, entriesOrUpdater)
    }, {})
  }

  trigger(action: string, event: DelegatedPaletteEvent, autoActivate = false): unknown {
    const button = event.delegateTarget ?? event.target

    if (!(button instanceof Element)) {
      event.preventDefault()
      return undefined
    }

    const entryId = button.getAttribute('data-action')
    if (entryId === null) return undefined

    return this.triggerEntry(entryId, action, event.originalEvent ?? event, autoActivate)
  }

  triggerEntry(entryId: string, action: string, event: Event, autoActivate = false): unknown {
    const entry = this.getEntries()[entryId]
    if (entry === undefined) return undefined
    if (this.eventBus.fire('palette.trigger', { entry, event }) === false) return undefined

    const handler = this.entryHandler(entry, action)
    if (handler !== undefined) return handler(event, autoActivate)

    event.preventDefault()
    return undefined
  }

  close(): void {
    this.opened = false
    this.fireChanged()
  }

  open(): void {
    this.opened = true
    this.fireChanged()
  }

  toggle(): void {
    if (this.opened) this.close()
    else this.open()
  }

  isActiveTool(tool: string): boolean {
    return tool.length > 0 && this.activeTool === tool
  }

  updateToolHighlight(tool: string | null): void {
    this.activeTool = tool
  }

  isOpen(): boolean {
    return this.opened
  }

  /** Compatibility hook used by palette providers after their entries change. */
  _update(): void {
    // Entries are resolved lazily by getEntries(); there is no DOM to rebuild.
  }

  private entryHandler(entry: PaletteEntry, action: string): PaletteEntryAction | undefined {
    return typeof entry.action === 'function' ? entry.action : entry.action[action]
  }

  private fireChanged(): void {
    this.eventBus.fire('palette.changed', {
      open: this.opened,
      twoColumn: false
    })
  }
}
