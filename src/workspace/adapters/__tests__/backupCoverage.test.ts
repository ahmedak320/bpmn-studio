import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  MemoryWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH,
  WorkspaceOperationError,
  applyWorkspaceBackupImport as applyWorkspaceBackupImportCore,
  inspectWorkspaceBackup as inspectWorkspaceBackupCore,
  preflightWorkspaceBackupZip,
  sealWorkspaceBackupImportPlan,
  sha256Hex,
  type SaveOutcome,
  type WorkspaceBackupImportPlan
} from '..'
import type { ReviewedBpmnIngestionPort } from '../../reviewedBpmn'

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const fakeProcessIdentityInspector = async (xml: string) => ({
  processIds: [...xml.matchAll(/<(?:\w+:)?process\s+id="([^"]+)"/g)].map((match) => match[1])
})

const fakeReviewedBpmnIngestion: ReviewedBpmnIngestionPort = async (xml) => {
  const digest = await sha256Hex(encode(xml))
  const reviewDigest = `review-${digest}`
  return {
    xml,
    digest,
    reviewDigest,
    validation: {} as never,
    evidence: { originalDigest: digest, outputDigest: digest, reviewDigest } as never
  }
}

async function inspectWorkspaceBackup(...args: Parameters<typeof inspectWorkspaceBackupCore>) {
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

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'orbitpm-workspace-backup',
    version: 1,
    generatedAt: '2026-07-26T00:00:00.000Z',
    workspace: { id: 'source', mode: 'opfs' },
    checksumAlgorithm: 'SHA-256',
    directories: [],
    files: [],
    ...overrides
  }
}

function archive(
  value: Record<string, unknown> = manifest(),
  entries: Record<string, Uint8Array> = {},
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 0
): Uint8Array {
  return zipSync(
    {
      [WORKSPACE_BACKUP_MANIFEST_PATH]: strToU8(JSON.stringify(value)),
      ...entries
    },
    { level }
  )
}

function clone(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

function asBlob(bytes: Uint8Array): Blob {
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  return new Blob([owned.buffer])
}

function findSignature(bytes: Uint8Array, signature: number, from = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = from; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`ZIP signature ${signature.toString(16)} was not found.`)
}

function eocdOffset(bytes: Uint8Array): number {
  return findSignature(bytes, 0x06054b50)
}

function centralOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = eocdOffset(bytes)
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const offsets: number[] = []
  for (let index = 0; index < count; index += 1) {
    offsets.push(offset)
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
  }
  return offsets
}

function setU16(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const next = clone(bytes)
  new DataView(next.buffer).setUint16(offset, value, true)
  return next
}

function setU32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const next = clone(bytes)
  new DataView(next.buffer).setUint32(offset, value, true)
  return next
}

async function archiveWithFile(
  path = 'process.bpmn',
  content = '<process />',
  overrides: Record<string, unknown> = {},
  extra: Record<string, Uint8Array> = {}
): Promise<Blob> {
  const bytes = encode(content)
  const item = {
    path,
    archivePath: `workspace/${path}`,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    modifiedAt: 1,
    mimeType: 'application/xml'
  }
  const value = manifest({
    files: [{ ...item, ...overrides }]
  })
  return asBlob(
    archive(value, {
      [`workspace/${path}`]: bytes,
      ...extra
    })
  )
}

