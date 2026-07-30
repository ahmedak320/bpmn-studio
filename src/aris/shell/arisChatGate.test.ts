// @vitest-environment jsdom

/**
 * Plan §18.8 exit gate, proved LIVE against the real `ArisCanvas` command bridge — the same
 * `applyArisChatCommandsAsGesture` call `ArisStudioTab.handleApplyChatCommands` makes.
 *
 * `arisChatUndo.test.ts` already proves the undo/redo bullet of the gate on this same harness.
 * This file proves the other three bullets, each on the live canvas rather than only at the pure
 * `classification.ts` / `applyEngine.ts` / `patchSchema.ts` unit level those modules already cover
 * exhaustively:
 *
 *  - "Safe field completion auto-applies atomically" and "Topology/destructive changes remain
 *    confirmation-gated" — `partitionCommandsByClassification` (the exact function
 *    `interviewLoop.ts`'s `handleProposalReceived` calls, plan §18.2 step 9) splits a mixed batch;
 *    only the automatic partition is ever hande to `applyArisChatCommandsAsGesture` on its own,
 *    and the confirm partition is proved to still sit unapplied on the live canvas until a
 *    SEPARATE call — mirroring the two-step flow `ArisChatImproveRail` drives in the real product
 *    (auto-apply now, hold the rest for confirmation) rather than re-deriving the policy by hand.
 *  - "Invalid AI patches make no changes" — proved here for two failure shapes the existing
 *    `arisChatUndo.test.ts` batch-failure test does not cover: a `kind` outside the sixteen plan
 *    §18.3 allows (`toArisEditCommands`'s exhaustive switch throws `ArisChatUnsupportedCommandError`
 *    for it — see `arisChatHost.ts`), and a patch command that expands into TWO model commands
 *    (`addMetadataConnection`) where only the second half's precondition fails — proving the first
 *    half, which would have succeeded standing alone, never leaks into the live document either.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { partitionCommandsByClassification } from '../chat/classification'
import type { ArisChatCommand } from '../chat/patchSchema'
import { requireObjectDefinition } from '../canvas/commandFactory'
import { createEmptyArisCanvasDocument, DEFAULT_LOCALE_ID } from '../canvas/emptyDocument'
import { bootCanvas, type Harness } from '../canvas/testing/harness'
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

describe('confirmation-gated commands never apply until a separate, explicit gesture (plan §18.4/§18.8, live canvas)', () => {
  it('auto-applies only the safe partition of a mixed batch; the confirm partition stays unapplied until confirmed separately', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const keep = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Keep',
      position: { x: 100, y: 100 }
    })
    const doomed = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Doomed',
      position: { x: 100, y: 300 }
    })
    const modelId = canvas.activeModelId
    const occurrencesBefore = canvas.document.models.get(modelId)!.occurrences.length
    const gesturesBefore = canvas.commandLog.length

    const rename: ArisChatCommand = {
      commandId: 'c-rename',
      kind: 'setLocalizedName',
      targetIds: [keep.definitionId],
      payload: {
        ownerKind: 'objectDefinition',
        ownerId: keep.definitionId,
        localeId: DEFAULT_LOCALE_ID,
        value: 'Kept, reviewed'
      }
    }
    const remove: ArisChatCommand = {
      commandId: 'c-delete',
      kind: 'deleteOccurrence',
      targetIds: [doomed.occurrenceId],
      payload: { occurrenceId: doomed.occurrenceId }
    }

    // The exact split `interviewLoop.ts`'s `handleProposalReceived` performs on a real AI
    // proposal via `partitionCommandsByClassification` (plan §18.2 step 9) — not re-derived here.
    const { automatic, confirm } = partitionCommandsByClassification([rename, remove])
    expect(automatic.map((c) => c.commandId)).toEqual(['c-rename'])
    expect(confirm.map((c) => c.commandId)).toEqual(['c-delete'])

    // Step 1: only the automatic partition ever reaches the live canvas (plan §18.5).
    const afterAuto = applyArisChatCommandsAsGesture(canvas, automatic, 'aris.chat.improve')
    expect(afterAuto).not.toBeNull()
    expect(nameOf(canvas.document, keep.definitionId)).toBe('Kept, reviewed')
    // The destructive command was never handed to the gesture — the occurrence must still exist.
    expect(canvas.document.models.get(modelId)!.occurrences).toHaveLength(occurrencesBefore)
    expect(
      canvas.document.models.get(modelId)!.occurrences.some((o) => o.id === doomed.occurrenceId)
    ).toBe(true)
    expect(canvas.commandLog).toHaveLength(gesturesBefore + 1)

    // Step 2: only once the confirm partition is separately handed over (i.e., only after the
    // user has confirmed it, plan §18.6) does the destructive command apply — as its OWN gesture.
    const afterConfirm = applyArisChatCommandsAsGesture(
      canvas,
      confirm,
      'aris.chat.improve.confirmed'
    )
    expect(afterConfirm).not.toBeNull()
    expect(canvas.document.models.get(modelId)!.occurrences).toHaveLength(occurrencesBefore - 1)
    expect(
      canvas.document.models.get(modelId)!.occurrences.some((o) => o.id === doomed.occurrenceId)
    ).toBe(false)
    expect(canvas.commandLog).toHaveLength(gesturesBefore + 2)

    // The two gestures are independent: undoing once reverts ONLY the confirmed deletion.
    canvas.undo()
    expect(
      canvas.document.models.get(modelId)!.occurrences.some((o) => o.id === doomed.occurrenceId)
    ).toBe(true)
    expect(nameOf(canvas.document, keep.definitionId)).toBe('Kept, reviewed')

    // Undoing again reverts the safe rename too — each gesture restores its own prior revision.
    canvas.undo()
    expect(nameOf(canvas.document, keep.definitionId)).toBe('Keep')
  })
})

describe('an unrecognized command kind is rejected and changes nothing (plan §18.3, live canvas)', () => {
  it('rejects a batch containing only an unrecognized kind', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const revisionBefore = canvas.document.revision
    const gesturesBefore = canvas.commandLog.length

    const bogus = {
      commandId: 'c-bogus',
      kind: 'wipeEverything',
      targetIds: ['x'],
      payload: {}
    } as unknown as ArisChatCommand

    const committed = applyArisChatCommandsAsGesture(canvas, [bogus], 'aris.chat.improve')

    expect(committed).toBeNull()
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(gesturesBefore)
    expect(canvas.canUndo).toBe(false)
  })

  it('rejects the whole batch when an unrecognized kind follows a command that would have succeeded on its own', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      name: 'Only',
      position: { x: 100, y: 100 }
    })
    const revisionBefore = canvas.document.revision
    const gesturesBefore = canvas.commandLog.length

    const rename: ArisChatCommand = {
      commandId: 'c-rename',
      kind: 'setLocalizedName',
      targetIds: [created.definitionId],
      payload: {
        ownerKind: 'objectDefinition',
        ownerId: created.definitionId,
        localeId: DEFAULT_LOCALE_ID,
        value: 'Renamed'
      }
    }
    const bogus = {
      commandId: 'c-bogus',
      kind: 'wipeEverything',
      targetIds: ['x'],
      payload: {}
    } as unknown as ArisChatCommand

    const committed = applyArisChatCommandsAsGesture(canvas, [rename, bogus], 'aris.chat.improve')

    expect(committed).toBeNull()
    // The valid FIRST command must not have leaked through either — the batch is one atomic unit.
    expect(nameOf(canvas.document, created.definitionId)).toBe('Only')
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(gesturesBefore)
  })
})

describe('a two-model-command patch command rolls back both halves when only the second fails (plan §18.8)', () => {
  it('addMetadataConnection: a bad modelId fails the occurrence half; the definition half must not leak in either', () => {
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
    const revisionBefore = canvas.document.revision
    const gesturesBefore = canvas.commandLog.length
    const definitionsBefore = canvas.document.connectionDefinitions.size

    const command: ArisChatCommand = {
      commandId: 'c-bad-cxn',
      kind: 'addMetadataConnection',
      targetIds: [source.occurrenceId, target.occurrenceId],
      payload: {
        connectionDefinitionId: 'placeholder-cxn-def',
        connectionOccurrenceId: 'placeholder-cxn-occ',
        connectionType: 'CT_IS_INPUT_FOR',
        // `createConnectionDefinition` never reads `modelId`, so the DEFINITION half applies
        // cleanly against the scratch fold; `createConnectionOccurrence`'s precondition requires
        // it to resolve (src/aris/model/commands.ts) and this deliberately does not, so the
        // OCCURRENCE half is the one that fails.
        modelId: 'Model.does-not-exist',
        fromObjectDefinitionId: source.definitionId,
        toObjectDefinitionId: target.definitionId,
        sourceOccurrenceId: source.occurrenceId,
        targetOccurrenceId: target.occurrenceId
      }
    }

    const committed = applyArisChatCommandsAsGesture(canvas, [command], 'aris.chat.improve')

    expect(committed).toBeNull()
    // The definition half is folded only into a local scratch document inside
    // `applyArisChatCommandsAsGesture`; `canvas.bridge.execute` is never reached, so it never
    // reaches the live document either.
    expect(canvas.document.connectionDefinitions.size).toBe(definitionsBefore)
    expect(canvas.document.revision).toBe(revisionBefore)
    expect(canvas.commandLog).toHaveLength(gesturesBefore)
  })
})
