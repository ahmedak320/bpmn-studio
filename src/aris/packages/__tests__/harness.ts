/** Shared test fixtures for the ARIS source-package suite. */

import { MemoryWorkspaceAdapter } from '../../../workspace/adapters/memory'
import { sha256Hex } from '../../../workspace/adapters/hash'
import type {
  BackupExportOptions,
  CreateFolderIfMissingResult,
  FileSnapshot,
  ListWorkspaceOptions,
  ReadFileOptions,
  RemoveEmptyFolderResult,
  SaveOutcome,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceStorageInfo,
  WriteAtomicOptions
} from '../../../workspace/adapters/types'
import { createArisAccountingDocument, type ArisAccountingDocumentV2 } from '../accounting'
import type { ArisModelManifestEntry } from '../manifest'
import type { ImportedAmlInput } from '../transaction'

export const SAMPLE_AML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE AML>
<AML>
  <Group Group.ID="Group.1">
    <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Animal workflows</AttrValue></AttrDef>
    <Model Model.ID="Model.1" Model.Type="MT_EEPC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Intake</AttrValue></AttrDef>
      <ObjOcc ObjOcc.ID="ObjOcc.1" ObjDef.IdRef="ObjDef.1" SymbolNum="ST_FUNC"/>
      <CxnOcc CxnOcc.ID="CxnOcc.1" CxnDef.IdRef="CxnDef.1"/>
    </Model>
  </Group>
