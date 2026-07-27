import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_LIST_LIMITS,
  validatedListLimits,
  workspaceFailure
} from '../workspaceError'

describe('workspace error normalization', () => {
  it('classifies DOM-like security failures and supplies a safe fallback message', () => {
    expect(workspaceFailure({ name: 'SecurityError' }, 'read', 'process.bpmn')).toEqual({
      code: 'permission-loss',
      message: 'The workspace read operation failed.',
      operation: 'read',
      path: 'process.bpmn',
      name: 'SecurityError'
    })
  })

  it('supplies hard recursive-list defaults and permits callers only to lower them', () => {
    expect(validatedListLimits({})).toEqual(DEFAULT_WORKSPACE_LIST_LIMITS)
    expect(validatedListLimits({ maxEntries: 10, maxDepth: 4 })).toEqual({
      maxEntries: 10,
      maxDepth: 4
    })
    expect(() =>
      validatedListLimits({
        maxEntries: DEFAULT_WORKSPACE_LIST_LIMITS.maxEntries + 1
      })
    ).toThrow('cannot exceed the hard limit')
    expect(() =>
      validatedListLimits({
        maxDepth: DEFAULT_WORKSPACE_LIST_LIMITS.maxDepth + 1
      })
    ).toThrow('cannot exceed the hard limit')
  })
})
