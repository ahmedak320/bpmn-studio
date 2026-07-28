/**
 * Workspace-facing API for ARIS source packages (plan §7.4).
 *
 * Immutability is structural rather than advisory:
 *
 * - every write goes through `ArisPackageStore`, and the only write primitives
 *   are `createMemberOnce` (creation-only compare-and-set) and
 *   `writeWorkingMember` (rejects any path inside `original/`), so no code path
 *   in this package can overwrite `original/source.xml`;
 * - saving appends working-revision commands;
 * - deleting a model rewrites the manifest and appends a revision, and never
 *   touches the original;
 * - deleting a source package is a separate call that must echo the package
 *   digest as explicit confirmation;
 * - the original is always readable back byte-for-byte for download/export.
 */

import { copyBytes, equalHash, sha256Hex } from '../../workspace/adapters/hash'
import { normalizeWorkspacePath } from '../../workspace/adapters/path'
import type {
  FileSnapshot,
  SaveOutcome,
  WorkspaceAdapter,
  WorkspaceEntry
} from '../../workspace/adapters/types'
import {
  arisAccountingDigest,
  parseArisAccounting,
  type ArisAccountingDocumentV2
} from './accounting'
import {
  ARIS_PACKAGE_NAMESPACE,
  arisPackageDigestFromPath,
  arisPackagePaths,
  arisRevisionPath,
  assertArisMutableMemberPath,
  isArisImmutableMemberPath,
  normalizeArisSourceDigest
} from './layout'
import {
  createArisManifest,
  parseArisManifest,
  serializeArisManifest,
  type ArisSourcePackageManifestV1
} from './manifest'
import {
  appendArisRevision,
  createArisRestoreRevision,
  createArisRevision,
  parseArisCurrentRevision,
  parseArisRevision,
  replayArisRevisions,
  serializeArisCurrentRevision,
  serializeArisRevision,
  type ArisCurrentRevisionV1,
  type ArisRevisionCommand,
  type ArisRevisionPatchV1,
  type ArisRevisionReplay
} from './revisions'
import { findSecretLikeMatches, type SecretFinding } from './secrets'

export type ArisPackageErrorCode =
  | 'unsupported-workspace'
  | 'write-failed'
  | 'already-exists'
  | 'not-found'
  | 'integrity-failure'
  | 'confirmation-required'
  | 'immutable-member'

export class ArisPackageError extends Error {
  readonly code: ArisPackageErrorCode
  readonly path?: string

  constructor(code: ArisPackageErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'ArisPackageError'
    this.code = code
    if (path !== undefined) this.path = path
  }
}

export interface ArisPackageWriteResult {
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
}

/**
 * Guard for the *package-directory* storage shape. A workspace that cannot
 * create folders, cannot conditionally delete, or holds a single file only
 * cannot host a multi-member directory tree with provable rollback.
 *
 * This is not a refusal to support such a workspace: single-file/portable
 * workspaces are a first-class mode (plan §2.5) and are routed to the portable
 * container in `portable.ts` via `openArisWorkspace`, which hydrates the same
 * tree in memory and commits it as one atomic write. Only a workspace that can
 * do neither fails closed here.
 */
export function assertArisPackageWorkspace(adapter: WorkspaceAdapter): void {
  const capabilities = adapter.storage.capabilities
  const missing: string[] = []
  if (!capabilities.multipleFiles) missing.push('multiple files')
  if (!capabilities.directories) missing.push('directories')
  if (!capabilities.remove) missing.push('removal')
  if (typeof adapter.createFolderIfMissing !== 'function') missing.push('createFolderIfMissing')
  if (typeof adapter.removeIfHash !== 'function') missing.push('removeIfHash')
  if (typeof adapter.removeEmptyFolder !== 'function') missing.push('removeEmptyFolder')
  if (missing.length > 0) {
    throw new ArisPackageError(
      'unsupported-workspace',
      `This workspace cannot host an ARIS package directory: it lacks ${missing.join(
        ', '
      )}. Use openArisWorkspace() so a single-file workspace is routed to the portable container instead.`
    )
  }
}