</AML>
`

export function amlBytes(text: string = SAMPLE_AML): Uint8Array {
  const encoded = new TextEncoder().encode(text)
  const owned = new Uint8Array(new ArrayBuffer(encoded.byteLength))
  owned.set(encoded)
  return owned
}

export function createWorkspace(id = 'test-workspace'): MemoryWorkspaceAdapter {
  return new MemoryWorkspaceAdapter({ id, now: () => 1_700_000_000_000 })
}

export interface WorkspaceSnapshot {
  readonly directories: readonly string[]
  readonly files: Readonly<Record<string, string>>
}

/** Full structural + content fingerprint used to prove a rollback left nothing. */
export async function snapshotWorkspace(adapter: WorkspaceAdapter): Promise<WorkspaceSnapshot> {
  const entries = await adapter.list('')
  const directories: string[] = []
  const files: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      directories.push(entry.path)
      continue
    }
    files[entry.path] = (await adapter.read(entry.path)).hash
  }
  return Object.freeze({ directories: Object.freeze(directories.sort()), files: Object.freeze(files) })
}

export type FaultOperation =
  | 'write'
  | 'createFolderIfMissing'
  | 'read'
  | 'removeIfHash'
  | 'removeEmptyFolder'

export interface FaultPlan {
  readonly operation: FaultOperation
  /** 1-based call index at which the operation fails. */
  readonly atCall: number
  readonly message?: string
  /** Fail every call at or after `atCall` instead of only that one call. */
  readonly sticky?: boolean
}

/**
 * Delegating adapter that injects a deterministic failure at a chosen call.
 * It never weakens the underlying adapter's behaviour for other calls.
 */
export class FaultInjectingWorkspaceAdapter implements WorkspaceAdapter {
  private readonly inner: WorkspaceAdapter
  private readonly plan: FaultPlan
  private readonly counts = new Map<FaultOperation, number>()

  constructor(inner: WorkspaceAdapter, plan: FaultPlan) {
    this.inner = inner
    this.plan = plan
  }

  get id(): string {
    return this.inner.id
  }

  get mode(): WorkspaceAdapter['mode'] {
    return this.inner.mode
  }

  get storage(): WorkspaceStorageInfo {
    return this.inner.storage
  }

  private trip(operation: FaultOperation): void {
    const next = (this.counts.get(operation) ?? 0) + 1
    this.counts.set(operation, next)
    const hit = this.plan.sticky
      ? this.plan.operation === operation && next >= this.plan.atCall
      : this.plan.operation === operation && next === this.plan.atCall
    if (hit) {
      throw new Error(this.plan.message ?? `Injected ${operation} failure at call ${next}.`)
    }
  }

  list(path?: string, options?: ListWorkspaceOptions): Promise<WorkspaceEntry[]> {
    return this.inner.list(path, options)
  }

  read(path: string, options?: ReadFileOptions): Promise<FileSnapshot> {
    this.trip('read')
    return this.inner.read(path, options)
  }

  writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome> {
    this.trip('write')
    return this.inner.writeAtomic(path, bytes, expectedHash, options)
  }

  rename(from: string, to: string): Promise<void> {
    return this.inner.rename(from, to)
  }

  move(from: string, to: string): Promise<void> {
    return this.inner.move(from, to)
  }

  remove(path: string): Promise<void> {
    return this.inner.remove(path)
  }

  removeIfHash(path: string, expectedHash: string): Promise<void> {
    this.trip('removeIfHash')
    return this.inner.removeIfHash!(path, expectedHash)
  }

  removeEmptyFolder(path: string): Promise<RemoveEmptyFolderResult> {
    this.trip('removeEmptyFolder')
    return this.inner.removeEmptyFolder!(path)
  }

  createFolder(path: string): Promise<void> {
    return this.inner.createFolder(path)
  }

  createFolderIfMissing(path: string): Promise<CreateFolderIfMissingResult> {
    this.trip('createFolderIfMissing')
    return this.inner.createFolderIfMissing!(path)
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.inner.exportBackup(options)
  }
}

/** Adapter wrapper that records any mutating call. Used to prove planning is read-only. */
export class ReadOnlyAssertingWorkspaceAdapter extends FaultInjectingWorkspaceAdapter {
  readonly mutations: string[] = []

  constructor(inner: WorkspaceAdapter) {
    super(inner, { operation: 'write', atCall: Number.MAX_SAFE_INTEGER })
  }

  override writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome> {
    this.mutations.push(`write:${path}`)
    return super.writeAtomic(path, bytes, expectedHash, options)
  }

  override createFolder(path: string): Promise<void> {
    this.mutations.push(`createFolder:${path}`)
    return super.createFolder(path)
  }

  override createFolderIfMissing(path: string): Promise<CreateFolderIfMissingResult> {
    this.mutations.push(`createFolderIfMissing:${path}`)
    return super.createFolderIfMissing(path)
  }

  override remove(path: string): Promise<void> {
    this.mutations.push(`remove:${path}`)
    return super.remove(path)
  }
}

export const SAMPLE_MODELS: readonly ArisModelManifestEntry[] = Object.freeze([
  Object.freeze({
    modelId: 'Model.1',
    name: 'Intake',
    modelType: 'MT_EEPC',
    objectCount: 1,
    connectionCount: 1,
    sourcePath: '/AML/Group[1]/Model[1]'
  })
])

export function sampleAccounting(sourceSha256: string): ArisAccountingDocumentV2 {
  return createArisAccountingDocument({
    sourceSha256,
    censusRecords: 6,
    entries: [
      {
        sourcePath: '/AML/Group[1]',
        kind: 'group',
        disposition: 'side-panel',
        targetIds: ['Group.1']
      },
      {
        sourcePath: '/AML/Group[1]/Model[1]',
        kind: 'model',
        disposition: 'editable-native',
        targetIds: ['Model.1']
      },
      {
        sourcePath: '/AML/Group[1]/Model[1]/CxnOcc[1]',
        kind: 'connection-occurrence',
        disposition: 'editable-native',
        targetIds: ['CxnOcc.1']
      },
      {
        sourcePath: '/AML/Group[1]/Model[1]/ObjOcc[1]',
        kind: 'object-occurrence',
        disposition: 'editable-native',
        targetIds: ['ObjOcc.1']
      },
      {
        sourcePath: '/AML/Group[1]/dtd',
        kind: 'doctype',
        disposition: 'raw-source-only',
        targetIds: [],
        reason: 'Document type declarations are preserved verbatim.'
      },
      {
        sourcePath: '/AML/declaration',
        kind: 'xml-declaration',
        disposition: 'raw-source-only',
        targetIds: []
      }
    ]
  })
}

export async function importedSource(bytes = amlBytes()): Promise<ImportedAmlInput> {
  return Object.freeze({
    bytes,
    name: 'AnimalWF-sample.xml',
    mediaType: 'application/xml',
    sha256: await sha256Hex(bytes),
    encoding: 'UTF-8',
    arisVersion: '10.0.14.0'
  })
}

/** Stand-in for the Phase 3 tokenizer/semantic-index handle. */
export const SAMPLE_ANALYSIS = Object.freeze({
  index: Object.freeze({ models: 1, objects: 1 }),
  diagnostics: Object.freeze([Object.freeze({ severity: 'warning', code: 'unknown-record' })])
})
