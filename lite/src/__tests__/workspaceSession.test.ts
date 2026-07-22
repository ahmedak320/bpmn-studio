import { describe, it, expect } from 'vitest'
import { canCommitToWorkspace, createRefreshGuard } from '../workspace/workspaceSession'

describe('canCommitToWorkspace (CRITICAL-1 tab-write guard)', () => {
  it('allows a write while the tab still belongs to the live generation', () => {
    expect(canCommitToWorkspace(3, 3)).toBe(true)
  })

  it('refuses a write from a tab opened under a previous workspace generation', () => {
    // The user switched folders (gen 3 → 4) after this tab was opened at gen 3;
    // its save must NOT flow through the new root handle.
    expect(canCommitToWorkspace(3, 4)).toBe(false)
  })

  it('refuses a tab from a LATER generation too (defensive, exact match only)', () => {
    expect(canCommitToWorkspace(5, 4)).toBe(false)
  })
})

describe('createRefreshGuard (MAJOR-8 stale/out-of-order scan guard)', () => {
  it('commits a single in-order scan against the active handle', () => {
    const guard = createRefreshGuard()
    const handle = {}
    const token = guard.begin()
    expect(guard.shouldCommit(token, handle, handle)).toBe(true)
  })

  it('discards a slower earlier refresh when a newer one has started (two interleaved refreshes)', () => {
    const guard = createRefreshGuard()
    const handle = {} // same workspace for both scans

    // Refresh A starts, then refresh B starts (B is newer).
    const tokenA = guard.begin()
    const tokenB = guard.begin()

    // B finishes first — it is the latest, so it commits.
    expect(guard.shouldCommit(tokenB, handle, handle)).toBe(true)
    // A finishes later — it is stale and must be discarded so it cannot
    // overwrite B's newer snapshot.
    expect(guard.shouldCommit(tokenA, handle, handle)).toBe(false)
  })

  it('discards a scan whose handle is no longer the active one (folder switched mid-scan)', () => {
    const guard = createRefreshGuard()
    const oldHandle = {}
    const newHandle = {}

    // A scan begun against the old workspace...
    const token = guard.begin()
    // ...must NOT commit once the active workspace has become a different handle,
    // even though it is still the latest token (cross-workspace bleed guard).
    expect(guard.shouldCommit(token, oldHandle, newHandle)).toBe(false)
    // The same-latest token DOES commit against its own handle.
    expect(guard.shouldCommit(token, oldHandle, oldHandle)).toBe(true)
  })

  it('latest() reflects the most recently claimed token', () => {
    const guard = createRefreshGuard()
    expect(guard.latest()).toBe(0)
    guard.begin()
    const t2 = guard.begin()
    expect(guard.latest()).toBe(t2)
  })
})
