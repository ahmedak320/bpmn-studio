import { describe, expect, it } from 'vitest'

import { classifySaveFailure } from './saveErrors'

describe('classifySaveFailure', () => {
  it.each([
    ['permission-loss', 'permission-denied', false],
    ['stale-workspace', 'stale-workspace', false],
    ['cancelled', 'aborted', true],
    ['quota-exceeded', 'quota-exceeded', true],
    ['not-found', 'not-found', false],
    ['unsupported', 'invalid-state', false],
    ['invalid-path', 'invalid-state', false],
    ['storage-failure', 'io', true],
    ['integrity-failure', 'io', true]
  ] as const)('maps workspace code %s to %s', (code, expected, retriable) => {
    const cause = { code, message: `failure: ${code}` }
    expect(classifySaveFailure(cause)).toEqual({
      code: expected,
      message: '[object Object]',
      retriable,
      cause
    })
  })

  it.each([
    ['NotAllowedError', 'permission-denied', false],
    ['SecurityError', 'permission-denied', false],
    ['NotFoundError', 'not-found', false],
    ['QuotaExceededError', 'quota-exceeded', true],
    ['AbortError', 'aborted', true],
    ['InvalidStateError', 'invalid-state', true],
    ['NoModificationAllowedError', 'permission-denied', false],
    ['TypeMismatchError', 'io', false],
    ['SomethingNew', 'unknown', true]
  ] as const)('maps DOM-style error name %s to %s', (name, expected, retriable) => {
    const cause = Object.assign(new Error(`failure: ${name}`), { name })
    expect(classifySaveFailure(cause)).toMatchObject({
      code: expected,
      message: `failure: ${name}`,
      retriable,
      cause
    })
  })

  it('classifies primitive and null causes without assuming an object shape', () => {
    expect(classifySaveFailure('disk disappeared')).toMatchObject({
      code: 'unknown',
      message: 'disk disappeared',
      retriable: true
    })
    expect(classifySaveFailure(null)).toMatchObject({
      code: 'unknown',
      message: 'null',
      retriable: true
    })
    expect(classifySaveFailure({ name: 17, code: 23 })).toMatchObject({
      code: 'unknown',
      message: '[object Object]',
      retriable: true
    })
  })
})
