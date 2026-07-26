import { describe, it, expect } from 'vitest'
import { classifyPickerError } from '../fs/workspaceHandle'

// Codex ORIG-12: the folder-picker / reconnect error paths surfaced the raw
// browser exception message (English, locale-dependent) straight into the UI via
// setPickError(errMsg(err)). Classify the exception into a stable code the UI
// maps to an i18n (en+ar) string instead.

class NamedError extends Error {
  constructor(name: string, message = name) {
    super(message)
    this.name = name
  }
}

describe('classifyPickerError (ORIG-12)', () => {
  it('classifies a SecurityError', () => {
    expect(classifyPickerError(new NamedError('SecurityError'))).toBe('security')
  })
  it('classifies a NotAllowedError', () => {
    expect(classifyPickerError(new NamedError('NotAllowedError'))).toBe('not-allowed')
  })
  it('classifies an AbortError (user dismissed)', () => {
    expect(classifyPickerError(new NamedError('AbortError'))).toBe('aborted')
  })
  it('falls back to unknown for anything else', () => {
    expect(classifyPickerError(new NamedError('TypeError', 'Failed to fetch'))).toBe('unknown')
    expect(classifyPickerError('a raw string')).toBe('unknown')
    expect(classifyPickerError(null)).toBe('unknown')
  })
})
