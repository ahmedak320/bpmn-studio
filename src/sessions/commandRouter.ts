import type { SessionId } from './types'

export interface SessionCommands {
  save(): unknown
  undo?(): unknown
  redo?(): unknown
  exportSvg?(): unknown
  exportPng?(): unknown
}

export type SessionCommandName = keyof SessionCommands

export type CommandRouteResult =
  | { status: 'invoked'; sessionId: SessionId; command: SessionCommandName; result: unknown }
  | { status: 'no-active-session'; command: SessionCommandName }
  | { status: 'unavailable'; sessionId: SessionId; command: SessionCommandName }

export interface KeyboardEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  preventDefault(): void
}

export interface KeyboardEventTargetLike {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
}

/**
 * One application-level command registry. Mounted background editors only
 * register commands; they never install their own global keyboard listeners.
 */
export class ActiveSessionCommandRouter {
  readonly #getActiveSessionId: () => SessionId | null
  readonly #commands = new Map<SessionId, { registration: symbol; commands: SessionCommands }>()

  constructor(getActiveSessionId: () => SessionId | null) {
    this.#getActiveSessionId = getActiveSessionId
  }

  register(sessionId: SessionId, commands: SessionCommands): () => void {
    const registration = Symbol(sessionId)
    this.#commands.set(sessionId, { registration, commands })
    return () => {
      const current = this.#commands.get(sessionId)
      // A late cleanup from an older editor instance must not unregister the
      // newer instance that replaced it.
      if (current?.registration === registration) this.#commands.delete(sessionId)
    }
  }

  unregister(sessionId: SessionId): void {
    this.#commands.delete(sessionId)
  }

  route(command: SessionCommandName): CommandRouteResult {
    const sessionId = this.#getActiveSessionId()
    if (!sessionId) return { status: 'no-active-session', command }
    const registered = this.#commands.get(sessionId)?.commands
    const handler = registered?.[command]
    if (typeof handler !== 'function') return { status: 'unavailable', sessionId, command }
    return {
      status: 'invoked',
      sessionId,
      command,
      result: handler.call(registered)
    }
  }

  handleKeyDown(event: KeyboardEventLike): CommandRouteResult | null {
    const saveCombo =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 's'
    if (!saveCombo) return null
    // Always suppress the browser's page-save dialog for the application save
    // gesture, including key-repeat and a briefly unmounted active editor.
    event.preventDefault()
    if (event.repeat) {
      const sessionId = this.#getActiveSessionId()
      return sessionId
        ? { status: 'unavailable', sessionId, command: 'save' }
        : { status: 'no-active-session', command: 'save' }
    }
    return this.route('save')
  }
}

export function installApplicationShortcuts(
  target: KeyboardEventTargetLike,
  router: ActiveSessionCommandRouter
): () => void {
  const listener = (event: KeyboardEvent): void => {
    router.handleKeyDown(event)
  }
  target.addEventListener('keydown', listener)
  return () => target.removeEventListener('keydown', listener)
}
