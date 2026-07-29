// @vitest-environment jsdom

/**
 * Plan §18.5 step 7 / §18.8 — a chat-applied batch is ONE undoable canvas gesture.
 *
 * These tests drive the real `ArisCanvas` command bridge through the very function
 * `ArisStudioTab.handleApplyChatCommands` calls, so "the rail's Undo and the toolbar's Undo agree"
 * is proved on the product's own history rather than on a stand-in.
 *
 * The defect they pin: the chat seam used to translate the nine direct patch kinds with
 * `before: null`. Such a command applies perfectly and then throws inside
 * `ArisGestureHandler.revert`, which leaves diagram-js's stack index exactly where it was — so the
 * batch stayed on the history, Undo stayed enabled, Redo never enabled, and nothing ever reverted.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { requireObjectDefinition } from '../canvas/commandFactory'
import { createEmptyArisCanvasDocument, DEFAULT_LOCALE_ID } from '../canvas/emptyDocument'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
import type { ArisChatCommand } from '../chat/patchSchema'
import type { ArisWorkingDocument } from '../model/types'
import { applyArisChatCommandsAsGesture } from './arisChatHost'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function nameOf(document: ArisWorkingDocument, definitionId: string): string {
  return requireObjectDefinition(document, definitionId).names.values[DEFAULT_LOCALE_ID] ?? ''
}

function renameCommand(commandId: string, definitionId: string, value: string): ArisChatCommand {
  return {
    commandId,
    kind: 'setLocalizedName',
    targetIds: [definitionId],
    payload: {
      ownerKind: 'objectDefinition',
      ownerId: definitionId,
      localeId: DEFAULT_LOCALE_ID,
      value
    }
  }
}

describe('a chat-applied batch is one undoable canvas gesture (plan §18.5 step 7 / §18.8)', () => {
  it('reverts every command in the batch with a single undo, and redoes them all', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = ['One', 'Two', 'Three'].map((name, index) =>
      canvas.authoring.createObject({
        objectType: 'OT_FUNC',
        name,
        position: { x: 100, y: 100 + index * 200 }
      })
    )

    const revisionBefore = canvas.document.revision
    const gesturesBefore = canvas.commandLog.length
    const namesBefore = created.map((entry) => nameOf(canvas.document, entry.definitionId))
    expect(namesBefore).toEqual(['One', 'Two', 'Three'])

    const batch = created.map((entry, index) =>
      renameCommand(`c-${index}`, entry.definitionId, `Reviewed value ${index + 1}`)
    )
    const committed = applyArisChatCommandsAsGesture(canvas, batch, 'aris.chat.improve')

    // The batch really landed on the live document the rails read.
    expect(committed).not.toBeNull()
    expect(committed).toBe(canvas.document)
    expect(created.map((entry) => nameOf(canvas.document, entry.definitionId))).toEqual([
      'Reviewed value 1',
      'Reviewed value 2',
      'Reviewed value 3'
    ])
    expect(canvas.document.revision).toBe(revisionBefore + batch.length)
    expect(canvas.commandLog).toHaveLength(gesturesBefore + batch.length)
    expect(canvas.canUndo).toBe(true)
    expect(canvas.canRedo).toBe(false)

    // ONE undo — the same call the rail's button and the toolbar's button both make.
    canvas.undo()

    expect(created.map((entry) => nameOf(canvas.document, entry.definitionId))).toEqual(namesBefore)
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(gesturesBefore)
    // A reverted gesture is a redoable one.
    expect(canvas.canRedo).toBe(true)

    canvas.redo()

    expect(created.map((entry) => nameOf(canvas.document, entry.definitionId))).toEqual([
      'Reviewed value 1',
      'Reviewed value 2',
      'Reviewed value 3'
    ])
    expect(canvas.document.revision).toBe(revisionBefore + batch.length)
    expect(canvas.canRedo).toBe(false)
  })

  it('records the whole batch as exactly one diagram-js history entry', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const first = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'First',
      position: { x: 100, y: 100 }
    })
    const second = canvas.authoring.createObject({
      objectType: 'OT_EVT',
      name: 'Second',
      position: { x: 100, y: 300 }
    })

    applyArisChatCommandsAsGesture(
      canvas,
      [
        renameCommand('c-0', first.definitionId, 'Renamed first'),
        renameCommand('c-1', second.definitionId, 'Renamed second')
      ],
      'aris.chat.improve'
    )

    // Undo once: the chat batch is gone but the two authoring gestures before it are not.
    canvas.undo()
    expect(nameOf(canvas.document, first.definitionId)).toBe('First')
    expect(nameOf(canvas.document, second.definitionId)).toBe('Second')
    expect(canvas.canUndo).toBe(true)

    // Undo twice more: the two `create-object` gestures, one entry each.
    canvas.undo()
    canvas.undo()
    expect(canvas.canUndo).toBe(false)
    expect(canvas.commandLog).toHaveLength(0)
  })

  it('applies a confirm-gated connection command, which is two model commands, as one gesture', () => {
    // A source-style model id, because the connection pair allocates its ids through
    // `src/aris/writer/ids.ts`, which only mints ids inside a real ARIS id namespace.
    const seeded = createEmptyArisCanvasDocument({ modelId: 'Model.AAAAAAAAAAA-u-L' })
    harness = bootCanvas({ document: seeded.document, modelId: seeded.modelId })
    const { canvas } = harness
    const source = canvas.authoring.createObject({
      objectType: 'OT_EVT',
      name: 'Start',
      position: { x: 100, y: 100 }
    })
    const target = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Approve',
      position: { x: 100, y: 300 }
    })
    const modelId = canvas.activeModelId
    const connectionsBefore = canvas.document.models.get(modelId)!.connectionOccurrences.length
    const definitionsBefore = canvas.document.connectionDefinitions.size

    const committed = applyArisChatCommandsAsGesture(
      canvas,
      [
        {
          commandId: 'c-cxn',
          kind: 'addCoreConnection',
          targetIds: [source.occurrenceId, target.occurrenceId],
          payload: {
            connectionDefinitionId: 'placeholder-cxn-def',
            connectionOccurrenceId: 'placeholder-cxn-occ',
            connectionType: 'CT_ACTIV_1',
            modelId,
            fromObjectDefinitionId: source.definitionId,
            toObjectDefinitionId: target.definitionId,
            sourceOccurrenceId: source.occurrenceId,
            targetOccurrenceId: target.occurrenceId
          }
        }
      ],
      'aris.chat.improve'
    )

    expect(committed).not.toBeNull()
    expect(canvas.document.models.get(modelId)!.connectionOccurrences).toHaveLength(
      connectionsBefore + 1
    )
    expect(canvas.document.connectionDefinitions.size).toBe(definitionsBefore + 1)

    // Both halves of the pair revert together, on one undo.
    canvas.undo()
    expect(canvas.document.models.get(modelId)!.connectionOccurrences).toHaveLength(
      connectionsBefore
    )
    expect(canvas.document.connectionDefinitions.size).toBe(definitionsBefore)
  })

  it('leaves both stacks untouched when the batch cannot be applied', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Only',
      position: { x: 100, y: 100 }
    })
    const revisionBefore = canvas.document.revision
    const gesturesBefore = canvas.commandLog.length

    const committed = applyArisChatCommandsAsGesture(
      canvas,
      [
        renameCommand('c-0', created.definitionId, 'Renamed'),
        renameCommand('c-1', 'ObjDef.does-not-exist', 'Renamed too')
      ],
      'aris.chat.improve'
    )

    expect(committed).toBeNull()
    expect(nameOf(canvas.document, created.definitionId)).toBe('Only')
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(gesturesBefore)
  })
})
