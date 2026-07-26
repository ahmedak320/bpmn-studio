import { zipSync } from 'fflate'

import type { FileSnapshot, SaveOutcome, WorkspaceAdapter } from '../workspace/adapters'
import { WorkspaceOperationError } from '../workspace/adapters'
import type {
  DestinationState,
  ImportDestinationInspector,
  ImportDestinationTransaction,
  ImportTransactionFactory,
  StagedImportWrite
} from './contracts'
import { stableHash } from './hash'

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
}

function saveFailure(outcome: Exclude<SaveOutcome, { ok: true }>): Error {
  if (outcome.status === 'external-conflict') {
    return new Error(`Workspace compare-and-set failed: ${outcome.reason}`)
  }
  if (outcome.status === 'stale-workspace') {
    return new Error('The active workspace changed during the spreadsheet import.')
  }
  return new Error(outcome.error.message)
}

async function requireSave(outcome: SaveOutcome): Promise<FileSnapshot> {
  if (!outcome.ok) throw saveFailure(outcome)
  return outcome.snapshot
}

export class WorkspaceSpreadsheetDestinationInspector implements ImportDestinationInspector {
  constructor(private readonly adapter: WorkspaceAdapter) {}

  async inspect(paths: readonly string[]): Promise<readonly DestinationState[]> {
    return Object.freeze(
      await Promise.all(
        paths.map(async (path): Promise<DestinationState> => {
          try {
            const snapshot = await this.adapter.read(path)
            return Object.freeze({ path, exists: true, hash: snapshot.hash })
          } catch (error) {
            if (isNotFound(error)) return Object.freeze({ path, exists: false })
            throw error
          }
        })
      )
    )
  }
}

export interface WorkspaceImportTransactionFactoryOptions {
  /**
   * The App supplies its operation mutex here, so preflight, all writes, and
   * automatic rollback are one in-app critical section.
   */
  readonly runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>
  /** Reject a captured adapter after the user switches workspaces. */
  readonly isCurrent?: () => boolean
}

interface AppliedWrite {
  readonly write: StagedImportWrite
  readonly original?: FileSnapshot
  readonly applied: FileSnapshot
}

class WorkspaceImportTransaction implements ImportDestinationTransaction {
  private readonly staged = new Map<string, StagedImportWrite>()
  private readonly originals = new Map<string, FileSnapshot | undefined>()
  private readonly applied: AppliedWrite[] = []
  private readonly recoveryPaths: string[] = []
  private state: 'staging' | 'committing' | 'committed' | 'rolling-back' | 'rolled-back' = 'staging'

  constructor(
    private readonly transactionId: string,
    private readonly adapter: WorkspaceAdapter,
    private readonly options: WorkspaceImportTransactionFactoryOptions
  ) {}

  async stage(write: StagedImportWrite): Promise<void> {
    if (this.state !== 'staging') throw new Error('The import transaction is closed.')
    if (this.staged.has(write.path)) {
      throw new Error(`Duplicate staged spreadsheet destination: ${write.path}`)
    }
    const bytes = new Uint8Array(write.bytes.byteLength)
    bytes.set(write.bytes)
    this.staged.set(
      write.path,
      Object.freeze({
        ...write,
        bytes
      })
    )
  }

  async commit(): Promise<void> {
    if (this.state !== 'staging') throw new Error('The import transaction is closed.')
    this.state = 'committing'
    const run = this.options.runExclusive ?? (async (operation) => await operation())
    await run(async () => {
      try {
        this.assertCurrent()
        await this.captureAllOriginals()
        await this.createRecoveryRevisions()
        for (const write of this.staged.values()) {
          this.assertCurrent()
          const snapshot = await requireSave(
            await this.adapter.writeAtomic(write.path, write.bytes, write.expectedHash, {
              expectedWorkspaceId: this.adapter.id,
              expectedMissing: write.expectedHash === undefined
            })
          )
          this.applied.push({
            write,
            original: this.originals.get(write.path),
            applied: snapshot
          })
        }
        this.state = 'committed'
      } catch (cause) {
        try {
          await this.rollbackInternal()
        } catch (rollbackCause) {
          throw new AggregateError(
            [cause, rollbackCause],
            'Spreadsheet import failed and automatic rollback was incomplete.'
          )
        }
        throw cause
      }
    })
  }

  async rollback(): Promise<void> {
    if (this.state === 'rolled-back') return
    if (this.state === 'committed') {
      throw new Error('A committed spreadsheet import cannot be rolled back implicitly.')
    }
    const run = this.options.runExclusive ?? (async (operation) => await operation())
    await run(async () => await this.rollbackInternal())
  }

  private assertCurrent(): void {
    if (this.options.isCurrent && !this.options.isCurrent()) {
      throw new Error('The active workspace changed during the spreadsheet import.')
    }
  }

  private async captureAllOriginals(): Promise<void> {
    for (const write of this.staged.values()) {
      try {
        const original = await this.adapter.read(write.path)
        if (!write.expectedHash || original.hash !== write.expectedHash) {
          throw new Error(`Destination changed before import: ${write.path}`)
        }
        this.originals.set(write.path, original)
      } catch (error) {
        if (!isNotFound(error)) throw error
        if (write.expectedHash) {
          throw new Error(`Overwrite destination disappeared: ${write.path}`)
        }
        this.originals.set(write.path, undefined)
      }
    }
  }

