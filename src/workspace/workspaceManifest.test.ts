import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH,
  WorkspaceLocalizationStore
} from '../localization/workspaceStore'
import {
  DEFAULT_HISTORY_PER_PROCESS,
  DEFAULT_HISTORY_TOTAL_BYTES,
  HISTORY_ROOT
} from './history/historyManager'
import {
  MemoryWorkspaceAdapter,
  SingleFileWorkspaceAdapter,
  WORKSPACE_BACKUP_MANIFEST_PATH,
  type BackupExportOptions,
  type RemoveEmptyFolderResult,
  type SaveOutcome,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WriteAtomicOptions
} from './adapters'
import {
  WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS,
  WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES,
  WORKSPACE_MANIFEST_CHECKSUM_SCOPE,
  WORKSPACE_MANIFEST_FORMAT,
  WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE,
  WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE,
  WORKSPACE_MANIFEST_PATH,
  WorkspaceManifestValidationError,
  bindWorkspaceToManifest,
  collectWorkspaceManifestChecksums,
  createWorkspaceManifestDocument,
  ensureWorkspaceManifest,
  isManifestChecksumPath,
  parseWorkspaceManifestJson,
  serializeWorkspaceManifest
} from './workspaceManifest'

const UUID_A = '123e4567-e89b-42d3-a456-426614174000'
const UUID_B = '123e4567-e89b-42d3-b456-426614174001'
const CREATED_AT = '2026-07-26T18:00:00.000Z'
const encoder = new TextEncoder()

class InstrumentedWorkspaceAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode: WorkspaceAdapter['mode']
  readonly storage: WorkspaceAdapter['storage']
  readonly listCalls: string[] = []
  readonly readCalls: string[] = []
  readonly writeCalls: string[] = []

  constructor(
    readonly target: WorkspaceAdapter,
    private readonly entryOverride?: (entries: WorkspaceEntry[]) => WorkspaceEntry[]
  ) {
    this.id = target.id
    this.mode = target.mode
    this.storage = target.storage
  }

  clearInstrumentation(): void {
    this.listCalls.length = 0
    this.readCalls.length = 0
    this.writeCalls.length = 0
  }

  async list(path?: string): Promise<WorkspaceEntry[]> {
    this.listCalls.push(path ?? '')
    const entries = await this.target.list(path)
    return this.entryOverride?.(entries) ?? entries
  }

  read(path: string) {
    this.readCalls.push(path)
    return this.target.read(path)
  }

  writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome> {
    this.writeCalls.push(path)
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

  removeEmptyFolder(path: string): Promise<RemoveEmptyFolderResult> {
    return this.target.removeEmptyFolder?.(path) ?? Promise.resolve('not-empty')
  }

  createFolder(path: string): Promise<void> {
    return this.target.createFolder(path)
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.target.exportBackup(options)
  }
}

function manifestJson(overrides: Record<string, unknown> = {}): string {
  const document = createWorkspaceManifestDocument({
    workspaceId: UUID_A,
    createdAt: CREATED_AT,
    checksums: []
  })
  return JSON.stringify({ ...document, ...overrides })
}

