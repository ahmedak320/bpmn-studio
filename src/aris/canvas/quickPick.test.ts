// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { findOccurrence } from './commandFactory'
import type { ArisQuickPick } from './quickPick'
import { bootCanvas, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function quickPick(h: Harness): ArisQuickPick {
  return h.canvas.get<ArisQuickPick>('arisQuickPick')
}

function pointerDown(button: HTMLElement): Event {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true })
  button.dispatchEvent(event)
  return event
}

function itemFor(
  container: HTMLElement,
  objectType: string,
  symbolNum?: string
): HTMLButtonElement {
  const selector =
    symbolNum === undefined
      ? `.aris-quick-pick button[data-aris-object-type="${objectType}"]`
      : `.aris-quick-pick button[data-aris-object-type="${objectType}"][data-aris-symbol-num="${symbolNum}"]`
  const button = container.querySelector<HTMLButtonElement>(selector)
  if (!button) throw new Error(`No quick-pick item for ${objectType} ${symbolNum ?? ''}`)
  return button
}

describe('post-placement quick-pick (Lane C4)', () => {
  it('lists the active symbol plus its variant family members', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })

    const members = quickPick(harness).membersFor(created.occurrenceId)
    const active = members.find((member) => member.active)
    expect(active?.symbolNum).toBe('ST_FUNC')

    const systemFunction = members.find((member) => member.symbolNum === 'ST_SYS_FUNC_ACT')
    expect(systemFunction).toMatchObject({ objectType: 'OT_FUNC', enabled: true, active: false })
    // Same object type members are always enabled.
    expect(members.every((member) => member.objectType !== 'OT_FUNC' || member.enabled)).toBe(true)
  })

  it('swaps the occurrence symbol in place for a same-type pick, one undo step', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })
    const commandsBefore = canvas.commandLog.length

    quickPick(harness).open(created.occurrenceId)
    const event = pointerDown(itemFor(container, 'OT_FUNC', 'ST_SYS_FUNC_ACT'))
    // Focus stays in the (would-be) direct-editing textbox.
    expect(event.defaultPrevented).toBe(true)

    expect(findOccurrence(canvas.document, created.occurrenceId)?.symbol).toBe('ST_SYS_FUNC_ACT')
    // Definition is untouched; only the occurrence symbol changed.
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.type).toBe('OT_FUNC')
    expect(canvas.commandLog.length).toBe(commandsBefore + 1)

    canvas.undo()
    expect(findOccurrence(canvas.document, created.occurrenceId)?.symbol).toBe('ST_FUNC')
  })

  it('swaps an information-carrier variant in place', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_INFO_CARR',
      position: { x: 0, y: 0 }
    })
    const startSymbol = findOccurrence(canvas.document, created.occurrenceId)?.symbol

    quickPick(harness).open(created.occurrenceId)
    pointerDown(itemFor(container, 'OT_INFO_CARR', 'ST_DOC'))

    expect(findOccurrence(canvas.document, created.occurrenceId)?.symbol).toBe('ST_DOC')
    expect(startSymbol).not.toBe('ST_DOC')
  })

  it('replaces the object across types for a fresh shape, preserving bounds and name', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_PERS_TYPE',
      name: 'Reviewer',
      position: { x: 40, y: 60 }
    })
    const originalBounds = findOccurrence(canvas.document, created.occurrenceId)?.bounds

    quickPick(harness).open(created.occurrenceId)
    pointerDown(itemFor(container, 'OT_ORG_UNIT'))

    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(false)
    const model = canvas.document.models.get(canvas.activeModelId)
    const orgOccurrence = model?.occurrences.find(
      (occurrence) =>
        canvas.document.objectDefinitions.get(occurrence.definitionId)?.type === 'OT_ORG_UNIT'
    )
    expect(orgOccurrence).toBeTruthy()
    expect(orgOccurrence?.bounds).toEqual(originalBounds)
    expect(
      canvas.document.objectDefinitions.get(orgOccurrence?.definitionId ?? '')?.names.fallback
    ).toBe('Reviewer')

    // A single undo restores the original role object.
    canvas.undo()
    expect(canvas.document.objectDefinitions.get(created.definitionId)?.type).toBe('OT_PERS_TYPE')
  })

  it('disables the cross-type entry once the shape is connected', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const role = canvas.authoring.createObject({
      objectType: 'OT_PERS_TYPE',
      position: { x: 0, y: 0 }
    })
    const fn = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 400, y: 0 }
    })
    canvas.authoring.connect(role.occurrenceId, fn.occurrenceId)

    const orgMember = quickPick(harness)
      .membersFor(role.occurrenceId)
      .find((member) => member.objectType === 'OT_ORG_UNIT')
    expect(orgMember?.enabled).toBe(false)

    quickPick(harness).open(role.occurrenceId)
    const button = itemFor(container, 'OT_ORG_UNIT')
    expect(button.disabled).toBe(true)
    // Activating a disabled member is a no-op: the role object is untouched.
    pointerDown(button)
    expect(canvas.document.objectDefinitions.get(role.definitionId)?.type).toBe('OT_PERS_TYPE')
  })

  it('carries the open inline editor and typed caption onto the replacement across a cross-type swap (#6)', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_PERS_TYPE',
      name: '',
      position: { x: 40, y: 60 }
    })

    // Open the inline editor and type a caption that has NOT been committed yet.
    const directEditing = canvas.get<{
      activate: (element: unknown) => boolean
      isActive: (element?: unknown) => boolean
      complete: () => void
    }>('directEditing')
    directEditing.activate(shape(canvas, created.occurrenceId))
    const typedInto = container.querySelector<HTMLElement>('.djs-direct-editing-content')
    if (!typedInto) throw new Error('No direct-editing content node open.')
    typedInto.innerText = 'Customer'

    // Cross-type swap while the editor is open: replaceNewObject deletes the
    // occurrence + definition the editor captured and creates new ones.
    quickPick(harness).open(created.occurrenceId)
    pointerDown(itemFor(container, 'OT_ORG_UNIT'))

    // The old object is gone; a new OT_ORG_UNIT object took its place.
    expect(canvas.document.objectDefinitions.has(created.definitionId)).toBe(false)
    const model = canvas.document.models.get(canvas.activeModelId)
    const orgOccurrence = model?.occurrences.find(
      (occurrence) =>
        canvas.document.objectDefinitions.get(occurrence.definitionId)?.type === 'OT_ORG_UNIT'
    )
    expect(orgOccurrence).toBeTruthy()

    // The editor retargeted onto the replacement, keeping the typed caption, so
    // committing writes to the NEW definition rather than the deleted one.
    expect(directEditing.isActive()).toBe(true)
    const retargeted = container.querySelector<HTMLElement>('.djs-direct-editing-content')
    expect(retargeted?.innerText).toBe('Customer')
    directEditing.complete()

    expect(
      canvas.document.objectDefinitions.get(orgOccurrence?.definitionId ?? '')?.names.values[
        'en-US'
      ]
    ).toBe('Customer')
  })

  it('keeps the direct-editing textbox focused when a member is pressed', () => {
    harness = bootCanvas()
    const { canvas, container } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })

    const directEditing = canvas.get<{ activate: (element: unknown) => boolean }>('directEditing')
    directEditing.activate(shape(canvas, created.occurrenceId))
    const content = container.querySelector<HTMLElement>('.djs-direct-editing-content')
    if (content) {
      // jsdom only tracks focus on focusable nodes; make sure it is one.
      content.setAttribute('tabindex', '-1')
      content.focus()
    }
    const wasFocused = content !== null && document.activeElement === content

    quickPick(harness).open(created.occurrenceId)
    // Press the already-active member: pointerdown + preventDefault must not
    // move focus off the textbox (and this member makes no model change).
    const event = pointerDown(itemFor(container, 'OT_FUNC', 'ST_FUNC'))
    expect(event.defaultPrevented).toBe(true)
    if (wasFocused) {
      expect(document.activeElement).toBe(content)
    }
  })
})
