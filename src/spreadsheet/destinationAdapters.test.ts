import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { MemoryWorkspaceAdapter } from '../workspace/adapters'
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
    const inspector = new WorkspaceSpreadsheetDestinationInspector(adapter)
    const [existing, missing] = await inspector.inspect(['existing.bpmn', 'new.bpmn'])
    expect(existing).toMatchObject({ exists: true })
    expect(missing).toEqual({ path: 'new.bpmn', exists: false })

    const transaction = await new WorkspaceImportTransactionFactory(adapter).begin('import-1')
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
    const history = (await adapter.list()).filter((entry) =>
      entry.path.startsWith('.orbitpm/history/imports/import-1/')
    )
    expect(history.some(({ kind }) => kind === 'file')).toBe(true)
  })

  it('automatically restores every applied destination when a later write fails', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'first.bpmn': '<old />' },
      beforeWrite(path) {
        if (path === 'second.bpmn') throw new Error('simulated storage failure')
      }
    })
    const original = await adapter.read('first.bpmn')
    const transaction = await new WorkspaceImportTransactionFactory(adapter).begin(
      'import-rollback'
    )
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