function writeFailure(path: string, outcome: Exclude<SaveOutcome, { ok: true }>): ArisPackageError {
  if (outcome.status === 'external-conflict') {
    return new ArisPackageError(
      outcome.reason === 'already-exists' ? 'already-exists' : 'integrity-failure',
      `Writing "${path}" conflicted with the workspace (${outcome.reason}).`,
      path
    )
  }
  if (outcome.status === 'stale-workspace') {
    return new ArisPackageError(
      'write-failed',
      `Writing "${path}" targeted workspace "${outcome.expectedWorkspaceId}" but the active workspace is "${outcome.actualWorkspaceId}".`,
      path
    )
  }
  return new ArisPackageError('write-failed', `${outcome.error.message} (${path})`, path)
}

export interface ArisPackageSecretFinding extends SecretFinding {
  readonly path: string
}

export interface ArisPackageIntegrityReport {
  readonly sourceSha256: string
  readonly manifest: ArisSourcePackageManifestV1
  readonly originalPresent: boolean
  readonly originalSha256: string | null
  readonly accountingMatches: boolean
  readonly revisionCount: number
  readonly attachmentMismatches: readonly string[]
  readonly problems: readonly string[]
}

export interface ArisRevisionState {
  readonly current: ArisCurrentRevisionV1
  readonly patches: readonly ArisRevisionPatchV1[]
}

/** Explicit confirmation required to delete a whole source package (§7.4). */
export interface ArisPackageDeletionConfirmation {
  readonly confirmed: true
  /** Must equal the package digest exactly. */
  readonly confirmedSourceSha256: string
}

export class ArisPackageStore {
  private readonly adapter: WorkspaceAdapter

  constructor(adapter: WorkspaceAdapter) {
    assertArisPackageWorkspace(adapter)
    this.adapter = adapter
  }

  get workspaceId(): string {
    return this.adapter.id
  }

  /**
   * Creation-only write. Existing members are never replaced, which is what
   * makes `original/source.xml` write-once for every caller, including this
   * class itself.
   */
  async createMemberOnce(path: string, bytes: Uint8Array): Promise<ArisPackageWriteResult> {
    const normalized = normalizeWorkspacePath(path)
    if (arisPackageDigestFromPath(normalized) === null) {
      throw new ArisPackageError(
        'immutable-member',
        `"${normalized}" is not inside the ARIS package namespace.`,
        normalized
      )
    }
    const owned = copyBytes(bytes)
    const outcome = await this.adapter.writeAtomic(normalized, owned, undefined, {
      expectedMissing: true
    })
    if (!outcome.ok) throw writeFailure(normalized, outcome)
    return Object.freeze({
      path: normalized,
      sha256: outcome.snapshot.hash,
      byteLength: owned.byteLength
    })
  }

  /** Write a mutable working member. Immutable members are rejected outright. */
  async writeWorkingMember(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string
  ): Promise<ArisPackageWriteResult> {
    const normalized = assertArisMutableMemberPath(path)
    const owned = copyBytes(bytes)
    const outcome = await this.adapter.writeAtomic(normalized, owned, expectedHash)
    if (!outcome.ok) throw writeFailure(normalized, outcome)
    return Object.freeze({
      path: normalized,
      sha256: outcome.snapshot.hash,
      byteLength: owned.byteLength
    })
  }