describe('backup ZIP central-directory preflight edge cases', () => {
  it('rejects invalid configured limits', () => {
    const bytes = archive()
    expect(() =>
      preflightWorkspaceBackupZip(bytes, { maxEntries: Number.POSITIVE_INFINITY })
    ).toThrow(/must be positive/)
    expect(() => preflightWorkspaceBackupZip(bytes, { maxEntries: 0 })).toThrow(/must be positive/)
  })

  it('rejects truncated archives, missing end records, and malformed comments', () => {
    expect(() => preflightWorkspaceBackupZip(new Uint8Array(12))).toThrow(/truncated/)
    expect(() => preflightWorkspaceBackupZip(new Uint8Array(30))).toThrow(/end record missing/)
    const bytes = archive()
    const withJunk = new Uint8Array(bytes.byteLength + 1)
    withJunk.set(bytes)
    expect(() => preflightWorkspaceBackupZip(withJunk)).toThrow(/malformed end record/)
  })

  it('rejects multi-disk and ZIP64 end records', () => {
    const bytes = archive()
    const eocd = eocdOffset(bytes)
    for (const [fieldOffset, value] of [
      [4, 1],
      [6, 1],
      [8, 0]
    ] as const) {
      expect(() => preflightWorkspaceBackupZip(setU16(bytes, eocd + fieldOffset, value))).toThrow(
        /Multi-disk/
      )
    }
    let zip64Count = setU16(bytes, eocd + 8, 0xffff)
    zip64Count = setU16(zip64Count, eocd + 10, 0xffff)
    expect(() => preflightWorkspaceBackupZip(zip64Count)).toThrow(/ZIP64/)
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, eocd + 12, 0xffffffff))).toThrow(/ZIP64/)
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, eocd + 16, 0xffffffff))).toThrow(/ZIP64/)
  })

  it('rejects inconsistent, truncated, and trailing central directories', () => {
    const bytes = archive()
    const eocd = eocdOffset(bytes)
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, eocd + 12, 1))).toThrow(
      /bounds are inconsistent/
    )

    const central = centralOffsets(bytes)[0]
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, central, 0))).toThrow(
      /central directory is truncated/
    )
    expect(() => preflightWorkspaceBackupZip(setU16(bytes, central + 28, 0xffff))).toThrow(
      /metadata is truncated/
    )

    const twoEntries = archive(manifest(), { 'workspace/extra': encode('x') })
    const twoEocd = eocdOffset(twoEntries)
    let trailing = setU16(twoEntries, twoEocd + 8, 1)
    trailing = setU16(trailing, twoEocd + 10, 1)
    expect(() => preflightWorkspaceBackupZip(trailing)).toThrow(/trailing data/)
  })

  it('rejects encryption, entry disks, codecs, and ZIP64 entries', () => {
    const bytes = archive()
    const central = centralOffsets(bytes)[0]
    expect(() => preflightWorkspaceBackupZip(setU16(bytes, central + 8, 1))).toThrow(/Encrypted/)
    expect(() => preflightWorkspaceBackupZip(setU16(bytes, central + 34, 1))).toThrow(/Multi-disk/)
    expect(() => preflightWorkspaceBackupZip(setU16(bytes, central + 10, 7))).toThrow(/method 7/)
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, central + 20, 0xffffffff))).toThrow(
      /ZIP64 backup entries/
    )
    expect(() => preflightWorkspaceBackupZip(setU32(bytes, central + 24, 0xffffffff))).toThrow(
      /ZIP64 backup entries/
    )
  })

  it('rejects non-UTF-8, undecodable, absolute, NUL, and traversal names', () => {
    const highByte = archive()
    const central = centralOffsets(highByte)[0]
    const nameStart = central + 46
    const nonUtf = clone(highByte)
    nonUtf[nameStart] = 0xff
    new DataView(nonUtf.buffer).setUint16(central + 8, 0, true)
    expect(() => preflightWorkspaceBackupZip(nonUtf)).toThrow(/non-UTF-8/)

    const undecodable = clone(highByte)
    undecodable[nameStart] = 0xff
    new DataView(undecodable.buffer).setUint16(central + 8, 0x800, true)
    expect(() => preflightWorkspaceBackupZip(undecodable)).toThrow(/undecodable/)
    expect(() =>
      preflightWorkspaceBackupZip(zipSync({ '/unsafe-name.json': encode('x') }, { level: 0 }))
    ).toThrow(/unsafe ZIP entry name/)
    expect(() =>
      preflightWorkspaceBackupZip(zipSync({ '\\unsafe-name.json': encode('x') }, { level: 0 }))
    ).toThrow(/unsafe ZIP entry name/)
    expect(() =>
      preflightWorkspaceBackupZip(zipSync({ 'unsafe\u0000name.json': encode('x') }, { level: 0 }))
    ).toThrow(/unsafe ZIP entry name/)
    expect(() =>
      preflightWorkspaceBackupZip(zipSync({ 'safe/./unsafe.json': encode('x') }, { level: 0 }))
    ).toThrow(/traversal/)
  })

  it('rejects duplicate normalized names and all declared size limits', () => {
    expect(() =>
      preflightWorkspaceBackupZip(
        zipSync(
          {
            [WORKSPACE_BACKUP_MANIFEST_PATH]: encode('{}'),
            'workspace/a': encode('x'),
            'workspace\\a': encode('x')
          },
          { level: 0 }
        )
      )
    ).toThrow(/duplicate entry/)

    const large = archive(manifest(), {
      'workspace/large.bin': new Uint8Array(1_000)
    })
    expect(() => preflightWorkspaceBackupZip(large, { maxEntryBytes: 900 })).toThrow(/size limit/)

    const offsets = centralOffsets(archive())
    const zeroCompressed = setU32(archive(), offsets[0] + 20, 0)
    expect(() => preflightWorkspaceBackupZip(zeroCompressed)).toThrow(/compression ratio/)
    expect(() => preflightWorkspaceBackupZip(archive(), { maxManifestBytes: 1 })).toThrow(
      /manifest exceeds/
    )
  })

  it('requires a non-directory manifest', () => {
    expect(() =>
      preflightWorkspaceBackupZip(zipSync({ 'workspace/process.bpmn': encode('x') }, { level: 0 }))
    ).toThrow(/manifest .* missing/)
    expect(() =>
      preflightWorkspaceBackupZip(
        zipSync({ [`${WORKSPACE_BACKUP_MANIFEST_PATH}/`]: new Uint8Array() })
      )
    ).toThrow(/manifest .* missing/)
  })
})

