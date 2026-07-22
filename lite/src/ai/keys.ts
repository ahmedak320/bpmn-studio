// API-key storage for Lite. Unlike the desktop app (OS-encrypted safeStorage
// in the main process), a pure browser page has no secure vault — keys live in
// localStorage, scoped to this browser profile + origin. The Settings dialog
// shows the warning below prominently so the user makes an informed choice.

import type { LiteProviderId } from './browserAi'

const PREFIX = 'orbitpm.lite.key.'

export const KEY_STORAGE_WARNING =
  'Your API key is stored unencrypted in this browser profile (localStorage). ' +
  'Anyone with access to this computer profile can read it. Use only on a machine you trust, ' +
  'and clear the key when you are done on a shared computer.'

export function getKey(providerId: LiteProviderId): string {
  try {
    return localStorage.getItem(PREFIX + providerId) ?? ''
  } catch {
    return ''
  }
}

export function hasKey(providerId: LiteProviderId): boolean {
  return getKey(providerId).length > 0
}

export function setKey(providerId: LiteProviderId, value: string): void {
  try {
    const trimmed = value.trim()
    if (trimmed) localStorage.setItem(PREFIX + providerId, trimmed)
    else localStorage.removeItem(PREFIX + providerId)
  } catch {
    // localStorage can throw in private-mode / disabled-storage; ignore.
  }
}

export function clearKey(providerId: LiteProviderId): void {
  try {
    localStorage.removeItem(PREFIX + providerId)
  } catch {
    /* ignore */
  }
}

/** Last 4 chars of a stored key, for a non-revealing "Configured (••••1234)" hint. */
export function keyLast4(providerId: LiteProviderId): string {
  const k = getKey(providerId)
  return k ? k.slice(-4) : ''
}