  async readMember(path: string): Promise<FileSnapshot> {
    const normalized = normalizeWorkspacePath(path)
    try {
      return await this.adapter.read(normalized)
    } catch (error) {
      throw new ArisPackageError(
        'not-found',
        `Package member "${normalized}" could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        normalized
      )
    }
  }

  async hasMember(path: string): Promise<boolean> {
    try {
      await this.adapter.read(normalizeWorkspacePath(path))
      return true
    } catch {
      return false
    }
  }

  /** Byte-for-byte original AML, verified against the package digest (§7.4). */
  async readOriginalSource(digest: string): Promise<FileSnapshot> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const snapshot = await this.readMember(arisPackagePaths(sourceSha256).originalSource)
    if (!equalHash(snapshot.hash, sourceSha256)) {
      throw new ArisPackageError(
        'integrity-failure',
        'The stored original source no longer matches its package digest.',
        snapshot.path
      )
    }
    return snapshot
  }

  /** Payload for "download original AML" — exactly the imported bytes. */
  async readOriginalSourceDownload(digest: string): Promise<{
    readonly bytes: Uint8Array
    readonly name: string
    readonly mediaType: string
    readonly sha256: string
  }> {
    const manifest = await this.readManifest(digest)
    const snapshot = await this.readOriginalSource(digest)
    return Object.freeze({
      bytes: copyBytes(snapshot.bytes),
      name: manifest.source.name,
      mediaType: manifest.source.mediaType,
      sha256: snapshot.hash
    })
  }

  async readManifest(digest: string): Promise<ArisSourcePackageManifestV1> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const snapshot = await this.readMember(arisPackagePaths(sourceSha256).manifest)
    const manifest = parseArisManifest(snapshot.bytes)
    if (!equalHash(manifest.source.sha256, sourceSha256)) {
      throw new ArisPackageError(
        'integrity-failure',
        'The manifest source digest does not match its package directory.',
        snapshot.path
      )
    }
    return manifest
  }

  async readAccounting(digest: string): Promise<ArisAccountingDocumentV2> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const snapshot = await this.readMember(arisPackagePaths(sourceSha256).accounting)
    return parseArisAccounting(snapshot.bytes)
  }

  /** Digests of every package present in the workspace. */
  async listPackages(): Promise<readonly string[]> {
    let entries: readonly WorkspaceEntry[]
    try {
      entries = await this.adapter.list(ARIS_PACKAGE_NAMESPACE)
    } catch {
      return Object.freeze([])
    }
    const digests = new Set<string>()
    for (const entry of entries) {
      const digest = arisPackageDigestFromPath(entry.path)
      if (digest) digests.add(digest)
    }
    return Object.freeze([...digests].sort())
  }

  async readRevisionState(digest: string): Promise<ArisRevisionState> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const paths = arisPackagePaths(sourceSha256)
    const current = parseArisCurrentRevision((await this.readMember(paths.currentRevision)).bytes)
    const patches: ArisRevisionPatchV1[] = []
    for (const entry of current.revisions) {
      const snapshot = await this.readMember(arisRevisionPath(sourceSha256, entry.revisionId))
      const patch = parseArisRevision(snapshot.bytes)
      if (patch.commandsSha256 !== entry.commandsSha256) {
        throw new ArisPackageError(
          'integrity-failure',
          `Revision "${entry.revisionId}" content does not match the ledger.`,
          snapshot.path
        )
      }
      patches.push(patch)
    }
    return Object.freeze({ current, patches: Object.freeze(patches) })
  }

  async replayRevisions(digest: string): Promise<ArisRevisionReplay> {
    const state = await this.readRevisionState(digest)
    return replayArisRevisions(state.patches)
  }

  /**
   * Save an edit. This writes a new immutable revision patch, advances the
   * current-revision pointer and re-points the manifest; it never writes the
   * original source.
   */
  saveRevision(
    digest: string,
    commands: readonly ArisRevisionCommand[]
  ): Promise<ArisRevisionPatchV1> {
    return this.applyRevision(digest, (sourceSha256, current) =>
      createArisRevision({
        sourceSha256,
        ordinal: current.ordinal + 1,
        parentRevisionId: current.currentRevisionId,
        kind: 'edit',
        commands
      })
    )
  }

  /** Append a restore revision that returns the model to an earlier state. */
  restoreRevision(digest: string, targetRevisionId: string): Promise<ArisRevisionPatchV1> {
    return this.applyRevision(digest, (_sourceSha256, current) =>
      createArisRestoreRevision(current, targetRevisionId)
    )
  }

  /**
   * Append one revision and keep the manifest pointer consistent with the
   * working ledger. Every failure path leaves the package exactly as it was:
   * the pointer is written back and the new patch is removed.
   */
  private async applyRevision(
    digest: string,
    build: (
      sourceSha256: string,
      current: ArisCurrentRevisionV1
    ) => Promise<ArisRevisionPatchV1>,
    transformModels: (
      models: readonly ArisSourcePackageManifestV1['models'][number][]
    ) => readonly ArisSourcePackageManifestV1['models'][number][] = (models) => models
  ): Promise<ArisRevisionPatchV1> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const paths = arisPackagePaths(sourceSha256)
    const pointerSnapshot = await this.readMember(paths.currentRevision)
    const current = parseArisCurrentRevision(pointerSnapshot.bytes)
    const manifestSnapshot = await this.readMember(paths.manifest)
    const manifest = parseArisManifest(manifestSnapshot.bytes)

    const patch = await build(sourceSha256, current)
    const next = appendArisRevision(current, patch)
    const patchPath = arisRevisionPath(sourceSha256, patch.revisionId)
    if (await this.hasMember(patchPath)) {
      throw new ArisPackageError(
        'already-exists',
        `Revision "${patch.revisionId}" already exists; revisions are append-only.`,
        patchPath
      )
    }

    const written = await this.createMemberOnce(patchPath, serializeArisRevision(patch))
    let pointerHash: string | undefined
    try {
      const pointer = await this.writeWorkingMember(
        paths.currentRevision,
        serializeArisCurrentRevision(next),
        pointerSnapshot.hash
      )
      pointerHash = pointer.sha256
      await this.writeWorkingMember(
        paths.manifest,
        serializeArisManifest(
          createArisManifest({
            source: manifest.source,
            origin: manifest.origin,
            currentRevisionId: patch.revisionId,
            models: transformModels([...manifest.models]),
            attachments: manifest.attachments,
            references: manifest.references,
            accountingSha256: manifest.accountingSha256,
            fidelity: manifest.fidelity
          })
        ),
        manifestSnapshot.hash
      )
    } catch (error) {
      // Keep the ledger authoritative: a patch whose pointer or manifest update
      // failed is undone so the chain never contains an unreferenced entry.
      if (pointerHash !== undefined) {
        await this.writeWorkingMember(
          paths.currentRevision,
          pointerSnapshot.bytes,
          pointerHash
        ).catch(() => undefined)
      }
      await this.adapter.removeIfHash?.(written.path, written.sha256).catch(() => undefined)
      throw error
    }
    return patch
  }

  /**
   * Remove a model from the package. The manifest loses the entry and a
   * revision records the deletion; `original/source.xml` is untouched (§7.4).
   */
  async deleteModel(digest: string, modelId: string): Promise<ArisSourcePackageManifestV1> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const manifest = await this.readManifest(sourceSha256)
    if (!manifest.models.some((model) => model.modelId === modelId)) {
      throw new ArisPackageError('not-found', `Model "${modelId}" is not part of this package.`)
    }
    await this.applyRevision(
      sourceSha256,
      (source, current) =>
        createArisRevision({
          sourceSha256: source,
          ordinal: current.ordinal + 1,
          parentRevisionId: current.currentRevisionId,
          kind: 'edit',
          commands: [{ type: 'aris.model.delete', payload: { modelId } }]
        }),
      (models) => models.filter((model) => model.modelId !== modelId)
    )
    return this.readManifest(sourceSha256)
  }

  /**
   * Delete a whole source package. This is intentionally separate from model
   * deletion and requires the caller to echo the package digest.
   */
  async deleteSourcePackage(
    digest: string,
    confirmation: ArisPackageDeletionConfirmation
  ): Promise<void> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    if (
      confirmation?.confirmed !== true ||
      !equalHash(confirmation.confirmedSourceSha256 ?? '', sourceSha256)
    ) {
      throw new ArisPackageError(
        'confirmation-required',
        'Deleting a source package requires explicit confirmation of its digest.'
      )
    }
    await this.adapter.remove(arisPackagePaths(sourceSha256).root)
  }

  /**
   * Scan OrbitPM-authored artifacts for credential-shaped content. The original
   * source and user attachments are excluded on purpose: they are preserved
   * byte-for-byte and are never authored by OrbitPM.
   */
  async scanForSecrets(digest: string): Promise<readonly ArisPackageSecretFinding[]> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const paths = arisPackagePaths(sourceSha256)
    const entries = await this.adapter.list(paths.root)
    const findings: ArisPackageSecretFinding[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      if (isArisImmutableMemberPath(entry.path)) continue
      if (entry.path.startsWith(`${paths.attachmentsDirectory}/`)) continue
      if (entry.path.startsWith(`${paths.referencesDirectory}/`)) continue
      const snapshot = await this.readMember(entry.path)
      const text = new TextDecoder('utf-8').decode(snapshot.bytes)
      for (const finding of findSecretLikeMatches(text)) {
        findings.push(Object.freeze({ ...finding, path: entry.path }))
      }
    }
    return Object.freeze(findings)
  }

  /** Verify every digest recorded in the package against its stored bytes. */
  async verifyIntegrity(digest: string): Promise<ArisPackageIntegrityReport> {
    const sourceSha256 = normalizeArisSourceDigest(digest)
    const paths = arisPackagePaths(sourceSha256)
    const problems: string[] = []
    const manifest = await this.readManifest(sourceSha256)

    let originalSha256: string | null = null
    const originalPresent = await this.hasMember(paths.originalSource)
    if (manifest.origin.kind === 'imported-aml') {
      if (!originalPresent) {
        problems.push('The imported original source is missing.')
      } else {
        originalSha256 = (await this.readMember(paths.originalSource)).hash
        if (!equalHash(originalSha256, sourceSha256)) {
          problems.push('The original source bytes no longer match the package digest.')
        }
      }
    } else if (originalPresent) {
      problems.push('A generated package must not contain an imported original source.')
    }

    const accounting = await this.readAccounting(sourceSha256)
    const accountingSha256 = await arisAccountingDigest(accounting)
    const accountingMatches = equalHash(accountingSha256, manifest.accountingSha256)
    if (!accountingMatches) problems.push('The accounting digest does not match the manifest.')
    if (!equalHash(accounting.sourceSha256, sourceSha256)) {
      problems.push('The accounting document belongs to a different source package.')
    }

    const state = await this.readRevisionState(sourceSha256)
    await replayArisRevisions(state.patches)
    if (state.current.currentRevisionId !== manifest.currentRevisionId) {
      problems.push('The manifest current revision does not match the working pointer.')
    }

    const attachmentMismatches: string[] = []
    for (const attachment of manifest.attachments) {
      const path = `${paths.root}/${attachment.path}`
      if (!(await this.hasMember(path))) {
        attachmentMismatches.push(attachment.path)
        continue
      }
      const snapshot = await this.readMember(path)
      if (!equalHash(snapshot.hash, attachment.sha256)) attachmentMismatches.push(attachment.path)
    }
    for (const reference of manifest.references) {
      const path = `${paths.root}/${reference.path}`
      if (!(await this.hasMember(path))) {
        attachmentMismatches.push(reference.path)
        continue
      }
      const snapshot = await this.readMember(path)
      if (!equalHash(snapshot.hash, reference.sha256)) attachmentMismatches.push(reference.path)
    }
    if (attachmentMismatches.length > 0) {
      problems.push(`${attachmentMismatches.length} attachment or reference digests do not match.`)
    }

    return Object.freeze({
      sourceSha256,
      manifest,
      originalPresent,
      originalSha256,
      accountingMatches,
      revisionCount: state.patches.length,
      attachmentMismatches: Object.freeze(attachmentMismatches),
      problems: Object.freeze(problems)
    })
  }
}

/** Convenience helper for callers that only need the original bytes. */
export async function readArisOriginalSourceBytes(
  adapter: WorkspaceAdapter,
  digest: string
): Promise<Uint8Array> {
  const snapshot = await new ArisPackageStore(adapter).readOriginalSource(digest)
  const bytes = copyBytes(snapshot.bytes)
  const recomputed = await sha256Hex(bytes)
  if (!equalHash(recomputed, normalizeArisSourceDigest(digest))) {
    throw new ArisPackageError('integrity-failure', 'Original source bytes failed verification.')
  }
  return bytes
}
