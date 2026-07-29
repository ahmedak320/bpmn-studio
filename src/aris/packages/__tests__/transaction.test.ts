import { describe, expect, it } from 'vitest'
import { SingleFileWorkspaceAdapter } from '../../../workspace/adapters/singleFile'
import { sha256Hex } from '../../../workspace/adapters/hash'
import { arisPackagePaths } from '../layout'
import { ArisPackageError, ArisPackageStore } from '../store'
import { classifyArisWorkspace } from '../portable'
import {
  ArisTransactionError,
  commitArisSourcePackage,
  planArisImportedPackage,
  type ArisSourcePackagePlan
} from '../transaction'
import {
  FaultInjectingWorkspaceAdapter,
  ReadOnlyAssertingWorkspaceAdapter,
  SAMPLE_ANALYSIS,
  SAMPLE_MODELS,
  amlBytes,
  createWorkspace,
  importedSource,
  sampleAccounting,
  snapshotWorkspace
} from './harness'
import type { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import type { WorkspaceAdapter } from '../../../workspace/adapters/types'

const ATTACHMENT_BYTES = new TextEncoder().encode('%PDF-1.4 attachment')
const REFERENCE_BYTES = new TextEncoder().encode('reference asset')

async function plan(adapter: WorkspaceAdapter): Promise<ArisSourcePackagePlan> {
  const source = await importedSource()
  return planArisImportedPackage({
    adapter,
    source,
    analysis: SAMPLE_ANALYSIS,
    accounting: sampleAccounting(source.sha256),
    models: SAMPLE_MODELS,
    attachments: [
      {
        attachmentId: 'Att.1',
        sourceId: '../../escape',
        name: '../../../etc/passwd',
        mediaType: 'application/pdf',
        bytes: ATTACHMENT_BYTES
      }
    ],
    references: [{ name: 'symbols.png', mediaType: 'image/png', bytes: REFERENCE_BYTES }],
    fidelityIssues: [{ code: 'unknown-symbol', count: 1 }]
  })
}

async function importOnce(
  adapter: WorkspaceAdapter
): Promise<Awaited<ReturnType<typeof commitArisSourcePackage>>> {
  const prepared = await plan(adapter)
  return commitArisSourcePackage({
    adapter,
    plan: prepared,
    reviewedDigest: prepared.reviewDigest
  })
}

describe('imported-source transaction (plan §7.3)', () => {
  it('verifies the declared digest against the exact imported bytes (steps 1-2)', async () => {
    const adapter = createWorkspace()
    const source = await importedSource()
    await expect(
      planArisImportedPackage({
        adapter,
        source: { ...source, sha256: '0'.repeat(64) },
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting(source.sha256)
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'digest-mismatch' }))
  })

  it('refuses to stage a source that was never parsed and indexed (steps 3-4)', async () => {
    const adapter = createWorkspace()
    const source = await importedSource()
    await expect(
      planArisImportedPackage({
        adapter,
        source,
        analysis: { index: null },
        accounting: sampleAccounting(source.sha256)
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'analysis-required' }))
    await expect(
      planArisImportedPackage({
        adapter,
        source: { ...source, encoding: '' },
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting(source.sha256)
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'analysis-required' }))
  })

  it('binds the accounting document to the source digest (step 5)', async () => {
    const adapter = createWorkspace()
    const source = await importedSource()
    await expect(
      planArisImportedPackage({
        adapter,
        source,
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting('9'.repeat(64))
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'digest-mismatch' }))
  })

  it('sanitizes attachment metadata into safe package paths (step 6)', async () => {
    const adapter = createWorkspace()
    const prepared = await plan(adapter)
    const attachment = prepared.manifest.attachments[0]
    expect(attachment?.path).toBe('attachments/escape/passwd')
    expect(attachment?.sha256).toBe(await sha256Hex(ATTACHMENT_BYTES))
    expect(prepared.manifest.references[0]?.path).toBe('references/symbols.png')
  })

  it('stages every write in memory without touching the workspace (steps 7-8)', async () => {
    const inner = createWorkspace()
    const adapter = new ReadOnlyAssertingWorkspaceAdapter(inner)
    const before = await snapshotWorkspace(inner)
    const prepared = await plan(adapter)

    expect(adapter.mutations).toEqual([])
    expect(await snapshotWorkspace(inner)).toEqual(before)
    expect(prepared.status).toBe('ready')
    expect(prepared.review.counts.writes).toBe(prepared.writes.length)
    expect(prepared.review.writes.map((write) => write.role)).toEqual([
      'original',
      'attachment',
      'reference',
      'accounting',
      'revision',
      'current-revision',
      'manifest'
    ])
    expect(prepared.review.counts.models).toBe(1)
    expect(prepared.review.fidelity.issues).toEqual([{ code: 'unknown-symbol', count: 1 }])
    expect(prepared.reviewDigest).toMatch(/^[0-9a-f]{64}$/u)
    // The review payload describes writes; it never carries their bytes.
    const reviewJson = JSON.stringify(prepared.review)
    expect(reviewJson).not.toContain('ObjOcc')
    expect(reviewJson).not.toContain('"bytes"')
    expect(prepared.review.writes.every((write) => !('bytes' in write))).toBe(true)
  })

  it('requires the committer to echo the reviewed digest (step 8)', async () => {
    const adapter = createWorkspace()
    const prepared = await plan(adapter)
    await expect(
      commitArisSourcePackage({ adapter, plan: prepared, reviewedDigest: 'a'.repeat(64) })
    ).rejects.toThrow(expect.objectContaining({ code: 'review-mismatch' }))
    expect(await snapshotWorkspace(adapter)).toEqual({ directories: [], files: {} })
  })

  it('detects a plan mutated after review', async () => {
    const adapter = createWorkspace()
    const prepared = await plan(adapter)
    const tampered = {
      ...prepared,
      writes: prepared.writes.slice(0, 1)
    } as ArisSourcePackagePlan
    await expect(
      commitArisSourcePackage({ adapter, plan: tampered, reviewedDigest: prepared.reviewDigest })
    ).rejects.toThrow(expect.objectContaining({ code: 'plan-tampered' }))
  })

  it('rejects a plan reviewed against a different workspace', async () => {
    const prepared = await plan(createWorkspace('workspace-a'))
    await expect(
      commitArisSourcePackage({
        adapter: createWorkspace('workspace-b'),
        plan: prepared,
        reviewedDigest: prepared.reviewDigest
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'workspace-changed' }))
  })

  it('commits every member atomically and writes the manifest last (step 9)', async () => {
    const adapter = createWorkspace()
    const source = await importedSource()
    const outcome = await importOnce(adapter)
    expect(outcome.status).toBe('committed')
    if (outcome.status !== 'committed') return

    const paths = arisPackagePaths(source.sha256)
    expect(outcome.writtenPaths[outcome.writtenPaths.length - 1]).toBe(paths.manifest)
    expect(outcome.writtenPaths).toEqual([
      paths.originalSource,
      `${paths.root}/attachments/escape/passwd`,
      `${paths.root}/references/symbols.png`,
      paths.accounting,
      `${paths.revisionsDirectory}/${outcome.manifest.currentRevisionId}.patch.json`,
      paths.currentRevision,
      paths.manifest
    ])

    const store = new ArisPackageStore(adapter)
    const original = await store.readOriginalSource(source.sha256)
    expect(Array.from(original.bytes)).toEqual(Array.from(amlBytes()))
    const report = await store.verifyIntegrity(source.sha256)
    expect(report.problems).toEqual([])
    expect(report.originalSha256).toBe(source.sha256)
  })

  it('rolls back completely when any write fails, at every write index (step 10)', async () => {
    const reference = createWorkspace()
    const referencePlan = await plan(reference)
    const writeCount = referencePlan.writes.length
    expect(writeCount).toBeGreaterThan(1)

    for (let index = 1; index <= writeCount; index += 1) {
      const inner = createWorkspace()
      const before = await snapshotWorkspace(inner)
      const adapter = new FaultInjectingWorkspaceAdapter(inner, {
        operation: 'write',
        atCall: index,
        message: `boom at write ${index}`
      })
      const prepared = await plan(adapter)
      const outcome = await commitArisSourcePackage({
        adapter,
        plan: prepared,
        reviewedDigest: prepared.reviewDigest
      })

      expect(outcome.status, `write ${index}`).toBe('rolled-back')
      if (outcome.status === 'rolled-back' || outcome.status === 'rollback-failed') {
        expect(outcome.rollbackErrors).toEqual([])
        expect(outcome.error.message).toContain(`boom at write ${index}`)
      }
      expect(await snapshotWorkspace(inner), `workspace after write ${index}`).toEqual(before)
    }
  })

  it('rolls back completely when directory creation fails', async () => {
    const reference = createWorkspace()
    const referencePlan = await plan(reference)

    for (let index = 1; index <= referencePlan.directories.length; index += 1) {
      const inner = createWorkspace()
      const before = await snapshotWorkspace(inner)
      const adapter = new FaultInjectingWorkspaceAdapter(inner, {
        operation: 'createFolderIfMissing',
        atCall: index
      })
      const prepared = await plan(adapter)
      const outcome = await commitArisSourcePackage({
        adapter,
        plan: prepared,
        reviewedDigest: prepared.reviewDigest
      })
      expect(outcome.status, `directory ${index}`).toBe('rolled-back')
      expect(await snapshotWorkspace(inner), `workspace after directory ${index}`).toEqual(before)
    }
  })

  it('reports a failed rollback instead of claiming success', async () => {
    const inner = createWorkspace()
    const adapter = new FaultInjectingWorkspaceAdapter(inner, {
      operation: 'removeIfHash',
      atCall: 1,
      sticky: true,
      message: 'cannot delete'
    })
    const prepared = await plan(adapter)
    // Fail the very last write so rollback has files to remove.
    const failing = new FaultInjectingWorkspaceAdapter(adapter, {
      operation: 'write',
      atCall: prepared.writes.length
    })
    const preparedAgain = await plan(failing)
    const outcome = await commitArisSourcePackage({
      adapter: failing,
      plan: preparedAgain,
      reviewedDigest: preparedAgain.reviewDigest
    })
    expect(outcome.status).toBe('rollback-failed')
    if (outcome.status === 'rollback-failed') {
      expect(outcome.rollbackErrors.length).toBeGreaterThan(0)
    }
  })

  it('rolls back completely when the post-write integrity verification fails', async () => {
    // Every write can individually succeed and the commit can still be forced
    // to roll back by the final readback check in `commitArisSourcePackage`
    // (the `verify` callback passed to `writeArisPackageMembersAtomically`).
    // This targets that one read call by path rather than by position, so it
    // stays precise regardless of how many other reads (the dedup pre-check,
    // for instance) happen first.
    const inner = createWorkspace()
    const before = await snapshotWorkspace(inner)
    const source = await importedSource()
    const originalSourcePath = arisPackagePaths(source.sha256).originalSource
    const adapter = new FaultInjectingWorkspaceAdapter(inner, {
      operation: 'read',
      path: originalSourcePath,
      atCall: 1,
      message: 'injected verification read failure'
    })
    const prepared = await plan(adapter)
    const outcome = await commitArisSourcePackage({
      adapter,
      plan: prepared,
      reviewedDigest: prepared.reviewDigest
    })
    expect(outcome.status).toBe('rolled-back')
    if (outcome.status === 'rolled-back' || outcome.status === 'rollback-failed') {
      expect(outcome.rollbackErrors).toEqual([])
      expect(outcome.error.message).toContain('injected verification read failure')
    }
    expect(await snapshotWorkspace(inner)).toEqual(before)
  })

  it('deduplicates an identical source digest without mutating the package (step 11)', async () => {
    const adapter = createWorkspace()
    const source = await importedSource()
    const first = await importOnce(adapter)
    expect(first.status).toBe('committed')
    const afterFirst = await snapshotWorkspace(adapter)

    const secondPlan = await plan(adapter)
    expect(secondPlan.status).toBe('duplicate')
    expect(secondPlan.writes).toEqual([])
    expect(secondPlan.review.duplicate).toBe(true)
    expect(secondPlan.existingManifest?.source.sha256).toBe(source.sha256)

    const second = await commitArisSourcePackage({
      adapter,
      plan: secondPlan,
      reviewedDigest: secondPlan.reviewDigest
    })
    expect(second.status).toBe('deduplicated')
    expect(await snapshotWorkspace(adapter)).toEqual(afterFirst)

    const digests = await new ArisPackageStore(adapter).listPackages()
    expect(digests).toEqual([source.sha256])
  })

  it('deduplicates even when a stale ready plan is committed twice', async () => {
    const adapter = createWorkspace()
    const prepared = await plan(adapter)
    const first = await commitArisSourcePackage({
      adapter,
      plan: prepared,
      reviewedDigest: prepared.reviewDigest
    })
    expect(first.status).toBe('committed')
    const afterFirst = await snapshotWorkspace(adapter)

    const replay = await commitArisSourcePackage({
      adapter,
      plan: prepared,
      reviewedDigest: prepared.reviewDigest
    })
    expect(replay.status).toBe('deduplicated')
    expect(await snapshotWorkspace(adapter)).toEqual(afterFirst)
  })

  it('refuses the directory shape on a single-file workspace and points at the portable path', async () => {
    const singleFile = new SingleFileWorkspaceAdapter({
      path: 'model.xml',
      bytes: amlBytes(),
      download: () => undefined
    })
    const source = await importedSource()
    // A single-file workspace cannot host the directory tree, so planning
    // directly against it must fail closed rather than write partial members.
    // Support for that workspace lives in `openArisWorkspace` (portable.ts).
    await expect(
      planArisImportedPackage({
        adapter: singleFile,
        source,
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting(source.sha256)
      })
    ).rejects.toThrow(ArisPackageError)
    await expect(
      planArisImportedPackage({
        adapter: singleFile,
        source,
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting(source.sha256)
      })
    ).rejects.toThrow(/openArisWorkspace/u)
    expect(classifyArisWorkspace(singleFile)).toBe('portable-single-file')
  })

  it('enforces staged limits before writing anything', async () => {
    const adapter: MemoryWorkspaceAdapter = createWorkspace()
    const source = await importedSource()
    await expect(
      planArisImportedPackage({
        adapter,
        source,
        analysis: SAMPLE_ANALYSIS,
        accounting: sampleAccounting(source.sha256),
        limits: { maxSourceBytes: 8 }
      })
    ).rejects.toThrow(ArisTransactionError)
    expect(await snapshotWorkspace(adapter)).toEqual({ directories: [], files: {} })
  })
})
