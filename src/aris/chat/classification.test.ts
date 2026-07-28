import { describe, expect, it } from 'vitest'
import {
  AUTOMATIC_COMMAND_KINDS,
  DESTRUCTIVE_COMMAND_KINDS,
  TOPOLOGY_COMMAND_KINDS,
  classifyCommandKind,
  classifyPatchCommand,
  isDestructiveCommandKind,
  isTopologyCommandKind,
  partitionCommandsByClassification,
  type ArisChatClassification
} from './classification'
import { ARIS_CHAT_COMMAND_KINDS, type ArisChatCommand, type ArisChatCommandKind } from './patchSchema'

/** One classification per command kind — plan 18.4's exhaustive mapping, spelled out. */
const EXPECTED_CLASSIFICATION: Readonly<Record<ArisChatCommandKind, ArisChatClassification>> = {
  setLocalizedName: 'automatic',
  setAttribute: 'automatic',
  addAttributeValue: 'automatic',
  addMetadataDefinition: 'automatic',
  addMetadataOccurrence: 'automatic',
  addMetadataConnection: 'automatic',
  addCoreObject: 'confirm',
  addCoreConnection: 'confirm',
  setAssignment: 'confirm',
  setRoute: 'confirm',
  reconnect: 'confirm',
  deleteConnection: 'confirm',
  deleteOccurrence: 'confirm',
  deleteDefinition: 'confirm',
  removeAttachment: 'confirm'
}

describe('classifyCommandKind — exhaustive, one assertion per command (table in the task report)', () => {
  it.each(ARIS_CHAT_COMMAND_KINDS)('classifies %s as expected', (kind) => {
    expect(classifyCommandKind(kind)).toBe(EXPECTED_CLASSIFICATION[kind])
  })

  it('covers every one of the fifteen command kinds — no kind is left unclassified', () => {
    expect(Object.keys(EXPECTED_CLASSIFICATION).sort()).toEqual([...ARIS_CHAT_COMMAND_KINDS].sort())
  })
})

describe('the invariant: no destructive or topology-changing command is ever automatic', () => {
  it('DESTRUCTIVE_COMMAND_KINDS and TOPOLOGY_COMMAND_KINDS are disjoint from AUTOMATIC_COMMAND_KINDS', () => {
    for (const kind of DESTRUCTIVE_COMMAND_KINDS) {
      expect(AUTOMATIC_COMMAND_KINDS.has(kind)).toBe(false)
    }
    for (const kind of TOPOLOGY_COMMAND_KINDS) {
      expect(AUTOMATIC_COMMAND_KINDS.has(kind)).toBe(false)
    }
  })

  it.each(ARIS_CHAT_COMMAND_KINDS)('%s: if destructive or topology-changing, classifyCommandKind never returns automatic', (kind) => {
    if (isDestructiveCommandKind(kind) || isTopologyCommandKind(kind)) {
      expect(classifyCommandKind(kind)).toBe('confirm')
    }
  })

  it('every destructive kind is present and is confirm-required (enumeration is not vacuous)', () => {
    expect([...DESTRUCTIVE_COMMAND_KINDS].sort()).toEqual(['deleteConnection', 'deleteDefinition', 'deleteOccurrence', 'removeAttachment'])
    for (const kind of DESTRUCTIVE_COMMAND_KINDS) expect(classifyCommandKind(kind)).toBe('confirm')
  })

  it('every topology-changing kind is present and is confirm-required (enumeration is not vacuous)', () => {
    expect([...TOPOLOGY_COMMAND_KINDS].sort()).toEqual(['addCoreConnection', 'addCoreObject', 'reconnect', 'setAssignment'])
    for (const kind of TOPOLOGY_COMMAND_KINDS) expect(classifyCommandKind(kind)).toBe('confirm')
  })
})

let commandCounter = 0
function commandOf(kind: ArisChatCommandKind): ArisChatCommand {
  // Payload contents do not matter for classification — only `kind` and the override context do.
  commandCounter += 1
  return { commandId: `c${commandCounter}`, kind, targetIds: ['x'], payload: {} } as unknown as ArisChatCommand
}

describe('classifyPatchCommand overrides (plan 18.4: ID change / ambiguous target)', () => {
  it('forces confirm for an otherwise-automatic command when the target is ambiguous', () => {
    expect(classifyPatchCommand(commandOf('setAttribute'), { ambiguousTarget: true })).toBe('confirm')
  })

  it('forces confirm for an otherwise-automatic command when it implies an id change', () => {
    expect(classifyPatchCommand(commandOf('setLocalizedName'), { impliesIdChange: true })).toBe('confirm')
  })

  it('does not downgrade an already-confirm command', () => {
    expect(classifyPatchCommand(commandOf('deleteOccurrence'), {})).toBe('confirm')
  })

  it('with no context, matches classifyCommandKind', () => {
    for (const kind of ARIS_CHAT_COMMAND_KINDS) {
      expect(classifyPatchCommand(commandOf(kind))).toBe(classifyCommandKind(kind))
    }
  })
})

describe('partitionCommandsByClassification', () => {
  it('splits a mixed batch, preserving relative order within each partition', () => {
    const commands = [commandOf('setLocalizedName'), commandOf('deleteOccurrence'), commandOf('addAttributeValue'), commandOf('reconnect')]
    const { automatic, confirm } = partitionCommandsByClassification(commands)
    expect(automatic.map((c) => c.kind)).toEqual(['setLocalizedName', 'addAttributeValue'])
    expect(confirm.map((c) => c.kind)).toEqual(['deleteOccurrence', 'reconnect'])
  })

  it('honors a per-command context resolver', () => {
    const commands = [commandOf('setAttribute'), commandOf('setLocalizedName')]
    const { automatic, confirm } = partitionCommandsByClassification(commands, (command) => ({
      ambiguousTarget: command.kind === 'setAttribute'
    }))
    expect(automatic.map((c) => c.kind)).toEqual(['setLocalizedName'])
    expect(confirm.map((c) => c.kind)).toEqual(['setAttribute'])
  })
})
