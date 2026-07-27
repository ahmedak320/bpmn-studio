import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  MemoryWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH,
  copyBytes,
  normalizeWorkspacePath,
  sha256Hex
} from '..'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

describe('workspace path and hash primitives', () => {
  it('normalizes separators while rejecting traversal and absolute paths', () => {
    expect(normalizeWorkspacePath('sales\\\\intake//request.bpmn')).toBe(
      'sales/intake/request.bpmn'
    )
    expect(normalizeWorkspacePath('', { allowRoot: true })).toBe('')
    expect(() => normalizeWorkspacePath('../secret.bpmn')).toThrow(/\.\./)
    expect(() => normalizeWorkspacePath('safe/../secret.bpmn')).toThrow(/\.\./)
    expect(() => normalizeWorkspacePath('/etc/passwd')).toThrow(/relative/)
    expect(() => normalizeWorkspacePath('C:\\secret.bpmn')).toThrow(/relative/)
    expect(() => normalizeWorkspacePath('folder/\u0000bad')).toThrow(/control/)
  })

  it('computes standard SHA-256 and returns owned byte copies', async () => {
    expect(await sha256Hex(text('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    const source = text('safe')
    const copy = copyBytes(source)
    copy[0] = 0
    expect(decode(source)).toBe('safe')
    expect(copy.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

describe('MemoryWorkspaceAdapter', () => {
  it('supports recursive folders, listing, reads, and defensive snapshots', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'memory:test',
      folders: ['empty', '.orbitpm/history'],
      files: {
        'sales/intake.bpmn': '<xml />',
        'sales/logo.bin': new Uint8Array([0, 255, 7])
      },
      now: () => 42
    })

    expect((await adapter.list()).map((entry) => [entry.path, entry.kind])).toEqual([
      ['.orbitpm', 'directory'],
      ['.orbitpm/history', 'directory'],
      ['empty', 'directory'],
      ['sales', 'directory'],
      ['sales/intake.bpmn', 'file'],
      ['sales/logo.bin', 'file']
    ])
    expect((await adapter.list('sales')).map((entry) => entry.path)).toEqual([
      'sales/intake.bpmn',
      'sales/logo.bin'
    ])

    const first = await adapter.read('sales/logo.bin')
    first.bytes[0] = 99
    expect([...(await adapter.read('sales/logo.bin')).bytes]).toEqual([0, 255, 7])
    expect(first.size).toBe(3)
  })

  it('serializes concurrent expected-hash saves so only one wins', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': 'base' },
      now: (() => {
        let value = 10
        return () => ++value
      })()
    })
    const base = await adapter.read('process.bpmn')

    const [left, right] = await Promise.all([
      adapter.writeAtomic('process.bpmn', text('left'), base.hash),
      adapter.writeAtomic('process.bpmn', text('right'), base.hash)
    ])
    const outcomes = [left, right]
    expect(outcomes.filter((outcome) => outcome.status === 'success')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'external-conflict')).toHaveLength(1)
    expect(['left', 'right']).toContain(decode((await adapter.read('process.bpmn')).bytes))
  })

  it('distinguishes changed, deleted, existing, stale, cancelled, and permission outcomes', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'workspace:generation-2',
      files: { 'process.bpmn': 'one' }
    })
    const initial = await adapter.read('process.bpmn')
    adapter.replaceExternally('process.bpmn', 'external')

    const changed = await adapter.writeAtomic('process.bpmn', text('local'), initial.hash)
    expect(changed).toMatchObject({
      ok: false,
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    if (changed.status === 'external-conflict') {
      expect(decode(changed.actual!.bytes)).toBe('external')
    }

    const current = await adapter.read('process.bpmn')
    adapter.removeExternally('process.bpmn')
    expect(await adapter.writeAtomic('process.bpmn', text('local'), current.hash)).toMatchObject({
      status: 'external-conflict',
      reason: 'missing'
    })

    await adapter.writeAtomic('process.bpmn', text('created'), undefined, {
      expectedMissing: true
    })
    expect(
      await adapter.writeAtomic('process.bpmn', text('again'), undefined, {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'external-conflict', reason: 'already-exists' })
    expect(
      await adapter.writeAtomic('process.bpmn', text('stale'), undefined, {
        expectedWorkspaceId: 'workspace:generation-1'
      })
    ).toMatchObject({ status: 'stale-workspace' })

    const controller = new AbortController()
    controller.abort()
    expect(
      await adapter.writeAtomic('process.bpmn', text('cancel'), undefined, {
        signal: controller.signal
      })
    ).toMatchObject({ status: 'cancelled' })

    adapter.setPermission('denied')
    expect(await adapter.writeAtomic('process.bpmn', text('denied'))).toMatchObject({
      status: 'permission-loss'
    })
  })

  it('renames, moves, recursively removes, and protects hierarchy invariants', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['sales/sub', 'archive'],
      files: {
        'sales/sub/a.bpmn': 'a',
        'sales/sub/raw.bin': new Uint8Array([1, 2, 3]),
        'archive/taken.bpmn': 'taken'
      }
    })

    await adapter.rename('sales/sub/a.bpmn', 'sales/sub/renamed.bpmn')
    expect(decode((await adapter.read('sales/sub/renamed.bpmn')).bytes)).toBe('a')
    await adapter.move('sales/sub', 'archive/sub')
    expect([...(await adapter.read('archive/sub/raw.bin')).bytes]).toEqual([1, 2, 3])
    await expect(adapter.read('sales/sub/renamed.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(adapter.move('archive', 'archive/sub/nested')).rejects.toMatchObject({
      code: 'invalid-path'
    })
    await expect(
      adapter.rename('archive/sub/renamed.bpmn', 'elsewhere/renamed.bpmn')
    ).rejects.toMatchObject({ code: 'invalid-path' })

    await adapter.remove('archive/sub')
    expect((await adapter.list()).some((entry) => entry.path.startsWith('archive/sub'))).toBe(false)
  })

  it('removes empty folders atomically without deleting non-empty contents', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['empty', 'occupied'],
      files: { 'occupied/concurrent-note.txt': 'retain me' }
    })

    await expect(adapter.removeEmptyFolder('occupied')).resolves.toBe('not-empty')
    expect(decode((await adapter.read('occupied/concurrent-note.txt')).bytes)).toBe('retain me')
    await expect(adapter.removeEmptyFolder('empty')).resolves.toBe('removed')
    await expect(adapter.list('empty')).rejects.toMatchObject({ code: 'not-found' })
    await expect(adapter.removeEmptyFolder('occupied/concurrent-note.txt')).rejects.toMatchObject({
      code: 'not-a-directory'
    })
  })

  it('conditionally removes only the exact file incarnation at delete entry', async () => {
    let injectRace = false
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'exact.txt': 'exact',
        'raced.txt': 'reviewed'
      },
      beforeRemoveIfHash: (path) => {
        if (path === 'raced.txt' && injectRace) {
          adapter.replaceExternally(path, 'newer bytes')
        }
      }
    })

    const exact = await adapter.read('exact.txt')
    await adapter.removeIfHash('exact.txt', exact.hash)
    await expect(adapter.read('exact.txt')).rejects.toMatchObject({ code: 'not-found' })

    const raced = await adapter.read('raced.txt')
    injectRace = true
    await expect(adapter.removeIfHash('raced.txt', raced.hash)).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'remove',
      path: 'raced.txt'
    })
    expect(decode((await adapter.read('raced.txt')).bytes)).toBe('newer bytes')
  })

  it('exports a complete ZIP with checksums, metadata, history, and empty folders', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'backup-source',
      folders: ['empty', '.orbitpm/history'],
      files: [
        {
          path: 'process.bpmn',
          bytes: '<definitions />',
          modifiedAt: 123,
          mimeType: 'application/xml'
        },
        {
          path: '.orbitpm/manifest.json',
          bytes: '{"workspaceVersion":1}',
          modifiedAt: 124,
          mimeType: 'application/json'
        },
        {
          path: '.orbitpm/history/process/revision.bpmn',
          bytes: '<old />',
          modifiedAt: 125
        }
      ]
    })

    const blob = await adapter.exportBackup({
      generatedAt: new Date('2026-07-26T00:00:00.000Z')
    })
    expect(blob.type).toBe('application/zip')
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(archive)).toEqual(
      expect.arrayContaining([
        WORKSPACE_BACKUP_MANIFEST_PATH,
        'workspace/process.bpmn',
        'workspace/.orbitpm/manifest.json',
        'workspace/.orbitpm/history/process/revision.bpmn'
      ])
    )
    expect(strFromU8(archive['workspace/process.bpmn'])).toBe('<definitions />')

    const manifest = JSON.parse(strFromU8(archive[WORKSPACE_BACKUP_MANIFEST_PATH])) as {
      generatedAt: string
      directories: string[]
      files: Array<{ path: string; sha256: string; size: number }>
    }
    expect(manifest.generatedAt).toBe('2026-07-26T00:00:00.000Z')
    expect(manifest.directories).toEqual(
      expect.arrayContaining(['empty', '.orbitpm/history', '.orbitpm/history/process'])
    )
    const process = manifest.files.find((file) => file.path === 'process.bpmn')!
    expect(process.size).toBe(text('<definitions />').byteLength)
    expect(process.sha256).toBe(await sha256Hex(text('<definitions />')))
  })

  it('refuses a mixed-time backup when an external writer changes the workspace', async () => {
    class ChangingWorkspace extends MemoryWorkspaceAdapter {
      private changed = false

      override async read(path: string) {
        const snapshot = await super.read(path)
        if (!this.changed) {
          this.changed = true
          this.replaceExternally('second.bpmn', 'changed while exporting')
        }
        return snapshot
      }
    }
    const adapter = new ChangingWorkspace({
      files: {
        'first.bpmn': 'first',
        'second.bpmn': 'second'
      }
    })

    await expect(adapter.exportBackup()).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'export-backup'
    })
  })
})