describe('public workspace manifest', () => {
  it('creates one stable UUID and checksums every public file except managed exclusions', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'display-name-is-not-identity',
      files: {
        'z.bpmn': '<z/>',
        'folder/a.bpmn': '<a/>',
        'notes.txt': 'covered',
        [WORKSPACE_GLOSSARY_PATH]: '{"glossary":true}',
        [WORKSPACE_TRANSLATION_MEMORY_PATH]: '{"tm":true}',
        [`${HISTORY_ROOT}/revision.bpmn`]: '<history/>',
        '.orbitpm/transactions/staged/payload': 'recoverable'
      }
    })
    const state = await ensureWorkspaceManifest(adapter, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })

    expect(state.created).toBe(true)
    expect(state.document).toMatchObject({
      format: WORKSPACE_MANIFEST_FORMAT,
      version: 1,
      workspace: {
        id: UUID_A,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      },
      policies: {
        checksumAlgorithm: 'SHA-256',
        checksumScope: WORKSPACE_MANIFEST_CHECKSUM_SCOPE,
        excludedPaths: WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS,
        excludedPathPrefixes: WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES,
        publicLocalization: {
          glossaryPath: WORKSPACE_GLOSSARY_PATH,
          translationMemoryPath: WORKSPACE_TRANSLATION_MEMORY_PATH,
          checksumCoverage: WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE
        },
        portableHistory: {
          rootPath: HISTORY_ROOT,
          maxRevisionsPerProcess: DEFAULT_HISTORY_PER_PROCESS,
          maxTotalBytes: DEFAULT_HISTORY_TOTAL_BYTES,
          pruneOrder: 'oldest-first',
          preserveNewestPerProcess: true,
          checksumCoverage: WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE
        }
      }
    })
    expect(state.document.checksums.map((item) => item.path)).toEqual([
      WORKSPACE_GLOSSARY_PATH,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      'folder/a.bpmn',
      'notes.txt',
      'z.bpmn'
    ])
    expect(
      parseWorkspaceManifestJson(
        new TextDecoder('utf-8', { fatal: true }).decode(
          (await adapter.read(WORKSPACE_MANIFEST_PATH)).bytes
        )
      )
    ).toEqual(state.document)

    const reopened = await ensureWorkspaceManifest(adapter, {
      createUuid: () => UUID_B,
      now: () => new Date('2026-07-26T19:00:00.000Z')
    })
    expect(reopened.created).toBe(false)
    expect(reopened.reconciled).toBe(false)
    expect(reopened.document.workspace.id).toBe(UUID_A)
    expect(reopened.snapshot.hash).toBe(state.snapshot.hash)
  })

  it('includes public localization and refreshes it only after successful CAS writes', async () => {
    expect(isManifestChecksumPath('process.bpmn')).toBe(true)
    expect(isManifestChecksumPath('notes.txt')).toBe(true)
    expect(isManifestChecksumPath(WORKSPACE_GLOSSARY_PATH)).toBe(true)
    expect(isManifestChecksumPath(WORKSPACE_TRANSLATION_MEMORY_PATH)).toBe(true)
    expect(isManifestChecksumPath(WORKSPACE_MANIFEST_PATH)).toBe(false)
    expect(isManifestChecksumPath(`${HISTORY_ROOT}/revision.bpmn`)).toBe(false)
    expect(isManifestChecksumPath('.orbitpm/transactions/staged/payload')).toBe(false)

    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional-handle-id',
      files: { 'process.bpmn': '<process/>' }
    })
    const { adapter } = await bindWorkspaceToManifest(backing, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })
    const localization = new WorkspaceLocalizationStore(adapter, {
      now: () => new Date('2026-07-26T19:00:00.000Z')
    })
    await localization.load()
    await localization.editGlossary((entries) => [
      ...entries,
      { en: 'Review request', ar: 'مراجعة الطلب' }
    ])
    await localization.acceptTranslationPair({
      en: 'Approve request',
      ar: 'اعتماد الطلب'
    })

    const successfulManifest = adapter.manifest
    const successfulGlossary = await backing.read(WORKSPACE_GLOSSARY_PATH)
    expect(successfulManifest.document.checksums.map((item) => item.path)).toEqual([
      WORKSPACE_GLOSSARY_PATH,
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      'process.bpmn'
    ])
    expect(
      successfulManifest.document.checksums.find((item) => item.path === WORKSPACE_GLOSSARY_PATH)
        ?.sha256
    ).toBe(successfulGlossary.hash)

    backing.replaceExternally(WORKSPACE_GLOSSARY_PATH, '{"external":true}')
    await expect(
      localization.editGlossary((entries) => [
        ...entries,
        { en: 'Rejected collision', ar: 'تعارض مرفوض' }
      ])
    ).rejects.toMatchObject({
      name: 'WorkspaceLocalizationConflictError',
      path: WORKSPACE_GLOSSARY_PATH
    })
    expect(adapter.manifest).toBe(successfulManifest)
    expect(adapter.manifest.snapshot.hash).toBe(successfulManifest.snapshot.hash)
  })

  it('binds adapter identity to the UUID and translates CAS identity to its backing adapter', async () => {
    const backing = new MemoryWorkspaceAdapter({
      id: 'directory-handle-generation',
      folders: ['archive'],
      files: { 'process.bpmn': '<before/>', 'old.txt': 'old' }
    })
    const { adapter } = await bindWorkspaceToManifest(backing, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })
    expect(adapter.id).toBe(UUID_A)

    const process = await adapter.read('process.bpmn')
    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<after/>'), process.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({ status: 'success' })
    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<stale/>'), undefined, {
        expectedWorkspaceId: UUID_B
      })
    ).toEqual({
      ok: false,
      status: 'stale-workspace',
      expectedWorkspaceId: UUID_B,
      actualWorkspaceId: UUID_A
    })

    await adapter.rename('old.txt', 'renamed.txt')
    expect(adapter.manifest.document.checksums.map((item) => item.path)).toContain('renamed.txt')
    await adapter.move('renamed.txt', 'archive/renamed.txt')
    expect(adapter.manifest.document.checksums.map((item) => item.path)).toContain(
      'archive/renamed.txt'
    )
    await adapter.remove('archive/renamed.txt')
    expect(adapter.manifest.document.checksums.map((item) => item.path)).not.toContain(
      'archive/renamed.txt'
    )

    const backup = await adapter.exportBackup({
      generatedAt: new Date('2026-07-26T20:00:00.000Z')
    })
    const archive = unzipSync(new Uint8Array(await backup.arrayBuffer()))
    const backupManifest = JSON.parse(strFromU8(archive[WORKSPACE_BACKUP_MANIFEST_PATH]!)) as {
      workspace: { id: string }
    }
    expect(backupManifest.workspace.id).toBe(UUID_A)
  })

  it('forwards atomic empty-folder removal while protecting manifest metadata', async () => {
    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional',
      folders: ['empty', 'occupied'],
      files: { 'occupied/concurrent-note.txt': 'retain me' }
    })
    const { adapter } = await bindWorkspaceToManifest(backing, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })

    await expect(adapter.removeEmptyFolder('occupied')).resolves.toBe('not-empty')
    expect(
      new TextDecoder().decode((await adapter.read('occupied/concurrent-note.txt')).bytes)
    ).toBe('retain me')
    await expect(adapter.removeEmptyFolder('empty')).resolves.toBe('removed')
    await expect(adapter.list('empty')).rejects.toMatchObject({ code: 'not-found' })
    await expect(adapter.removeEmptyFolder('.orbitpm')).rejects.toMatchObject({
      code: 'unsupported'
    })
    expect(await adapter.read(WORKSPACE_MANIFEST_PATH)).toMatchObject({
      path: WORKSPACE_MANIFEST_PATH
    })
  })

  it('updates ordinary saves and i18n incrementally without listing or reading unrelated files', async () => {
    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional',
      files: {
        'process.bpmn': '<before/>',
        'unrelated/large.bin': new Uint8Array(1024)
      }
    })
    const instrumented = new InstrumentedWorkspaceAdapter(backing)
    const { adapter } = await bindWorkspaceToManifest(instrumented, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })
    const process = await adapter.read('process.bpmn')
    instrumented.clearInstrumentation()

    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<after/>'), process.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({ status: 'success' })
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual([])
    expect(instrumented.writeCalls).toEqual(['process.bpmn', WORKSPACE_MANIFEST_PATH])
    expect(
      adapter.manifest.document.checksums.find((item) => item.path === 'process.bpmn')?.sha256
    ).toBe((await backing.read('process.bpmn')).hash)

    instrumented.clearInstrumentation()
    expect(
      await adapter.writeAtomic(
        WORKSPACE_GLOSSARY_PATH,
        encoder.encode('{"public":"glossary"}'),
        undefined,
        {
          expectedWorkspaceId: UUID_A,
          expectedMissing: true
        }
      )
    ).toMatchObject({ status: 'success' })
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual([])
    expect(instrumented.writeCalls).toEqual([WORKSPACE_GLOSSARY_PATH, WORKSPACE_MANIFEST_PATH])
    expect(adapter.manifest.document.checksums.map((item) => item.path)).toContain(
      WORKSPACE_GLOSSARY_PATH
    )
  })

  it('limits directory moves to the destination subtree and removes prefixes without a rescan', async () => {
    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional',
      folders: ['archive'],
      files: {
        'folder/a.bpmn': '<a/>',
        'folder/nested/b.txt': 'b',
        'unrelated/large.bin': new Uint8Array(1024)
      }
    })
    const instrumented = new InstrumentedWorkspaceAdapter(backing)
    const { adapter } = await bindWorkspaceToManifest(instrumented, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT)
    })
    instrumented.clearInstrumentation()

    await adapter.rename('folder/a.bpmn', 'folder/renamed.bpmn')
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual(['folder/renamed.bpmn'])
    expect(instrumented.readCalls).not.toContain('unrelated/large.bin')

    instrumented.clearInstrumentation()
    await adapter.move('folder', 'archive/folder')
    expect(instrumented.listCalls).toEqual(['archive/folder'])
    expect(instrumented.readCalls).toEqual([
      'archive/folder/nested/b.txt',
      'archive/folder/renamed.bpmn'
    ])
    expect(instrumented.readCalls).not.toContain('unrelated/large.bin')
    expect(adapter.manifest.document.checksums.map((item) => item.path)).toEqual([
      'archive/folder/nested/b.txt',
      'archive/folder/renamed.bpmn',
      'unrelated/large.bin'
    ])

    instrumented.clearInstrumentation()
    await adapter.remove('archive/folder')
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual([])
    expect(adapter.manifest.document.checksums.map((item) => item.path)).toEqual([
      'unrelated/large.bin'
    ])
  })

  it('uses a bounded full reconciliation only after an exceptional manifest CAS conflict', async () => {
    let conflictingManifestBytes: Uint8Array | undefined
    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional',
      files: {
        'process.bpmn': '<before/>',
        'unrelated.txt': 'unrelated'
      },
      beforeWrite: (path) => {
        if (path !== WORKSPACE_MANIFEST_PATH || !conflictingManifestBytes) return
        const bytes = conflictingManifestBytes
        conflictingManifestBytes = undefined
        backing.replaceExternally(path, bytes)
      }
    })
    const instrumented = new InstrumentedWorkspaceAdapter(backing)
    const onManifestError = vi.fn()
    const { adapter } = await bindWorkspaceToManifest(instrumented, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT),
      onManifestError
    })
    const process = await adapter.read('process.bpmn')
    conflictingManifestBytes = encoder.encode(
      serializeWorkspaceManifest(
        createWorkspaceManifestDocument({
          workspaceId: UUID_A,
          createdAt: CREATED_AT,
          updatedAt: '2026-07-26T19:00:00.000Z',
          checksums: adapter.manifest.document.checksums
        })
      )
    )
    instrumented.clearInstrumentation()

    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<after/>'), process.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({ status: 'success' })
    expect(instrumented.listCalls).toEqual([''])
    expect(instrumented.readCalls).toContain('unrelated.txt')
    expect(instrumented.writeCalls.filter((path) => path === WORKSPACE_MANIFEST_PATH)).toHaveLength(
      2
    )
    expect(onManifestError).not.toHaveBeenCalled()
    expect(adapter.lastManifestError).toBeUndefined()
    expect(
      adapter.manifest.document.checksums.find((item) => item.path === 'process.bpmn')?.sha256
    ).toBe((await backing.read('process.bpmn')).hash)
  })

  it('keeps data-write conflicts side-effect free and recovers after post-commit manifest failure', async () => {
    let failManifestWrite = false
    const backing = new MemoryWorkspaceAdapter({
      id: 'provisional',
      files: {
        'process.bpmn': '<before/>',
        'notes.txt': 'before'
      },
      beforeWrite: (path) => {
        if (failManifestWrite && path === WORKSPACE_MANIFEST_PATH) {
          throw new Error('manifest storage unavailable')
        }
      }
    })
    const instrumented = new InstrumentedWorkspaceAdapter(backing)
    const onManifestError = vi.fn()
    const { adapter } = await bindWorkspaceToManifest(instrumented, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT),
      onManifestError
    })
    const originalProcess = await adapter.read('process.bpmn')
    const originalManifest = adapter.manifest
    backing.replaceExternally('process.bpmn', '<external/>')
    instrumented.clearInstrumentation()

    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<local/>'), originalProcess.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    expect(adapter.manifest).toBe(originalManifest)
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual([])
    expect(instrumented.writeCalls).toEqual(['process.bpmn'])
    expect(onManifestError).not.toHaveBeenCalled()

    const external = await adapter.read('process.bpmn')
    failManifestWrite = true
    instrumented.clearInstrumentation()
    expect(
      await adapter.writeAtomic('process.bpmn', encoder.encode('<committed/>'), external.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({ status: 'success' })
    expect(onManifestError).toHaveBeenCalledOnce()
    expect(adapter.manifest).toBe(originalManifest)
    expect(instrumented.listCalls).toEqual([])
    expect(instrumented.readCalls).toEqual([])

    failManifestWrite = false
    const notes = await adapter.read('notes.txt')
    instrumented.clearInstrumentation()
    expect(
      await adapter.writeAtomic('notes.txt', encoder.encode('after'), notes.hash, {
        expectedWorkspaceId: UUID_A
      })
    ).toMatchObject({ status: 'success' })
    expect(instrumented.listCalls).toEqual([''])
    expect(adapter.lastManifestError).toBeUndefined()
    expect(
      adapter.manifest.document.checksums.find((item) => item.path === 'process.bpmn')?.sha256
    ).toBe((await backing.read('process.bpmn')).hash)
    expect(
      adapter.manifest.document.checksums.find((item) => item.path === 'notes.txt')?.sha256
    ).toBe((await backing.read('notes.txt')).hash)
  })

  it('isolates unreadable public files while binding and preserves prior checksums when possible', async () => {
    const issue = {
      code: 'storage-failure' as const,
      operation: 'read' as const,
      path: 'unreadable.bin',
      message: 'unreadable file metadata'
    }
    const markUnreadable = (entries: WorkspaceEntry[]) =>
      entries.map((entry) =>
        entry.path === 'unreadable.bin' ? { ...entry, readable: false, issue } : entry
      )
    const initialBacking = new MemoryWorkspaceAdapter({
      id: 'provisional',
      files: {
        'healthy.bpmn': '<healthy/>',
        'unreadable.bin': 'secret'
      }
    })
    const initial = new InstrumentedWorkspaceAdapter(initialBacking, markUnreadable)
    const onWarning = vi.fn()
    const { adapter } = await bindWorkspaceToManifest(initial, {
      createUuid: () => UUID_A,
      now: () => new Date(CREATED_AT),
      onManifestWarning: onWarning
    })

    expect(adapter.manifest.document.checksums.map((item) => item.path)).toEqual(['healthy.bpmn'])
    expect(adapter.manifest.warnings).toEqual([
      expect.objectContaining({
        code: 'unreadable-file',
        path: 'unreadable.bin',
        message: 'unreadable file metadata'
      })
    ])
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ path: 'unreadable.bin' }))
    expect(await adapter.read('healthy.bpmn')).toMatchObject({ path: 'healthy.bpmn' })
    expect(initial.readCalls).not.toContain('unreadable.bin')

    const healthyBacking = new MemoryWorkspaceAdapter({
      id: 'another-provisional',
      files: {
        'healthy.bpmn': '<healthy/>',
        'unreadable.bin': 'original'
      }
    })
    const first = await ensureWorkspaceManifest(healthyBacking, {
      createUuid: () => UUID_B,
      now: () => new Date(CREATED_AT)
    })
    const previousUnreadable = first.document.checksums.find(
      (item) => item.path === 'unreadable.bin'
    )
    const reopened = await ensureWorkspaceManifest(
      new InstrumentedWorkspaceAdapter(healthyBacking, markUnreadable),
      {
        now: () => new Date('2026-07-26T20:00:00.000Z')
      }
    )
    expect(reopened.document.checksums.find((item) => item.path === 'unreadable.bin')).toEqual(
      previousUnreadable
    )
    expect(reopened.warnings.map((warning) => warning.path)).toEqual(['unreadable.bin'])
  })

  it('reconciles external public-file changes with CAS while preserving identity', async () => {
    let now = CREATED_AT
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<before/>' },
      now: () => Date.parse(now)
    })
    const first = await ensureWorkspaceManifest(adapter, {
      createUuid: () => UUID_A,
      now: () => new Date(now)
    })
    const previousChecksum = first.document.checksums[0]!.sha256

    now = '2026-07-26T19:00:00.000Z'
    adapter.replaceExternally('process.bpmn', '<after/>')
    const reconciled = await ensureWorkspaceManifest(adapter, {
      createUuid: () => UUID_B,
      now: () => new Date(now)
    })

    expect(reconciled.reconciled).toBe(true)
    expect(reconciled.document.workspace).toEqual({
      id: UUID_A,
      createdAt: CREATED_AT,
      updatedAt: now
    })
    expect(reconciled.document.checksums[0]!.sha256).not.toBe(previousChecksum)
    expect(reconciled.document.checksums).toEqual(await collectWorkspaceManifestChecksums(adapter))
  })

  it('concurrent first-open creation converges on the one creation-only winner', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: { 'process.bpmn': '<process/>' }
    })
    const [left, right] = await Promise.all([
      ensureWorkspaceManifest(adapter, {
        createUuid: () => UUID_A,
        now: () => new Date(CREATED_AT)
      }),
      ensureWorkspaceManifest(adapter, {
        createUuid: () => UUID_B,
        now: () => new Date(CREATED_AT)
      })
    ])

    expect(left.document.workspace.id).toBe(right.document.workspace.id)
    expect([UUID_A, UUID_B]).toContain(left.document.workspace.id)
    expect(
      parseWorkspaceManifestJson(
        new TextDecoder('utf-8', { fatal: true }).decode(
          (await adapter.read(WORKSPACE_MANIFEST_PATH)).bytes
        )
      ).workspace.id
    ).toBe(left.document.workspace.id)
  })

  it('strictly rejects malformed identity, policies, ordering, and unknown fields', () => {
    expect(() => parseWorkspaceManifestJson('{')).toThrow(WorkspaceManifestValidationError)
    expect(() =>
      parseWorkspaceManifestJson(
        manifestJson({
          workspace: { id: 'folder-name', createdAt: CREATED_AT, updatedAt: CREATED_AT }
        })
      )
    ).toThrow(/version-4 UUID/)

    const invalidPolicies = JSON.parse(manifestJson()) as {
      policies: { excludedPathPrefixes: string[] }
    }
    invalidPolicies.policies.excludedPathPrefixes = ['.orbitpm/']
    expect(() => parseWorkspaceManifestJson(JSON.stringify(invalidPolicies))).toThrow(
      /excludedPathPrefixes/
    )
    expect(() =>
      parseWorkspaceManifestJson(
        manifestJson({
          checksums: [
            {
              path: `${HISTORY_ROOT}/revision.bpmn`,
              sha256: 'a'.repeat(64),
              size: 1,
              modifiedAt: 1
            }
          ]
        })
      )
    ).toThrow(/excluded/)
    expect(() => parseWorkspaceManifestJson(manifestJson({ unexpected: true }))).toThrow(
      /unsupported field/
    )
  })

  it('serializes deterministically and rejects storage modes without public directories', async () => {
    const document = createWorkspaceManifestDocument({
      workspaceId: UUID_A.toUpperCase(),
      createdAt: CREATED_AT
    })
    expect(serializeWorkspaceManifest(document)).toBe(`${JSON.stringify(document, null, 2)}\n`)
    const single = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: encoder.encode('<process/>')
    })
    await expect(ensureWorkspaceManifest(single)).rejects.toMatchObject({
      code: 'unsupported',
      path: WORKSPACE_MANIFEST_PATH
    })
  })
})
