import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../../workspace/adapters/hash'
import type { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import { ArisPackagePathError, arisPackagePaths } from '../layout'
import { ArisPackageError, ArisPackageStore } from '../store'
import { commitArisSourcePackage, planArisImportedPackage } from '../transaction'
import { replayArisRevisions } from '../revisions'
import {
  SAMPLE_ANALYSIS,
  SAMPLE_MODELS,
  amlBytes,
  createWorkspace,
  importedSource,
  sampleAccounting,
  snapshotWorkspace
} from './harness'

async function importedPackage(): Promise<{
  adapter: MemoryWorkspaceAdapter
  store: ArisPackageStore
  digest: string
}> {
  const adapter = createWorkspace()
  const source = await importedSource()
  const plan = await planArisImportedPackage({
    adapter,
    source,
    analysis: SAMPLE_ANALYSIS,
    accounting: sampleAccounting(source.sha256),
    models: SAMPLE_MODELS
  })
  const outcome = await commitArisSourcePackage({
    adapter,
    plan,
    reviewedDigest: plan.reviewDigest
  })
  if (outcome.status !== 'committed') throw new Error(`import failed: ${outcome.status}`)
  return { adapter, store: new ArisPackageStore(adapter), digest: source.sha256 }
}

describe('immutability (plan §7.4)', () => {
  it('makes overwriting original/source.xml impossible through every write API', async () => {
    const { adapter, store, digest } = await importedPackage()
    const paths = arisPackagePaths(digest)
    const evil = new TextEncoder().encode('<AML>replaced</AML>')

    await expect(store.writeWorkingMember(paths.originalSource, evil)).rejects.toThrow(
      ArisPackagePathError
    )
    await expect(
      store.writeWorkingMember(`${paths.originalDirectory}/anything.xml`, evil)
    ).rejects.toThrow(ArisPackagePathError)
    await expect(store.createMemberOnce(paths.originalSource, evil)).rejects.toThrow(
      expect.objectContaining({ code: 'already-exists' })
    )

    const original = await store.readOriginalSource(digest)
    expect(original.hash).toBe(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect((await adapter.read(paths.originalSource)).hash).toBe(digest)
  })

  it('keeps the original byte-identical across save, edit and export', async () => {
    const { store, digest } = await importedPackage()
    const before = await store.readOriginalSource(digest)

    await store.saveRevision(digest, [
      { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Triage' } }
    ])
    await store.saveRevision(digest, [
      { type: 'aris.object.move', payload: { id: 'ObjOcc.1', x: 10, y: 20 } }
    ])
    const download = await store.readOriginalSourceDownload(digest)

    const after = await store.readOriginalSource(digest)
    expect(after.hash).toBe(before.hash)
    expect(after.hash).toBe(digest)
    expect(Array.from(after.bytes)).toEqual(Array.from(before.bytes))
    expect(Array.from(download.bytes)).toEqual(Array.from(amlBytes()))
    expect(await sha256Hex(download.bytes)).toBe(digest)
    expect(download.name).toBe('AnimalWF-sample.xml')
    expect(download.mediaType).toBe('application/xml')
  })

  it('writes saves as append-only working revisions', async () => {
    const { adapter, store, digest } = await importedPackage()
    const paths = arisPackagePaths(digest)
    const originalHash = (await adapter.read(paths.originalSource)).hash

    const first = await store.saveRevision(digest, [
      { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Triage' } }
    ])
    const second = await store.saveRevision(digest, [
      { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Intake triage' } }
    ])

    const state = await store.readRevisionState(digest)
    expect(state.current.ordinal).toBe(2)
    expect(state.patches.map((patch) => patch.revisionId)).toEqual([
      state.patches[0]?.revisionId,
      first.revisionId,
      second.revisionId
    ])
    const replay = await replayArisRevisions(state.patches)
    expect(replay.commands).toHaveLength(2)
    expect((await adapter.read(paths.originalSource)).hash).toBe(originalHash)

    // Revision patches are never rewritten.
    await expect(
      store.writeWorkingMember(
        `${paths.revisionsDirectory}/${first.revisionId}.patch.json`,
        new TextEncoder().encode('{}'),
        'f'.repeat(64)
      )
    ).rejects.toThrow(ArisPackageError)
  })

  it('restores an earlier revision without deleting later ones', async () => {
    const { store, digest } = await importedPackage()
    const first = await store.saveRevision(digest, [{ type: 'aris.a', payload: {} }])
    await store.saveRevision(digest, [{ type: 'aris.b', payload: {} }])
    const restore = await store.restoreRevision(digest, first.revisionId)

    const state = await store.readRevisionState(digest)
    expect(state.patches).toHaveLength(4)
    expect(state.current.currentRevisionId).toBe(restore.revisionId)
    const replay = await store.replayRevisions(digest)
    expect(replay.commands.map((command) => command.type)).toEqual(['aris.a'])
  })

  it('keeps the original when a model is deleted', async () => {
    const { store, digest } = await importedPackage()
    const before = await store.readOriginalSource(digest)

    const manifest = await store.deleteModel(digest, 'Model.1')
    expect(manifest.models).toEqual([])

    const after = await store.readOriginalSource(digest)
    expect(after.hash).toBe(before.hash)
    const replay = await store.replayRevisions(digest)
    expect(replay.commands.at(-1)).toEqual({
      type: 'aris.model.delete',
      payload: { modelId: 'Model.1' }
    })
    await expect(store.deleteModel(digest, 'Model.404')).rejects.toThrow(
      expect.objectContaining({ code: 'not-found' })
    )
  })

  it('deletes a source package only with explicit confirmation', async () => {
    const { adapter, store, digest } = await importedPackage()
    const before = await snapshotWorkspace(adapter)

    for (const bad of [
      undefined,
      { confirmed: false, confirmedSourceSha256: digest },
      { confirmed: true, confirmedSourceSha256: 'a'.repeat(64) },
      { confirmed: true, confirmedSourceSha256: '' }
    ]) {
      await expect(
        store.deleteSourcePackage(
          digest,
          bad as unknown as Parameters<typeof store.deleteSourcePackage>[1]
        )
      ).rejects.toThrow(expect.objectContaining({ code: 'confirmation-required' }))
    }
    expect(await snapshotWorkspace(adapter)).toEqual(before)

    await store.deleteSourcePackage(digest, {
      confirmed: true,
      confirmedSourceSha256: digest
    })
    expect(await store.listPackages()).toEqual([])
  })

  it('never lets API keys enter the package', async () => {
    const { adapter, store, digest } = await importedPackage()
    const findings = await store.scanForSecrets(digest)
    expect(findings).toEqual([])

    // Scan every OrbitPM-authored artifact directly for credential shapes.
    const entries = await adapter.list(arisPackagePaths(digest).root)
    const keyShapes = [
      /sk-ant-[A-Za-z0-9_-]{16,}/u,
      /\bsk-[A-Za-z0-9_-]{20,}/u,
      /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/u,
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
      /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/u,
      /\b(?:api[_-]?key|authorization|client[_-]?secret|password)\b\s*["']?\s*[:=]/iu
    ]
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const text = new TextDecoder().decode((await adapter.read(entry.path)).bytes)
      for (const shape of keyShapes) {
        expect(shape.test(text), `${entry.path} matched ${String(shape)}`).toBe(false)
      }
    }

    // A credential-shaped save is rejected before it can be persisted.
    await expect(
      store.saveRevision(digest, [
        { type: 'aris.ai.request', payload: { apiKey: 'sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZ' } }
      ])
    ).rejects.toThrow()
    expect(await store.scanForSecrets(digest)).toEqual([])
  })

  it('detects tampering through integrity verification', async () => {
    const { adapter, store, digest } = await importedPackage()
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])

    adapter.replaceExternally(arisPackagePaths(digest).originalSource, '<AML>tampered</AML>')
    await expect(store.readOriginalSource(digest)).rejects.toThrow(
      expect.objectContaining({ code: 'integrity-failure' })
    )
    const report = await store.verifyIntegrity(digest)
    expect(report.problems).toContain(
      'The original source bytes no longer match the package digest.'
    )
  })
})
