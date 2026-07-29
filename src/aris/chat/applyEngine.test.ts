import { describe, expect, it } from 'vitest'
import {
  applySafeCommandsAtomically,
  applySelectedConfirmedCommands,
  buildConfirmationPreview,
  buildUndoDescriptor
} from './applyEngine'
import { buildCleanEepcDocument, createTestApplyHost } from './testFixtures'
import { parseArisChatCommand, type ArisChatCommand } from './patchSchema'

function cmd(kind: string, targetIds: readonly string[], payload: unknown): ArisChatCommand {
  return parseArisChatCommand({
    commandId: `${kind}-${targetIds.join(',')}`,
    kind,
    targetIds,
    payload
  })
}

function fourAutomaticCommands(): readonly ArisChatCommand[] {
  return [
    cmd('setLocalizedName', ['OD_START'], {
      ownerKind: 'objectDefinition',
      ownerId: 'OD_START',
      localeId: 'ar',
      value: 'محدث'
    }),
    cmd('setAttribute', ['OD_FUNC'], {
      ownerKind: 'objectDefinition',
      ownerId: 'OD_FUNC',
      attributeType: 'AT_DESC',
      values: [{ localeId: 'en', text: 'desc' }]
    }),
    cmd('addAttributeValue', ['OD_FUNC'], {
      ownerKind: 'objectDefinition',
      ownerId: 'OD_FUNC',
      attributeType: 'AT_DESC',
      value: { localeId: 'ar', text: 'وصف' }
    }),
    cmd('addMetadataDefinition', ['OD_NEW'], {
      definitionId: 'OD_NEW',
      objectType: 'OT_APPL_SYS',
      names: { values: { en: 'New System' }, fallback: 'New System' }
    })
  ]
}

describe('applySafeCommandsAtomically — happy path', () => {
  it('applies every automatic command and returns a receipt', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.objectDefinitions.has('OD_NEW')).toBe(true)
    expect(result.receipt.entries).toHaveLength(4)
    expect(result.receipt.entries.every((entry) => entry.origin === 'ai-auto')).toBe(true)
    expect(result.receipt.revisionBefore).toBe(document.revision)
    expect(result.document).not.toBe(document)
  })

  it('is a true no-op success for an empty command list', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const result = applySafeCommandsAtomically(document, document.revision, [], host)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document).toBe(document)
    expect(result.receipt.entries).toEqual([])
  })

  it('produces an undo descriptor targeting the pre-application revision', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const undo = buildUndoDescriptor(result.receipt)
    expect(undo.targetRevision).toBe(document.revision)
    expect(undo.commandIds).toHaveLength(4)
  })
})

describe('applySafeCommandsAtomically — abort conditions never leave a partial document', () => {
  it('aborts on a stale base revision without touching the document', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const result = applySafeCommandsAtomically(
      document,
      document.revision + 1,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('stale-revision')
    expect(result.document).toBe(document)
  })

  it('aborts if any command in the batch is not classified automatic', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const notAutomatic = cmd('deleteOccurrence', ['OC_START'], { occurrenceId: 'OC_START' })
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      [...fourAutomaticCommands(), notAutomatic],
      host
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('non-automatic-command')
    expect(result.document).toBe(document)
  })

  it('aborts and rolls back when semantic validation fails after every command applied', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost({
      validateSemantic: () => [{ code: 'bad-semantics', message: 'nope' }]
    })
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('semantic-validation-failed')
    expect(result.document).toBe(document)
    expect(result.document).toEqual(buildCleanEepcDocument())
  })

  it('aborts and rolls back when reference validation fails', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost({
      validateReference: () => [{ code: 'bad-reference', message: 'nope' }]
    })
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('reference-validation-failed')
    expect(result.document).toBe(document)
  })

  it('aborts and rolls back when accounting validation fails', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost({
      validateAccounting: () => [{ code: 'bad-accounting', message: 'nope' }]
    })
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('accounting-validation-failed')
    expect(result.document).toBe(document)
  })

  it('never calls saveDraftRevision when the batch fails', () => {
    const document = buildCleanEepcDocument()
    let saveCalls = 0
    const host = createTestApplyHost({
      validateSemantic: () => [{ code: 'bad', message: 'nope' }],
      saveDraftRevision: () => {
        saveCalls += 1
        return 'rev-1'
      }
    })
    applySafeCommandsAtomically(document, document.revision, fourAutomaticCommands(), host)
    expect(saveCalls).toBe(0)
  })

  it('calls saveDraftRevision exactly once on success and records the returned id', () => {
    const document = buildCleanEepcDocument()
    let saveCalls = 0
    const host = createTestApplyHost({
      saveDraftRevision: () => {
        saveCalls += 1
        return 'draft-42'
      }
    })
    const result = applySafeCommandsAtomically(
      document,
      document.revision,
      fourAutomaticCommands(),
      host
    )
    expect(saveCalls).toBe(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.draftRevisionId).toBe('draft-42')
  })
})

