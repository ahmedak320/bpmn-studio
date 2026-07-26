import type { DocumentSession } from './types'

export interface BeforeUnloadEventLike {
  returnValue: string
  preventDefault(): void
}

export interface BeforeUnloadTargetLike {
  addEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void
  removeEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void
}

export function hasDirtySessions(sessions: Iterable<Pick<DocumentSession, 'dirty'>>): boolean {
  for (const session of sessions) {
    if (session.dirty) return true
  }
  return false
}

export function createBeforeUnloadHandler(
  getSessions: () => Iterable<Pick<DocumentSession, 'dirty'>>
): (event: BeforeUnloadEventLike) => void {
  return (event) => {
    if (!hasDirtySessions(getSessions())) return
    event.preventDefault()
    // Setting returnValue is still required by Chromium/WebKit. Browsers show
    // their own localized text and intentionally ignore custom strings.
    event.returnValue = ''
  }
}

export function installBeforeUnloadDirtyGuard(
  target: BeforeUnloadTargetLike,
  getSessions: () => Iterable<Pick<DocumentSession, 'dirty'>>
): () => void {
  const handler = createBeforeUnloadHandler(getSessions)
  const listener = handler as (event: BeforeUnloadEvent) => void
  target.addEventListener('beforeunload', listener)
  return () => target.removeEventListener('beforeunload', listener)
}

