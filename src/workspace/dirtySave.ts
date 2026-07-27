// Save-plan partitioning for "Save all & switch". Kept pure (no React/DOM/FS) so
// the guarantee — every DIRTY tab is accounted for, none silently discarded — is
// unit-testable (Codex NEW-C2).

export interface DirtyTabLike {
  key: string
  /** workspace-relative path in directory mode; null for a fallback/virtual tab. */
  relPath: string | null
}

export interface DirtySavePlan<T> {
  /** Dirty tabs backed by a workspace file — written to disk in place. */
  writable: T[]
  /** Dirty fallback/in-memory tabs (relPath === null) — saved via the
   *  download-on-save path so their changes are never silently discarded. */
  downloadable: T[]
}

/**
 * Partition dirty tabs into the ones that can be written to disk and the
 * fallback ones that must be downloaded. A fallback tab (relPath === null) is
 * routed to `downloadable`, never dropped.
 */
export function partitionDirtyTabs<T extends DirtyTabLike>(
  tabs: T[],
  isDirty: (tab: T) => boolean
): DirtySavePlan<T> {
  const writable: T[] = []
  const downloadable: T[] = []
  for (const tab of tabs) {
    if (!isDirty(tab)) continue
    if (tab.relPath !== null) writable.push(tab)
    else downloadable.push(tab) // fallback tab → download-on-save, never discarded
  }
  return { writable, downloadable }
}