describe('backup manifest verification edge cases', () => {
  it('rejects malformed UTF-8 JSON and each unsupported manifest discriminator', async () => {
    await expect(
      inspectWorkspaceBackup(
        new MemoryWorkspaceAdapter(),
        asBlob(
          zipSync({
            [WORKSPACE_BACKUP_MANIFEST_PATH]: new Uint8Array([0xff])
          })
        )
      )
    ).rejects.toThrow(/not valid UTF-8 JSON/)

    const invalidValues: Array<Record<string, unknown>> = [
      { format: 'other' },
      { version: 2 },
      { checksumAlgorithm: 'MD5' },
      { workspace: { id: 4, mode: 'opfs' } },
      { workspace: { id: 'source', mode: 'memory' } },
      { directories: null },
      { files: null }
    ]
    for (const invalid of invalidValues) {
      await expect(
        inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), asBlob(archive(manifest(invalid))))
      ).rejects.toThrow(/incomplete or unsupported/)
    }
  })

  it('rejects duplicate directories and invalid file records', async () => {
    await expect(
      inspectWorkspaceBackup(
        new MemoryWorkspaceAdapter(),
        asBlob(archive(manifest({ directories: ['same', 'same'] })))
      )
    ).rejects.toThrow(/duplicate directories/)

    await expect(
      inspectWorkspaceBackup(
        new MemoryWorkspaceAdapter(),
        asBlob(archive(manifest({ files: [null] })))
      )
    ).rejects.toThrow(/invalid file record/)
  })

  it('rejects every inconsistent file-field form', async () => {
    const cases: Array<Record<string, unknown>> = [
      { path: 'copy.bpmn' },
      { sha256: 'bad' },
      { size: 1.5 },
      { size: -1 }
    ]
    for (const fields of cases) {
      const blob = await archiveWithFile('process.bpmn', '<process />', fields)
      await expect(
        inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), blob)
      ).rejects.toMatchObject({ code: 'integrity-failure' })
    }

    const content = encode('<process />')
    const duplicateItem = {
      path: 'process.bpmn',
      archivePath: 'workspace/process.bpmn',
      size: content.byteLength,
      sha256: await sha256Hex(content),
      modifiedAt: 1
    }
    await expect(
      inspectWorkspaceBackup(
        new MemoryWorkspaceAdapter(),
        asBlob(
          archive(manifest({ files: [duplicateItem, duplicateItem] }), {
            'workspace/process.bpmn': content
          })
        )
      )
    ).rejects.toThrow(/inconsistent/)
  })

  it('rejects missing, wrong-size, unmanifested, and over-compressed inputs', async () => {
    const missing = await archiveWithFile('process.bpmn', '<process />', {
      archivePath: 'workspace/missing.bpmn'
    })
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), missing)
    ).rejects.toMatchObject({ code: 'integrity-failure' })

    const wrongSize = await archiveWithFile('process.bpmn', '<process />', {
      size: 999
    })
    await expect(inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), wrongSize)).rejects.toThrow(
      /wrong size/
    )

    const unmanifested = await archiveWithFile(
      'process.bpmn',
      '<process />',
      {},
      { 'workspace/extra.bpmn': encode('<extra />') }
    )
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), unmanifested)
    ).rejects.toThrow(/unmanifested/)

    const ordinary = await archiveWithFile()
    await expect(
      inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), ordinary, {
        limits: { maxCompressedBytes: ordinary.size - 1 }
      })
    ).rejects.toThrow(/compressed-size/)
  })
})

