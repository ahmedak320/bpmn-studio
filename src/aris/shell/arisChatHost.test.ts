import { describe, expect, it } from 'vitest'

import { applySafeCommandsAtomically } from '../chat/applyEngine'
import { classifyCommandKind } from '../chat/classification'
import { ARIS_CHAT_COMMAND_KINDS, type ArisChatCommand } from '../chat/patchSchema'
import { addAttachmentCommand, listAttachments } from '../canvas/attachments'
import {
  createDefinitionCommand,
  createOccurrenceCommand,
  findOccurrence
} from '../canvas/commandFactory'
import { createEmptyArisCanvasDocument } from '../canvas/emptyDocument'
import { applyCommand as applyModelCommand } from '../model/commands'
import { createCommandStack } from '../model/commandStack'
import type { ArisObjectDefinition, ArisWorkingDocument } from '../model/types'
import {
  ARIS_ID_KEY_ALPHABET,
  ARIS_ID_KEY_LENGTH,
  createArisIdAllocator,
  formatDefinitionId,
  parseArisId
} from '../writer/ids'
import {
  ARIS_CHAT_SUPPORTED_COMMAND_KINDS,
  ArisChatUnsupportedCommandError,
  applyOrderedModelCommands,
  createArisChatApplyHost,
  toArisEditCommand,
  toArisEditCommands
} from './arisChatHost'

interface Fixture {
  readonly document: ArisWorkingDocument
  readonly modelId: string
  readonly startDefId: string
  readonly startOccId: string
  readonly funcDefId: string
  readonly funcOccId: string
}

/** A minimal but real document: one EEPC model with a start event and a function, connectable. */
function buildFixture(): Fixture {
  const { document: empty, modelId } = createEmptyArisCanvasDocument({
    modelId: 'Model.AAAAAAAAAAA-u-L'
  })
  const startDefId = 'ObjDef.BBBBBBBBBBB-p-L'
  const startOccId = 'ObjOcc.AAAAAAAAAAA-u-L-CCCCCCCCCCC-x-L-33-c'
  const funcDefId = 'ObjDef.DDDDDDDDDDD-p-L'
  const funcOccId = 'ObjOcc.AAAAAAAAAAA-u-L-EEEEEEEEEEE-x-L-33-c'

  let document = empty
  document = applyModelCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-start-def', baseRevision: document.revision, origin: 'user' },
      { definitionId: startDefId, objectType: 'OT_EVT', symbolNum: 'ST_EVT', name: 'Start' }
    )
  )
  document = applyModelCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-start-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: startOccId,
        definitionId: startDefId,
        modelId,
        symbolNum: 'ST_EVT',
        bounds: { x: 100, y: 100, width: 100, height: 80 }
      }
    )
  )
  document = applyModelCommand(
    document,
    createDefinitionCommand(
      { commandId: 'seed-func-def', baseRevision: document.revision, origin: 'user' },
      { definitionId: funcDefId, objectType: 'OT_FUNC', symbolNum: 'ST_FUNC', name: 'Approve' }
    )
  )
  document = applyModelCommand(
    document,
    createOccurrenceCommand(
      { commandId: 'seed-func-occ', baseRevision: document.revision, origin: 'user' },
      {
        occurrenceId: funcOccId,
        definitionId: funcDefId,
        modelId,
        symbolNum: 'ST_FUNC',
        bounds: { x: 100, y: 300, width: 100, height: 80 }
      }
    )
  )

  return { document, modelId, startDefId, startOccId, funcDefId, funcOccId }
}

