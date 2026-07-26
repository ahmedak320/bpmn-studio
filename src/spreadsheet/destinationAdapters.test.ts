import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { MemoryWorkspaceAdapter } from '../workspace/adapters'
import { PortableHistoryManager } from '../workspace/history'
import {
  WorkspaceImportTransactionFactory,
  WorkspaceSpreadsheetDestinationInspector,
  buildSpreadsheetImportZip
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
    const [existing, missing] = await inspector.inspect(['existing.bpmn', 'new.bpmn'])
    expect(existing).toMatchObject({ exists: true })
    expect(missing).toEqual({ path: 'new.bpmn', exists: false })

    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager
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
    await transaction.commit()

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
    const transaction = await new WorkspaceImportTransactionFactory(adapter, {
      historyManager
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
    const files = (await adapter.list()).filter((entry) => entry.kind === 'file')
    expect(files.map((entry) => entry.path)).toEqual(['first.bpmn'])
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
