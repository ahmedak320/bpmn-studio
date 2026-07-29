// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  ARIS_DOCUMENT_CHANGED,
  ARIS_GESTURE_COMMAND,
  ArisCanvasCommandError
} from './commandBridge'
import { findOccurrence } from './commandFactory'
import { bootCanvas, dragShape, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

describe('command-stack bridge (Section 11.1 / 11.6)', () => {
  it('turns a canvas drag into an ARIS moveOccurrence command and undoes it', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 100, y: 100 }
    })
    const before = findOccurrence(canvas.document, created.occurrenceId)
    expect(before?.bounds).toMatchObject({ x: 100, y: 100 })
    const commandsBeforeDrag = canvas.commandLog.length

    // A real drag through diagram-js's `move` module.
    dragShape(canvas, created.occurrenceId, { x: 60, y: -25 })

    const move = canvas.commandLog[canvas.commandLog.length - 1]
    expect(canvas.commandLog).toHaveLength(commandsBeforeDrag + 1)
    expect(move.kind).toBe('moveOccurrence')
    expect(move.before).toEqual({ occurrenceId: created.occurrenceId, x: 100, y: 100 })
    expect(move.after).toEqual({ occurrenceId: created.occurrenceId, x: 160, y: 75 })

    // The document and the canvas agree.
    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toMatchObject({
      x: 160,
      y: 75
    })
    expect(shape(canvas, created.occurrenceId).x).toBe(160)
    expect(shape(canvas, created.occurrenceId).y).toBe(75)

    canvas.undo()

    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toMatchObject({
      x: 100,
      y: 100
    })
    expect(shape(canvas, created.occurrenceId).x).toBe(100)
    expect(shape(canvas, created.occurrenceId).y).toBe(100)
    expect(canvas.commandLog).toHaveLength(commandsBeforeDrag)
  })

  it('redoes a drag back to the moved position', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })

    // `grid-snapping` snaps the dragged shape's midpoint to the 10-unit grid,
    // so the delta is chosen to land on it exactly.
    dragShape(canvas, created.occurrenceId, { x: 30, y: 45 })
    canvas.undo()
    expect(shape(canvas, created.occurrenceId).x).toBe(0)

    canvas.redo()
    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toMatchObject({
      x: 30,
      y: 45
    })
    expect(shape(canvas, created.occurrenceId).x).toBe(30)
    expect(canvas.commandLog[canvas.commandLog.length - 1].kind).toBe('moveOccurrence')
  })

  it('produces identical results from every undo entry point', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 10, y: 10 }
    })

    // 1. ArisCanvas.undo()
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 200, y: 200 })
    canvas.undo()
    const viaFacade = findOccurrence(canvas.document, created.occurrenceId)?.bounds

    // 2. diagram-js commandStack.undo()
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 200, y: 200 })
    canvas.commandStack.undo()
    const viaCommandStack = findOccurrence(canvas.document, created.occurrenceId)?.bounds

    // 3. editorActions ('undo' is what the keyboard binding triggers)
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 200, y: 200 })
    canvas.get<{ trigger: (action: string) => void }>('editorActions').trigger('undo')
    const viaEditorActions = findOccurrence(canvas.document, created.occurrenceId)?.bounds

    expect(viaFacade).toMatchObject({ x: 10, y: 10 })
    expect(viaCommandStack).toEqual(viaFacade)
    expect(viaEditorActions).toEqual(viaFacade)
    expect(canvas.canUndo).toBe(true)
    expect(canvas.store.canUndo).toBe(true)
  })

  it('keeps the two command stacks in lockstep, one history entry per gesture', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_EVT',
      position: { x: 0, y: 0 }
    })
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 50, y: 0 })
    canvas.authoring.resizeOccurrence(created.occurrenceId, { width: 120, height: 120 })

    // 3 gestures on the diagram-js stack; the create gesture is one ARIS
    // transaction command, so the ARIS stack also has 3 entries.
    expect(canvas.commandLog).toHaveLength(3)
    expect(canvas.commandLog.map((command) => command.kind)).toEqual([
      'transaction',
      'moveOccurrence',
      'resizeOccurrence'
    ])

    canvas.undo()
    canvas.undo()
    expect(canvas.commandLog).toHaveLength(1)
    expect(canvas.store.redoStack).toHaveLength(2)
    expect(canvas.canRedo).toBe(true)

    canvas.redo()
    canvas.redo()
    expect(canvas.commandLog).toHaveLength(3)
    expect(canvas.store.redoStack).toHaveLength(0)
    expect(canvas.document.models.get('Model.1')?.occurrences[0].bounds).toMatchObject({
      x: 50,
      y: 0,
      width: 120,
      height: 120
    })
  })

  it('reverts a multi-command gesture as one undo unit', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 300, y: 0 } })
    const historyBefore = canvas.commandLog.length

    // `connect` emits createConnectionDefinition + createConnectionOccurrence.
    const connectionId = canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    expect(canvas.commandLog).toHaveLength(historyBefore + 2)
    expect(canvas.commandLog.slice(-2).map((command) => command.kind)).toEqual([
      'createConnectionDefinition',
      'createConnectionOccurrence'
    ])
    expect(canvas.elementRegistry.get(connectionId)).toBeTruthy()

    canvas.undo()

    expect(canvas.commandLog).toHaveLength(historyBefore)
    expect(canvas.document.connectionDefinitions.size).toBe(0)
    expect(canvas.document.models.get('Model.1')?.connectionOccurrences).toHaveLength(0)
    expect(canvas.elementRegistry.get(connectionId)).toBeUndefined()
  })

  it('rejects an invalid gesture before either stack is touched', () => {
    harness = bootCanvas()
    const { canvas } = harness
    canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })
    const revisionBefore = canvas.document.revision
    const historyBefore = canvas.commandLog.length

    expect(() => canvas.authoring.moveOccurrence('ObjOcc.does-not-exist', { x: 1, y: 1 })).toThrow(
      ArisCanvasCommandError
    )

    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(historyBefore)
    expect(canvas.commandStack.canUndo()).toBe(true)
    expect(canvas.store.undoStack).toHaveLength(historyBefore)
  })

  it('records gestures under a single diagram-js command name', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const seen: string[] = []
    canvas.eventBus.on('commandStack.changed', () => {
      seen.push('changed')
    })
    canvas.eventBus.on(`commandStack.${ARIS_GESTURE_COMMAND}.executed`, () => {
      seen.push(ARIS_GESTURE_COMMAND)
    })
    canvas.authoring.createObject({ objectType: 'OT_FUNC', position: { x: 0, y: 0 } })
    expect(seen).toContain(ARIS_GESTURE_COMMAND)
  })

  it('announces document changes for every apply, undo and redo', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const reasons: string[] = []
    canvas.eventBus.on(ARIS_DOCUMENT_CHANGED, (event: { reason: string }) => {
      reasons.push(event.reason)
    })
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 5, y: 5 })
    canvas.undo()
    canvas.redo()
    expect(reasons).toEqual([
      'create-object',
      'move-occurrence',
      'move-occurrence',
      'move-occurrence'
    ])
  })

  it('exports the command log as plain JSON (Section 11.6)', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 4, y: 8 }
    })
    canvas.authoring.moveOccurrence(created.occurrenceId, { x: 40, y: 80 })

    const serialized = canvas.serialize()
    const roundTripped = JSON.parse(JSON.stringify(serialized)) as typeof serialized

    expect(roundTripped.undoCommands).toHaveLength(2)
    expect(roundTripped.undoCommands[1].kind).toBe('moveOccurrence')
    expect(roundTripped.document.revision).toBe(canvas.document.revision)
    expect(roundTripped.document.objectDefinitions).toHaveLength(1)
  })
})
