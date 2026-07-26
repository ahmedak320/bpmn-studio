import { describe, expect, it, vi } from 'vitest'

import {
  ActiveSessionCommandRouter,
  installApplicationShortcuts,
  type KeyboardEventTargetLike
} from './commandRouter'

describe('ActiveSessionCommandRouter edge behavior', () => {
  it('reports missing registrations, invokes optional commands, and unregisters safely', () => {
    let active: string | null = null
    const router = new ActiveSessionCommandRouter(() => active)

    expect(router.route('save')).toEqual({
      status: 'no-active-session',
      command: 'save'
    })

    active = 'editor'
    expect(router.route('undo')).toEqual({
      status: 'unavailable',
      sessionId: 'editor',
      command: 'undo'
    })

    const undo = vi.fn(() => 'undone')
    const cleanup = router.register('editor', {
      save: vi.fn(),
      undo
    })
    expect(router.route('undo')).toEqual({
      status: 'invoked',
      sessionId: 'editor',
      command: 'undo',
      result: 'undone'
    })
    expect(undo).toHaveBeenCalledOnce()

    cleanup()
    expect(router.route('save').status).toBe('unavailable')
    router.register('editor', { save: vi.fn() })
    router.unregister('editor')
    expect(router.route('save').status).toBe('unavailable')
  })

  it('handles non-save keys and repeated shortcuts with or without an active session', () => {
    let active: string | null = null
    const router = new ActiveSessionCommandRouter(() => active)
    const preventDefault = vi.fn()

    expect(
      router.handleKeyDown({
        key: 's',
        ctrlKey: false,
        metaKey: false,
        preventDefault
      })
    ).toBeNull()
    expect(
      router.handleKeyDown({
        key: 'x',
        ctrlKey: true,
        metaKey: false,
        preventDefault
      })
    ).toBeNull()
    expect(
      router.handleKeyDown({
        key: 's',
        ctrlKey: false,
        metaKey: true,
        repeat: true,
        preventDefault
      })
    ).toEqual({ status: 'no-active-session', command: 'save' })
    active = 'editor'
    expect(
      router.handleKeyDown({
        key: 's',
        ctrlKey: true,
        metaKey: false,
        repeat: true,
        preventDefault
      })
    ).toEqual({
      status: 'unavailable',
      sessionId: 'editor',
      command: 'save'
    })
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it('installs one application listener and removes the same listener', () => {
    let listener: ((event: KeyboardEvent) => void) | null = null
    const target: KeyboardEventTargetLike = {
      addEventListener: vi.fn((_type, next) => {
        listener = next
      }),
      removeEventListener: vi.fn((_type, current) => {
        if (listener === current) listener = null
      })
    }
    const save = vi.fn()
    const router = new ActiveSessionCommandRouter(() => 'editor')
    router.register('editor', { save })

    const uninstall = installApplicationShortcuts(target, router)
    expect(target.addEventListener).toHaveBeenCalledOnce()
    expect(listener).not.toBeNull()
    listener?.({
      key: 's',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn()
    } as KeyboardEvent)
    expect(save).toHaveBeenCalledOnce()

    uninstall()
    expect(target.removeEventListener).toHaveBeenCalledOnce()
    expect(listener).toBeNull()
  })
})
