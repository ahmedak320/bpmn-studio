/**
 * Plan §7.6 exit gate, proven end to end in one lifecycle:
 * import is atomic, the original survives save/edit/export/backup/restore
 * unchanged, identical sources deduplicate, and generated models keep their
 * provenance.
 */

import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceBackupImport,
  inspectWorkspaceBackup
} from '../../../workspace/adapters/backupImport'
import { sha256Hex } from '../../../workspace/adapters/hash'
import { createArisAccountingDocument } from '../accounting'
import { arisPackagePaths } from '../layout'
import { collectArisPackageArchive, compareArisPackageArchives } from '../packageBackup'
import { ArisPackageStore } from '../store'
import {
  commitArisSourcePackage,
  planArisGeneratedPackage,
  planArisImportedPackage
} from '../transaction'
import {
  FaultInjectingWorkspaceAdapter,
  SAMPLE_ANALYSIS,
  SAMPLE_MODELS,
  amlBytes,
  createWorkspace,
  importedSource,
  sampleAccounting,
  snapshotWorkspace
} from './harness'

describe('phase 4 exit gate (plan §7.6)', () => {
  it('imports atomically, preserves the original everywhere, and deduplicates', async () => {
    const original = amlBytes()
    const digest = await sha256Hex(original)

    // 1. A failed import leaves nothing behind.
    const workspace = createWorkspace('exit-gate')
    const empty = await snapshotWorkspace(workspace)
    const faulty = new FaultInjectingWorkspaceAdapter(workspace, {
      operation: 'write',
      atCall: 3
    })
    const doomed = await planArisImportedPackage({
      adapter: faulty,
      source: await importedSource(original),
      analysis: SAMPLE_ANALYSIS,
      accounting: sampleAccounting(digest),
      models: SAMPLE_MODELS
    })
    const failed = await commitArisSourcePackage({
      adapter: faulty,
      plan: doomed,
      reviewedDigest: doomed.reviewDigest
    })
    expect(failed.status).toBe('rolled-back')
    expect(await snapshotWorkspace(workspace)).toEqual(empty)

    // 2. A successful import stores the exact bytes.
    const plan = await planArisImportedPackage({
      adapter: workspace,
      source: await importedSource(original),
      analysis: SAMPLE_ANALYSIS,
      accounting: sampleAccounting(digest),
      models: SAMPLE_MODELS
    })
    expect(
      (await commitArisSourcePackage({
        adapter: workspace,
        plan,
        reviewedDigest: plan.reviewDigest
      })).status
    ).toBe('committed')

    const store = new ArisPackageStore(workspace)
    const imported = await store.readOriginalSource(digest)
    expect(Array.from(imported.bytes)).toEqual(Array.from(original))
    expect(imported.hash).toBe(digest)

    // 3. Saving, editing and deleting a model never rewrite the original.
    await store.saveRevision(digest, [{ type: 'aris.object.rename', payload: { id: 'ObjOcc.1' } }])
    await store.saveRevision(digest, [{ type: 'aris.object.move', payload: { x: 4, y: 8 } }])
    await store.deleteModel(digest, 'Model.1')
    const afterEdits = await store.readOriginalSource(digest)
    expect(Array.from(afterEdits.bytes)).toEqual(Array.from(original))
    expect(afterEdits.hash).toBe(digest)

    // 4. Export materializes a derived document outside the package.
    const derived = new TextEncoder().encode(
      new TextDecoder().decode(imported.bytes).replace('Intake', 'Triage')
    )
    const exported = await workspace.writeAtomic('exports/derived.xml', derived)
    expect(exported.ok).toBe(true)
    const afterExport = await store.readOriginalSource(digest)
    expect(afterExport.hash).toBe(digest)
    expect(await sha256Hex(afterExport.bytes)).toBe(digest)

    // 5. Backup and restore preserve every member byte-for-byte.
    const before = await collectArisPackageArchive(workspace, digest)
    const blob = await workspace.exportBackup({ generatedAt: new Date(0) })
    const restored = createWorkspace('exit-gate-restored')
    const importPlan = await inspectWorkspaceBackup(restored, blob)
    expect(
      (
        await applyWorkspaceBackupImport(restored, importPlan, {
          reviewedDigest: importPlan.reviewDigest
        })
      ).status
    ).toBe('committed')
    const after = await collectArisPackageArchive(restored, digest)
    expect((await compareArisPackageArchives(before, after)).differences).toEqual([])

    const restoredStore = new ArisPackageStore(restored)
    const restoredOriginal = await restoredStore.readOriginalSource(digest)
    expect(Array.from(restoredOriginal.bytes)).toEqual(Array.from(original))
    expect(restoredOriginal.hash).toBe(digest)
    expect(await sha256Hex(restoredOriginal.bytes)).toBe(digest)
    expect((await restoredStore.verifyIntegrity(digest)).problems).toEqual([])
    expect((await restoredStore.replayRevisions(digest)).commands).toHaveLength(3)

    // 6. Re-importing the identical source deduplicates and changes nothing.
    const stateBefore = await snapshotWorkspace(workspace)
    const duplicate = await planArisImportedPackage({
      adapter: workspace,
      source: await importedSource(original),
      analysis: SAMPLE_ANALYSIS,
      accounting: sampleAccounting(digest),
      models: SAMPLE_MODELS
    })
    expect(duplicate.status).toBe('duplicate')
    const dedup = await commitArisSourcePackage({
      adapter: workspace,
      plan: duplicate,
      reviewedDigest: duplicate.reviewDigest
    })
    expect(dedup.status).toBe('deduplicated')
    expect(await snapshotWorkspace(workspace)).toEqual(stateBefore)
    expect(await store.listPackages()).toEqual([digest])
  })

  it('keeps generated provenance through backup and restore', async () => {
    const workspace = createWorkspace('exit-gate-generated')
    const aml = '<?xml version="1.0" encoding="UTF-8"?>\n<AML><Group Group.ID="G1"/></AML>\n'
    const brief = new TextEncoder().encode('Intake, triage, discharge.')
    const digest = await sha256Hex(brief)
    const plan = await planArisGeneratedPackage({
      adapter: workspace,
      originKind: 'description',
      baselineAml: { text: aml, name: 'generated.xml' },
      generationSource: { bytes: brief, name: 'brief.md', mediaType: 'text/markdown' },
      generation: {
        provider: 'anthropic',
        model: 'claude-opus-5',
        requestSha256: 'd'.repeat(64)
      },
      accounting: createArisAccountingDocument({ sourceSha256: digest })
    })
    expect(
      (await commitArisSourcePackage({
        adapter: workspace,
        plan,
        reviewedDigest: plan.reviewDigest
      })).status
    ).toBe('committed')

    const blob = await workspace.exportBackup({ generatedAt: new Date(0) })
    const restored = createWorkspace('exit-gate-generated-restored')
    const importPlan = await inspectWorkspaceBackup(restored, blob)
    await applyWorkspaceBackupImport(restored, importPlan, {
      reviewedDigest: importPlan.reviewDigest
    })

    const store = new ArisPackageStore(restored)
    const manifest = await store.readManifest(digest)
    expect(manifest.origin).toEqual({
      kind: 'description',
      generation: {
        provider: 'anthropic',
        model: 'claude-opus-5',
        requestSha256: 'd'.repeat(64),
        retainedSourcePath: 'original/brief.md'
      }
    })
    const retained = await store.readMember(
      `${arisPackagePaths(digest).originalDirectory}/brief.md`
    )
    expect(retained.hash).toBe(digest)
    expect((await store.verifyIntegrity(digest)).problems).toEqual([])
    expect(await store.scanForSecrets(digest)).toEqual([])
  })
})