describe('toArisEditCommand — direct (already-supported) command kinds', () => {
  it('still translates setLocalizedName unchanged after the rewrite', () => {
    const { document, funcDefId } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-name',
      kind: 'setLocalizedName',
      targetIds: [funcDefId],
      payload: {
        ownerKind: 'objectDefinition',
        ownerId: funcDefId,
        localeId: 'en-US',
        value: 'Approve v2'
      }
    }
    const edit = toArisEditCommand(document, command)
    expect(edit.kind).toBe('setLocalizedName')
    expect(edit.after).toEqual(command.payload)
  })

  it('still narrows setRoute points to {x, y} after the rewrite', () => {
    const { document, startOccId, funcOccId, modelId, startDefId, funcDefId } = buildFixture()
    // Seed a connection occurrence to route.
    const withConnection = applyOrderedModelCommands(
      document,
      toArisEditCommands(
        document,
        {
          commandId: 'seed-cxn',
          kind: 'addMetadataConnection',
          targetIds: ['seed-cxn-def', 'seed-cxn-occ'],
          payload: {
            connectionDefinitionId: 'seed-cxn-def',
            connectionType: 'CT_TRIGGERS',
            connectionOccurrenceId: 'seed-cxn-occ',
            modelId,
            fromObjectDefinitionId: startDefId,
            toObjectDefinitionId: funcDefId,
            sourceOccurrenceId: startOccId,
            targetOccurrenceId: funcOccId
          }
        },
        'user'
      )
    )
    const connectionOccurrenceId = withConnection.models.get(modelId)!.connectionOccurrences[0]!.id
    const command: ArisChatCommand = {
      commandId: 'c-route',
      kind: 'setRoute',
      targetIds: [connectionOccurrenceId],
      payload: { connectionOccurrenceId, route: [{ x: 1.4, y: 2.6 }] }
    }
    const edit = toArisEditCommand(withConnection, command)
    expect(edit.after).toEqual({ connectionOccurrenceId, route: [{ x: 1.4, y: 2.6 }] })
  })

  it('lists all fifteen plan §18.3 command kinds as supported', () => {
    expect([...ARIS_CHAT_SUPPORTED_COMMAND_KINDS].sort()).toEqual(
      [...ARIS_CHAT_COMMAND_KINDS].sort()
    )
    expect(ARIS_CHAT_SUPPORTED_COMMAND_KINDS.size).toBe(15)
  })

  it('throws ArisChatUnsupportedCommandError for a kind outside the fifteen', () => {
    const { document } = buildFixture()
    const bogus = {
      commandId: 'c-bogus',
      kind: 'notARealCommand',
      targetIds: ['x'],
      payload: {}
    } as unknown as ArisChatCommand
    expect(() => toArisEditCommand(document, bogus)).toThrow(ArisChatUnsupportedCommandError)
  })
})

