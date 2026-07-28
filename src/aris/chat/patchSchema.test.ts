import { describe, expect, it } from 'vitest'
import { ARIS_CHAT_COMMAND_KINDS, ArisPatchSchemaError, arisPatchCommandSchema, parseArisChatCommand, parseArisPatchProposal } from './patchSchema'

function validPayloadFor(kind: (typeof ARIS_CHAT_COMMAND_KINDS)[number]): unknown {
  switch (kind) {
    case 'setLocalizedName':
      return { ownerKind: 'objectDefinition', ownerId: 'D1', localeId: 'en', value: 'Name' }
    case 'setAttribute':
      return { ownerKind: 'objectDefinition', ownerId: 'D1', attributeType: 'AT_DESC', values: [{ localeId: 'en', text: 'note' }] }
    case 'addAttributeValue':
      return { ownerKind: 'objectDefinition', ownerId: 'D1', attributeType: 'AT_DESC', value: { localeId: 'en', text: 'note' } }
    case 'addMetadataDefinition':
      return { definitionId: 'D2', objectType: 'OT_APPL_SYS', names: { values: { en: 'System' }, fallback: 'System' } }
    case 'addMetadataOccurrence':
      return { occurrenceId: 'O2', definitionId: 'D2', modelId: 'M1', symbol: 'ST_APPL_SYS' }
    case 'addMetadataConnection':
      return {
        connectionDefinitionId: 'CD2',
        connectionType: 'CT_SUPP_3',
        connectionOccurrenceId: 'C2',
        modelId: 'M1',
        fromObjectDefinitionId: 'D2',
        toObjectDefinitionId: 'D1',
        sourceOccurrenceId: 'O2',
        targetOccurrenceId: 'O1'
      }
    case 'addCoreObject':
      return {
        definitionId: 'D3',
        occurrenceId: 'O3',
        modelId: 'M1',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: { values: { en: 'New step' }, fallback: 'New step' }
      }
    case 'addCoreConnection':
      return {
        connectionDefinitionId: 'CD3',
        connectionType: 'CT_ACTIV_1',
        connectionOccurrenceId: 'C3',
        modelId: 'M1',
        fromObjectDefinitionId: 'D1',
        toObjectDefinitionId: 'D3',
        sourceOccurrenceId: 'O1',
        targetOccurrenceId: 'O3'
      }
    case 'setAssignment':
      return { objectDefinitionId: 'D1', modelId: 'M2', action: 'add' }
    case 'setRoute':
      return { connectionOccurrenceId: 'C1', route: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
    case 'reconnect':
      return { connectionOccurrenceId: 'C1', targetOccurrenceId: 'O3' }
    case 'deleteConnection':
      return { connectionOccurrenceId: 'C1' }
    case 'deleteOccurrence':
      return { occurrenceId: 'O1' }
    case 'deleteDefinition':
      return { definitionId: 'D1' }
    case 'removeAttachment':
      return { attachmentId: 'A1', ownerId: 'D1' }
  }
}

function validCommand(kind: (typeof ARIS_CHAT_COMMAND_KINDS)[number]) {
  return { commandId: `cmd-${kind}`, kind, targetIds: ['D1'], payload: validPayloadFor(kind) }
}

describe('arisPatchCommandSchema', () => {
  it.each(ARIS_CHAT_COMMAND_KINDS)('accepts a well-formed %s command', (kind) => {
    const result = arisPatchCommandSchema.safeParse(validCommand(kind))
    expect(result.success).toBe(true)
  })

  it('rejects an unrecognized command kind outright', () => {
    const result = arisPatchCommandSchema.safeParse({
      commandId: 'x',
      kind: 'dropDatabase',
      targetIds: ['D1'],
      payload: {}
    })
    expect(result.success).toBe(false)
  })

  it('rejects a recognized kind with a malformed payload (missing required field)', () => {
    const result = arisPatchCommandSchema.safeParse({
      commandId: 'x',
      kind: 'deleteOccurrence',
      targetIds: ['O1'],
      payload: {}
    })
    expect(result.success).toBe(false)
  })

  it('rejects a payload with unknown extra keys (strict)', () => {
    const command = validCommand('deleteDefinition') as { payload: Record<string, unknown> }
    command.payload.unexpected = 'nope'
    const result = arisPatchCommandSchema.safeParse(command)
    expect(result.success).toBe(false)
  })

  it('rejects addMetadataDefinition when the object type is a core control-flow type', () => {
    const result = arisPatchCommandSchema.safeParse({
      commandId: 'x',
      kind: 'addMetadataDefinition',
      targetIds: ['D1'],
      payload: { definitionId: 'D9', objectType: 'OT_FUNC', names: { values: { en: 'Nope' }, fallback: 'Nope' } }
    })
    expect(result.success).toBe(false)
  })

  it('rejects reconnect with neither endpoint provided', () => {
    const result = arisPatchCommandSchema.safeParse({
      commandId: 'x',
      kind: 'reconnect',
      targetIds: ['C1'],
      payload: { connectionOccurrenceId: 'C1' }
    })
    expect(result.success).toBe(false)
  })

  it('rejects an envelope with an extra unknown top-level key', () => {
    const command = validCommand('setRoute') as Record<string, unknown>
    command.extra = true
    const result = arisPatchCommandSchema.safeParse(command)
    expect(result.success).toBe(false)
  })

  it('parseArisChatCommand throws ArisPatchSchemaError with structured issues on failure', () => {
    expect(() => parseArisChatCommand({ commandId: 'x', kind: 'notAThing', targetIds: [], payload: {} })).toThrow(ArisPatchSchemaError)
    try {
      parseArisChatCommand({ commandId: 'x', kind: 'notAThing', targetIds: [], payload: {} })
    } catch (error) {
      expect(error).toBeInstanceOf(ArisPatchSchemaError)
      expect((error as ArisPatchSchemaError).issues.length).toBeGreaterThan(0)
    }
  })
})

describe('arisPatchProposalSchema / parseArisPatchProposal', () => {
  it('accepts a proposal carrying every command kind', () => {
    const proposal = {
      version: 1,
      baseRevision: 3,
      commands: ARIS_CHAT_COMMAND_KINDS.map((kind) => validCommand(kind))
    }
    expect(() => parseArisPatchProposal(proposal)).not.toThrow()
  })

  it('rejects a proposal with zero commands', () => {
    expect(() => parseArisPatchProposal({ version: 1, baseRevision: 0, commands: [] })).toThrow(ArisPatchSchemaError)
  })

  it('rejects a proposal with a negative baseRevision', () => {
    expect(() => parseArisPatchProposal({ version: 1, baseRevision: -1, commands: [validCommand('setRoute')] })).toThrow(ArisPatchSchemaError)
  })

  it('rejects a proposal with the wrong version literal', () => {
    expect(() => parseArisPatchProposal({ version: 2, baseRevision: 0, commands: [validCommand('setRoute')] })).toThrow(ArisPatchSchemaError)
  })

  it('rejects a completely malformed value (not even an object)', () => {
    expect(() => parseArisPatchProposal('not a proposal')).toThrow(ArisPatchSchemaError)
    expect(() => parseArisPatchProposal(null)).toThrow(ArisPatchSchemaError)
    expect(() => parseArisPatchProposal(undefined)).toThrow(ArisPatchSchemaError)
  })

  it('rejects a proposal containing one bad command among otherwise-good ones', () => {
    const proposal = {
      version: 1,
      baseRevision: 0,
      commands: [validCommand('setRoute'), { commandId: 'bad', kind: 'notACommand', targetIds: ['x'], payload: {} }]
    }
    expect(() => parseArisPatchProposal(proposal)).toThrow(ArisPatchSchemaError)
  })
})

describe('ARIS_CHAT_COMMAND_KINDS', () => {
  it('is exactly the fifteen commands plan 18.3 lists, in that order', () => {
    expect(ARIS_CHAT_COMMAND_KINDS).toEqual([
      'setLocalizedName',
      'setAttribute',
      'addAttributeValue',
      'addMetadataDefinition',
      'addMetadataOccurrence',
      'addMetadataConnection',
      'addCoreObject',
      'addCoreConnection',
      'setAssignment',
      'setRoute',
      'reconnect',
      'deleteConnection',
      'deleteOccurrence',
      'deleteDefinition',
      'removeAttachment'
    ])
    expect(ARIS_CHAT_COMMAND_KINDS).toHaveLength(15)
  })
})