describe('backup transaction decision and rollback edge cases', () => {
  it('uses explicit keep-both paths and rejects occupied paths', async () => {
    const blob = await archiveWithFile('process.txt', 'incoming')
    const target = new MemoryWorkspaceAdapter({
      files: {
        'process.txt': 'existing',
        'occupied.txt': 'occupied'
      }
    })
    const plan = await inspectWorkspaceBackup(target, blob)
    expect(
      await applyWorkspaceBackupImport(target, plan, {
        decisions: {
          'process.txt': {
            action: 'keep-both',
            destinationPath: 'restored.txt'
          }
        }
      })
    ).toMatchObject({
      status: 'committed',
      applied: [expect.objectContaining({ destinationPath: 'restored.txt' })]
    })

    await expect(
      applyWorkspaceBackupImport(target, plan, {
        decisions: {
          'process.txt': {
            action: 'keep-both',
            destinationPath: 'occupied.txt'
          }
        }
      })
    ).rejects.toMatchObject({ code: 'already-exists' })
  })

  it('allocates extensionless keep-both names', async () => {
    const blob = await archiveWithFile('README', 'incoming')
    const target = new MemoryWorkspaceAdapter({
      files: { README: 'existing' }
    })
    const plan = await inspectWorkspaceBackup(target, blob)
    const result = await applyWorkspaceBackupImport(target, plan, {
      decisions: { README: { action: 'keep-both' } }
    })
    expect(result).toMatchObject({
      status: 'committed',
      applied: [expect.objectContaining({ destinationPath: 'README-restored' })]
    })
  })

  it('cancels before mutations and rolls back when overwrite history fails', async () => {
    const blob = await archiveWithFile()
    const target = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': 'existing' }
    })
    const plan = await inspectWorkspaceBackup(target, blob)
    const controller = new AbortController()
    controller.abort()
    await expect(
      applyWorkspaceBackupImport(target, plan, {
        decisions: { 'process.bpmn': { action: 'replace' } },
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })

    const beforeOverwrite = vi.fn(async () => {
      throw new Error('history full')
    })
    expect(
      await applyWorkspaceBackupImport(target, plan, {
        decisions: { 'process.bpmn': { action: 'replace' } },
        beforeOverwrite
      })
    ).toMatchObject({
      status: 'rolled-back',
      appliedBeforeFailure: []
    })
    expect(beforeOverwrite).toHaveBeenCalledOnce()
  })

  it('maps non-success save outcomes during apply', async () => {
    const blob = await archiveWithFile()
    const plan = await inspectWorkspaceBackup(new MemoryWorkspaceAdapter(), blob)
    const outcomes: SaveOutcome[] = [
      {
        ok: false,
        status: 'external-conflict',
        reason: 'missing',
        expectedHash: 'f'.repeat(64)
      },
      {
        ok: false,
        status: 'permission-loss',
        error: {
          code: 'permission-loss',
          operation: 'write',
          message: 'revoked'
        }
      },
      {
        ok: false,
        status: 'stale-workspace',
        expectedWorkspaceId: 'old',
        actualWorkspaceId: 'new'
      }
    ]
    for (const failure of outcomes) {
      const adapter = new MemoryWorkspaceAdapter()
      vi.spyOn(adapter, 'writeAtomic').mockResolvedValueOnce(failure)
      const result = await applyWorkspaceBackupImport(adapter, plan)
      expect(result).toMatchObject({
        status: 'rolled-back',
        appliedBeforeFailure: []
      })
    }
  })

  it('reports rollback write conflicts and folder cleanup failures', async () => {
    const source = new MemoryWorkspaceAdapter({
      folders: ['created'],
      files: {
        'created/a.bpmn': 'a',
        'created/z.bpmn': 'z'
      }
    })
    const blob = await source.exportBackup()
    const target = new MemoryWorkspaceAdapter()
    const plan = await inspectWorkspaceBackup(target, blob)
    const originalWrite = target.writeAtomic.bind(target)
    let writes = 0
    vi.spyOn(target, 'writeAtomic').mockImplementation(async (...args) => {
      writes += 1
      if (writes === 2) {
        return {
          ok: false,
          status: 'permission-loss',
          error: {
            code: 'permission-loss',
            operation: 'write',
            path: args[0],
            message: 'revoked'
          }
        }
      }
      return originalWrite(...args)
    })
    vi.spyOn(target, 'remove').mockRejectedValueOnce(new Error('cleanup failed'))

    const result = await applyWorkspaceBackupImport(target, plan)
    expect(result).toMatchObject({
      status: 'rollback-failed',
      rollbackErrors: [expect.objectContaining({ message: 'cleanup failed' })]
    })
  })

  it('handles not-found folder cleanup without turning rollback into failure', async () => {
    const contentBytes = encode('content')
    const failBytes = encode('fail')
    const contentHash = await sha256Hex(contentBytes)
    const failHash = await sha256Hex(failBytes)
    const target = new MemoryWorkspaceAdapter()
    const processIdentityDigest = await sha256Hex(encode('[]'))
    const plan: WorkspaceBackupImportPlan = await sealWorkspaceBackupImportPlan({
      manifest: manifest({
        files: [
          { path: 'created/file.bpmn', sha256: contentHash },
          { path: 'created/fail.bpmn', sha256: failHash }
        ]
      }) as never,
      directories: ['created'],
      files: [
        {
          path: 'created/file.bpmn',
          bytes: contentBytes,
          archiveSha256: contentHash,
          sha256: contentHash,
          reviewedBpmn: {
            reviewDigest: `review-${contentHash}`,
            outputDigest: contentHash,
            processIds: [],
            replacesProcessIds: [],
            evidence: {
              originalDigest: contentHash,
              outputDigest: contentHash,
              reviewDigest: `review-${contentHash}`
            } as never
          }
        },
        {
          path: 'created/fail.bpmn',
          bytes: failBytes,
          archiveSha256: failHash,
          sha256: failHash,
          reviewedBpmn: {
            reviewDigest: `review-${failHash}`,
            outputDigest: failHash,
            processIds: [],
            replacesProcessIds: [],
            evidence: {
              originalDigest: failHash,
              outputDigest: failHash,
              reviewDigest: `review-${failHash}`
            } as never
          }
        }
      ],
      collisions: [],
      compressedBytes: 1,
      declaredUncompressedBytes: contentBytes.byteLength + failBytes.byteLength,
      workspaceId: target.id,
      workspaceMultipleFiles: true,
      processIdentitySnapshot: [],
      processIdentityDigest
    })
    const originalWrite = target.writeAtomic.bind(target)
    let writeCalls = 0
    vi.spyOn(target, 'writeAtomic').mockImplementation(async (...args) => {
      writeCalls += 1
      if (writeCalls === 1) return originalWrite(...args)
      return {
        ok: false,
        status: 'storage-failure',
        error: {
          code: 'quota-exceeded',
          operation: 'write',
          message: 'full'
        }
      }
    })
    vi.spyOn(target, 'remove')
      .mockImplementationOnce(async (path) => {
        await MemoryWorkspaceAdapter.prototype.remove.call(target, path)
      })
      .mockRejectedValueOnce(
        new WorkspaceOperationError({
          code: 'not-found',
          operation: 'remove',
          path: 'created',
          message: 'already gone'
        })
      )
    expect(await applyWorkspaceBackupImport(target, plan)).toMatchObject({
      status: 'rolled-back'
    })
  })
})
