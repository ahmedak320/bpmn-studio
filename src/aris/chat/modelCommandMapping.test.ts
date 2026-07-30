import { describe, expect, it } from 'vitest'
import { ARIS_CHAT_COMMAND_KINDS } from './patchSchema'
import { PATCH_TO_MODEL_COMMAND_MAPPING } from './modelCommandMapping'

describe('PATCH_TO_MODEL_COMMAND_MAPPING', () => {
  it('has exactly one entry per chat command kind, covering all sixteen', () => {
    const kinds = PATCH_TO_MODEL_COMMAND_MAPPING.map((entry) => entry.chatCommandKind)
    expect([...kinds].sort()).toEqual([...ARIS_CHAT_COMMAND_KINDS].sort())
    expect(new Set(kinds).size).toBe(16)
  })

  it('maps deleteConnectionDefinition to the model deleteConnectionDefinition command', () => {
    const entry = PATCH_TO_MODEL_COMMAND_MAPPING.find(
      (e) => e.chatCommandKind === 'deleteConnectionDefinition'
    )
    expect(entry?.modelCommandKinds).toEqual(['deleteConnectionDefinition'])
    expect(entry?.requiresTransactionWrapper).toBe(false)
  })

  it('maps removeAttachment to setAttribute (AT_ORBITPM_ATTACHMENT is attribute-backed, not a dedicated ArisCommandKind)', () => {
    const entry = PATCH_TO_MODEL_COMMAND_MAPPING.find(
      (e) => e.chatCommandKind === 'removeAttachment'
    )
    expect(entry?.modelCommandKinds).toEqual(['setAttribute'])
  })

  it('every command maps to at least one real model command kind', () => {
    for (const entry of PATCH_TO_MODEL_COMMAND_MAPPING) {
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
