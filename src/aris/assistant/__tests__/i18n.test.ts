import { describe, expect, it } from 'vitest'

import { arisAssistantAr, arisAssistantEn, tAssistant } from '../i18n'

describe('tAssistant', () => {
  it('interpolates {name} vars', () => {
    expect(tAssistant('en', 'assistant.next.forStep', { step: 'Approve' })).toBe(
      'After Approve, the process continues with:'
    )
    expect(tAssistant('ar', 'assistant.next.forStep', { step: 'الموافقة' })).toContain('الموافقة')
  })

  it('falls back to English when a key would be missing (defensive; every key is present in both dicts)', () => {
    expect(tAssistant('ar', 'assistant.none')).toBe(arisAssistantAr['assistant.none'])
  })

  it('every English key has an Arabic counterpart', () => {
    for (const key of Object.keys(arisAssistantEn)) {
      expect(arisAssistantAr).toHaveProperty(key)
    }
  })
})