  private recoveryPath(write: StagedImportWrite): string {
    const safeId = this.transactionId.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96)
    const name = write.path.split('/').pop() ?? 'process.bpmn'
    return `.orbitpm/history/imports/${safeId}/${stableHash(write.path)}-${name}`
  }

  private async createRecoveryRevisions(): Promise<void> {
    for (const write of this.staged.values()) {
      if (!write.createRecoveryRevision) continue
      const original = this.originals.get(write.path)
      if (!original) {
        throw new Error(`Recovery revision source is missing: ${write.path}`)
      }
      const path = this.recoveryPath(write)
      await requireSave(
        await this.adapter.writeAtomic(path, original.bytes, undefined, {
          expectedWorkspaceId: this.adapter.id,
          expectedMissing: true
        })
      )
      this.recoveryPaths.push(path)
    }
  }

  private async rollbackInternal(): Promise<void> {
    if (this.state === 'rolled-back') return
    this.state = 'rolling-back'
    const failures: unknown[] = []
    for (const entry of [...this.applied].reverse()) {
      try {
        if (entry.original) {
          await requireSave(
            await this.adapter.writeAtomic(
              entry.write.path,
              entry.original.bytes,
              entry.applied.hash,
              { expectedWorkspaceId: this.adapter.id }
            )
          )
        } else {
          const current = await this.adapter.read(entry.write.path)
          if (current.hash !== entry.applied.hash) {
            throw new Error(
              `Refusing to remove externally changed destination: ${entry.write.path}`
            )
          }
          await this.adapter.remove(entry.write.path)
        }
      } catch (error) {
        if (entry.original === undefined && isNotFound(error)) continue
        failures.push(error)
      }
    }
    if (failures.length === 0) {
      for (const path of [...this.recoveryPaths].reverse()) {
        try {
          await this.adapter.remove(path)
        } catch (error) {
          if (!isNotFound(error)) failures.push(error)
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Spreadsheet import rollback failed.')
    }
    this.applied.length = 0
    this.recoveryPaths.length = 0
    this.state = 'rolled-back'
  }
}

export class WorkspaceImportTransactionFactory implements ImportTransactionFactory {
  constructor(
    private readonly adapter: WorkspaceAdapter,
    private readonly options: WorkspaceImportTransactionFactoryOptions = {}
  ) {}

  async begin(transactionId: string): Promise<ImportDestinationTransaction> {
    if (this.options.isCurrent && !this.options.isCurrent()) {
      throw new Error('The active workspace changed before spreadsheet import.')
    }
    return new WorkspaceImportTransaction(transactionId, this.adapter, this.options)
  }
}

export class EmptySpreadsheetDestinationInspector implements ImportDestinationInspector {
  async inspect(paths: readonly string[]): Promise<readonly DestinationState[]> {
    return Object.freeze(paths.map((path) => Object.freeze({ path, exists: false })))
  }
}

export interface BrowserImportDeliveryOptions {
  readonly openSingle: (xml: string, path: string) => void | Promise<void>
  readonly downloadZip?: (archive: Blob, fileName: string) => void | Promise<void>
}

export function buildSpreadsheetImportZip(
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[]
): Blob {
  const entries: Record<string, Uint8Array> = {}
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    entries[file.path] = file.bytes
  }
  return new Blob([zipSync(entries, { level: 6 })], {
    type: 'application/zip'
  })
}

export function downloadSpreadsheetBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

class BrowserDeliveryTransaction implements ImportDestinationTransaction {
  private readonly staged = new Map<string, Uint8Array>()
  private committed = false

  constructor(
    private readonly transactionId: string,
    private readonly options: BrowserImportDeliveryOptions
  ) {}

  async stage(write: StagedImportWrite): Promise<void> {
    if (this.committed) throw new Error('The browser delivery is closed.')
    if (this.staged.has(write.path)) throw new Error(`Duplicate delivery path: ${write.path}`)
    const bytes = new Uint8Array(write.bytes.byteLength)
    bytes.set(write.bytes)
    this.staged.set(write.path, bytes)
  }

  async commit(): Promise<void> {
    if (this.committed) throw new Error('The browser delivery is closed.')
    const files = [...this.staged].map(([path, bytes]) => ({ path, bytes }))
    if (files.length === 0) throw new Error('There are no generated BPMN files.')
    if (files.length === 1) {
      await this.options.openSingle(new TextDecoder().decode(files[0]!.bytes), files[0]!.path)
    } else {
      const blob = buildSpreadsheetImportZip(files)
      const fileName = `orbitpm-spreadsheet-${this.transactionId.slice(-12)}.zip`
      await (this.options.downloadZip ?? downloadSpreadsheetBlob)(blob, fileName)
    }
    this.committed = true
  }

  async rollback(): Promise<void> {
    if (this.committed) {
      throw new Error('A delivered browser download cannot be recalled.')
    }
    this.staged.clear()
  }
}

export class BrowserImportDeliveryTransactionFactory implements ImportTransactionFactory {
  constructor(private readonly options: BrowserImportDeliveryOptions) {}

  async begin(transactionId: string): Promise<ImportDestinationTransaction> {
    return new BrowserDeliveryTransaction(transactionId, this.options)
  }
}