describe('toArisEditCommand — newly implemented creation/removal commands', () => {
  it('addMetadataDefinition creates a real object definition with an allocated id, and is undoable', () => {
    const { document } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-def',
      kind: 'addMetadataDefinition',
      targetIds: ['placeholder-app-sys'],
      payload: {
        definitionId: 'placeholder-app-sys',
        objectType: 'OT_APPL_SYS',
        names: { values: { en: 'Payments Gateway' }, fallback: 'Payments Gateway' }
      }
    }
    const edit = toArisEditCommand(document, command, 'ai-auto')
    expect(edit.kind).toBe('createDefinition')
    const definition = edit.after as ArisObjectDefinition
    expect(definition.id).not.toBe('placeholder-app-sys')
    expect(parseArisId(definition.id)?.kind).toBe('ObjDef')
    // The document's own locale convention ('en-US', seeded by the fixture) is reused, not '1033'.
    expect(definition.names.values['en-US']).toBe('Payments Gateway')

    const stack = createCommandStack(document).apply(edit)
    expect(stack.document.objectDefinitions.get(definition.id)?.type).toBe('OT_APPL_SYS')

    const undone = stack.undo()
    expect(undone.document).toEqual(document)
  })

  it('addMetadataOccurrence creates a real occurrence of an existing definition, and is undoable', () => {
    const { document, modelId, funcDefId } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-occ',
      kind: 'addMetadataOccurrence',
      targetIds: ['placeholder-occ'],
      payload: { occurrenceId: 'placeholder-occ', definitionId: funcDefId, modelId, symbol: null }
    }
    const edit = toArisEditCommand(document, command, 'ai-auto')
    expect(edit.kind).toBe('createOccurrence')
    const occurrenceId = (edit.after as { readonly id: string }).id
    expect(occurrenceId).not.toBe('placeholder-occ')
    expect(parseArisId(occurrenceId)?.kind).toBe('ObjOcc')

    const stack = createCommandStack(document).apply(edit)
    expect(findOccurrence(stack.document, occurrenceId)?.definitionId).toBe(funcDefId)

    const undone = stack.undo()
    expect(undone.document).toEqual(document)
  })

  it('addMetadataConnection creates a connection definition+occurrence as an ordered pair, and is undoable', () => {
    const { document, modelId, startDefId, funcDefId, startOccId, funcOccId } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-mcxn',
      kind: 'addMetadataConnection',
      targetIds: ['placeholder-cxn-def', 'placeholder-cxn-occ'],
      payload: {
        connectionDefinitionId: 'placeholder-cxn-def',
        connectionType: 'CT_IS_INPUT_FOR',
        connectionOccurrenceId: 'placeholder-cxn-occ',
        modelId,
        fromObjectDefinitionId: startDefId,
        toObjectDefinitionId: funcDefId,
        sourceOccurrenceId: startOccId,
        targetOccurrenceId: funcOccId
      }
    }
    // A single `toArisEditCommand` refuses this kind — it always produces two commands.
    expect(() => toArisEditCommand(document, command, 'ai-auto')).toThrow(
      /translates into 2 model commands/
    )

    const [definitionEdit, occurrenceEdit] = toArisEditCommands(document, command, 'ai-auto')
    expect(definitionEdit!.kind).toBe('createConnectionDefinition')
    expect(occurrenceEdit!.kind).toBe('createConnectionOccurrence')

    const stack = createCommandStack(document).apply(definitionEdit!).apply(occurrenceEdit!)
    const created = stack.document.models
      .get(modelId)!
      .connectionOccurrences.find(
        (connection) =>
          connection.sourceOccurrenceId === startOccId &&
          connection.targetOccurrenceId === funcOccId
      )
    expect(created).toBeDefined()
    expect(parseArisId(created!.id)?.kind).toBe('CxnOcc')
    expect(parseArisId(created!.definitionId)?.kind).toBe('CxnDef')

    // Undo is LIFO: the occurrence goes first, then the definition it depended on.
    const undone = stack.undo().undo()
    expect(undone.document).toEqual(document)
  })

  it('addCoreObject creates a control-flow definition+occurrence in one transaction, and is undoable', () => {
    const { document, modelId } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-core-obj',
      kind: 'addCoreObject',
      targetIds: ['placeholder-func-def', 'placeholder-func-occ'],
      payload: {
        definitionId: 'placeholder-func-def',
        occurrenceId: 'placeholder-func-occ',
        modelId,
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: { values: { en: 'Verify identity' }, fallback: 'Verify identity' }
      }
    }
    const edit = toArisEditCommand(document, command, 'ai-confirmed')
    expect(edit.kind).toBe('transaction')

    const stack = createCommandStack(document).apply(edit)
    const created = [...stack.document.objectDefinitions.values()].find(
      (definition) => definition.names.fallback === 'Verify identity'
    )
    expect(created).toBeDefined()
    expect(parseArisId(created!.id)?.kind).toBe('ObjDef')
    const occurrence = stack.document.models
      .get(modelId)!
      .occurrences.find((candidate) => candidate.definitionId === created!.id)
    expect(occurrence).toBeDefined()
    expect(parseArisId(occurrence!.id)?.kind).toBe('ObjOcc')

    const undone = stack.undo()
    expect(undone.document).toEqual(document)
  })

  it('addCoreConnection creates a control-flow connection in one transaction, and is undoable (incl. return back-edges)', () => {
    const { document, modelId, startDefId, funcDefId, startOccId, funcOccId } = buildFixture()
    const command: ArisChatCommand = {
      commandId: 'c-core-cxn',
      kind: 'addCoreConnection',
      targetIds: ['placeholder-flow-def', 'placeholder-flow-occ'],
      payload: {
        connectionDefinitionId: 'placeholder-flow-def',
        connectionType: 'CT_ACTIVATES',
        connectionOccurrenceId: 'placeholder-flow-occ',
        modelId,
        fromObjectDefinitionId: funcDefId,
        toObjectDefinitionId: startDefId,
        sourceOccurrenceId: funcOccId,
        targetOccurrenceId: startOccId,
        isReturnBackEdge: true
      }
    }
    const [definitionEdit, occurrenceEdit] = toArisEditCommands(document, command, 'ai-confirmed')
    expect(definitionEdit!.kind).toBe('createConnectionDefinition')
    expect(occurrenceEdit!.kind).toBe('createConnectionOccurrence')

    const stack = createCommandStack(document).apply(definitionEdit!).apply(occurrenceEdit!)
    const created = stack.document.models
      .get(modelId)!
      .connectionOccurrences.find(
        (connection) =>
          connection.sourceOccurrenceId === funcOccId &&
          connection.targetOccurrenceId === startOccId
      )
    expect(created).toBeDefined()

    const undone = stack.undo().undo()
    expect(undone.document).toEqual(document)
  })

  it('removeAttachment removes an OrbitPM attachment via setAttribute, and is undoable', () => {
    const { document: base, funcDefId } = buildFixture()
    const attachment = {
      id: 'attach-1',
      fileName: 'spec.pdf',
      mimeType: 'application/pdf',
      size: 3,
      dataBase64: 'AAA='
    }
    const document = applyModelCommand(
      base,
      addAttachmentCommand(
        { commandId: 'seed-attach', baseRevision: base.revision, origin: 'user' },
        base,
        funcDefId,
        attachment
      )
    )
    expect(listAttachments(document, funcDefId)).toHaveLength(1)

    const command: ArisChatCommand = {
      commandId: 'c-remove-attach',
      kind: 'removeAttachment',
      targetIds: [funcDefId],
      payload: { attachmentId: 'attach-1', ownerId: funcDefId }
    }
    const edit = toArisEditCommand(document, command, 'ai-confirmed')
    expect(edit.kind).toBe('setAttribute')

    const stack = createCommandStack(document).apply(edit)
    expect(listAttachments(stack.document, funcDefId)).toHaveLength(0)

    const undone = stack.undo()
    expect(undone.document).toEqual(document)
  })
})

