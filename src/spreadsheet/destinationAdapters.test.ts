import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { MemoryWorkspaceAdapter, workspaceParentPath } from '../workspace/adapters'
import { HISTORY_ROOT, PortableHistoryManager } from '../workspace/history'
import {
  BrowserImportDeliveryTransactionFactory,
  WorkspaceImportTransactionFactory,
  WorkspaceSpreadsheetDestinationInspector,
  buildSpreadsheetImportZip,
  type WorkspaceSpreadsheetMutationChange
} from './destinationAdapters'

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('spreadsheet destination adapters', () => {
  it('inspects hashes and commits multi-file writes with recovery history', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'existing.bpmn': '<old />' }
    })
    const historyManager = new PortableHistoryManager({
      adapter,
      now: () => 1_000
    })
    const inspector = new WorkspaceSpreadsheetDestinationInspector(adapter)
    const published: WorkspaceSpreadsheetMutationChange[] = []
    const [existing, missing] = await inspector.inspect(['existing.bpmn', 'new.bpmn'])
    expect(existing).toMatchObject({ exists: true })
    expect(missing).toEqual({ path: 'new.bpmn', exists: false })

    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager,
      runExclusive: (operation) =>
        operation((changes) => {
          published.push(...changes)
        })
    }).begin('import-1')
    await transaction.stage({
      path: 'existing.bpmn',
      bytes: bytes('<new />'),
      expectedHash: existing!.hash,
      createRecoveryRevision: true
    })
    await transaction.stage({
      path: 'new.bpmn',
      bytes: bytes('<created />'),
      createRecoveryRevision: false
    })
    const controller = new AbortController()
    const progress: { completed: number; total: number }[] = []
    await transaction.commit({
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event)
        if (event.completed === event.total) controller.abort()
      }
    })

    expect(controller.signal.aborted).toBe(true)
    expect(progress).toEqual([
      { completed: 0, total: 2 },
      { completed: 1, total: 2 },
      { completed: 2, total: 2 }
    ])
    expect(new TextDecoder().decode((await adapter.read('existing.bpmn')).bytes)).toBe('<new />')
    expect(new TextDecoder().decode((await adapter.read('new.bpmn')).bytes)).toBe('<created />')
    const listing = await historyManager.listRevisions('existing.bpmn')
    expect(listing.issues).toEqual([])
    expect(listing.revisions).toHaveLength(1)
    const [revision] = listing.revisions
    expect(revision).toMatchObject({
      originalPath: 'existing.bpmn',
      reason: 'backup-import',
      createdAt: 1_000
    })
    expect(new TextDecoder().decode((await historyManager.preview(revision!)).bytes)).toBe(
      '<old />'
    )
    expect(
      JSON.parse(new TextDecoder().decode((await adapter.read(revision!.metadataPath)).bytes))
    ).toMatchObject({
      format: 'orbitpm-history-revision',
      originalPath: 'existing.bpmn',
      contentPath: revision!.contentPath,
      reason: 'backup-import'
    })
    expect(
      (await adapter.list()).some((entry) => entry.path.startsWith('.orbitpm/history/imports/'))
    ).toBe(false)
    expect(published).toEqual([
      expect.objectContaining({ kind: 'saved', path: 'existing.bpmn' }),
      expect.objectContaining({ kind: 'saved', path: 'new.bpmn' }),
      { kind: 'invalidated', path: HISTORY_ROOT }
    ])
  })

  it('checks cancellation after original reads before creating history or writing', async () => {
    const controller = new AbortController()
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<old />' }
    })
    const original = await adapter.read('process.bpmn')
    const read = adapter.read.bind(adapter)
    adapter.read = vi.fn(async (path) => {
      const snapshot = await read(path)
      if (path === 'process.bpmn') controller.abort()
      return snapshot
    })
    const historyManager = new PortableHistoryManager({ adapter })
    const createRevision = vi.spyOn(historyManager, 'createRevision')
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager
    }).begin('abort-after-read')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<new />'),
      expectedHash: original.hash,
      createRecoveryRevision: true
    })

    await expect(transaction.commit({ signal: controller.signal })).rejects.toMatchObject({
      code: 'parse-cancelled'
    })
    expect(createRevision).not.toHaveBeenCalled()
    expect(writeAtomic).not.toHaveBeenCalled()
    expect(new TextDecoder().decode((await read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('records then cleans recovery history when cancellation lands after revision creation', async () => {
    const controller = new AbortController()
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<old />' }
    })
    const original = await adapter.read('process.bpmn')
    const historyManager = new PortableHistoryManager({ adapter })
    const createRevision = historyManager.createRevision.bind(historyManager)
    vi.spyOn(historyManager, 'createRevision').mockImplementation(async (path, options) => {
      const revision = await createRevision(path, options)
      controller.abort()
      return revision
    })
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager
    }).begin('abort-after-history')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<new />'),
      expectedHash: original.hash,
      createRecoveryRevision: true
    })

    await expect(transaction.commit({ signal: controller.signal })).rejects.toMatchObject({
      code: 'parse-cancelled'
    })
    expect(writeAtomic.mock.calls.filter(([path]) => path === 'process.bpmn')).toHaveLength(0)
    expect(new TextDecoder().decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
    expect((await historyManager.listRevisions()).revisions).toEqual([])
  })

  it('records an applied write before abort and restores it without forwarding the signal', async () => {
    const controller = new AbortController()
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'first.bpmn': '<old />' }
    })
    const original = await adapter.read('first.bpmn')
    const writeAtomic = adapter.writeAtomic.bind(adapter)
    const firstWriteSignals: (AbortSignal | undefined)[] = []
    const attemptedPaths: string[] = []
    adapter.writeAtomic = vi.fn(async (path, value, expectedHash, options) => {
      attemptedPaths.push(path)
      const outcome = await writeAtomic(path, value, expectedHash, options)
      if (path === 'first.bpmn') {
        firstWriteSignals.push(options?.signal)
        if (
          outcome.ok &&
          new TextDecoder().decode(value) === '<changed />' &&
          !controller.signal.aborted
        ) {
          controller.abort()
        }
      }
      return outcome
    })
    const transaction = await new WorkspaceImportTransactionFactory(adapter).begin(
      'abort-after-write'
    )
    await transaction.stage({
      path: 'first.bpmn',
      bytes: bytes('<changed />'),
      expectedHash: original.hash,
      createRecoveryRevision: false
    })
    await transaction.stage({
      path: 'second.bpmn',
      bytes: bytes('<second />'),
      createRecoveryRevision: false
    })

    await expect(transaction.commit({ signal: controller.signal })).rejects.toMatchObject({
      code: 'parse-cancelled'
    })
    expect(new TextDecoder().decode((await adapter.read('first.bpmn')).bytes)).toBe('<old />')
    await expect(adapter.read('second.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    expect(attemptedPaths.filter((path) => path === 'second.bpmn')).toHaveLength(0)
    expect(firstWriteSignals).toEqual([controller.signal, undefined])
    await expect(transaction.rollback()).resolves.toBeUndefined()
  })

  it('automatically restores every applied destination when a later write fails', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'first.bpmn': '<old />' },
      beforeWrite(path) {
        if (path === 'second.bpmn') throw new Error('simulated storage failure')
      }
    })
    const historyManager = new PortableHistoryManager({ adapter })
    const original = await adapter.read('first.bpmn')
    const published: WorkspaceSpreadsheetMutationChange[] = []
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager,
      runExclusive: (operation) =>
        operation((changes) => {
          published.push(...changes)
        })
    }).begin('import-rollback')
    await transaction.stage({
      path: 'first.bpmn',
      bytes: bytes('<changed />'),
      expectedHash: original.hash,
      createRecoveryRevision: true
    })
    await transaction.stage({
      path: 'second.bpmn',
      bytes: bytes('<second />'),
      createRecoveryRevision: false
    })
    await expect(transaction.commit()).rejects.toThrow()
    await expect(transaction.rollback()).resolves.toBeUndefined()

    expect(new TextDecoder().decode((await adapter.read('first.bpmn')).bytes)).toBe('<old />')
    await expect(adapter.read('second.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    expect((await historyManager.listRevisions()).revisions).toEqual([])
    expect((await adapter.list()).map(({ path }) => path)).toEqual(['first.bpmn'])
    expect(published).toEqual([
      expect.objectContaining({ kind: 'saved', path: 'first.bpmn' }),
      { kind: 'invalidated', path: HISTORY_ROOT }
    ])
  })

  it('prunes only created empty recovery folders and preserves pre-existing or non-empty folders', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'first.bpmn': '<first-old />',
        'second.bpmn': '<second-old />'
      },
      beforeWrite(path) {
        if (path === 'third.bpmn') throw new Error('simulated later write failure')
      }
    })
    const preExistingEmpty = `${HISTORY_ROOT}/pre-existing-empty`
    await adapter.createFolder(preExistingEmpty)
    const first = await adapter.read('first.bpmn')
    const second = await adapter.read('second.bpmn')
    const recoveryFolders = new Map<string, string>()
    const remove = adapter.remove.bind(adapter)
    adapter.remove = vi.fn(async (path) => {
      let originalPath: string | undefined
      if (path.endsWith('.json')) {
        originalPath = (
          JSON.parse(new TextDecoder().decode((await adapter.read(path)).bytes)) as {
            readonly originalPath?: string
          }
        ).originalPath
      }
      await remove(path)
      if (!originalPath) return
      const folder = workspaceParentPath(path)
      recoveryFolders.set(originalPath, folder)
    })
    const removeEmptyFolder = adapter.removeEmptyFolder.bind(adapter)
    let concurrentEntryInserted = false
    adapter.removeEmptyFolder = vi.fn(async (path) => {
      if (path === recoveryFolders.get('second.bpmn') && !concurrentEntryInserted) {
        concurrentEntryInserted = true
        const outcome = await adapter.writeAtomic(
          `${path}/concurrent-note.txt`,
          bytes('independent non-history content'),
          undefined,
          { expectedMissing: true }
        )
        expect(outcome.ok).toBe(true)
      }
      return await removeEmptyFolder(path)
    })
    const transaction = await new WorkspaceImportTransactionFactory(adapter).begin(
      'selective-recovery-folder-cleanup'
    )
    await transaction.stage({
      path: 'first.bpmn',
      bytes: bytes('<first-new />'),
      expectedHash: first.hash,
      createRecoveryRevision: true
    })
    await transaction.stage({
      path: 'second.bpmn',
      bytes: bytes('<second-new />'),
      expectedHash: second.hash,
      createRecoveryRevision: true
    })
    await transaction.stage({
      path: 'third.bpmn',
      bytes: bytes('<third />'),
      createRecoveryRevision: false
    })

    await expect(transaction.commit()).rejects.toThrow('simulated later write failure')
    await expect(transaction.rollback()).resolves.toBeUndefined()

    const firstRecoveryFolder = recoveryFolders.get('first.bpmn')
    const secondRecoveryFolder = recoveryFolders.get('second.bpmn')
    expect(firstRecoveryFolder).toBeDefined()
    expect(secondRecoveryFolder).toBeDefined()
    if (!firstRecoveryFolder || !secondRecoveryFolder) {
      throw new Error('Expected both recovery folders to be observed during cleanup')
    }
    const entries = await adapter.list()
    const paths = entries.map(({ path }) => path)
    expect(paths).toContain(preExistingEmpty)
    expect(paths).not.toContain(firstRecoveryFolder)
    expect(paths).toContain(secondRecoveryFolder)
    expect(paths).toContain(`${secondRecoveryFolder}/concurrent-note.txt`)
    expect(concurrentEntryInserted).toBe(true)
    expect(
      paths.filter(
        (path) =>
          path.startsWith(`${HISTORY_ROOT}/`) && (path.endsWith('.bpmn') || path.endsWith('.json'))
      )
    ).toEqual([])
    expect(new TextDecoder().decode((await adapter.read('first.bpmn')).bytes)).toBe('<first-old />')
    expect(new TextDecoder().decode((await adapter.read('second.bpmn')).bytes)).toBe(
      '<second-old />'
    )
  })

  it('retries paired-history cleanup without reapplying completed rollback writes', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'first.bpmn': '<old />' },
      beforeWrite(path) {
        if (path === 'second.bpmn') throw new Error('simulated storage failure')
      }
    })
    const remove = adapter.remove.bind(adapter)
    let rejectMetadataRemoval = true
    adapter.remove = async (path) => {
      if (rejectMetadataRemoval && path.endsWith('.json')) {
        rejectMetadataRemoval = false
        throw new Error('simulated metadata cleanup failure')
      }
      await remove(path)
    }
    const historyManager = new PortableHistoryManager({ adapter })
    const original = await adapter.read('first.bpmn')
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager
    }).begin('import-cleanup-retry')
    await transaction.stage({
      path: 'first.bpmn',
      bytes: bytes('<changed />'),
      expectedHash: original.hash,
      createRecoveryRevision: true
    })
    await transaction.stage({
      path: 'second.bpmn',
      bytes: bytes('<second />'),
      createRecoveryRevision: false
    })

    await expect(transaction.commit()).rejects.toThrow(
      'Spreadsheet import failed and automatic rollback was incomplete'
    )
    expect(new TextDecoder().decode((await adapter.read('first.bpmn')).bytes)).toBe('<old />')
    await expect(transaction.rollback()).resolves.toBeUndefined()
    expect((await historyManager.listRevisions()).revisions).toEqual([])
    const files = (await adapter.list()).filter((entry) => entry.kind === 'file')
    expect(files.map((entry) => entry.path)).toEqual(['first.bpmn'])
  })

  it('uses bounded shared history retention across repeated spreadsheet overwrites', async () => {
    let now = 1_000
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': 'v0' }
    })
    const historyManager = new PortableHistoryManager({
      adapter,
      now: () => now++,
      maxPerProcess: 2,
      maxTotalBytes: 10_000_000
    })
    const factory = new WorkspaceImportTransactionFactory(adapter, { historyManager })

    for (const next of ['v1', 'v2', 'v3']) {
      const original = await adapter.read('process.bpmn')
      const transaction = await factory.begin(`import-${next}`)
      await transaction.stage({
        path: 'process.bpmn',
        bytes: bytes(next),
        expectedHash: original.hash,
        createRecoveryRevision: true
      })
      await transaction.commit()
    }

    const listing = await historyManager.listRevisions('process.bpmn')
    expect(listing.issues).toEqual([])
    expect(listing.revisions).toHaveLength(2)
    const previews = await Promise.all(
      listing.revisions.map((revision) => historyManager.preview(revision))
    )
    expect(previews.map((preview) => new TextDecoder().decode(preview.bytes))).toEqual(['v2', 'v1'])
    expect(
      (await adapter.list()).filter(
        (entry) => entry.kind === 'file' && entry.path.startsWith('.orbitpm/history/')
      )
    ).toHaveLength(4)
  })

  it('cleans paired recovery history when the active workspace changes before writes', async () => {
    let current = true
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<old />' },
      beforeWrite(path) {
        if (path.endsWith('.json')) current = false
      }
    })
    const historyManager = new PortableHistoryManager({ adapter })
    const original = await adapter.read('process.bpmn')
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager,
      isCurrent: () => current
    }).begin('workspace-switch')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<new />'),
      expectedHash: original.hash,
      createRecoveryRevision: true
    })

    await expect(transaction.commit()).rejects.toThrow(
      'active workspace changed during the spreadsheet import'
    )
    expect(new TextDecoder().decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
    expect((await historyManager.listRevisions()).revisions).toEqual([])
  })

  it('cancels browser delivery cleanly before invoking the callback', async () => {
    const openSingle = vi.fn(async () => undefined)
    const transaction = await new BrowserImportDeliveryTransactionFactory({
      openSingle
    }).begin('browser-pre-delivery')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<definitions />'),
      createRecoveryRevision: false
    })
    const controller = new AbortController()
    controller.abort()

    await expect(transaction.commit({ signal: controller.signal })).rejects.toMatchObject({
      code: 'parse-cancelled'
    })
    expect(openSingle).not.toHaveBeenCalled()
    await expect(transaction.rollback()).resolves.toBeUndefined()
  })

  it('treats a pending browser callback as irreversible and commits after late abort', async () => {
    let resolveDelivery: (() => void) | undefined
    const openSingle = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveDelivery = resolve
        })
    )
    const transaction = await new BrowserImportDeliveryTransactionFactory({
      openSingle
    }).begin('browser-pending')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<definitions />'),
      createRecoveryRevision: false
    })
    const controller = new AbortController()
    const progress: { completed: number; total: number }[] = []

    const commit = transaction.commit({
      signal: controller.signal,
      onProgress: (event) => progress.push(event)
    })
    await vi.waitFor(() => expect(openSingle).toHaveBeenCalledOnce())
    controller.abort()
    await expect(transaction.rollback()).rejects.toThrow('cannot be recalled')
    resolveDelivery?.()
    await expect(commit).resolves.toBeUndefined()
    expect(progress).toEqual([
      { completed: 0, total: 1 },
      { completed: 1, total: 1 }
    ])
  })

  it('keeps rejected browser delivery indeterminate instead of claiming rollback', async () => {
    const transaction = await new BrowserImportDeliveryTransactionFactory({
      openSingle: async () => {
        throw new Error('delivery rejected')
      }
    }).begin('browser-rejected')
    await transaction.stage({
      path: 'process.bpmn',
      bytes: bytes('<definitions />'),
      createRecoveryRevision: false
    })

    await expect(transaction.commit()).rejects.toThrow('delivery rejected')
    await expect(transaction.rollback()).rejects.toThrow('cannot be recalled')
  })

  it('builds a deterministic multi-process ZIP', async () => {
    const archive = unzipSync(
      new Uint8Array(
        await buildSpreadsheetImportZip([
          { path: 'b.bpmn', bytes: bytes('B') },
          { path: 'a.bpmn', bytes: bytes('A') }
        ]).arrayBuffer()
      )
    )
    expect(Object.keys(archive)).toEqual(['a.bpmn', 'b.bpmn'])
    expect(strFromU8(archive['a.bpmn']!)).toBe('A')
  })
})
