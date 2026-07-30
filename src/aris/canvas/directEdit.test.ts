// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { Shape } from 'diagram-js/lib/model/Types'

import { freeTextElementId } from './elements'
import { bootCanvas, shape, type Harness } from './testing/harness'

/** The subset of the `diagram-js-direct-editing` service the tests drive. */
interface DirectEditingService {
  activate(element: unknown): boolean
  cancel(): void
  isActive(element?: unknown): boolean
}

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function directEditing(): DirectEditingService {
  return harness!.canvas.get<DirectEditingService>('directEditing')
}

function content(): HTMLElement {
  const node = harness!.container.querySelector('.djs-direct-editing-content')
  if (!(node instanceof HTMLElement)) throw new Error('No direct-editing content node is open.')
  return node
}

/** Dispatch a real keydown carrying `keyCode` (jsdom does not derive it from `key`). */
function fireKey(target: Element, keyCode: number): void {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'keyCode', { value: keyCode })
  target.dispatchEvent(event)
}

const ENTER = 13
const ESCAPE = 27
const F2 = 113

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Fire diagram-js's `create.end` for a freshly dragged palette shape, exactly
 * as the real gesture does once it commits. The stock handler (priority 1000)
 * turns the draft into a real occurrence and rewrites `context.shape`; the
 * direct-editing handler (priority 250) then opens the editor on it.
 *
 * `snapped` short-circuits the snapping module's `create.end` listener, which
 * otherwise expects a snap context built during a real `create.start`.
 */
function placeFunction(at: { x: number; y: number }): void {
  const canvas = harness!.canvas
  const paletteTarget = canvas.palette.targets().find((t) => t.objectType === 'OT_FUNC')
  if (!paletteTarget) throw new Error('No OT_FUNC palette target.')
  const draft = canvas.palette.draftShape(paletteTarget)
  const root = canvas.canvas.getRootElement()

  canvas.eventBus.fire('create.end', {
    context: { shape: draft, elements: [draft], canExecute: true, target: root, hints: {} },
    shape: draft,
    elements: [draft],
    snapped: { x: true, y: true },
    x: at.x,
    y: at.y
  })
}

function createFunction(name: string): {
  definitionId: string
  occurrenceId: string
  shape: Shape
} {
  const created = harness!.canvas.authoring.createObject({
    objectType: 'OT_FUNC',
    name,
    position: { x: 200, y: 150 }
  })
  return {
    definitionId: created.definitionId,
    occurrenceId: created.occurrenceId,
    shape: shape(harness!.canvas, created.occurrenceId)
  }
}

function nameFor(definitionId: string, localeId: string): string | undefined {
  return harness!.canvas.document.objectDefinitions.get(definitionId)?.names.values[localeId]
}

describe('ArisDirectEditingProvider (Lane C3)', () => {
  it('opens a contenteditable populated with the current name', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    expect(directEditing().activate(target.shape)).toBe(true)
    expect(directEditing().isActive()).toBe(true)
    expect(content().getAttribute('contenteditable')).toBe('true')
    expect(content().innerText).toBe('Original')
  })

  it('commits typed text + Enter under the display locale, one undo reverts', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    directEditing().activate(target.shape)
    content().innerText = 'Renamed'
    fireKey(content(), ENTER)

    expect(nameFor(target.definitionId, 'en-US')).toBe('Renamed')

    harness.canvas.undo()
    expect(nameFor(target.definitionId, 'en-US')).toBe('Original')
  })

  it('discards the edit on Escape', () => {
    harness = bootCanvas()
    const target = createFunction('Original')
    const commandsBefore = harness.canvas.commandLog.length

    directEditing().activate(target.shape)
    content().innerText = 'Discarded'
    fireKey(content(), ESCAPE)

    expect(nameFor(target.definitionId, 'en-US')).toBe('Original')
    expect(harness.canvas.commandLog).toHaveLength(commandsBefore)
    expect(directEditing().isActive()).toBe(false)
  })

  it('commits on focusout', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    directEditing().activate(target.shape)
    content().innerText = 'ViaBlur'
    content().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))

    expect(nameFor(target.definitionId, 'en-US')).toBe('ViaBlur')
  })

  it('activates on double-click', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    expect(directEditing().isActive()).toBe(false)
    harness.canvas.eventBus.fire('element.dblclick', { element: target.shape })
    expect(directEditing().isActive()).toBe(true)
  })

  it('activates on F2 with a single editable selection', () => {
    harness = bootCanvas()
    const target = createFunction('Original')
    harness.canvas.selection.select(target.shape)

    harness.canvas.eventBus.fire('keyboard.keydown', { keyEvent: { keyCode: F2 } })
    expect(directEditing().isActive()).toBe(true)
  })

  it('opens the editor on the shape a create.end just committed', async () => {
    harness = bootCanvas()
    const occurrencesBefore = harness.canvas.document.models.get(harness.canvas.activeModelId)
      ?.occurrences.length

    placeFunction({ x: 320, y: 240 })

    // The placement created exactly one occurrence...
    expect(
      harness.canvas.document.models.get(harness.canvas.activeModelId)?.occurrences.length
    ).toBe((occurrencesBefore ?? 0) + 1)
    // ...and its editor is open on the next tick.
    await tick()
    expect(directEditing().isActive()).toBe(true)
  })

  it('commits an Arabic string under ar-AE after setContentLanguage(ar)', () => {
    harness = bootCanvas()
    harness.canvas.setContentLanguage('ar')
    const target = createFunction('Original')

    directEditing().activate(shape(harness.canvas, target.occurrenceId))
    content().innerText = 'وظيفة'
    fireKey(content(), ENTER)

    expect(nameFor(target.definitionId, 'ar-AE')).toBe('وظيفة')
    expect(nameFor(target.definitionId, 'en-US')).toBe('Original')
  })

  it('marks the content node dir="auto" for RTL-safe layout', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    directEditing().activate(target.shape)
    expect(content().getAttribute('dir')).toBe('auto')
    expect(content().style.unicodeBidi).toBe('plaintext')
  })

  it('gives the editing content node a localized placeholder and aria-label', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    directEditing().activate(target.shape)
    expect(content().getAttribute('placeholder')).toBe('Type a label')
    expect(content().getAttribute('aria-label')).toBe('Edit label')
  })

  it('removes a just-created empty free-text note when its edit is cancelled', () => {
    harness = bootCanvas()
    const freeTextId = harness.canvas.authoring.addFreeText({
      text: '',
      bounds: { x: 100, y: 100, width: 160, height: 32 }
    })
    const elementId = freeTextElementId(freeTextId)
    const noteShape = shape(harness.canvas, elementId)

    directEditing().activate(noteShape)
    fireKey(content(), ESCAPE)

    expect(harness.canvas.elementRegistry.get(elementId)).toBeUndefined()
    expect(harness.canvas.document.models.get(harness.canvas.activeModelId)?.freeText).toHaveLength(
      0
    )
  })

  it('commits against the id captured at activate, surviving an unrelated re-render', () => {
    harness = bootCanvas()
    const target = createFunction('Original')

    directEditing().activate(target.shape)
    content().innerText = 'Renamed'
    // An unrelated re-render replaces every element's frozen business object.
    harness.canvas.bridge.refresh('unrelated-change')
    fireKey(content(), ENTER)

    expect(nameFor(target.definitionId, 'en-US')).toBe('Renamed')
  })
})
