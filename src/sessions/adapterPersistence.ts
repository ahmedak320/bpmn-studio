import type {
  FileSnapshot,
  SaveOutcome as AdapterSaveOutcome,
  WorkspaceAdapter,
  WorkspaceErrorCode
} from '../workspace/adapters'
import { WorkspaceOperationError } from '../workspace/adapters'
import type {
  PersistenceWriteOptions,
  PersistenceWriteResult,
  SessionPersistence
} from './controller'
import type { ExternalDocument } from './externalConflict'
import {
  sameWorkspace,
  type DocumentIdentity,
  type FileFingerprint,
  type WorkspaceIdentity
} from './types'

export interface AdapterSessionPersistenceOptions {
  /**
   * Exact adapter instance selected for this workspace generation. Keeping it
   * bound here prevents a stale session from resolving paths through a later
   * global/root handle.
   */
  adapter: WorkspaceAdapter
  workspace: WorkspaceIdentity
  encoder?: TextEncoder
  decoder?: TextDecoder
}

class AdapterOutcomeError extends Error {
  readonly code: WorkspaceErrorCode

  constructor(outcome: Exclude<AdapterSaveOutcome, { status: 'success' | 'external-conflict' }>) {
    const fallback = `Workspace ${outcome.status} while saving`
    const message = 'error' in outcome ? outcome.error.message : fallback
    super(message)
    this.name = 'AdapterOutcomeError'
    this.code = 'error' in outcome ? outcome.error.code : outcome.status
  }
}

function fingerprint(snapshot: FileSnapshot): FileFingerprint {
  return {
    hash: snapshot.hash,
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt
  }
}

/**
 * Direct bridge from the common workspace adapter to the session persistence
 * port. It is intentionally a separate injected object rather than making the
 * session controller depend on File System Access API or OPFS.
 */
export class AdapterSessionPersistence implements SessionPersistence {
  readonly #adapter: WorkspaceAdapter
  readonly #workspace: WorkspaceIdentity
  readonly #encoder: TextEncoder
  readonly #decoder: TextDecoder

  constructor(options: AdapterSessionPersistenceOptions) {
    if (options.adapter.id !== options.workspace.id) {
      throw new Error('Workspace adapter id does not match the bound workspace identity')
    }
    this.#adapter = options.adapter
    this.#workspace = options.workspace
    this.#encoder = options.encoder ?? new TextEncoder()
    this.#decoder = options.decoder ?? new TextDecoder('utf-8', { fatal: true })
  }

  async inspect(identity: DocumentIdentity): Promise<ExternalDocument | null> {
    this.#assertIdentity(identity)
    if (identity.path === null) return null
    try {
      const snapshot = await this.#adapter.read(identity.path)
      return this.#external(identity, snapshot)
    } catch (error) {
      if (error instanceof WorkspaceOperationError && error.code === 'not-found') return null
      throw error
    }
  }

  async write(
    identity: DocumentIdentity,
    xml: string,
    options: PersistenceWriteOptions
  ): Promise<PersistenceWriteResult> {
    this.#assertIdentity(identity)
    if (identity.path === null) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'write',
        message: 'A virtual document requires Save As or an explicit download adapter.'
      })
    }
    // `force` is authorization from an explicit overwrite decision, not an
    // unconditional write. expectedBase is the exact external version the user
    // reviewed; retaining it here makes a second external edit trigger another
    // conflict instead of being silently overwritten.
    const expectedHash = options.expectedBase?.hash
    const expectedMissing = options.expectedBase === null
    const outcome = await this.#adapter.writeAtomic(
      identity.path,
      this.#encoder.encode(xml),
      expectedHash,
      {
        expectedWorkspaceId: this.#adapter.id,
        expectedMissing,
        signal: options.signal
      }
    )
    return this.#writeResult(identity, outcome)
  }

  async writeAs(
    source: DocumentIdentity,
    destinationPath: string,
    xml: string,
    options: Omit<PersistenceWriteOptions, 'force'>
  ) {
    this.#assertIdentity(source)
    const identity: DocumentIdentity = {
      workspace: source.workspace,
      path: destinationPath
    }
    const outcome = await this.#adapter.writeAtomic(
      destinationPath,
      this.#encoder.encode(xml),
      undefined,
      {
        expectedWorkspaceId: this.#adapter.id,
        expectedMissing: true,
        signal: options.signal
      }
    )
    const result = this.#writeResult(identity, outcome)
    return result.status === 'written' ? { ...result, identity } : result
  }

  #assertIdentity(identity: DocumentIdentity): void {
    if (!sameWorkspace(identity.workspace, this.#workspace)) {
      throw new AdapterOutcomeError({
        ok: false,
        status: 'stale-workspace',
        expectedWorkspaceId: this.#workspace.id,
        actualWorkspaceId: identity.workspace.id
      })
    }
  }

  #external(identity: DocumentIdentity, snapshot: FileSnapshot): ExternalDocument {
    return {
      identity,
      xml: this.#decoder.decode(snapshot.bytes),
      fingerprint: fingerprint(snapshot)
    }
  }

  #writeResult(identity: DocumentIdentity, outcome: AdapterSaveOutcome): PersistenceWriteResult {
    if (outcome.status === 'success') {
      return { status: 'written', fingerprint: fingerprint(outcome.snapshot) }
    }
    if (outcome.status === 'external-conflict') {
      return {
        status: 'external-conflict',
        external: outcome.actual ? this.#external(identity, outcome.actual) : null
      }
    }
    throw new AdapterOutcomeError(outcome)
  }
}

export function createAdapterSessionPersistence(
  options: AdapterSessionPersistenceOptions
): SessionPersistence {
  return new AdapterSessionPersistence(options)
}
