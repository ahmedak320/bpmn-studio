// Pure back/forward navigation history (browser-style) over tab activations,
// including call-activity drill-downs. Entries are tab keys (a workspace-
// relative .bpmn path in directory mode, or a `virtual:*` key for an in-memory
// tab). A cursor marks the current position; a new activation truncates any
// forward entries and pushes. Back/Forward take an `exists` predicate so a key
// whose tab was closed (and, for a virtual key, can't be reopened) is skipped.
// No React/DOM — unit-tested in plain node.

export interface NavHistory {
  entries: string[]
  /** Index of the current entry, or -1 when empty. */
  cursor: number
}

/** Cap so a long editing session can't grow the history unbounded. */
export const MAX_HISTORY = 100

export function emptyHistory(): NavHistory {
  return { entries: [], cursor: -1 }
}

export function currentEntry(h: NavHistory): string | null {
  return h.cursor >= 0 && h.cursor < h.entries.length ? h.entries[h.cursor] : null
}

/**
 * Record a user-initiated activation. Re-activating the current entry is a
 * no-op (so switching to the already-active tab doesn't spam history).
 * Otherwise any forward entries are dropped and the key is appended.
 */
export function pushHistory(h: NavHistory, key: string): NavHistory {
  if (currentEntry(h) === key) return h
  const kept = h.entries.slice(0, h.cursor + 1)
  kept.push(key)
  // Trim from the front if over the cap, keeping the cursor at the end.
  const trimmed = kept.length > MAX_HISTORY ? kept.slice(kept.length - MAX_HISTORY) : kept
  return { entries: trimmed, cursor: trimmed.length - 1 }
}

/** Move the cursor to the nearest earlier entry that still `exists`. Returns the
 *  same history (cursor unchanged) when there is nowhere valid to go. */
export function goBack(h: NavHistory, exists: (key: string) => boolean): NavHistory {
  let c = h.cursor - 1
  while (c >= 0 && !exists(h.entries[c])) c -= 1
  if (c < 0) return h
  return { ...h, cursor: c }
}

/** Move the cursor to the nearest later entry that still `exists`. */
export function goForward(h: NavHistory, exists: (key: string) => boolean): NavHistory {
  let c = h.cursor + 1
  while (c < h.entries.length && !exists(h.entries[c])) c += 1
  if (c >= h.entries.length) return h
  return { ...h, cursor: c }
}

export function canGoBack(h: NavHistory, exists: (key: string) => boolean): boolean {
  for (let c = h.cursor - 1; c >= 0; c -= 1) if (exists(h.entries[c])) return true
  return false
}

export function canGoForward(h: NavHistory, exists: (key: string) => boolean): boolean {
  for (let c = h.cursor + 1; c < h.entries.length; c += 1) if (exists(h.entries[c])) return true
  return false
}

/** Drop entries whose key is no longer valid (e.g. a closed virtual tab or a
 *  deleted/renamed file), keeping the cursor pointing at the same logical
 *  entry where possible. Used after closing tabs / refreshing the workspace so
 *  the history can't accumulate dead keys. */
export function pruneHistory(h: NavHistory, exists: (key: string) => boolean): NavHistory {
  const currentKey = currentEntry(h)
  const entries = h.entries.filter((k) => exists(k))
  if (entries.length === h.entries.length) return h
  let cursor = currentKey ? entries.indexOf(currentKey) : -1
  if (cursor === -1) cursor = entries.length - 1
  return { entries, cursor }
}
