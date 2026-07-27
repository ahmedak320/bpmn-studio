import { describe, expect, it, vi } from 'vitest'
import { DirectoryWorkspaceAdapter } from '..'
import { asDirectoryHandle, fakeRoot } from './fakeFileSystem'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

describe('DirectoryWorkspaceAdapter', () => {
  it('lists folders and isolates unreadable files without failing the refresh', async () => {
    const root = fakeRoot()
    root.addFile('good/process.bpmn', '<good />', { lastModified: 7 })
    root.addFile('good/data.bin', new Uint8Array([0, 255]))
    root.addFile('bad.bpmn', '<bad />').unreadable = true
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:1'
    })

    const entries = await adapter.list()
    expect(entries.find((entry) => entry.path === 'good')).toMatchObject({
      kind: 'directory',
      readable: true
    })
    expect(entries.find((entry) => entry.path === 'good/process.bpmn')).toMatchObject({
      kind: 'file',
      readable: true,
      size: text('<good />').byteLength,
      modifiedAt: 7
    })
    expect(entries.find((entry) => entry.path === 'bad.bpmn')).toMatchObject({
      kind: 'file',
      readable: false,
      issue: { code: 'storage-failure', operation: 'read' }
    })
    expect([...(await adapter.read('good/data.bin')).bytes]).toEqual([0, 255])
  })

  it('stops recursive traversal at configured entry and depth ceilings', async () => {
    const root = fakeRoot()
    root.addFile('one/a.bpmn', 'a')
    root.addFile('one/two/b.bpmn', 'b')
    root.addFile('one/two/three/c.bpmn', 'c')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:bounded-list'
    })

    await expect(adapter.list('', { maxEntries: 2 })).rejects.toMatchObject({
      name: 'WorkspaceListLimitError',
      operation: 'list',
      dimension: 'entries',
      limit: 2
    })
    await expect(adapter.list('', { maxDepth: 2 })).rejects.toMatchObject({
      name: 'WorkspaceListLimitError',
      operation: 'list',
      path: 'one/two/b.bpmn',
      dimension: 'depth',
      limit: 2
    })
  })

  it('stops recursive metadata traversal when its list signal is aborted', async () => {
    const root = fakeRoot()
    const first = root.addFile('a.bpmn', 'a')
    const second = root.addFile('b.bpmn', 'b')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:cancelled-list'
    })
    const controller = new AbortController()
    const firstGetFile = first.getFile.bind(first)
    vi.spyOn(first, 'getFile').mockImplementation(async () => {
      const file = await firstGetFile()
      controller.abort('stop listing')
      return file
    })
    const secondGetFile = vi.spyOn(second, 'getFile')

    await expect(adapter.list('', { signal: controller.signal })).rejects.toBe('stop listing')
    expect(secondGetFile).not.toHaveBeenCalled()
  })

  it('enforces expected hashes and maps permission, stale, and cancellation outcomes', async () => {
    const root = fakeRoot()
    root.addFile('process.bpmn', 'base')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:current'
    })
    const base = await adapter.read('process.bpmn')
    root.file('process.bpmn').bytes = text('external')

    const conflict = await adapter.writeAtomic('process.bpmn', text('local'), base.hash)
    expect(conflict).toMatchObject({
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    expect(decode(root.file('process.bpmn').bytes)).toBe('external')

    const external = await adapter.read('process.bpmn')
    const saved = await adapter.writeAtomic('process.bpmn', text('saved'), external.hash)
    expect(saved).toMatchObject({
      ok: true,
      status: 'success',
      created: false,
      disposition: 'workspace'
    })
    expect(decode(root.file('process.bpmn').bytes)).toBe('saved')

    expect(
      await adapter.writeAtomic('new.bpmn', text('new'), undefined, {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'success', created: true })
    expect(
      await adapter.writeAtomic('new.bpmn', text('clobber'), undefined, {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'external-conflict', reason: 'already-exists' })
    expect(
      await adapter.writeAtomic('process.bpmn', text('stale'), undefined, {
        expectedWorkspaceId: 'directory:old'
      })
    ).toMatchObject({ status: 'stale-workspace' })

    const controller = new AbortController()
    controller.abort()
    expect(
      await adapter.writeAtomic('process.bpmn', text('cancel'), undefined, {
        signal: controller.signal
      })
    ).toMatchObject({ status: 'cancelled' })

    root.permission = 'denied'
    expect(await adapter.writeAtomic('process.bpmn', text('denied'))).toMatchObject({
      status: 'permission-loss'
    })
  })

  it('preserves the old bytes when atomic writable close fails', async () => {
    const root = fakeRoot()
    const file = root.addFile('process.bpmn', 'safe')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:atomic'
    })
    const snapshot = await adapter.read('process.bpmn')
    file.failNextClose = new Error('disk full')

    expect(await adapter.writeAtomic('process.bpmn', text('partial'), snapshot.hash)).toMatchObject(
      {
        status: 'storage-failure'
      }
    )
    expect(decode(root.file('process.bpmn').bytes)).toBe('safe')
  })

  it('relocates complete binary folder trees and refuses collisions or descendants', async () => {
    const root = fakeRoot()
    root.addDirectory('source/child')
    root.addFile('source/process.bpmn', '<xml />')
    root.addFile('source/child/binary.bin', new Uint8Array([0, 1, 254, 255]))
    root.addDirectory('archive')
    root.addFile('taken.bpmn', 'taken')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:moves'
    })

    await adapter.rename('taken.bpmn', 'renamed.bpmn')
    expect(decode((await adapter.read('renamed.bpmn')).bytes)).toBe('taken')
    await adapter.move('source', 'archive/source')
    expect([...(await adapter.read('archive/source/child/binary.bin')).bytes]).toEqual([
      0, 1, 254, 255
    ])
    await expect(adapter.read('source/process.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(adapter.move('archive', 'archive/source/inside')).rejects.toMatchObject({
      code: 'invalid-path'
    })
    await expect(adapter.rename('renamed.bpmn', 'archive/renamed.bpmn')).rejects.toMatchObject({
      code: 'invalid-path'
    })
  })

  it('creates nested folders and recursively removes their complete contents', async () => {
    const root = fakeRoot()
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:folders'
    })

    await adapter.createFolder('one/two/three')
    expect(
      await adapter.writeAtomic('one/two/three/process.bpmn', text('process'), undefined, {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'success', created: true })
    await adapter.remove('one/two')
    expect((await adapter.list()).map((entry) => entry.path)).toEqual(['one'])
    await expect(adapter.remove('one/missing')).rejects.toMatchObject({
      code: 'not-found'
    })
  })

  it('does not create parent folders when an expected file was externally deleted', async () => {
    const root = fakeRoot()
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:missing-cas'
    })

    expect(
      await adapter.writeAtomic('not-created/process.bpmn', text('local'), 'f'.repeat(64))
    ).toMatchObject({ status: 'external-conflict', reason: 'missing' })
    expect(root.children.has('not-created')).toBe(false)
  })

  it('uses a recovery staging name for safe case-only renames', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    root.addFile('Order.bpmn', 'case-safe')
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:case'
    })

    await adapter.rename('Order.bpmn', 'order.bpmn')
    expect(decode((await adapter.read('order.bpmn')).bytes)).toBe('case-safe')
    expect([...root.children.keys()]).toEqual(['order.bpmn'])
  })

  it('rejects unsafe paths before touching the directory handle', async () => {
    const root = fakeRoot()
    const adapter = new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
      workspaceId: 'directory:safe'
    })
    await expect(adapter.writeAtomic('../escape.bpmn', text('bad'))).rejects.toMatchObject({
      code: 'invalid-path'
    })
    await expect(adapter.createFolder('/absolute')).rejects.toMatchObject({
      code: 'invalid-path'
    })
    expect(root.children.size).toBe(0)
  })
})