describe('rollback proof — injected command-application failure at every index 1..N', () => {
  const commands = fourAutomaticCommands()

  it.each([1, 2, 3, 4])(
    'failure at command #%i leaves the document deep-equal to its pre-application state',
    (failAtIndex) => {
      const document = buildCleanEepcDocument()
      const host = createTestApplyHost({
        beforeApply: (_doc, _command, callIndex) => {
          if (callIndex === failAtIndex) throw new Error(`injected failure at call ${callIndex}`)
        }
      })

      const result = applySafeCommandsAtomically(document, document.revision, commands, host)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('command-application-failed')
      // Same reference — the strongest possible rollback guarantee.
      expect(result.document).toBe(document)
      // And, independently, structurally identical to a fresh, untouched document.
      expect(result.document).toEqual(buildCleanEepcDocument())
    }
  )
})

// --- 18.6 confirmation-gated application ----------------------------------------------------

describe('buildConfirmationPreview', () => {
  it('reports affected ids and a simulated after-document without mutating the original', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const deleteCommand = cmd('deleteOccurrence', ['OC_END_A'], { occurrenceId: 'OC_END_A' })

    const outcome = buildConfirmationPreview(document, [deleteCommand], host, (doc, ids) =>
      ids.map(
        (id) =>
          doc.objectDefinitions.has(id) ||
          doc.models.get('M1')?.occurrences.some((o) => o.id === id)
      )
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.preview.affectedIds).toEqual(['OC_END_A'])
    expect(
      outcome.preview.simulatedDocument.models
        .get('M1')
        ?.occurrences.some((o) => o.id === 'OC_END_A')
    ).toBe(false)
    // The real document is untouched.
    expect(document.models.get('M1')?.occurrences.some((o) => o.id === 'OC_END_A')).toBe(true)
  })

  it('reports failure without throwing when a command cannot apply', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const badCommand = cmd('deleteOccurrence', ['NOPE'], { occurrenceId: 'NOPE' })
    const outcome = buildConfirmationPreview(document, [badCommand], host)
    expect(outcome.ok).toBe(false)
  })
})

describe('applySelectedConfirmedCommands', () => {
  function twoConfirmCommands(): readonly ArisChatCommand[] {
    return [
      cmd('deleteOccurrence', ['OC_END_A'], { occurrenceId: 'OC_END_A' }),
      cmd('deleteOccurrence', ['OC_END_R'], { occurrenceId: 'OC_END_R' })
    ]
  }

  it('applies only the selected commands and keeps the rest as suggestions', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const [first, second] = twoConfirmCommands()

    const result = applySelectedConfirmedCommands(
      document,
      document.revision,
      [first, second],
      new Set([first.commandId]),
      host
    )

    expect(result.outcome.ok).toBe(true)
    if (!result.outcome.ok) return
    const model = result.outcome.document.models.get('M1')!
    expect(model.occurrences.some((o) => o.id === 'OC_END_A')).toBe(false)
    expect(model.occurrences.some((o) => o.id === 'OC_END_R')).toBe(true)
    expect(result.remainingSuggestions).toEqual([second])
  })

  it('keeps every proposed command as a suggestion when nothing is selected', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const commands = twoConfirmCommands()
    const result = applySelectedConfirmedCommands(
      document,
      document.revision,
      commands,
      new Set(),
      host
    )
    expect(result.outcome.ok).toBe(false)
    if (result.outcome.ok) return
    expect(result.outcome.reason).toBe('no-commands-selected')
    expect(result.outcome.document).toBe(document)
    expect(result.remainingSuggestions).toEqual(commands)
  })

  it('on stale revision, applies nothing and keeps every proposed command as a suggestion', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const commands = twoConfirmCommands()
    const result = applySelectedConfirmedCommands(
      document,
      document.revision + 1,
      commands,
      new Set([commands[0].commandId]),
      host
    )
    expect(result.outcome.ok).toBe(false)
    if (result.outcome.ok) return
    expect(result.outcome.reason).toBe('stale-revision')
    expect(result.outcome.document).toBe(document)
    expect(result.remainingSuggestions).toEqual(commands)
  })

  it('on application failure, rolls back and keeps every proposed command as a suggestion', () => {
    const document = buildCleanEepcDocument()
    const host = createTestApplyHost()
    const bad = cmd('deleteOccurrence', ['NOPE'], { occurrenceId: 'NOPE' })
    const commands = [twoConfirmCommands()[0], bad]
    const result = applySelectedConfirmedCommands(
      document,
      document.revision,
      commands,
      new Set(commands.map((c) => c.commandId)),
      host
    )
    expect(result.outcome.ok).toBe(false)
    if (result.outcome.ok) return
    expect(result.outcome.document).toBe(document)
    expect(result.remainingSuggestions).toEqual(commands)
  })
})
