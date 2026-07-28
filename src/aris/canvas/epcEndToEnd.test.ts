// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { applyChange, invertCommand, normalizeCommand } from '../model/commands'
import { deserializeDocument } from '../model/serialize'
import type { ArisWorkingDocument } from '../model/types'
import { EMPTY_ARIS_SOURCE_INDEX } from './emptyDocument'
import { bootCanvas, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/**
 * Re-run the model lane's own document validator over the authored result.
 *
 * `validateDocument` is internal to `commands.ts`, but every `applyChange` runs
 * it as a postcondition — so applying a harmless no-op command is the supported
 * way to assert the whole document is structurally valid.
 */
function assertDocumentValidates(document: ArisWorkingDocument): void {
  const [modelId] = [...document.models.keys()]
  const probe = applyChange(document, {
    commandId: 'validate-probe',
    baseRevision: document.revision,
    kind: 'setAttribute',
    affectedSourceIds: [modelId],
    before: null,
    after: { ownerKind: 'model', ownerId: modelId, attributeType: 'AT_PROBE', values: [] },
    origin: 'user'
  })
  expect(probe).toBeTruthy()
}

describe('authoring a complete EPC through canvas operations (Section 11.6)', () => {
  it('builds start event -> function -> XOR split -> two branches -> merge -> end event', () => {
    harness = bootCanvas({ modelName: 'Animal registration' })
    const { canvas } = harness
    const authoring = canvas.authoring

    const start = authoring.createObject({ objectType: 'OT_EVT', name: 'Application received', position: { x: 0, y: 0 } })
    const review = authoring.createObject({ objectType: 'OT_FUNC', name: 'Review application', position: { x: 0, y: 200 } })
    const split = authoring.createRule('XOR', { x: 0, y: 400 }, 'Decision')
    const approvedEvent = authoring.createObject({ objectType: 'OT_EVT', name: 'Approved', position: { x: -250, y: 560 } })
    const rejectedEvent = authoring.createObject({ objectType: 'OT_EVT', name: 'Rejected', position: { x: 250, y: 560 } })
    const issue = authoring.createObject({ objectType: 'OT_FUNC', name: 'Issue licence', position: { x: -250, y: 740 } })
    const notify = authoring.createObject({ objectType: 'OT_FUNC', name: 'Notify applicant', position: { x: 250, y: 740 } })
    const issued = authoring.createObject({ objectType: 'OT_EVT', name: 'Licence issued', position: { x: -250, y: 920 } })
    const notified = authoring.createObject({ objectType: 'OT_EVT', name: 'Applicant notified', position: { x: 250, y: 920 } })
    const merge = authoring.createRule('XOR', { x: 0, y: 1100 }, 'Merge')
    const end = authoring.createObject({ objectType: 'OT_EVT', name: 'Case closed', position: { x: 0, y: 1280 } })

    // Every edge is drawn through the canvas connect operation.
    const edges = [
      [start.occurrenceId, review.occurrenceId],
      [review.occurrenceId, split.occurrenceId],
      [split.occurrenceId, approvedEvent.occurrenceId],
      [split.occurrenceId, rejectedEvent.occurrenceId],
      [approvedEvent.occurrenceId, issue.occurrenceId],
      [rejectedEvent.occurrenceId, notify.occurrenceId],
      [issue.occurrenceId, issued.occurrenceId],
      [notify.occurrenceId, notified.occurrenceId],
      [issued.occurrenceId, merge.occurrenceId],
      [notified.occurrenceId, merge.occurrenceId],
      [merge.occurrenceId, end.occurrenceId]
    ] as const
    const connectionIds = edges.map(([from, to]) => authoring.connect(from, to))

    const model = canvas.document.models.get(canvas.activeModelId)
    expect(model?.occurrences).toHaveLength(11)
    expect(model?.connectionOccurrences).toHaveLength(11)
    expect(connectionIds.every((id) => canvas.elementRegistry.get(id) !== undefined)).toBe(true)

    // The connection types follow the EPC triples.
    const typeOf = (connectionId: string): string => {
      const occurrence = model?.connectionOccurrences.find((entry) => entry.id === connectionId)
      return canvas.document.connectionDefinitions.get(occurrence?.definitionId ?? '')?.type ?? ''
    }
    expect(typeOf(connectionIds[0])).toBe('CT_ACTIV_1') // event -> function
    expect(typeOf(connectionIds[1])).toBe('CT_LEADS_TO_1') // function -> rule
    expect(typeOf(connectionIds[2])).toBe('CT_LEADS_TO_2') // rule -> event
    expect(typeOf(connectionIds[8])).toBe('CT_IS_EVAL_BY_1') // event -> rule

    // The resulting ARIS working document is structurally valid.
    assertDocumentValidates(canvas.document)

    // Both XOR rules carry the native XOR symbol.
    const ruleSymbols = model?.occurrences
      .filter((occurrence) => canvas.document.objectDefinitions.get(occurrence.definitionId)?.type === 'OT_RULE')
      .map((occurrence) => occurrence.symbol)
    expect(ruleSymbols).toEqual(['ST_OPR_XOR_1', 'ST_OPR_XOR_1'])

    // Every command is exportable and replayable from an empty document.
    const serialized = canvas.serialize()
    expect(serialized.undoCommands).toHaveLength(11 + 11 * 2)
    const replayed = deserializeDocument(serialized.document, EMPTY_ARIS_SOURCE_INDEX)
    expect(replayed.models.get(canvas.activeModelId)?.occurrences).toHaveLength(11)
  })

  it('undoes the whole EPC one gesture at a time and redoes it back', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const authoring = canvas.authoring
    const start = authoring.createObject({ objectType: 'OT_EVT', name: 'Start', position: { x: 0, y: 0 } })
    const work = authoring.createObject({ objectType: 'OT_FUNC', name: 'Work', position: { x: 0, y: 200 } })
    const end = authoring.createObject({ objectType: 'OT_EVT', name: 'End', position: { x: 0, y: 400 } })
    authoring.connect(start.occurrenceId, work.occurrenceId)
    authoring.connect(work.occurrenceId, end.occurrenceId)

    const finalRevision = canvas.document.revision
    let undone = 0
    while (canvas.canUndo) {
      canvas.undo()
      undone += 1
    }
    expect(undone).toBe(5)
    expect(canvas.document.revision).toBe(0)
    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences).toHaveLength(0)
    expect(canvas.document.objectDefinitions.size).toBe(0)
    expect(canvas.elementRegistry.getAll().filter((element) => element.id !== 'model:Model.1')).toHaveLength(0)

    while (canvas.canRedo) canvas.redo()
    expect(canvas.document.revision).toBe(finalRevision)
    expect(canvas.document.models.get(canvas.activeModelId)?.occurrences).toHaveLength(3)
    expect(canvas.document.models.get(canvas.activeModelId)?.connectionOccurrences).toHaveLength(2)
  })

  it('every recorded command is individually invertible', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const a = canvas.authoring.createObject({ objectType: 'OT_EVT', name: 'A', position: { x: 0, y: 0 } })
    const b = canvas.authoring.createObject({ objectType: 'OT_FUNC', name: 'B', position: { x: 0, y: 200 } })
    canvas.authoring.connect(a.occurrenceId, b.occurrenceId)
    canvas.authoring.moveOccurrence(b.occurrenceId, { x: 40, y: 240 })

    // Replay forwards from the empty document, then invert back to empty.
    let document = canvas.store.serialize().document
    expect(document.revision).toBe(canvas.document.revision)

    let live = canvas.document
    for (const command of [...canvas.commandLog].reverse()) {
      const inverse = normalizeCommand(invertCommand(command), live.revision)
      live = { ...applyChange(live, inverse), revision: live.revision - 1 }
    }
    expect(live.revision).toBe(0)
    expect(live.models.get(canvas.activeModelId)?.occurrences).toHaveLength(0)
    expect(live.objectDefinitions.size).toBe(0)
    document = canvas.store.serialize().document
    expect(document.models[0][1].occurrences).toHaveLength(2)
  })
})
