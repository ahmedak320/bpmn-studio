import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceAdapter, sha256Hex } from '../adapters'
import { diffXml } from './diff'
import {
  DEFAULT_HISTORY_TOTAL_REVISIONS,
  HISTORY_ISSUE_MESSAGE_MAX_CODE_POINTS,
  HISTORY_RETENTION_RESULT_DETAIL_LIMIT,
  HISTORY_ROOT,
  PortableHistoryManager
} from './historyManager'
import type { HistoryRevision, HistoryRevisionMetadata } from './types'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

function tickingClock(start = 1000): () => number {
  let value = start
  return () => value++
}

async function seedRevision(
  adapter: MemoryWorkspaceAdapter,
  index: number,
  options: {
    originalPath?: string
    folder?: string
    createdAt?: number
    sequence?: number
    content?: string
  } = {}
): Promise<HistoryRevision> {
  const createdAt = options.createdAt ?? 10_000 + index
  const sequence = options.sequence ?? index + 1
  const originalPath = options.originalPath ?? `process-${index}.bpmn`
  const content = options.content ?? `v${index}`
  const hash = await sha256Hex(text(content))
  const id = `${createdAt}-${sequence}-${hash.slice(0, 12)}`
  const folder = options.folder ?? `${HISTORY_ROOT}/${await sha256Hex(text(originalPath))}`
  const contentPath = `${folder}/${id}.bpmn`
  const metadataPath = `${folder}/${id}.json`
  const metadata: HistoryRevisionMetadata = {
    format: 'orbitpm-history-revision',
    version: 1,
    id,
    originalPath,
    contentPath,
    metadataPath,
    hash,
    size: text(content).byteLength,
    createdAt,
    reason: 'manual'
  }
  const metadataBytes = text(JSON.stringify(metadata))
  adapter.replaceExternally(contentPath, content)
  adapter.replaceExternally(metadataPath, metadataBytes)
  return {
    ...metadata,
    storageBytes: text(content).byteLength + metadataBytes.byteLength
  }
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

  it('preserves newer live bytes changed at conditional user-delete entry', async () => {
    let injectRace = false
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:conditional-delete-race',
      files: { 'process.bpmn': '<reviewed />' },
      beforeRemoveIfHash: (path) => {
        if (path === 'process.bpmn' && injectRace) {
          injectRace = false
          adapter.replaceExternally(path, '<newer />')
        }
      }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock()
    })

    injectRace = true
    await expect(history.removeWithRevision('process.bpmn')).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'remove',
      path: 'process.bpmn'
    })

    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<newer />')
    const revisions = (await history.listRevisions('process.bpmn')).revisions
    expect(revisions).toHaveLength(1)
    expect((await history.preview(revisions[0]!)).xml).toBe('<reviewed />')
  })

  it('pages thousands of revisions and corrupt issues within fixed I/O and yield budgets', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:paged-thousands' })
    await Promise.all(Array.from({ length: 1_200 }, (_, index) => seedRevision(adapter, index)))
    adapter.replaceExternally(`${HISTORY_ROOT}/corrupt/99999-9999-aaaaaaaaaaaa.json`, '{')
    adapter.replaceExternally(`${HISTORY_ROOT}/orphan/100000-10000-aaaaaaaaaaaa.bpmn`, '<orphan />')
    const cooperativeYield = vi.fn(async () => Promise.resolve())
    const history = new PortableHistoryManager({ adapter, cooperativeYield })
    const read = vi.spyOn(adapter, 'read')

    const orphanBoundary = await history.listRevisions(undefined, { limit: 1 })
    expect(orphanBoundary.issues).toEqual([expect.objectContaining({ code: 'orphan-content' })])
    const afterOrphan = await history.listRevisions(undefined, {
      limit: 1,
      cursor: orphanBoundary.nextCursor
    })
    expect(afterOrphan.issues).toEqual([expect.objectContaining({ code: 'invalid-metadata' })])
    read.mockClear()
    cooperativeYield.mockClear()

    const startedAt = performance.now()
    const first = await history.listRevisions(undefined, { limit: 65 })
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(1_500)
    expect(first.revisions.length + first.issues.length).toBe(65)
    expect(first.issues.map((issue) => issue.code)).toEqual(['orphan-content', 'invalid-metadata'])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.complete).toBe(false)
    expect(first.totalBytes).toBe(
      first.revisions.reduce((total, item) => total + item.storageBytes, 0)
    )
    expect(read).toHaveBeenCalledTimes(64)
    expect(cooperativeYield).toHaveBeenCalledOnce()

    const firstPaths = new Set(first.revisions.map((item) => item.metadataPath))
    const second = await history.listRevisions(undefined, {
      limit: 65,
      cursor: first.nextCursor
    })
    expect(second.revisions.length + second.issues.length).toBe(65)
    expect(second.revisions.every((item) => !firstPaths.has(item.metadataPath))).toBe(true)
    expect(read).toHaveBeenCalledTimes(129)

    const reachedRevisionPaths = new Set<string>()
    const reachedIssuePaths = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await history.listRevisions(undefined, { limit: 127, cursor })
      for (const item of page.revisions) reachedRevisionPaths.add(item.metadataPath)
      for (const issue of page.issues) reachedIssuePaths.add(issue.path)
      cursor = page.nextCursor
    } while (cursor !== undefined)

    expect(reachedRevisionPaths.size).toBe(1_200)
    expect(reachedIssuePaths).toEqual(
      new Set([
        `${HISTORY_ROOT}/corrupt/99999-9999-aaaaaaaaaaaa.json`,
        `${HISTORY_ROOT}/orphan/100000-10000-aaaaaaaaaaaa.bpmn`
      ])
    )
  }, 15_000)

  it('cooperatively aborts a thousand-entry listing between bounded scan batches', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:abort-thousands' })
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => seedRevision(adapter, index)))
    const controller = new AbortController()
    let yields = 0
    const history = new PortableHistoryManager({
      adapter,
      cooperativeYield: async () => {
        yields += 1
        if (yields === 2) controller.abort('history dialog closed')
        await Promise.resolve()
      }
    })
    const read = vi.spyOn(adapter, 'read')

    await expect(
      history.listRevisions(undefined, { limit: 1_000, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'cancelled', operation: 'list' })
    expect(yields).toBe(2)
    expect(read).toHaveBeenCalledTimes(128)
  })

  it.each(['content', 'metadata'] as const)(
    'never overwrites the live BPMN when cancellation reaches history %s creation',
    async (abortStage) => {
      const abort = new AbortController()
      const adapter = new MemoryWorkspaceAdapter({
        files: { 'process.bpmn': '<live />' },
        beforeWrite: (path) => {
          const isHistoryContent = path.startsWith('.orbitpm/history/') && path.endsWith('.bpmn')
          const isHistoryMetadata = path.startsWith('.orbitpm/history/') && path.endsWith('.json')
          if (
            (abortStage === 'content' && isHistoryContent) ||
            (abortStage === 'metadata' && isHistoryMetadata)
          ) {
            abort.abort()
          }
        }
      })
      const history = new PortableHistoryManager({ adapter, now: tickingClock() })
      const live = await adapter.read('process.bpmn')

      await expect(
        history.writeWithRevision(
          'process.bpmn',
          text('<reviewed restore />'),
          live.hash,
          'restore',
          abort.signal
        )
      ).rejects.toMatchObject({ code: 'cancelled' })

      expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<live />')
      expect((await history.listRevisions('process.bpmn')).revisions).toEqual([])
      expect(
        (await adapter.list()).filter(
          (entry) => entry.kind === 'file' && entry.path.startsWith('.orbitpm/history/')
        )
      ).toEqual([])
    }
  )

  it('preserves externally replaced metadata when partial-write cleanup races', async () => {
    const controller = new AbortController()
    let replacedMetadataPath: string | undefined
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:partial-write-metadata-race',
      files: { 'process.bpmn': '<live />' },
      beforeRemoveIfHash: (path) => {
        if (!replacedMetadataPath && path.endsWith('.json')) {
          replacedMetadataPath = path
          adapter.replaceExternally(path, '{"newer":"metadata-evidence"}')
        }
      }
    })
    const writeAtomic = adapter.writeAtomic.bind(adapter)
    vi.spyOn(adapter, 'writeAtomic').mockImplementation(
      async (path, bytes, expectedHash, options) => {
        const outcome = await writeAtomic(path, bytes, expectedHash, options)
        if (
          path.startsWith(`${HISTORY_ROOT}/`) &&
          path.endsWith('.json') &&
          outcome.status === 'success'
        ) {
          controller.abort('fail after metadata commit')
        }
        return outcome
      }
    )
    const history = new PortableHistoryManager({ adapter, now: tickingClock() })

    let failure: unknown
    try {
      await history.createRevision('process.bpmn', {
        reason: 'manual',
        signal: controller.signal
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'storage-failure',
      operation: 'write',
      path: 'process.bpmn',
      message: expect.stringContaining('partial-write rollback was incomplete')
    })
    const cause = (failure as Error & { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(AggregateError)
    expect((cause as AggregateError).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'integrity-failure',
          operation: 'remove',
          path: replacedMetadataPath
        })
      ])
    )
    expect(replacedMetadataPath).toEqual(expect.any(String))
    expect(decode((await adapter.read(replacedMetadataPath!)).bytes)).toBe(
      '{"newer":"metadata-evidence"}'
    )
    const historyFiles = (await adapter.list())
      .filter((entry) => entry.kind === 'file' && entry.path.startsWith(`${HISTORY_ROOT}/`))
      .map((entry) => entry.path)
    expect(historyFiles).toEqual([replacedMetadataPath])
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<live />')
  })

  it('preserves externally replaced content when retention rollback races', async () => {
    let replacedContentPath: string | undefined
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:retention-rollback-content-race',
      files: { 'process.bpmn': '<live />' },
      beforeRemoveIfHash: (path) => {
        if (!replacedContentPath && path.startsWith(`${HISTORY_ROOT}/`) && path.endsWith('.bpmn')) {
          replacedContentPath = path
          adapter.replaceExternally(path, '<newer history evidence />')
        }
      }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(),
      maxTotalBytes: 1
    })

    let failure: unknown
    try {
      await history.createRevision('process.bpmn', { reason: 'manual' })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'storage-failure',
      operation: 'write',
      path: 'process.bpmn',
      message: expect.stringContaining('conditional rollback was incomplete')
    })
    const cause = (failure as Error & { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(AggregateError)
    expect((cause as AggregateError).errors).toEqual([
      expect.objectContaining({
        code: 'integrity-failure',
        operation: 'remove',
        path: replacedContentPath
      })
    ])
    expect(replacedContentPath).toEqual(expect.any(String))
    expect(decode((await adapter.read(replacedContentPath!)).bytes)).toBe(
      '<newer history evidence />'
    )
    const listing = await history.listRevisions('process.bpmn')
    expect(listing.revisions).toEqual([])
    expect(listing.issues).toContainEqual(
      expect.objectContaining({ code: 'orphan-content', path: replacedContentPath })
    )
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<live />')
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

  it('restores exact UTF-8 revision bytes even when the UI preview would be Unicode-bounded', async () => {
    const exactXml = `<definitions name="😀">مرحبا\u0301</definitions>`
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': exactXml }
    })
    const history = new PortableHistoryManager({ adapter, now: tickingClock() })
    const original = await adapter.read('process.bpmn')
    const revision = await history.createRevision('process.bpmn', { reason: 'manual' })
    adapter.replaceExternally('process.bpmn', '<changed />')

    expect(await history.restoreAsCopy(revision, 'process-restored.bpmn')).toMatchObject({
      status: 'success'
    })
    const restored = await adapter.read('process-restored.bpmn')
    expect([...restored.bytes]).toEqual([...original.bytes])
    expect(decode(restored.bytes)).toBe(exactXml)
  })

  it('cancels restore-as-copy before destination commit when its signal aborts', async () => {
    const controller = new AbortController()
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<historical />' },
      beforeWrite: (path) => {
        if (path === 'process-restored.bpmn') controller.abort('workspace switched')
      }
    })
    const history = new PortableHistoryManager({ adapter, now: tickingClock() })
    const revision = await history.createRevision('process.bpmn', { reason: 'manual' })

    await expect(
      history.restoreAsCopy(revision, 'process-restored.bpmn', controller.signal)
    ).resolves.toMatchObject({
      status: 'cancelled'
    })
    await expect(adapter.read('process-restored.bpmn')).rejects.toMatchObject({
      code: 'not-found'
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

  it('uses numeric same-millisecond sequence order when protecting the newest revision', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': 'v0' }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: () => 5_000,
      maxPerProcess: 1,
      maxTotalBytes: 10_000_000
    })
    for (let version = 1; version <= 12; version += 1) {
      adapter.replaceExternally('process.bpmn', `v${version}`)
      await history.createRevision('process.bpmn', { reason: 'manual', prune: false })
    }

    const retention = await history.enforceRetention()
    const listing = await history.listRevisions('process.bpmn')

    expect(retention.withinLimits).toBe(true)
    expect(retention.removedRevisionCount).toBe(11)
    expect(listing.revisions).toHaveLength(1)
    expect(listing.revisions[0]?.id).toContain('-12-')
    expect((await history.preview(listing.revisions[0]!)).xml).toBe('v12')
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

  it('bounds hostile and oversized cleanup diagnostics by Unicode code points', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:bounded-cleanup-errors' })
    const revisions = await Promise.all(
      [0, 1, 2].map((index) => seedRevision(adapter, index, { originalPath: 'process.bpmn' }))
    )
    const remove = adapter.remove.bind(adapter)
    let failure: 'hostile' | 'oversized' = 'hostile'
    vi.spyOn(adapter, 'remove').mockImplementation(async (path) => {
      if (path === revisions[0]!.contentPath) {
        if (failure === 'oversized') throw new Error('😀'.repeat(2_000))
        throw {
          get message() {
            throw new Error('hostile getter')
          },
          toString() {
            throw new Error('hostile string conversion')
          }
        }
      }
      await remove(path)
    })
    const history = new PortableHistoryManager({
      adapter,
      maxPerProcess: 1,
      maxTotalBytes: 10_000_000,
      cooperativeYield: async () => Promise.resolve()
    })

    const hostileResult = await history.enforceRetention()
    failure = 'oversized'
    const oversizedResult = await history.enforceRetention()
    const cleanupIssues = [...hostileResult.issues, ...oversizedResult.issues].filter(
      (issue) => issue.code === 'unreadable'
    )
    expect(cleanupIssues).toHaveLength(2)
    expect(cleanupIssues[0]?.message).toContain('Unknown portable history failure.')
    expect(
      cleanupIssues.every(
        (issue) => Array.from(issue.message).length <= HISTORY_ISSUE_MESSAGE_MAX_CODE_POINTS
      )
    ).toBe(true)
    expect(hostileResult.withinLimits).toBe(false)
    expect(oversizedResult.withinLimits).toBe(false)
  })

  it('reports legacy protected overflow and rolls back a new protected revision before overwrite', async () => {
    const legacyAdapter = new MemoryWorkspaceAdapter({ id: 'history:legacy-overflow' })
    await Promise.all(
      Array.from({ length: DEFAULT_HISTORY_TOTAL_REVISIONS + 1 }, (_, index) =>
        seedRevision(legacyAdapter, index)
      )
    )
    const legacy = new PortableHistoryManager({
      adapter: legacyAdapter,
      cooperativeYield: async () => Promise.resolve()
    })

    const legacyResult = await legacy.enforceRetention()
    expect(legacyResult.withinLimits).toBe(false)
    expect(legacyResult.overLimitBecauseNewestAreProtected).toBe(true)
    expect(legacyResult.totalRevisions).toBe(DEFAULT_HISTORY_TOTAL_REVISIONS + 1)
    expect(legacyResult.removedRevisionCount).toBe(0)
    expect(legacyResult.removed).toHaveLength(0)
    expect(legacyResult.omittedRemovedRevisionCount).toBe(0)
    expect(legacyResult.issues).toContainEqual(expect.objectContaining({ code: 'retention-limit' }))
    expect(legacyResult.issues.length).toBeLessThanOrEqual(HISTORY_RETENTION_RESULT_DETAIL_LIMIT)

    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:new-overflow',
      files: { 'overflow.bpmn': '<live />' }
    })
    await seedRevision(adapter, 0, { originalPath: 'existing.bpmn' })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(50_000),
      maxTotalRevisions: 1,
      maxTotalBytes: 10_000_000,
      cooperativeYield: async () => Promise.resolve()
    })
    const live = await adapter.read('overflow.bpmn')

    await expect(
      history.writeWithRevision('overflow.bpmn', text('<destructive />'), live.hash)
    ).rejects.toMatchObject({ code: 'quota-exceeded', operation: 'write' })
    expect(decode((await adapter.read('overflow.bpmn')).bytes)).toBe('<live />')
    expect((await history.listRevisions('overflow.bpmn')).revisions).toEqual([])
    expect((await history.listRevisions()).revisions).toHaveLength(1)
  })

  it('enforces the global revision count across thousands without removing the newest revision', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:global-count-thousands' })
    await Promise.all(
      Array.from({ length: 1_200 }, (_, index) =>
        seedRevision(adapter, index, { originalPath: 'process.bpmn' })
      )
    )
    const history = new PortableHistoryManager({
      adapter,
      maxPerProcess: 2_000,
      maxTotalRevisions: 1_000,
      maxTotalBytes: 100_000_000,
      cooperativeYield: async () => Promise.resolve()
    })

    const result = await history.enforceRetention()
    const after = await history.listRevisions()

    expect(result.withinLimits).toBe(true)
    expect(result.removedRevisionCount).toBe(200)
    expect(result.removed).toHaveLength(HISTORY_RETENTION_RESULT_DETAIL_LIMIT)
    expect(result.omittedRemovedRevisionCount).toBe(100)
    expect(after.revisions).toHaveLength(1_000)
    expect(after.revisions[0]?.createdAt).toBe(11_199)
  })

  it('counts corrupt and orphan files toward the byte cap and rolls back a new revision', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:orphan-byte-cap',
      files: { 'overflow.bpmn': '<live />' }
    })
    await seedRevision(adapter, 0, { originalPath: 'existing.bpmn' })
    adapter.replaceExternally(`${HISTORY_ROOT}/unaccounted/orphan.bin`, 'x'.repeat(4_096))
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(50_000),
      maxTotalBytes: 1_024,
      cooperativeYield: async () => Promise.resolve()
    })

    const legacy = await history.enforceRetention()
    expect(legacy.storageBytes).toBeGreaterThan(1_024)
    expect(legacy.withinLimits).toBe(false)
    expect(legacy.overLimitBecauseNewestAreProtected).toBe(false)
    expect(legacy.issues).toContainEqual(expect.objectContaining({ code: 'retention-limit' }))

    const live = await adapter.read('overflow.bpmn')
    await expect(
      history.writeWithRevision('overflow.bpmn', text('<destructive />'), live.hash)
    ).rejects.toMatchObject({ code: 'storage-failure', operation: 'write' })
    expect(decode((await adapter.read('overflow.bpmn')).bytes)).toBe('<live />')
    expect((await history.listRevisions('overflow.bpmn')).revisions).toEqual([])
  })

  it('treats unknown unreadable file sizes as indeterminate and blocks destructive writes', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:unknown-byte-cap',
      files: { 'overflow.bpmn': '<live />' }
    })
    const unknown = await seedRevision(adapter, 0, { originalPath: 'existing.bpmn' })
    const list = adapter.list.bind(adapter)
    vi.spyOn(adapter, 'list').mockImplementation(async (path) =>
      (await list(path)).map((entry) =>
        entry.path === unknown.metadataPath
          ? {
              ...entry,
              size: undefined,
              readable: false,
              issue: {
                code: 'permission-loss',
                operation: 'read',
                path: entry.path,
                message: 'size unavailable'
              }
            }
          : entry
      )
    )
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(60_000),
      cooperativeYield: async () => Promise.resolve()
    })

    const legacy = await history.enforceRetention()
    expect(legacy.storageBytes).toBeUndefined()
    expect(legacy.withinLimits).toBe(false)
    expect(legacy.issues).toContainEqual(expect.objectContaining({ code: 'retention-limit' }))

    const live = await adapter.read('overflow.bpmn')
    await expect(
      history.writeWithRevision('overflow.bpmn', text('<destructive />'), live.hash)
    ).rejects.toMatchObject({ code: 'storage-failure', operation: 'write' })
    expect(decode((await adapter.read('overflow.bpmn')).bytes)).toBe('<live />')
    expect((await history.listRevisions('overflow.bpmn')).revisions).toEqual([])
  })

  it('keeps the prior newest revision when a two-file cleanup fails before overwrite', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:partial-cleanup',
      files: { 'process.bpmn': 'v1' }
    })
    const builder = new PortableHistoryManager({
      adapter,
      now: tickingClock(1_000),
      maxTotalBytes: 10_000_000
    })
    const oldest = await builder.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    adapter.replaceExternally('process.bpmn', 'v2')
    const priorNewest = await builder.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    const remove = adapter.remove.bind(adapter)
    vi.spyOn(adapter, 'remove').mockImplementation(async (path) => {
      if (path === oldest.metadataPath) throw new Error('metadata removal failed')
      await remove(path)
    })
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(50_000),
      maxPerProcess: 2,
      maxTotalBytes: 10_000_000
    })
    const live = await adapter.read('process.bpmn')

    await expect(
      history.writeWithRevision('process.bpmn', text('v3'), live.hash)
    ).rejects.toMatchObject({ code: 'storage-failure', operation: 'write' })

    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('v2')
    expect((await history.preview(priorNewest)).xml).toBe('v2')
    const after = await history.listRevisions('process.bpmn')
    expect(after.revisions.map((item) => item.metadataPath)).toEqual([priorNewest.metadataPath])
    expect(after.issues).toContainEqual(
      expect.objectContaining({ path: oldest.metadataPath, code: 'missing-content' })
    )
    expect(after.recordCount).toBe(2)
  })

  it('rejects a candidate that could fit only by pruning the prior newest revision', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:protect-prior-newest',
      files: { 'process.bpmn': 'v1' }
    })
    const builder = new PortableHistoryManager({
      adapter,
      now: tickingClock(1_000),
      maxTotalBytes: 10_000_000
    })
    const priorNewest = await builder.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    const remove = vi.spyOn(adapter, 'remove')
    const history = new PortableHistoryManager({
      adapter,
      now: tickingClock(50_000),
      maxPerProcess: 1,
      maxTotalBytes: 10_000_000
    })
    const live = await adapter.read('process.bpmn')

    await expect(
      history.writeWithRevision('process.bpmn', text('v2'), live.hash)
    ).rejects.toMatchObject({ code: 'quota-exceeded', operation: 'write' })

    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('v1')
    expect((await history.preview(priorNewest)).xml).toBe('v1')
    expect(remove).not.toHaveBeenCalledWith(priorNewest.contentPath)
    expect(remove).not.toHaveBeenCalledWith(priorNewest.metadataPath)
  })

  it('protects the newest checksum-valid recovery instead of a tampered newer record', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'history:checksum-protection',
      files: { 'process.bpmn': 'v1' }
    })
    const builder = new PortableHistoryManager({
      adapter,
      now: tickingClock(1_000),
      maxTotalBytes: 10_000_000
    })
    const valid = await builder.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    adapter.replaceExternally('process.bpmn', 'v2')
    const tampered = await builder.createRevision('process.bpmn', {
      reason: 'manual',
      prune: false
    })
    adapter.replaceExternally(tampered.contentPath, 'xx')
    const history = new PortableHistoryManager({
      adapter,
      maxPerProcess: 1,
      maxTotalBytes: 10_000_000
    })

    const result = await history.enforceRetention()
    const after = await history.listRevisions('process.bpmn')

    expect(result.withinLimits).toBe(true)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: tampered.contentPath, code: 'checksum-mismatch' })
    )
    expect(after.revisions.map((item) => item.metadataPath)).toEqual([valid.metadataPath])
    expect((await history.preview(valid)).xml).toBe('v1')
  })

  it('rejects metadata stored outside the hash folder without displacing the real newest', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:wrong-folder' })
    const valid = await seedRevision(adapter, 0, { originalPath: 'process.bpmn' })
    const forged = await seedRevision(adapter, 1, {
      originalPath: 'process.bpmn',
      folder: `${HISTORY_ROOT}/forged`
    })
    const history = new PortableHistoryManager({
      adapter,
      maxPerProcess: 1,
      maxTotalRevisions: 1,
      maxTotalBytes: 10_000_000
    })

    const listing = await history.listRevisions()
    expect(listing.revisions.map((item) => item.metadataPath)).toEqual([valid.metadataPath])
    expect(listing.issues).toContainEqual(
      expect.objectContaining({ path: forged.metadataPath, code: 'invalid-metadata' })
    )
    const result = await history.enforceRetention()
    expect(result.withinLimits).toBe(false)
    expect((await history.preview(valid)).xml).toBe('v0')
  })

  it('rejects promptly when cancellation interrupts the initial adapter listing', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'history:abort-initial-list' })
    vi.spyOn(adapter, 'list').mockImplementation(async () => new Promise<never>(() => undefined))
    const history = new PortableHistoryManager({ adapter })
    const controller = new AbortController()

    const pending = history.listRevisions(undefined, { signal: controller.signal })
    controller.abort('history dialog closed')

    await expect(pending).rejects.toMatchObject({ code: 'cancelled', operation: 'list' })
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