describe('a created metadata satellite is a real, selectable object', () => {
  it('has both a real definition id and a real occurrence id once both commands apply', () => {
    const { document, modelId } = buildFixture()
    const host = createArisChatApplyHost({ origin: 'ai-auto' })

    const defCommand: ArisChatCommand = {
      commandId: 'sat-def',
      kind: 'addMetadataDefinition',
      targetIds: ['sat-def-placeholder'],
      payload: {
        definitionId: 'sat-def-placeholder',
        objectType: 'OT_APPL_SYS',
        names: { values: { en: 'Ledger' }, fallback: 'Ledger' }
      }
    }
    const occCommand: ArisChatCommand = {
      commandId: 'sat-occ',
      kind: 'addMetadataOccurrence',
      targetIds: ['sat-occ-placeholder'],
      payload: {
        occurrenceId: 'sat-occ-placeholder',
        definitionId: 'sat-def-placeholder',
        modelId,
        symbol: null
      }
    }

    const afterDef = host.applyCommand(document, defCommand)
    const afterOcc = host.applyCommand(afterDef, occCommand)

    const realDefinition = [...afterOcc.objectDefinitions.values()].find(
      (definition) => definition.names.fallback === 'Ledger'
    )
    expect(realDefinition).toBeDefined()
    expect(realDefinition!.id).not.toBe('sat-def-placeholder')

    // The occurrence command's `definitionId` placeholder resolved to the SAME real id the
    // definition command allocated a moment before — proving cross-command correlation works.
    const occurrence = afterOcc.models
      .get(modelId)!
      .occurrences.find((candidate) => candidate.definitionId === realDefinition!.id)
    expect(occurrence).toBeDefined()
    expect(occurrence!.id).not.toBe('sat-occ-placeholder')
    expect(parseArisId(occurrence!.id)?.kind).toBe('ObjOcc')
  })
})

describe('creation and topology commands stay confirmation-gated (plan §18.4)', () => {
  it('addCoreObject and addCoreConnection classify as confirm, not automatic', () => {
    expect(classifyCommandKind('addCoreObject')).toBe('confirm')
    expect(classifyCommandKind('addCoreConnection')).toBe('confirm')
  })

  it('applySafeCommandsAtomically refuses to auto-apply an addCoreObject even though it is now translatable', () => {
    const { document, modelId } = buildFixture()
    const host = createArisChatApplyHost({ origin: 'ai-auto' })
    const command: ArisChatCommand = {
      commandId: 'core-1',
      kind: 'addCoreObject',
      targetIds: ['x', 'y'],
      payload: {
        definitionId: 'x',
        occurrenceId: 'y',
        modelId,
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: { values: { en: 'New step' }, fallback: 'New step' }
      }
    }
    const outcome = applySafeCommandsAtomically(document, document.revision, [command], host)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('non-automatic-command')
    expect(outcome.document).toBe(document)
  })
})

