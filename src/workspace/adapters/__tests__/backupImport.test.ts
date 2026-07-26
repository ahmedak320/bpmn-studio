import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  MemoryWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH,
  applyWorkspaceBackupImport as applyWorkspaceBackupImportCore,
  inspectWorkspaceBackup as inspectWorkspaceBackupCore,
  preflightWorkspaceBackupZip,
  sha256Hex,
  type BackupExportOptions,
  type FileSnapshot,
  type SaveOutcome,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WorkspaceStorageInfo,
  type WriteAtomicOptions
} from '..'
import type { ReviewedBpmnIngestionPort } from '../../reviewedBpmn'
import { validMultiProcessXml } from '../../../validation/__tests__/fixtures'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

const fakeProcessIdentityInspector = async (xml: string) => ({
  processIds: [...xml.matchAll(/<(?:\w+:)?process\s+id="([^"]+)"/g)].map(
    (match) => match[1]
  )
})

const fakeReviewedBpmnIngestion: ReviewedBpmnIngestionPort = async (xml) => {
  const digest = await sha256Hex(text(xml))
  const reviewDigest = `review-${digest}`
  return {
    xml,
    digest,
    reviewDigest,
    validation: {} as never,
    evidence: { originalDigest: digest, outputDigest: digest, reviewDigest } as never
  }
}

async function inspectWorkspaceBackup(
  ...args: Parameters<typeof inspectWorkspaceBackupCore>
) {
  const [adapter, backup, options = {}] = args
  return inspectWorkspaceBackupCore(adapter, backup, {
    ...options,
    processIdentityInspector: fakeProcessIdentityInspector,
    reviewedBpmnIngestion: fakeReviewedBpmnIngestion
  })
}

async function applyWorkspaceBackupImport(
  adapter: Parameters<typeof applyWorkspaceBackupImportCore>[0],
  plan: Parameters<typeof applyWorkspaceBackupImportCore>[1],
  options: Parameters<typeof applyWorkspaceBackupImportCore>[2] = {}
) {
  return applyWorkspaceBackupImportCore(adapter, plan, {
    reviewedDigest: plan.reviewDigest,
    processIdentityInspector: fakeProcessIdentityInspector,
    ...options
  })
}

async function backupFrom(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const source = new MemoryWorkspaceAdapter({
    id: 'backup:source',
    folders: ['empty'],
    files
  })
  return source.exportBackup({
    generatedAt: new Date('2026-07-26T00:00:00.000Z')
  })
}

class DelegatingAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode
  readonly storage: WorkspaceStorageInfo
  writes = 0

  constructor(
    readonly target: MemoryWorkspaceAdapter,
    readonly failPath?: string,
    readonly mutateBeforeFailure?: string
  ) {
    this.id = target.id
    this.mode = target.mode
    this.storage = target.storage
  }

  list(path?: string): Promise<WorkspaceEntry[]> {
    return this.target.list(path)
  }

  read(path: string): Promise<FileSnapshot> {
    return this.target.read(path)
  }

  async writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome> {
    this.writes += 1
    if (path === this.failPath) {
      if (this.mutateBeforeFailure) {
        this.target.replaceExternally(this.mutateBeforeFailure, 'changed during rollback')
      }
      return {
        ok: false,
        status: 'storage-failure',
        error: {
          code: 'quota-exceeded',
          operation: 'write',
          path,
          message: 'Injected quota failure'
        }
      }
    }
    return this.target.writeAtomic(path, bytes, expectedHash, options)
  }

  rename(from: string, to: string): Promise<void> {
    return this.target.rename(from, to)
  }

  move(from: string, to: string): Promise<void> {
    return this.target.move(from, to)
  }

  remove(path: string): Promise<void> {
    return this.target.remove(path)
  }

  createFolder(path: string): Promise<void> {
    return this.target.createFolder(path)
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.target.exportBackup(options)
  }
}

