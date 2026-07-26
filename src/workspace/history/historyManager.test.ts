import { describe, expect, it } from 'vitest'
import { MemoryWorkspaceAdapter } from '../adapters'
import { diffXml } from './diff'
import { PortableHistoryManager } from './historyManager'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

function tickingClock(start = 1000): () => number {
  let value = start
  return () => value++
}

describe('portable workspace history', () => {
  it('creates exact-byte revisions before overwrite and delete', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:write',
      files: { 'process.bpmn': '<old />' }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(),
      applicationVersion: '0.4.5'
    })
    const base = await adapter.read('process.bpmn')
    const written = await history.writeWithRevision('process.bpmn', text('<new />'), base.hash)

    expect(written.outcome).toMatchObject({ status: 'success' })
    expect(written.revision).toMatchObject({
      originalPath: 'process.bpmn',
      hash: base.hash,
      reason: 'overwrite',
      applicationVersion: '0.4.5'
    })
    expect((await history.preview(written.revision!)).xml).toBe('<old />')
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<new />')

    const deleted = await history.removeWithRevision('process.bpmn')
    expect(deleted.revision.reason).toBe('delete')
    expect((await history.preview(deleted.revision)).xml).toBe('<new />')
    await expect(adapter.read('process.bpmn')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('never creates history for a stale expected hash', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<external />' }
    })
    const history = new PortableHistoryManager({ adapter })

    const result = await history.writeWithRevision(
      'process.bpmn',
      text('<local />'),
      '0'.repeat(64)
    )
    expect(result.outcome).toMatchObject({
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    expect(result.revision).toBeUndefined()
    expect((await history.listRevisions()).revisions).toHaveLength(0)
  })

  it('previews, diffs, restores, and restores as a collision-safe copy', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'process.bpmn': '<definitions>\n  <task name="Old" />\n</definitions>'
      }
    })
    const history = new PortableHistoryManager({ adapter, now: tickingClock() })
    const revision = await history.createRevision('process.bpmn', { reason: 'manual' })
    adapter.replaceExternally(
      'process.bpmn',
      '<definitions>\n  <task name="New" />\n</definitions>'
    )

    const comparison = await history.diff(revision)
    expect(comparison.identical).toBe(false)
    expect(comparison.hunks).toEqual([
      expect.objectContaining({
        removed: ['  <task name="Old" />'],
        added: ['  <task name="New" />']
      })
    ])

    const current = await adapter.read('process.bpmn')
    const restored = await history.restore(revision, current.hash)
    expect(restored.outcome).toMatchObject({ status: 'success' })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toContain('name="Old"')
    expect(await history.restoreAsCopy(revision, 'process-restored.bpmn')).toMatchObject({
      status: 'success',
      created: true
    })
    expect(decode((await adapter.read('process-restored.bpmn')).bytes)).toContain('name="Old"')
    expect(await history.restoreAsCopy(revision, 'process-restored.bpmn')).toMatchObject({
      status: 'external-conflict',
      reason: 'already-exists'
    })
  })

  it('uses an explicit creation-only CAS when restoring a deleted original', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<historical />' }
    })
    const history = new PortableHistoryManager({ adapter, now: tickingClock() })
    const revision = await history.createRevision('process.bpmn', { reason: 'manual' })

    await adapter.remove('process.bpmn')
    const restored = await history.restore(revision, null)
    expect(restored.outcome).toMatchObject({ status: 'success', created: true })
    expect(restored.revision).toBeUndefined()
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<historical />')

    await adapter.remove('process.bpmn')
    await expect(adapter.read('process.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    adapter.replaceExternally('process.bpmn', '<concurrently recreated />')

    const collision = await history.restore(revision, null)
    expect(collision.outcome).toMatchObject({
      status: 'external-conflict',
      reason: 'already-exists'
    })
    expect(collision.revision).toBeUndefined()
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<concurrently recreated />')
  })

  it('keeps only the newest configured revisions per process', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': 'v0' }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(),
      maxPerProcess: 3,
      maxTotalBytes: 10_000_000
    })

    for (let version = 0; version < 5; version += 1) {
      adapter.replaceExternally('process.bpmn', `v${version}`)
      await history.createRevision('process.bpmn', {
        reason: 'manual',
        prune: false
      })
    }
    const retention = await history.enforceRetention()
    const listing = await history.listRevisions('process.bpmn')
    expect(retention.removed).toHaveLength(2)
    expect(listing.revisions).toHaveLength(3)
    const previews = await Promise.all(
      listing.revisions.map((revision) => history.preview(revision))
    )
    expect(previews.map((preview) => preview.xml)).toEqual(['v4', 'v3', 'v2'])
  })

  it('cleans oldest globally while preserving each process newest revision', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a.bpmn': 'a0',
        'b.bpmn': 'b0'
      }
    })
    const builder = new PortableHistoryManager({
      adapter,
      now: tickingClock(),
      maxTotalBytes: 10_000_000
    })
    for (const [path, values] of [
      ['a.bpmn', ['a0', 'a1', 'a2']],
      ['b.bpmn', ['b0', 'b1']]
    ] as const) {
      for (const value of values) {
        adapter.replaceExternally(path, value)
        await builder.createRevision(path, { reason: 'manual', prune: false })
      }
    }
    const before = await builder.listRevisions()
    const newest = new Map<string, (typeof before.revisions)[number]>()
    for (const revision of before.revisions) {
      if (!newest.has(revision.originalPath)) newest.set(revision.originalPath, revision)
    }
    const protectedBytes = [...newest.values()].reduce(
      (total, revision) => total + revision.storageBytes,
      0
    )
    const retentionManager = new PortableHistoryManager({
      adapter,
      maxPerProcess: 20,
      maxTotalBytes: protectedBytes
    })
    const retention = await retentionManager.enforceRetention()
    const after = await retentionManager.listRevisions()

    expect(retention.overLimitBecauseNewestAreProtected).toBe(false)
    expect(after.totalBytes).toBeLessThanOrEqual(protectedBytes)
    expect(new Set(after.revisions.map((revision) => revision.originalPath))).toEqual(
      new Set(['a.bpmn', 'b.bpmn'])
    )
    expect(after.revisions).toHaveLength(2)
  })

  it('reports an unavoidable over-limit state rather than deleting newest revisions', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a.bpmn': 'a',
        'b.bpmn': 'b'
      }
    })
    const history = new PortableHistoryManager({
      adapter,
      maxTotalBytes: 1,
      now: tickingClock()
    })
    await history.createRevision('a.bpmn', { reason: 'manual', prune: false })
    await history.createRevision('b.bpmn', { reason: 'manual', prune: false })

    const retention = await history.enforceRetention()
    expect(retention.overLimitBecauseNewestAreProtected).toBe(true)
    expect((await history.listRevisions()).revisions).toHaveLength(2)
  })

  it('rejects a corrupted revision during preview', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<safe />' }
    })
    const history = new PortableHistoryManager({ adapter })
    const revision = await history.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    adapter.replaceExternally(revision.contentPath, '<tampered />')

    await expect(history.preview(revision)).rejects.toMatchObject({
      code: 'integrity-failure'
    })
  })
})

describe('history XML diff', () => {
  it('handles insertions/deletions and falls back safely for large inputs', () => {
    const small = diffXml('a\nb\nc', 'a\nx\nc\nd')
    expect(small.hunks).toEqual([
      expect.objectContaining({ removed: ['b'], added: ['x'] }),
      expect.objectContaining({ removed: [], added: ['d'] })
    ])

    const oldLarge = Array.from({ length: 1200 }, (_, index) => `old-${index}`).join('\n')
    const newLarge = Array.from({ length: 1200 }, (_, index) => `new-${index}`).join('\n')
    const large = diffXml(oldLarge, newLarge)
    expect(large.hunks).toHaveLength(1)
    expect(large.hunks[0].oldLines).toBe(1200)
    expect(large.hunks[0].newLines).toBe(1200)
  })
})
