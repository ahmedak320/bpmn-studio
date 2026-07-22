import { describe, it, expect } from 'vitest'
import { writeFileAt, readFileAt, copyTree } from '../fs/fsAccess'
import { newRoot } from './mockFs'

// Codex NEW-minor (copyTree retry-ability): a folder copy that failed partway
// leaves a PARTIAL/STALE destination. Re-running the copy must be deterministic
// — the result equals the SOURCE subtree EXACTLY, never source ∪ leftovers.
// copyTree cleans the destination first so a retry is idempotent.

describe('copyTree retry-safety (NEW-minor)', () => {
  it('cleans a partial/stale destination so a retry equals the source exactly', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Src/a.bpmn', 'A')
    await writeFileAt(root, 'Src/deep/b.bpmn', 'B')
    // Simulate a PRIOR failed attempt that left a partial + stale destination:
    await writeFileAt(root, 'Dst/a.bpmn', 'STALE-OLD') // wrong content
    await writeFileAt(root, 'Dst/ghost.bpmn', 'GHOST') // not in source at all

    const counts = await copyTree(root, 'Src', 'Dst')

    expect(counts.files).toBe(2)
    // Source files land with correct content (deterministic overwrite).
    expect(await readFileAt(root, 'Dst/a.bpmn')).toBe('A')
    expect(await readFileAt(root, 'Dst/deep/b.bpmn')).toBe('B')
    // The stale leftover that is NOT part of the source is removed — the retry
    // is not source ∪ leftovers.
    await expect(readFileAt(root, 'Dst/ghost.bpmn')).rejects.toBeTruthy()
  })

  it('a fresh copy (no pre-existing dest) still works', async () => {
    const root = newRoot()
    await writeFileAt(root, 'Src/x.bpmn', 'X')
    const counts = await copyTree(root, 'Src', 'Fresh')
    expect(counts.files).toBe(1)
    expect(await readFileAt(root, 'Fresh/x.bpmn')).toBe('X')
  })
})
