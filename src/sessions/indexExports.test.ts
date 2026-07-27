import { describe, expect, it } from 'vitest'

import * as sessions from './index'

describe('session public surface', () => {
  it('exports the application integration primitives from one stable module', () => {
    expect(sessions.DocumentSessionStore).toBeTypeOf('function')
    expect(sessions.DocumentSessionController).toBeTypeOf('function')
    expect(sessions.ActiveSessionCommandRouter).toBeTypeOf('function')
    expect(sessions.AdapterSessionPersistence).toBeTypeOf('function')
    expect(sessions.createBeforeUnloadHandler).toBeTypeOf('function')
    expect(sessions.executePathTransaction).toBeTypeOf('function')
    expect(sessions.BroadcastWorkspaceCoordinator).toBeTypeOf('function')
  })
})
