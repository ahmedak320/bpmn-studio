// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n'
import {
  ARABIC_DIAGRAM_TRANSLATIONS,
  translateDiagram,
  translateDiagramForLanguage
} from '../diagramTranslations'
import {
  AccessiblePaletteProvider,
  EmbeddedDiagramControlBehavior,
  LocalizedPropertiesPanelProvider,
  type PaletteEntriesLike
} from '../embeddedDiagramControls'

type EventCallback = (event?: unknown) => void

class FakeEventBus {
  private readonly handlers = new Map<
    string,
    Array<{ readonly priority: number; readonly callback: EventCallback }>
  >()
  readonly fired: Array<{ readonly event: string; readonly payload?: unknown }> = []

  on(event: string, priority: number, callback: EventCallback): void {
    const handlers = this.handlers.get(event) ?? []
    handlers.push({ priority, callback })
    handlers.sort((left, right) => right.priority - left.priority)
    this.handlers.set(event, handlers)
  }

  off(event: string, callback: EventCallback): void {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((handler) => handler.callback !== callback)
    )
  }

  fire(event: string, payload?: unknown): void {
    this.fired.push({ event, payload })
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      handler.callback(payload)
    }
  }
}

beforeEach(() => {
  setLang('en')
  document.body.innerHTML = ''
})

afterEach(() => {
  setLang('en')
  document.body.innerHTML = ''
})

describe('diagram-js translation catalogue', () => {
  it('covers standard palette, context-pad, create/append, properties and minimap controls', () => {
    expect(Object.keys(ARABIC_DIAGRAM_TRANSLATIONS).length).toBeGreaterThan(175)
    expect(translateDiagramForLanguage('ar', 'Create task')).toBe('إنشاء مهمة')
    expect(translateDiagramForLanguage('ar', 'Append element')).toBe('إلحاق عنصر')
    expect(translateDiagramForLanguage('ar', 'Connect to other element')).toBe('الربط بعنصر آخر')
    expect(translateDiagramForLanguage('ar', 'Completion condition')).toBe('شرط الإكمال')
    expect(translateDiagramForLanguage('ar', 'Open minimap')).toBe('فتح الخريطة المصغّرة')
  })

  it('interpolates translated and fallback templates without dropping zero values', () => {
    expect(
      translateDiagramForLanguage('ar', 'Open {element}', {
        element: 'العملية الفرعية'
      })
    ).toBe('فتح العملية الفرعية')
    expect(
      translateDiagramForLanguage('ar', 'Unknown count: {count}', {
        count: 0
      })
    ).toBe('Unknown count: 0')
    expect(translateDiagramForLanguage('en', 'Open {element}', { element: 'Task' })).toBe(
      'Open Task'
    )
  })
})

