// Workspace-session guards — the data-safety spine for switching folders and
// refreshing the tree. All logic here is pure (no React / DOM / FS) so it is
// unit-tested directly in plain node (see src/__tests__/workspaceSession.test.ts).
//
// Two distinct hazards this guards, both surfaced by the Codex review:
//
//  * CRITICAL-1 — after the user switches to a different folder, a tab that was
//    opened against the PREVIOUS folder must never write its relative path
//    through the NEW root handle. Every tab records the workspace *generation*
//    it was opened under; a save is committed only while that generation is
//    still the live one (`canCommitToWorkspace`). Switching folders bumps the
//    generation, instantly invalidating every stale tab.
//
//  * MAJOR-8 — two workspace scans (buildTree + scanWorkspaceFiles) launched by
//    overlapping mutations can finish out of order, letting a slow earlier scan
//    overwrite a newer one, or a scan begun before a folder switch commit its
//    results against the new folder. `createRefreshGuard` hands each scan a
//    monotonically increasing token; the scan commits only if it is BOTH the
//    most recent token AND still scanning the currently-active handle.

/**
 * True when a tab opened under `tabGeneration` may still write to disk, i.e. the
 * workspace has not been switched out from under it. A mismatch means a folder
 * switch happened after the tab was opened — the write MUST be refused so it
 * cannot land in the wrong workspace.
 */
export function canCommitToWorkspace(tabGeneration: number, activeGeneration: number): boolean {
  return tabGeneration === activeGeneration
}

export interface RefreshGuard {
  /** Claim a fresh token for a scan about to start; also becomes the "latest". */
  begin(): number
  /** The most recently claimed token. */
  latest(): number
  /**
   * A scan's results may be committed only when its `token` is still the latest
   * (no newer scan has started) AND the handle it scanned is still the active
   * one (no folder switch happened mid-scan). `scannedHandle`/`activeHandle` are
   * compared by identity.
   */
  shouldCommit(token: number, scannedHandle: unknown, activeHandle: unknown): boolean
}

export function createRefreshGuard(): RefreshGuard {
  let counter = 0
  return {
    begin(): number {
      counter += 1
      return counter
    },
    latest(): number {
      return counter
    },
    shouldCommit(token: number, scannedHandle: unknown, activeHandle: unknown): boolean {
      return token === counter && scannedHandle === activeHandle
    }
  }
}
