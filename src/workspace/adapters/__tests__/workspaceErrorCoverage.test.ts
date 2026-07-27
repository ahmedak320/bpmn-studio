import { describe, expect, it } from 'vitest'
import {
  WorkspaceListLimitError,
  WorkspaceOperationError,
  asWorkspaceOperationError,
  errorName,
  validatedListLimits,
  validatedReadLimit,
  workspaceFailure
} from '..'

describe('workspace error edge coverage', () => {
  it('describes depth limits even when the offending path is unavailable', () => {
    const error = new WorkspaceListLimitError(undefined, 'depth', 4, 5)
    expect(error).toMatchObject({
      name: 'WorkspaceListLimitError',
      dimension: 'depth',
      limit: 4,
      actual: 5,
      message: 'Workspace entry "" has depth 5; the scan depth limit is 4.'
    })
  })

  it('rejects non-integer and non-positive list limits', () => {
    for (const options of [{ maxEntries: 1.5 }, { maxDepth: 0 }]) {
      expect(() => validatedListLimits(options)).toThrow('must be a positive safe integer')
    }
  })

  it('rejects every invalid finite, integer, and sign alternative for read limits', () => {
    for (const maxBytes of [Number.POSITIVE_INFINITY, 1.5, -1]) {
      expect(() => validatedReadLimit('process.bpmn', { maxBytes })).toThrow(
        'must be a non-negative safe integer'
      )
    }
    expect(validatedReadLimit('process.bpmn', { maxBytes: 0 })).toBe(0)
  })

  it('preserves Error and string messages and classifies platform error names', () => {
    expect(workspaceFailure(new Error('disk failed'), 'write', 'process.bpmn')).toMatchObject({
      code: 'storage-failure',
      message: 'disk failed',
      name: 'Error'
    })
    expect(workspaceFailure('plain failure', 'read')).toMatchObject({
      code: 'storage-failure',
      message: 'plain failure',
      name: undefined
    })

    for (const [name, code] of [
      ['AbortError', 'cancelled'],
      ['NotAllowedError', 'permission-loss'],
      ['NotFoundError', 'not-found'],
      ['QuotaExceededError', 'quota-exceeded']
    ] as const) {
      expect(workspaceFailure({ name }, 'write')).toMatchObject({ code, name })
    }
  })

  it('normalizes operation errors idempotently and ignores non-string object names', () => {
    const operationError = new WorkspaceOperationError({
      code: 'already-exists',
      operation: 'write',
      path: 'process.bpmn',
      message: 'already exists'
    })
    expect(asWorkspaceOperationError(operationError, 'read')).toBe(operationError)

    const wrapped = asWorkspaceOperationError('storage unavailable', 'read', 'process.bpmn')
    expect(wrapped).toMatchObject({
      code: 'storage-failure',
      operation: 'read',
      path: 'process.bpmn',
      message: 'storage unavailable'
    })
    expect(errorName({ name: 42 })).toBeUndefined()
    expect(errorName(null)).toBeUndefined()
  })
})