describe('accessible palette provider', () => {
  it('emits semantic draggable buttons while preserving click and drag actions', () => {
    let updater: ((entries: PaletteEntriesLike) => PaletteEntriesLike) | undefined
    const palette = {
      registerProvider: vi.fn(
        (
          priority: number,
          provider: {
            getPaletteEntries(): (entries: PaletteEntriesLike) => PaletteEntriesLike
          }
        ) => {
          expect(priority).toBe(1)
          updater = provider.getPaletteEntries()
        }
      )
    }
    new AccessiblePaletteProvider(palette as never)

    const click = vi.fn()
    const dragstart = vi.fn()
    const action = { click, dragstart }
    const entries: PaletteEntriesLike = {
      create: {
        action,
        title: 'Create element',
        html: '<div class="entry custom-entry"><svg aria-hidden="true"></svg></div>'
      },
      separator: {
        action: vi.fn(),
        separator: true
      }
    }
    const transformed = updater!(entries)
    const template = document.createElement('template')
    template.innerHTML = transformed.create.html!
    const button = template.content.firstElementChild as HTMLButtonElement

    expect(button.localName).toBe('button')
    expect(button.type).toBe('button')
    expect(button.draggable).toBe(true)
    expect(button.classList.contains('entry')).toBe(true)
    expect(button.classList.contains('custom-entry')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Create element')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(transformed.create.action).toBe(action)
    expect(transformed.separator.html).toBeUndefined()

    ;(transformed.create.action as typeof action).click(new Event('click'), false)
    ;(transformed.create.action as typeof action).dragstart(new Event('dragstart'), false)
    expect(click).toHaveBeenCalledOnce()
    expect(dragstart).toHaveBeenCalledOnce()
  })

  it('uses the current language each time diagram-js rebuilds the palette', () => {
    let updater: ((entries: PaletteEntriesLike) => PaletteEntriesLike) | undefined
    new AccessiblePaletteProvider({
      registerProvider: (
        _priority: number,
        provider: {
          getPaletteEntries(): (entries: PaletteEntriesLike) => PaletteEntriesLike
        }
      ) => {
        updater = provider.getPaletteEntries()
      }
    } as never)

    setLang('ar')
    const arabic = updater!({
      task: {
        action: vi.fn(),
        title: translateDiagram('Create task')
      }
    })
    expect(arabic.task.html).toContain('aria-label="إنشاء مهمة"')
    expect(arabic.task.html).toContain('lang="ar"')

    setLang('en')
    const english = updater!({
      task: {
        action: vi.fn(),
        title: translateDiagram('Create task')
      }
    })
    expect(english.task.html).toContain('aria-label="Create task"')
    expect(english.task.html).toContain('lang="en"')
  })
})

describe('localized properties provider', () => {
  it('injects the live translator into generic groups and list items', () => {
    let registered:
      | {
          getGroups(
            element: unknown
          ): (groups: readonly Record<string, unknown>[]) => readonly Record<string, unknown>[]
        }
      | undefined
    const propertiesPanel = {
      registerProvider: vi.fn((_priority: number, provider: typeof registered) => {
        registered = provider
      })
    }
    const translator = vi.fn(translateDiagram)
    new LocalizedPropertiesPanelProvider(propertiesPanel as never, translator)

    const original = [
      {
        id: 'general',
        label: 'General'
      },
      {
        id: 'list',
        items: [{ id: 'one' }]
      }
    ]
    const localized = registered!.getGroups({})(original) as Array<{
      translate?: unknown
      items?: Array<{ translate?: unknown }>
    }>

    expect(localized[0]!.translate).toBe(translator)
    expect(localized[1]!.translate).toBe(translator)
    expect(localized[1]!.items?.[0]?.translate).toBe(translator)
    expect(original[0]).not.toHaveProperty('translate')
  })
})

describe('embedded control behavior', () => {
  it('localizes toggles live, supports Enter/Space, preserves palette state and refreshes panels', () => {
    const editor = document.createElement('div')
    editor.className = 'orbitpm-editor'
    editor.innerHTML = `
      <div class="canvas">
        <div class="djs-palette open">
          <div class="djs-palette-toggle"></div>
        </div>
        <div class="djs-minimap">
          <div class="toggle"></div>
        </div>
        <div class="djs-context-pad"></div>
        <div class="djs-popup"></div>
      </div>
      <div class="bio-properties-panel">
        <code>ISO 8601 / BPMN</code>
      </div>
    `
    document.body.appendChild(editor)
    const canvasContainer = editor.querySelector<HTMLElement>('.canvas')!
    const eventBus = new FakeEventBus()

    let paletteOpen = true
    let minimapOpen = false
    let contextOpen = true
    const paletteToggle = vi.fn(() => {
      paletteOpen = !paletteOpen
      eventBus.fire('palette.changed', { open: paletteOpen })
    })
    const minimapToggle = vi.fn(() => {
      minimapOpen = !minimapOpen
      eventBus.fire('minimap.toggle', { open: minimapOpen })
    })
    const contextPadRefresh = vi.fn()
    const popupRefresh = vi.fn()
    const palette = {
      isOpen: () => paletteOpen,
      open: () => {
        paletteOpen = true
        eventBus.fire('palette.changed', { open: true })
      },
      close: () => {
        paletteOpen = false
        eventBus.fire('palette.changed', { open: false })
      },
      toggle: paletteToggle
    }

    // Match installed Palette behavior: i18n.changed rebuilds then opens it.
    eventBus.on('i18n.changed', 1_000, () => palette.open())
    new EmbeddedDiagramControlBehavior(
      eventBus as never,
      { getContainer: () => canvasContainer },
      palette as never,
      {
        isOpen: () => minimapOpen,
        toggle: minimapToggle
      },
      {
        isOpen: () => contextOpen,
        open: (target, force) => contextPadRefresh(target, force)
      },
      {
        isOpen: () => true,
        refresh: popupRefresh
      },
      translateDiagram
    )
    eventBus.fire('diagram.init')
    eventBus.fire('contextPad.open', { current: { target: { id: 'Task_1' } } })

    const paletteControl = editor.querySelector<HTMLElement>('.djs-palette-toggle')!
    const minimapControl = editor.querySelector<HTMLElement>('.djs-minimap .toggle')!
    expect(paletteControl.getAttribute('role')).toBe('button')
    expect(paletteControl.tabIndex).toBe(0)
    expect(paletteControl.title).toBe('Close palette')
    expect(minimapControl.title).toBe('Open minimap')

    const space = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true
    })
    minimapControl.dispatchEvent(space)
    expect(space.defaultPrevented).toBe(true)
    expect(minimapToggle).toHaveBeenCalledOnce()
    expect(minimapControl.getAttribute('aria-expanded')).toBe('true')
    expect(minimapControl.title).toBe('Close minimap')

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })
    paletteControl.dispatchEvent(enter)
    expect(paletteOpen).toBe(false)

    setLang('ar')
    eventBus.fire('i18n.changed')

    expect(paletteOpen).toBe(false)
    expect(paletteControl.title).toBe('فتح لوحة الأدوات')
    expect(paletteControl.getAttribute('aria-label')).toBe('فتح لوحة الأدوات')
    expect(minimapControl.title).toBe('إغلاق الخريطة المصغّرة')
    expect(minimapControl.lang).toBe('ar')
    expect(minimapControl.dir).toBe('rtl')
    expect(contextPadRefresh).toHaveBeenCalledWith({ id: 'Task_1' }, true)
    expect(popupRefresh).toHaveBeenCalledOnce()
    expect(
      eventBus.fired.filter(({ event }) => event === 'propertiesPanel.providersChanged')
    ).toHaveLength(1)

    const technical = editor.querySelector<HTMLElement>('code')!
    expect(technical.dataset.orbitpmTechnicalEnglish).toBe('true')
    expect(technical.lang).toBe('en')
    expect(technical.dir).toBe('ltr')

    setLang('en')
    eventBus.fire('i18n.changed')
    expect(paletteControl.title).toBe('Open palette')
    expect(minimapControl.title).toBe('Close minimap')
    expect(technical.dataset.orbitpmTechnicalEnglish).toBeUndefined()

    contextOpen = false
    eventBus.fire('diagram.destroy')
    paletteControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(paletteToggle).toHaveBeenCalledOnce()
  })
})