describe('atomic rollback on a failing creation command (plan §18.5)', () => {
  it('leaves the document untouched when one command in the batch fails', () => {
    const { document, modelId } = buildFixture()
    const host = createArisChatApplyHost({ origin: 'ai-auto' })
    const good: ArisChatCommand = {
      commandId: 'good-1',
      kind: 'addMetadataDefinition',
      targetIds: ['sat'],
      payload: {
        definitionId: 'sat',
        objectType: 'OT_APPL_SYS',
        names: { values: { en: 'X' }, fallback: 'X' }
      }
    }
    const bad: ArisChatCommand = {
      commandId: 'bad-1',
      kind: 'addMetadataOccurrence',
      targetIds: ['sat-occ'],
      // References a model that does not exist — must fail translation.
      payload: {
        occurrenceId: 'sat-occ',
        definitionId: 'sat',
        modelId: 'Model.does-not-exist',
        symbol: null
      }
    }
    void modelId

    const outcome = applySafeCommandsAtomically(document, document.revision, [good, bad], host)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('command-application-failed')
    expect(outcome.document).toBe(document)
    expect(outcome.document).toEqual(document)
    // Even the VALID first command in the batch left no trace.
    expect(
      [...outcome.document.objectDefinitions.values()].some((d) => d.names.fallback === 'X')
    ).toBe(false)
  })
})

describe('allocated ids never collide with existing source ids', () => {
  it('retries with a fresh id when the first candidate is already taken', () => {
    const { document: base } = buildFixture()

    // Build the exact 11-character key a counter-based random source produces on its Nth call.
    const keyOf = (offset: number): string =>
      Array.from(
        { length: ARIS_ID_KEY_LENGTH },
        (_, index) => ARIS_ID_KEY_ALPHABET[(offset + index) % ARIS_ID_KEY_ALPHABET.length]
      ).join('')
    const firstAttemptId = formatDefinitionId('ObjDef', keyOf(0))
    const secondAttemptId = formatDefinitionId('ObjDef', keyOf(ARIS_ID_KEY_LENGTH))

    // Seed the document so the allocator's first candidate is already taken.
    const document = applyModelCommand(
      base,
      createDefinitionCommand(
        { commandId: 'seed-collision', baseRevision: base.revision, origin: 'user' },
        {
          definitionId: firstAttemptId,
          objectType: 'OT_APPL_SYS',
          symbolNum: 'ST_APPL_SYS',
          name: 'Existing'
        }
      )
    )

    let calls = 0
    const random = (): number => {
      const value = calls % ARIS_ID_KEY_ALPHABET.length
      calls += 1
      return value / ARIS_ID_KEY_ALPHABET.length
    }

    const command: ArisChatCommand = {
      commandId: 'c-collide',
      kind: 'addMetadataDefinition',
      targetIds: ['placeholder'],
      payload: {
        definitionId: 'placeholder',
        objectType: 'OT_APPL_SYS',
        names: { values: { en: 'New' }, fallback: 'New' }
      }
    }
    const host = createArisChatApplyHost({ origin: 'ai-auto', randomIdSource: random })
    const next = host.applyCommand(document, command)

    const created = [...next.objectDefinitions.values()].find(
      (definition) => definition.names.fallback === 'New'
    )
    expect(created).toBeDefined()
    expect(created!.id).toBe(secondAttemptId)
    expect(created!.id).not.toBe(firstAttemptId)
    expect(document.objectDefinitions.has(created!.id)).toBe(false)
  })

  it('createArisIdAllocator itself never hands out an id already in existingIds', () => {
    const { document } = buildFixture()
    const existingIds = [
      ...document.models.keys(),
      ...document.objectDefinitions.keys(),
      ...[...document.models.values()].flatMap((model) => model.occurrences.map((o) => o.id))
    ]
    const allocator = createArisIdAllocator({ existingIds })
    const allocated = new Set<string>()
    for (let index = 0; index < 25; index += 1) {
      const id = allocator.allocateDefinitionId('ObjDef')
      expect(existingIds.includes(id)).toBe(false)
      expect(allocated.has(id)).toBe(false)
      allocated.add(id)
    }
  })
})
