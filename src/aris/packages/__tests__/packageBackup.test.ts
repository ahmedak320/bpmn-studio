import { describe, expect, it } from 'vitest'
import { applyWorkspaceBackupImport, inspectWorkspaceBackup } from '../../../workspace/adapters/backupImport'
import { sha256Hex } from '../../../workspace/adapters/hash'
import type { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import { arisPackagePaths } from '../layout'
import {
  arisPackageArchiveDigest,
  collectArisPackageArchive,
  compareArisPackageArchives,
  restoreArisPackageArchive
} from '../packageBackup'
import { ArisPackageStore } from '../store'
import { commitArisSourcePackage, planArisImportedPackage } from '../transaction'
import {
  SAMPLE_ANALYSIS,
  SAMPLE_MODELS,
  amlBytes,
  createWorkspace,
  importedSource,
  sampleAccounting
} from './harness'

async function populated(id = 'source-workspace'): Promise<{
  adapter: MemoryWorkspaceAdapter
  store: ArisPackageStore
  digest: string
}> {
  const adapter = createWorkspace(id)
  const source = await importedSource()
  const plan = await planArisImportedPackage({
    adapter,
    source,
    analysis: SAMPLE_ANALYSIS,
    accounting: sampleAccounting(source.sha256),
    models: SAMPLE_MODELS,
    attachments: [
      {
        attachmentId: 'Att.1',
        sourceId: 'ObjDef.7',
        name: 'plan.pdf',
        mediaType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4 attachment')
      }
    ],
    references: [
      {
        name: 'symbols.png',
        mediaType: 'image/png',
        bytes: new TextEncoder().encode('reference asset')
      }
    ]
  })
  const outcome = await commitArisSourcePackage({
    adapter,
    plan,
    reviewedDigest: plan.reviewDigest
  })
  if (outcome.status !== 'committed') throw new Error(`import failed: ${outcome.status}`)
  const store = new ArisPackageStore(adapter)
  await store.saveRevision(source.sha256, [
    { type: 'aris.object.rename', payload: { id: 'ObjOcc.1', name: 'Triage' } }
  ])
  return { adapter, store, digest: source.sha256 }
}

describe('package backup and restore (plan §7.4)', () => {
  it('round-trips original, revisions, report, attachments and references', async () => {
    const { adapter, digest } = await populated()
    const archive = await collectArisPackageArchive(adapter, digest)
    const paths = archive.members.map((member) => member.path)
    expect(paths).toEqual([
      'accounting.v2.json',
      'attachments/ObjDef.7/plan.pdf',
      'manifest.json',
      'original/source.xml',
      'references/symbols.png',
      ...paths.filter((path) => path.startsWith('working/')).sort()
    ])
    expect(paths.filter((path) => path.startsWith('working/revisions/'))).toHaveLength(2)
    expect(paths).toContain('working/current-revision.json')

    const restored = createWorkspace('restore-workspace')
    const outcome = await restoreArisPackageArchive(restored, archive)
    expect(outcome.status).toBe('restored')

    const roundTrip = await collectArisPackageArchive(restored, digest)
    const comparison = await compareArisPackageArchives(archive, roundTrip)
    expect(comparison.differences).toEqual([])
    expect(comparison.identical).toBe(true)
    expect(await arisPackageArchiveDigest(roundTrip)).toBe(
      await arisPackageArchiveDigest(archive)
    )

    const store = new ArisPackageStore(restored)
    const original = await store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect(original.hash).toBe(digest)
    expect(await sha256Hex(original.bytes)).toBe(digest)
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])
    expect((await store.replayRevisions(digest)).commands).toHaveLength(1)
  })

  it('is idempotent and never overwrites an existing original', async () => {
    const { adapter, digest } = await populated()
    const archive = await collectArisPackageArchive(adapter, digest)

    const again = await restoreArisPackageArchive(adapter, archive)
    expect(again.status).toBe('restored')
    if (again.status === 'restored') expect(again.writtenPaths).toEqual([])

    const tampered = {
      ...archive,
      members: await Promise.all(
        archive.members.map(async (member) =>
          member.path === 'original/source.xml'
            ? {
                ...member,
                bytes: new TextEncoder().encode('<AML>different</AML>'),
                byteLength: 20,
                sha256: await sha256Hex(new TextEncoder().encode('<AML>different</AML>'))
              }
            : member
        )
      )
    }
    const conflicted = await restoreArisPackageArchive(adapter, tampered)
    expect(conflicted.status).toBe('rolled-back')
    const store = new ArisPackageStore(adapter)
    expect((await store.readOriginalSource(digest)).hash).toBe(digest)
  })

  it('rejects an archive whose member digests do not match', async () => {
    const { adapter, digest } = await populated()
    const archive = await collectArisPackageArchive(adapter, digest)
    const corrupted = {
      ...archive,
      members: archive.members.map((member) =>
        member.path === 'manifest.json' ? { ...member, sha256: 'a'.repeat(64) } : member
      )
    }
    await expect(
      restoreArisPackageArchive(createWorkspace('corrupt-target'), corrupted)
    ).rejects.toThrow(/failed digest verification/u)
  })

  it('survives the real workspace ZIP backup and reviewed restore unchanged', async () => {
    const { adapter, digest } = await populated('zip-source')
    const before = await collectArisPackageArchive(adapter, digest)
    const blob = await adapter.exportBackup({ generatedAt: new Date(0) })

    const restored = createWorkspace('zip-target')
    const plan = await inspectWorkspaceBackup(restored, blob)
    const outcome = await applyWorkspaceBackupImport(restored, plan, {
      reviewedDigest: plan.reviewDigest
    })
    expect(outcome.status).toBe('committed')

    const after = await collectArisPackageArchive(restored, digest)
    expect((await compareArisPackageArchives(before, after)).differences).toEqual([])

    const store = new ArisPackageStore(restored)
    const original = await store.readOriginalSource(digest)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    expect(original.hash).toBe(digest)
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])

    const restoredPaths = arisPackagePaths(digest)
    expect(await store.hasMember(restoredPaths.accounting)).toBe(true)
    expect(await store.hasMember(`${restoredPaths.root}/attachments/ObjDef.7/plan.pdf`)).toBe(true)
    expect(await store.hasMember(`${restoredPaths.root}/references/symbols.png`)).toBe(true)
  })
})
