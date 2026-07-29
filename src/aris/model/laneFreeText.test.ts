import { describe, expect, it } from 'vitest'
import { createCommandStack, createCommandIdGenerator } from './index'
import { buildTestDocument } from './testFixture'
import type { ArisFreeText, ArisLane } from './types'

describe('lane commands', () => {
  it('adds a lane with bilingual names, geometry, and orientation', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('lane')
    let stack = createCommandStack(document, { idGenerator })

    const lane: ArisLane = {
      id: 'l-new',
      modelId: 'm1',
      names: { values: { 'en-US': 'Approver', 'ar-SA': 'الموافق' }, fallback: 'Approver' },
      laneType: 'LT_POOL',
      orientation: 'vertical',
      startBorder: 0,
      endBorder: 200
    }

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'addLane',
      affectedSourceIds: ['l-new'],
      before: null,
      after: lane,
      origin: 'user'
    })

    const m1 = stack.document.models.get('m1')!
    expect(m1.lanes).toHaveLength(2)
    const added = m1.lanes.find((l) => l.id === 'l-new')!
    expect(added.names.values['ar-SA']).toBe('الموافق')
    expect(added.orientation).toBe('vertical')

    stack = stack.undo()
    expect(stack.document.models.get('m1')!.lanes).toHaveLength(1)
  })

  it('edits an existing lane geometry and names', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('lane')
    let stack = createCommandStack(document, { idGenerator })

    const before = stack.document.models.get('m1')!.lanes.find((l) => l.id === 'l1')!
    const after: ArisLane = {
      ...before,
      startBorder: 10,
      endBorder: 300,
      names: { values: { 'en-US': 'Updated' }, fallback: 'Updated' }
    }

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'editLane',
      affectedSourceIds: ['l1'],
      before,
      after,
      origin: 'user'
    })

    const edited = stack.document.models.get('m1')!.lanes.find((l) => l.id === 'l1')!
    expect(edited.startBorder).toBe(10)
    expect(edited.names.values['en-US']).toBe('Updated')

    stack = stack.undo()
    const restored = stack.document.models.get('m1')!.lanes.find((l) => l.id === 'l1')!
    expect(restored.startBorder).toBe(before.startBorder)
  })

  it('deletes a lane and restores it on undo', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('lane')
    let stack = createCommandStack(document, { idGenerator })

    const before = stack.document.models.get('m1')!.lanes.find((l) => l.id === 'l1')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'deleteLane',
      affectedSourceIds: ['l1'],
      before,
      after: { laneId: 'l1' },
      origin: 'user'
    })

    expect(stack.document.models.get('m1')!.lanes).toHaveLength(0)
    stack = stack.undo()
    expect(stack.document.models.get('m1')!.lanes).toHaveLength(1)
    expect(stack.document.models.get('m1')!.lanes[0].id).toBe('l1')
  })
})

describe('free text commands', () => {
  it('adds free text with bilingual content and geometry', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('ft')
    let stack = createCommandStack(document, { idGenerator })

    const freeText: ArisFreeText = {
      id: 'ft-new',
      modelId: 'm1',
      definitionId: null,
      text: { values: { 'en-US': 'Note', 'ar-SA': 'ملاحظة' }, fallback: 'Note' },
      attributes: [],
      bounds: { x: 5, y: 5, width: 120, height: 30 },
      style: {
        symbol: null,
        fillColor: null,
        strokeColor: null,
        strokeWidth: null,
        lineStyle: null,
        fontStyleSheetId: null,
        zOrder: 1
      }
    }

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'addFreeText',
      affectedSourceIds: ['ft-new'],
      before: null,
      after: freeText,
      origin: 'user'
    })

    const m1 = stack.document.models.get('m1')!
    expect(m1.freeText).toHaveLength(2)
    const added = m1.freeText.find((f) => f.id === 'ft-new')!
    expect(added.text.values['ar-SA']).toBe('ملاحظة')

    stack = stack.undo()
    expect(stack.document.models.get('m1')!.freeText).toHaveLength(1)
  })

  it('edits existing free text content and bounds', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('ft')
    let stack = createCommandStack(document, { idGenerator })

    const before = stack.document.models.get('m1')!.freeText.find((f) => f.id === 'fto1')!
    const after: ArisFreeText = {
      ...before,
      text: { values: { 'en-US': 'Updated note' }, fallback: 'Updated note' },
      bounds: { ...before.bounds, x: 99 }
    }

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'editFreeText',
      affectedSourceIds: ['fto1'],
      before,
      after,
      origin: 'user'
    })

    const edited = stack.document.models.get('m1')!.freeText.find((f) => f.id === 'fto1')!
    expect(edited.text.values['en-US']).toBe('Updated note')
    expect(edited.bounds.x).toBe(99)

    stack = stack.undo()
    const restored = stack.document.models.get('m1')!.freeText.find((f) => f.id === 'fto1')!
    expect(restored.text.values['en-US']).toBe(before.text.values['en-US'])
  })

  it('deletes free text and restores it on undo', async () => {
    const { document } = await buildTestDocument()
    const idGenerator = createCommandIdGenerator('ft')
    let stack = createCommandStack(document, { idGenerator })

    const before = stack.document.models.get('m1')!.freeText.find((f) => f.id === 'fto1')!

    stack = stack.apply({
      commandId: idGenerator(),
      baseRevision: 0,
      kind: 'deleteFreeText',
      affectedSourceIds: ['fto1'],
      before,
      after: { freeTextId: 'fto1' },
      origin: 'user'
    })

    expect(stack.document.models.get('m1')!.freeText).toHaveLength(0)
    stack = stack.undo()
    expect(stack.document.models.get('m1')!.freeText).toHaveLength(1)
  })
})
