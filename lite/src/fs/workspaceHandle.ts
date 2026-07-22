// Persistence + permission glue for the opened workspace directory handle.
// Keeps the picker/IDB/permission specifics out of the FS adapter (fsAccess.ts
// stays pure) and out of App.tsx.

import { idbGet, idbSet, idbDel } from './idb'

const HANDLE_KEY = 'rootHandle'

/** True when the browser exposes the directory-picker half of the FS Access
 * API. When false the app runs in single-file fallback mode. */
export function directoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Stable classification of a folder-picker / reconnect failure, so the UI can
 *  render an i18n (RTL-safe) message instead of the raw, locale-dependent
 *  browser exception text (Codex ORIG-12). */
export type PickerErrorCode = 'aborted' | 'security' | 'not-allowed' | 'unknown'

export function classifyPickerError(err: unknown): PickerErrorCode {
  const name = err instanceof Error ? err.name : (err as { name?: string })?.name
  switch (name) {
    case 'AbortError':
      return 'aborted'
    case 'SecurityError':
      return 'security'
    case 'NotAllowedError':
      return 'not-allowed'
    default:
      return 'unknown'
  }
}

/** Prompt the user to pick a workspace folder (read+write), or null if they
 * cancel. Throws only on genuine errors (not on cancellation). */
export async function pickWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ id: 'orbitpm-lite', mode: 'readwrite' })
  } catch (err) {
    // AbortError = the user dismissed the picker; treat as "no selection".
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}

/** Persist the opened handle for next visit. */
export async function rememberWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(HANDLE_KEY, handle)
}

/** Load the previously-remembered handle, if any. */
export function loadRememberedWorkspace(): Promise<FileSystemDirectoryHandle | undefined> {
  return idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
}

/** Forget the remembered handle (used when the user picks a different folder
 * or the stored one becomes unusable). */
export async function forgetWorkspace(): Promise<void> {
  await idbDel(HANDLE_KEY)
}

/**
 * Ensure read+write permission on a handle. Returns 'granted' if already
 * allowed. Some browsers require a user gesture to (re-)prompt, so callers
 * invoke `request: true` only from a click handler; a passive check on load
 * uses `request: false` and, if not already granted, shows a "Reconnect"
 * button instead.
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  request: boolean
): Promise<PermissionState> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if (handle.queryPermission) {
    const current = await handle.queryPermission(opts)
    if (current === 'granted') return 'granted'
    if (!request) return current
  }
  if (request && handle.requestPermission) {
    return handle.requestPermission(opts)
  }
  // Browsers without the permission API effectively grant on open.
  return handle.queryPermission ? 'prompt' : 'granted'
}