describe('bounded workspace backup inspection', () => {
  it('verifies manifest paths, byte sizes, checksums, and reports collisions', async () => {
    const blob = await backupFrom({
      'a.bpmn': '<incoming />',
      '.orbitpm/manifest.json': '{"workspaceVersion":1}'
    })
    const target = new MemoryWorkspaceAdapter({
      id: 'backup:target',
      files: { 'a.bpmn': '<existing />' }
    })

    const plan = await inspectWorkspaceBackup(target, blob)
    expect(plan.compressedBytes).toBe(blob.size)
    expect(plan.declaredUncompressedBytes).toBeGreaterThan(0)
    expect(plan.directories).toEqual(expect.arrayContaining(['.orbitpm', 'empty']))
    expect(plan.files.map((file) => file.path)).toEqual(['.orbitpm/manifest.json', 'a.bpmn'])
    expect(plan.collisions).toHaveLength(1)
    expect(plan.collisions[0]).toMatchObject({
      path: 'a.bpmn',
      identical: false
    })
    expect(decode(plan.collisions[0].existing.bytes)).toBe('<existing />')
  })

  it('rejects checksum tampering and unmanifested traversal before applying', async () => {
    const blob = await backupFrom({ 'a.bpmn': '<safe />' })
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    archive['workspace/a.bpmn'] = text('<tampered />')
    const tampered = new Blob([zipSync(archive)])

    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), tampered)
    ).rejects.toMatchObject({ code: 'integrity-failure' })

    archive['workspace/../escape.bpmn'] = text('escape')
    const traversal = zipSync(archive)
    expect(() => preflightWorkspaceBackupZip(traversal)).toThrow(/traversal/)
  })

  it('enforces compressed, entry-count, expanded-size, ratio, and cancellation limits', async () => {
    const blob = await backupFrom({ 'a.bpmn': '<safe />' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(() =>
      preflightWorkspaceBackupZip(bytes, { maxCompressedBytes: bytes.byteLength - 1 })
    ).toThrow(/compressed-size/)
    expect(() => preflightWorkspaceBackupZip(bytes, { maxEntries: 1 })).toThrow(/too many entries/)
    expect(() => preflightWorkspaceBackupZip(bytes, { maxDeclaredUncompressedBytes: 1 })).toThrow(
      /uncompressed-size/
    )

    const manifest = strToU8(
      JSON.stringify({
        format: 'orbitpm-workspace-backup',
        version: 1,
        generatedAt: new Date(0).toISOString(),
        workspace: { id: 'x', mode: 'opfs' },
        checksumAlgorithm: 'SHA-256',
        directories: [],
        files: []
      })
    )
    const ratioBomb = zipSync({
      [WORKSPACE_BACKUP_MANIFEST_PATH]: manifest,
      'workspace/bomb.bin': new Uint8Array(20_000)
    })
    expect(() => preflightWorkspaceBackupZip(ratioBomb, { maxCompressionRatio: 2 })).toThrow(
      /compression ratio/
    )

    const controller = new AbortController()
    controller.abort()
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), blob, {
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects malformed or unsupported manifests', async () => {
    const blob = await backupFrom({ 'a.bpmn': '<safe />' })
    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    archive[WORKSPACE_BACKUP_MANIFEST_PATH] = strToU8('{"format":"wrong"}')
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), new Blob([zipSync(archive)]))
    ).rejects.toThrow(/incomplete or unsupported/)

    const manifest = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))[WORKSPACE_BACKUP_MANIFEST_PATH])
    ) as { files: Array<{ path: string; archivePath: string }> }
    manifest.files[0].archivePath = 'workspace/not-the-file.bpmn'
    archive[WORKSPACE_BACKUP_MANIFEST_PATH] = strToU8(JSON.stringify(manifest))
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), new Blob([zipSync(archive)]))
    ).rejects.toThrow(/inconsistent/)
  })

  it('runs the production reviewed-localization boundary for every BPMN before planning', async () => {
    const beforeWrite = vi.fn()
    const target = new MemoryWorkspaceAdapter({ beforeWrite })
    const valid = await backupFrom({ 'valid.bpmn': validMultiProcessXml() })
    const plan = await inspectWorkspaceBackupCore(target, valid, {
      validationAdapters: [],
      targetLanguage: 'en'
    })
    expect(plan.files[0].reviewedBpmn).toMatchObject({
      outputDigest: plan.files[0].sha256,
      processIds: ['Process_1', 'Process_2']
    })
    expect(plan.files[0].reviewedBpmn?.evidence.originalDigest).toBe(
      plan.files[0].archiveSha256
    )

    const incomplete = await backupFrom({
      'incomplete.bpmn': validMultiProcessXml().replace(' orbitpm:nameAr="بداية"', '')
    })
    await expect(
      inspectWorkspaceBackupCore(target, incomplete, {
        validationAdapters: [],
        targetLanguage: 'en'
      })
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('reviews BPMN descendants inside the portable metadata namespace too', async () => {
    const review = vi.fn(fakeReviewedBpmnIngestion)
    const blob = await backupFrom({
      'active.bpmn': '<definitions><process id="Active"/></definitions>',
      '.orbitpm/history/old.bpmn': '<definitions><process id="Historical"/></definitions>'
    })
    const plan = await inspectWorkspaceBackupCore(new MemoryWorkspaceAdapter(), blob, {
      processIdentityInspector: fakeProcessIdentityInspector,
      reviewedBpmnIngestion: review
    })

    expect(review).toHaveBeenCalledTimes(2)
    expect(
      plan.files
        .filter((file) => /\.bpmn$/i.test(file.path))
        .every((file) => Boolean(file.reviewedBpmn))
    ).toBe(true)
  })
})

describe('transactional workspace backup import', () => {
  it('requires review, then replaces/skips/keeps-both according to decisions', async () => {
    const blob = await backupFrom({
      'replace.bpmn': 'incoming replace',
      'skip.bpmn': 'incoming skip',
      'copy.bpmn': 'incoming copy',
      'new.bpmn': 'incoming new'
    })
    const target = new MemoryWorkspaceAdapter({
      id: 'backup:review',
      files: {
        'replace.bpmn': 'existing replace',
        'skip.bpmn': 'existing skip',
        'copy.bpmn': 'existing copy',
        'copy-restored.bpmn': 'occupied copy name'
      }
    })
    const plan = await inspectWorkspaceBackup(target, blob)
    expect(await applyWorkspaceBackupImport(target, plan)).toMatchObject({
      status: 'needs-review',
      unresolvedCollisions: expect.any(Array)
    })

    const beforeOverwrite = vi.fn(async () => undefined)
    const result = await applyWorkspaceBackupImport(target, plan, {
      decisions: {
        'replace.bpmn': { action: 'replace' },
        'skip.bpmn': { action: 'skip' },
        'copy.bpmn': { action: 'keep-both' }
      },
      beforeOverwrite
    })
    expect(result).toMatchObject({ status: 'committed' })
    expect(beforeOverwrite).toHaveBeenCalledOnce()
    expect(decode((await target.read('replace.bpmn')).bytes)).toBe('incoming replace')
    expect(decode((await target.read('skip.bpmn')).bytes)).toBe('existing skip')
    expect(decode((await target.read('copy-restored-2.bpmn')).bytes)).toBe('incoming copy')
    expect(decode((await target.read('new.bpmn')).bytes)).toBe('incoming new')
  })

  it('automatically skips byte-identical collisions', async () => {
    const blob = await backupFrom({ 'same.bpmn': 'same' })
    const target = new MemoryWorkspaceAdapter({
      files: { 'same.bpmn': 'same' }
    })
    const plan = await inspectWorkspaceBackup(target, blob)
    expect(plan.collisions[0].identical).toBe(true)
    expect(await applyWorkspaceBackupImport(target, plan)).toEqual({
      status: 'committed',
      applied: [],
      skipped: ['same.bpmn']
    })
  })

  it('rolls back creations and replacements after a later write fails', async () => {
    const blob = await backupFrom({
      'a-created.bpmn': 'created',
      'b-replaced.bpmn': 'replacement',
      'z-fail.bpmn': 'failure'
    })
    const memory = new MemoryWorkspaceAdapter({
      id: 'backup:rollback',
      files: { 'b-replaced.bpmn': 'original' }
    })
    const failing = new DelegatingAdapter(memory, 'z-fail.bpmn')
    const plan = await inspectWorkspaceBackup(failing, blob)
    const result = await applyWorkspaceBackupImport(failing, plan, {
      decisions: {
        'b-replaced.bpmn': { action: 'replace' }
      }
    })

    expect(result).toMatchObject({
      status: 'rolled-back',
      rollbackErrors: []
    })
    await expect(memory.read('a-created.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    expect(decode((await memory.read('b-replaced.bpmn')).bytes)).toBe('original')
    await expect(memory.read('z-fail.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
  })

  it('reports rollback failure instead of overwriting a newer external edit', async () => {
    const blob = await backupFrom({
      'a-replaced.bpmn': 'replacement',
      'z-fail.bpmn': 'failure'
    })
    const memory = new MemoryWorkspaceAdapter({
      id: 'backup:rollback-conflict',
      files: { 'a-replaced.bpmn': 'original' }
    })
    const failing = new DelegatingAdapter(memory, 'z-fail.bpmn', 'a-replaced.bpmn')
    const plan = await inspectWorkspaceBackup(failing, blob)
    const result = await applyWorkspaceBackupImport(failing, plan, {
      decisions: {
        'a-replaced.bpmn': { action: 'replace' }
      }
    })

    expect(result).toMatchObject({
      status: 'rollback-failed',
      rollbackErrors: [expect.objectContaining({ code: 'integrity-failure' })]
    })
    expect(decode((await memory.read('a-replaced.bpmn')).bytes)).toBe('changed during rollback')
  })

  it('requires the exact plan digest and rejects post-review byte tampering before writes', async () => {
    const beforeWrite = vi.fn()
    const target = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await inspectWorkspaceBackup(target, await backupFrom({ 'new.txt': 'safe' }))

    await expect(applyWorkspaceBackupImportCore(target, plan)).rejects.toMatchObject({
      code: 'integrity-failure'
    })
    plan.files[0].bytes[0] ^= 0xff
    await expect(
      applyWorkspaceBackupImportCore(target, plan, {
        reviewedDigest: plan.reviewDigest,
        processIdentityInspector: fakeProcessIdentityInspector
      })
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    expect(beforeWrite).not.toHaveBeenCalled()
    await expect(target.read('new.txt')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects reserved custom keep-both destinations before writes', async () => {
    const beforeWrite = vi.fn()
    const target = new MemoryWorkspaceAdapter({
      files: { 'copy.bpmn': 'existing' },
      beforeWrite
    })
    const plan = await inspectWorkspaceBackup(
      target,
      await backupFrom({ 'copy.bpmn': '<definitions><process id="Copy"/></definitions>' })
    )

    await expect(
      applyWorkspaceBackupImportCore(target, plan, {
        reviewedDigest: plan.reviewDigest,
        processIdentityInspector: fakeProcessIdentityInspector,
        decisions: {
          'copy.bpmn': {
            action: 'keep-both',
            destinationPath: '.ORBITPM/restored.bpmn'
          }
        }
      })
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    expect(beforeWrite).not.toHaveBeenCalled()
    expect(decode((await target.read('copy.bpmn')).bytes)).toBe('existing')
  })

  it('enforces multipleFiles during inspection and again during apply', async () => {
    const beforeWrite = vi.fn()
    const single = new MemoryWorkspaceAdapter({ beforeWrite })
    single.storage.capabilities.multipleFiles = false
    await expect(
      inspectWorkspaceBackup(single, await backupFrom({ 'one.txt': '1', 'two.txt': '2' }))
    ).rejects.toMatchObject({ code: 'integrity-failure' })

    const changing = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await inspectWorkspaceBackup(
      changing,
      await backupFrom({ 'only.txt': 'one' })
    )
    changing.storage.capabilities.multipleFiles = false
    await expect(
      applyWorkspaceBackupImportCore(changing, plan, {
        reviewedDigest: plan.reviewDigest,
        processIdentityInspector: fakeProcessIdentityInspector
      })
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    expect(beforeWrite).not.toHaveBeenCalled()
  })

  it('rechecks unrelated process identities before creating folders or files', async () => {
    const beforeWrite = vi.fn()
    const target = new MemoryWorkspaceAdapter({ beforeWrite })
    const plan = await inspectWorkspaceBackup(
      target,
      await backupFrom({
        'incoming.bpmn': '<definitions><process id="Incoming"/></definitions>'
      })
    )

    target.replaceExternally(
      'unrelated.bpmn',
      '<definitions><process id="Unrelated"/></definitions>'
    )
    await expect(
      applyWorkspaceBackupImportCore(target, plan, {
        reviewedDigest: plan.reviewDigest,
        processIdentityInspector: fakeProcessIdentityInspector
      })
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    await expect(target.read('incoming.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    expect(beforeWrite).not.toHaveBeenCalled()
  })
})
