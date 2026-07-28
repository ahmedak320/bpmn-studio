import { describe, expect, it } from 'vitest'
import { ARIS_CHAT_COMMAND_KINDS } from './patchSchema'
import { PATCH_TO_MODEL_COMMAND_MAPPING } from './modelCommandMapping'

describe('PATCH_TO_MODEL_COMMAND_MAPPING', () => {
  it('has exactly one entry per chat command kind, covering all fifteen', () => {
    const kinds = PATCH_TO_MODEL_COMMAND_MAPPING.map((entry) => entry.chatCommandKind)
    expect([...kinds].sort()).toEqual([...ARIS_CHAT_COMMAND_KINDS].sort())
    expect(new Set(kinds).size).toBe(15)
  })

  it('flags removeAttachment as having no model-layer equivalent today', () => {
    const entry = PATCH_TO_MODEL_COMMAND_MAPPING.find((e) => e.chatCommandKind === 'removeAttachment')
    expect(entry?.modelCommandKinds).toEqual([])
  })

  it('every other command maps to at least one real model command kind', () => {
    for (const entry of PATCH_TO_MODEL_COMMAND_MAPPING) {
      if (entry.chatCommandKind === 'removeAttachment') continue
      expect(entry.modelCommandKinds.length).toBeGreaterThan(0)
    }
  })

  it('marks the three two-command mappings as requiring a transaction wrapper', () => {
    const twoCommandKinds = ['addMetadataConnection', 'addCoreObject', 'addCoreConnection']
    for (const entry of PATCH_TO_MODEL_COMMAND_MAPPING) {
      if (twoCommandKinds.includes(entry.chatCommandKind)) {
        expect(entry.modelCommandKinds.length).toBe(2)
        expect(entry.requiresTransactionWrapper).toBe(true)
      }
    }
  })
})
