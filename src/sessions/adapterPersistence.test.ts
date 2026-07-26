import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceAdapter, WorkspaceOperationError } from '../workspace/adapters'
import { AdapterSessionPersistence } from './adapterPersistence'
import { DocumentSessionController } from './controller'
import type { DocumentIdentity, WorkspaceIdentity } from './types'

const workspace: WorkspaceIdentity = { id: 'ws', generation: 1, mode: 'opfs' }
const identity: DocumentIdentity = { workspace, path: 'a.bpmn' }

async function setup() {
  let now = 10
  const adapter = new MemoryWorkspaceAdapter({
    id: 'ws',
    now: () => ++now,
    files: { 'a.bpmn': '<old/>' }
  })
  const persistence = new AdapterSessionPersistence({ adapter, workspace })
  const loaded = await persistence.inspect(identity)
  if (!loaded) throw new Error('fixture missing')
  const controller = new DocumentSessionController({ persistence })
  controller.open({
    id: 's',
    identity,
    title: 'a.bpmn',
    xml: loaded.xml,
    base: loaded.fingerprint
  })
  return { adapter, persistence, loaded, controller }
}

describe('AdapterSessionPersistence integration seam', () => {
  it('reads and atomically writes UTF-8 XML through the bound adapter', async () => {
    const { adapter, controller } = await setup()
    controller.updateXml('s', '<new>العربية</new>')

    expect(await controller.save('s')).toMatchObject({ status: 'success', ok: true })
    expect(new TextDecoder().decode((await adapter.read('a.bpmn')).bytes)).toBe(
      '<new>العربية</new>'
    )
  })

  it('maps compare-and-set races to external conflicts without overwriting', async () => {
    const { adapter, controller } = await setup()
    controller.updateXml('s', '<local/>')
    adapter.replaceExternally('a.bpmn', '<external/>')

    expect(await controller.save('s')).toMatchObject({
      status: 'external-conflict',
      conflict: { external: { xml: '<external/>' } }
    })
    expect(new TextDecoder().decode((await adapter.read('a.bpmn')).bytes)).toBe('<external/>')
  })

  it('implements explicit overwrite as a fresh compare-and-set against current bytes', async () => {
    const { adapter, controller } = await setup()
    controller.updateXml('s', '<local/>')
    adapter.replaceExternally('a.bpmn', '<external/>')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'overwrite', confirmed: true }
      })
    ).toMatchObject({ status: 'success' })
    expect(new TextDecoder().decode((await adapter.read('a.bpmn')).bytes)).toBe('<local/>')
  })

  it('does not let explicit overwrite silently cover a second external edit', async () => {
    let raceOnce = true
    const adapter = new MemoryWorkspaceAdapter({
      id: 'ws',
      files: { 'a.bpmn': '<old/>' },
      beforeWrite: () => {
        if (!raceOnce) return
        raceOnce = false
        adapter.replaceExternally('a.bpmn', '<second-external/>')
      }
    })
    const persistence = new AdapterSessionPersistence({ adapter, workspace })
    const loaded = await persistence.inspect(identity)
    if (!loaded) throw new Error('fixture missing')
    const controller = new DocumentSessionController({ persistence })
    controller.open({
      id: 's',
      identity,
      title: 'a',
      xml: loaded.xml,
      base: loaded.fingerprint
    })
    controller.updateXml('s', '<local/>')
    adapter.replaceExternally('a.bpmn', '<first-external/>')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'overwrite', confirmed: true }
      })
    ).toMatchObject({
      status: 'external-conflict',
      decisionStale: true,
      conflict: { external: { xml: '<second-external/>' } }
    })
    expect(new TextDecoder().decode((await adapter.read('a.bpmn')).bytes)).toBe(
      '<second-external/>'
    )
  })

  it('maps adapter permission loss and stale workspace generations truthfully', async () => {
    const { adapter, controller, loaded } = await setup()
    controller.updateXml('s', '<local/>')
    adapter.setPermission('denied')
    expect(await controller.save('s')).toMatchObject({ status: 'permission-loss' })

    const staleIdentity: DocumentIdentity = {
      workspace: { ...workspace, generation: 2 },
      path: 'a.bpmn'
    }
    const stale = new DocumentSessionController({
      persistence: new AdapterSessionPersistence({
        adapter: new MemoryWorkspaceAdapter({ id: 'ws', files: { 'a.bpmn': '<old/>' } }),
        workspace
      })
    })
    stale.open({
      id: 'stale',
      identity: staleIdentity,
      title: 'a',
      xml: loaded.xml,
      base: loaded.fingerprint
    })
    stale.updateXml('stale', '<new/>')
    expect(await stale.save('stale')).toEqual({
      status: 'stale-workspace',
      ok: false,
      sessionId: 'stale'
    })
  })

  it('keeps Save As creation-only so an existing destination is never overwritten', async () => {
    const { adapter, controller } = await setup()
    adapter.replaceExternally('copy.bpmn', '<existing/>')
    controller.updateXml('s', '<local/>')
    adapter.replaceExternally('a.bpmn', '<external/>')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
      })
    ).toMatchObject({
      status: 'external-conflict',
      conflict: {
        identity: { path: 'copy.bpmn' },
        reason: 'untracked-existing',
        base: null
      }
    })
    expect(new TextDecoder().decode((await adapter.read('copy.bpmn')).bytes)).toBe('<existing/>')
    expect(controller.store.get('s')?.identity.path).toBe('a.bpmn')
  })

  it('handles virtual documents, missing files, and non-missing read failures explicitly', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'ws' })
    const persistence = new AdapterSessionPersistence({
      adapter,
      workspace,
      encoder: new TextEncoder(),
      decoder: new TextDecoder('utf-8', { fatal: true })
    })
    const virtual: DocumentIdentity = { workspace, path: null }

    await expect(persistence.inspect(virtual)).resolves.toBeNull()
    await expect(
      persistence.write(virtual, '<virtual/>', {
        expectedBase: null,
        force: false
      })
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(persistence.inspect({ workspace, path: 'missing.bpmn' })).resolves.toBeNull()

    adapter.setPermission('denied')
    await expect(persistence.inspect(identity)).rejects.toBeInstanceOf(WorkspaceOperationError)
  })

  it('creates a new path with Save As and returns creation conflicts without changing bytes', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'ws',
      files: { 'a.bpmn': '<source/>' }
    })
    const persistence = new AdapterSessionPersistence({ adapter, workspace })

    await expect(
      persistence.writeAs(identity, 'copy.bpmn', '<copy/>', {
        expectedBase: null
      })
    ).resolves.toMatchObject({
      status: 'written',
      identity: { path: 'copy.bpmn' }
    })
    await expect(
      persistence.writeAs(identity, 'copy.bpmn', '<replacement/>', {
        expectedBase: null
      })
    ).resolves.toMatchObject({
      status: 'external-conflict',
      external: { xml: '<copy/>' }
    })
    expect(new TextDecoder().decode((await adapter.read('copy.bpmn')).bytes)).toBe('<copy/>')
  })

  it('maps adapter cancellation/failure outcomes and conflicts with no actual file', async () => {
    const adapter = new MemoryWorkspaceAdapter({ id: 'ws' })
    const persistence = new AdapterSessionPersistence({ adapter, workspace })
    const writeAtomic = vi.spyOn(adapter, 'writeAtomic')

    writeAtomic.mockResolvedValueOnce({
      ok: false,
      status: 'external-conflict',
      reason: 'missing',
      expectedHash: 'gone'
    })
    await expect(
      persistence.write(identity, '<local/>', {
        expectedBase: { hash: 'gone', size: 4, modifiedAt: 1 },
        force: false
      })
    ).resolves.toEqual({ status: 'external-conflict', external: null })

    writeAtomic.mockResolvedValueOnce({
      ok: false,
      status: 'cancelled',
      error: {
        code: 'cancelled',
        message: 'cancelled by user',
        operation: 'write',
        path: 'a.bpmn'
      }
    })
    await expect(
      persistence.write(identity, '<local/>', {
        expectedBase: null,
        force: false
      })
    ).rejects.toMatchObject({
      name: 'AdapterOutcomeError',
      code: 'cancelled',
      message: 'cancelled by user'
    })

    writeAtomic.mockResolvedValueOnce({
      ok: false,
      status: 'stale-workspace',
      expectedWorkspaceId: 'ws',
      actualWorkspaceId: 'other'
    })
    await expect(
      persistence.write(identity, '<local/>', {
        expectedBase: null,
        force: false
      })
    ).rejects.toMatchObject({
      name: 'AdapterOutcomeError',
      code: 'stale-workspace',
      message: 'Workspace stale-workspace while saving'
    })
  })

  it('rejects adapter/workspace and document/workspace identity mismatches', async () => {
    expect(
      () =>
        new AdapterSessionPersistence({
          adapter: new MemoryWorkspaceAdapter({ id: 'different' }),
          workspace
        })
    ).toThrow(/does not match/)

    const persistence = new AdapterSessionPersistence({
      adapter: new MemoryWorkspaceAdapter({ id: 'ws' }),
      workspace
    })
    await expect(
      persistence.inspect({
        workspace: { ...workspace, id: 'other' },
        path: 'a.bpmn'
      })
    ).rejects.toMatchObject({ code: 'stale-workspace' })
    await expect(
      persistence.inspect({
        workspace: { ...workspace, mode: 'directory' },
        path: 'a.bpmn'
      })
    ).rejects.toMatchObject({ code: 'stale-workspace' })
  })
})
