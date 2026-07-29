/**
 * Portable single-file ARIS packages (plan §2.5 single-file browser contract,
 * §17.2 portable mode).
 *
 * Directory and OPFS workspaces store a package as a directory tree. A browser
 * without File System Access has exactly one file, so the same tree is carried
 * inside **one** deterministic container document:
 *
 * ```json
 * {
 *   "format": "orbitpm-aris-portable-package",
 *   "version": 1,
 *   "packages": [
 *     { "sourceSha256": "<digest>",
 *       "members": [ { "path": "original/source.xml", "sha256": "…",
 *                      "byteLength": 510, "base64": "…" } ] }
 *   ]
 * }
 * ```
 *
 * Member paths are package-relative, members are sorted by path and packages by
 * digest, and the whole document is encoded with the canonical JSON writer, so
 * the same packages always produce byte-identical container bytes.
 *
 * Mechanically, a portable session hydrates the container into an in-memory
 * package-directory workspace, runs the *same* planning, commit, revision and
 * immutability code as directory mode, and then writes the whole container back
 * with a single compare-and-set `writeAtomic`. That makes the two-phase commit
 * collapse to "build everything in memory, write once": a failed flush cannot
 * leave a partial package because the file is replaced atomically or not at all.
 */

import { copyBytes, equalHash, sha256Hex } from '../../workspace/adapters/hash'
import { MemoryWorkspaceAdapter } from '../../workspace/adapters/memory'
import type { SaveOutcome, WorkspaceAdapter } from '../../workspace/adapters/types'
import { z } from 'zod'
import { canonicalJsonBytes } from './canonicalJson'
import {
  arisPackageDirectories,
  arisPackagePaths,
  assertArisMemberName,
  normalizeArisSourceDigest,
  sanitizeArisMemberName
} from './layout'
import type { ArisPackageArchive, ArisPackageArchiveMember } from './packageBackup'
import { collectArisPackageArchive, restoreArisPackageArchive } from './packageBackup'
import { assertNoSecretMaterial } from './secrets'
import { ArisPackageError, ArisPackageStore } from './store'

export const ARIS_PORTABLE_FORMAT = 'orbitpm-aris-portable-package'
export const ARIS_PORTABLE_VERSION = 1
export const ARIS_PORTABLE_EXTENSION = '.orbitpm-aris.json'

export interface ArisPortableMember {
  /** Package-relative path, e.g. `original/source.xml`. */
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  /** Standard base64 of the exact member bytes. */
  readonly base64: string
}

export interface ArisPortablePackageEntry {
  readonly sourceSha256: string
  readonly members: readonly ArisPortableMember[]
}

export interface ArisPortableContainerV1 {
  readonly format: typeof ARIS_PORTABLE_FORMAT
  readonly version: typeof ARIS_PORTABLE_VERSION
  readonly packages: readonly ArisPortablePackageEntry[]
}

export type ArisPortableErrorCode =
  | 'invalid-json'
  | 'schema'
  | 'digest-mismatch'
  | 'not-a-container'
  | 'unsupported-workspace'
  | 'limit-exceeded'
  | 'not-found'
  | 'write-failed'
  | 'unsafe-default-target'

export class ArisPortableError extends Error {
  readonly code: ArisPortableErrorCode
  readonly issues: readonly string[]

  constructor(code: ArisPortableErrorCode, message: string, issues: readonly string[] = []) {
    super(message)
    this.name = 'ArisPortableError'
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

export interface ArisPortableLimits {
  readonly maxPackages?: number
  readonly maxMembers?: number
  readonly maxContainerBytes?: number
}

export const DEFAULT_ARIS_PORTABLE_LIMITS = Object.freeze({
  maxPackages: 500,
  maxMembers: 100_000,
  maxContainerBytes: 512 * 1024 * 1024
})

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Dependency-free base64 so the encoding is identical in every runtime. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    out += BASE64_ALPHABET[first >> 2]
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    out +=
      second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    out += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return out
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(text) || text.length % 4 !== 0) {
    throw new ArisPortableError('schema', 'A portable member payload is not valid base64.')
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array(new ArrayBuffer((text.length / 4) * 3 - padding))
  let offset = 0
  for (let index = 0; index < text.length; index += 4) {
    const chunk =
      (BASE64_ALPHABET.indexOf(text[index] as string) << 18) |
      (BASE64_ALPHABET.indexOf(text[index + 1] as string) << 12) |
      ((text[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(text[index + 2] as string)) << 6) |
      (text[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(text[index + 3] as string))
    if (offset < bytes.length) bytes[offset++] = (chunk >> 16) & 0xff
    if (offset < bytes.length) bytes[offset++] = (chunk >> 8) & 0xff
    if (offset < bytes.length) bytes[offset++] = chunk & 0xff
  }
  return bytes
}

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u)

const memberSchema = z.strictObject({
  path: z.string().min(1).max(2048),
  sha256: SHA256,
  byteLength: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  base64: z.string().max(1_000_000_000)
})

export const arisPortableContainerSchema = z
  .strictObject({
    format: z.literal(ARIS_PORTABLE_FORMAT),
    version: z.literal(ARIS_PORTABLE_VERSION),
    packages: z.array(
      z
        .strictObject({
          sourceSha256: SHA256,
          members: z.array(memberSchema).min(1)
        })
        .refine((value) => {
          const paths = value.members.map((member) => member.path)
          return (
            new Set(paths).size === paths.length &&
            paths.every((path, index) => index === 0 || (paths[index - 1] as string) < path)
          )
        }, 'Portable members must have unique paths in ascending order.')
    )
  })
  .refine((value) => {
    const digests = value.packages.map((entry) => entry.sourceSha256)
    return (
      new Set(digests).size === digests.length &&
      digests.every((digest, index) => index === 0 || (digests[index - 1] as string) < digest)
    )
  }, 'Portable packages must have unique digests in ascending order.')

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function resolvedLimits(input: ArisPortableLimits = {}): Required<ArisPortableLimits> {
  return { ...DEFAULT_ARIS_PORTABLE_LIMITS, ...input }
}

export const EMPTY_ARIS_PORTABLE_CONTAINER: ArisPortableContainerV1 = Object.freeze({
  format: ARIS_PORTABLE_FORMAT,
  version: ARIS_PORTABLE_VERSION,
  packages: Object.freeze([])
})

export function arisPackageArchiveToPortable(
  archive: ArisPackageArchive
): ArisPortablePackageEntry {
  return Object.freeze({
    sourceSha256: normalizeArisSourceDigest(archive.sourceSha256),
    members: Object.freeze(
      [...archive.members]
        .sort((left, right) => compare(left.path, right.path))
        .map((member) =>
          Object.freeze({
            path: member.path,
            sha256: member.sha256,
            byteLength: member.byteLength,
            base64: bytesToBase64(member.bytes)
          })
        )
    )
  })
}

export function arisPortableToPackageArchive(entry: ArisPortablePackageEntry): ArisPackageArchive {
  const members: ArisPackageArchiveMember[] = entry.members.map((member) => {
    const bytes = base64ToBytes(member.base64)
    if (bytes.byteLength !== member.byteLength) {
      throw new ArisPortableError(
        'digest-mismatch',
        `Portable member "${member.path}" has a declared length that does not match its payload.`
      )
    }
    return Object.freeze({
      path: member.path,
      sha256: member.sha256,
      byteLength: member.byteLength,
      bytes
    })
  })
  const directories = new Set<string>()
  for (const member of members) {
    const segments = member.path.split('/')
    let current = ''
    for (const segment of segments.slice(0, -1)) {
      current = current ? `${current}/${segment}` : segment
      directories.add(current)
    }
  }
  return Object.freeze({
    format: 'orbitpm-aris-package-archive',
    version: 1,
    sourceSha256: entry.sourceSha256,
    members: Object.freeze(members),
    directories: Object.freeze([...directories].sort())
  })
}

/** Add a package, keeping an already-present identical digest untouched (§7.3 step 11). */
export function upsertArisPortablePackage(
  container: ArisPortableContainerV1,
  entry: ArisPortablePackageEntry
): ArisPortableContainerV1 {
  if (container.packages.some((existing) => existing.sourceSha256 === entry.sourceSha256)) {
    return container
  }
  return Object.freeze({
    format: ARIS_PORTABLE_FORMAT,
    version: ARIS_PORTABLE_VERSION,
    packages: Object.freeze(
      [...container.packages, entry].sort((left, right) =>
        compare(left.sourceSha256, right.sourceSha256)
      )
    )
  })
}

export function removeArisPortablePackage(
  container: ArisPortableContainerV1,
  digest: string
): ArisPortableContainerV1 {
  const sourceSha256 = normalizeArisSourceDigest(digest)
  return Object.freeze({
    format: ARIS_PORTABLE_FORMAT,
    version: ARIS_PORTABLE_VERSION,
    packages: Object.freeze(
      container.packages.filter((entry) => entry.sourceSha256 !== sourceSha256)
    )
  })
}

/** Members OrbitPM authors itself; retained content is preserved verbatim. */
function isAuthoredMember(path: string): boolean {
  return (
    !path.startsWith('original/') &&
    !path.startsWith('attachments/') &&
    !path.startsWith('references/')
  )
}

export async function validateArisPortableContainer(
  value: unknown,
  limits: ArisPortableLimits = {}
): Promise<ArisPortableContainerV1> {
  const resolved = resolvedLimits(limits)
  const result = arisPortableContainerSchema.safeParse(value)
  if (!result.success) {
    throw new ArisPortableError(
      'schema',
      'The portable ARIS package container is invalid.',
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    )
  }
  const container = result.data as ArisPortableContainerV1
  if (container.packages.length > resolved.maxPackages) {
    throw new ArisPortableError('limit-exceeded', 'The container holds too many packages.')
  }
  let members = 0
  for (const entry of container.packages) {
    members += entry.members.length
    if (members > resolved.maxMembers) {
      throw new ArisPortableError('limit-exceeded', 'The container holds too many members.')
    }
    for (const member of entry.members) {
      const segments = member.path.split('/')
      if (segments.some((segment) => segment.length === 0)) {
        throw new ArisPortableError('schema', `Member path "${member.path}" is malformed.`)
      }
      for (const segment of segments) assertArisMemberName(segment)
      const bytes = base64ToBytes(member.base64)
      const digest = await sha256Hex(bytes)
      if (!equalHash(digest, member.sha256) || bytes.byteLength !== member.byteLength) {
        throw new ArisPortableError(
          'digest-mismatch',
          `Portable member "${member.path}" failed digest verification.`
        )
      }
      if (isAuthoredMember(member.path)) {
        assertNoSecretMaterial(member.path, new TextDecoder('utf-8').decode(bytes))
      }
    }
  }
  return container
}

export function serializeArisPortableContainer(
  container: ArisPortableContainerV1
): Uint8Array<ArrayBuffer> {
  return canonicalJsonBytes({
    format: container.format,
    version: container.version,
    packages: [...container.packages]
      .sort((left, right) => compare(left.sourceSha256, right.sourceSha256))
      .map((entry) => ({
        sourceSha256: entry.sourceSha256,
        members: [...entry.members]
          .sort((left, right) => compare(left.path, right.path))
          .map((member) => ({
            path: member.path,
            sha256: member.sha256,
            byteLength: member.byteLength,
            base64: member.base64
          }))
      }))
  })
}

export async function parseArisPortableContainer(
  input: Uint8Array | string,
  limits: ArisPortableLimits = {}
): Promise<ArisPortableContainerV1> {
  const resolved = resolvedLimits(limits)
  if (typeof input !== 'string' && input.byteLength > resolved.maxContainerBytes) {
    throw new ArisPortableError('limit-exceeded', 'The portable container exceeds the byte limit.')
  }
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ArisPortableError('invalid-json', 'The portable container is not valid JSON.', [
      error instanceof Error ? error.message : String(error)
    ])
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { format?: unknown }).format !== ARIS_PORTABLE_FORMAT
  ) {
    throw new ArisPortableError(
      'not-a-container',
      'This file is not an OrbitPM portable ARIS package container.'
    )
  }
  return validateArisPortableContainer(parsed, limits)
}

export function looksLikeArisPortableContainer(input: Uint8Array | string): boolean {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  return text.includes(`"${ARIS_PORTABLE_FORMAT}"`)
}

/** Suggested portable file name for a source document. */
export function arisPortableFileName(sourceName: string): string {
  const safe = sanitizeArisMemberName(sourceName)
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  return sanitizeArisMemberName(`${stem}${ARIS_PORTABLE_EXTENSION}`)
}

/** Build a container from every package stored in a package-directory workspace. */
export async function collectArisPortableContainer(
  adapter: WorkspaceAdapter,
  digests?: readonly string[]
): Promise<ArisPortableContainerV1> {
  const store = new ArisPackageStore(adapter)
  const selected = digests ?? (await store.listPackages())
  let container = EMPTY_ARIS_PORTABLE_CONTAINER
  for (const digest of [...selected].sort()) {
    const archive = await collectArisPackageArchive(adapter, digest)
    container = upsertArisPortablePackage(container, arisPackageArchiveToPortable(archive))
  }
  return container
}

/** Materialize a container as an in-memory package-directory workspace. */
export function hydrateArisPortableContainer(
  container: ArisPortableContainerV1,
  workspaceId = 'aris-portable'
): MemoryWorkspaceAdapter {
  const folders: string[] = []
  const files: Array<{ path: string; bytes: Uint8Array }> = []
  for (const entry of container.packages) {
    const root = arisPackagePaths(entry.sourceSha256).root
    folders.push(...arisPackageDirectories(entry.sourceSha256))
    for (const member of entry.members) {
      files.push({ path: `${root}/${member.path}`, bytes: base64ToBytes(member.base64) })
    }
  }
  return new MemoryWorkspaceAdapter({
    id: workspaceId,
    folders: [...new Set(folders)],
    files,
    now: () => 0
  })
}

export type ArisWorkspaceKind = 'package-directory' | 'portable-single-file' | 'unsupported'

/**
 * Directory APIs are an enhancement, not a requirement (§2.5). A workspace that
 * can host the directory tree uses it; a single-file workspace uses the
 * portable container; anything else is genuinely unable to store a package.
 */
export function classifyArisWorkspace(adapter: WorkspaceAdapter): ArisWorkspaceKind {
  const capabilities = adapter.storage.capabilities
  if (
    capabilities.multipleFiles &&
    capabilities.directories &&
    capabilities.remove &&
    typeof adapter.createFolderIfMissing === 'function' &&
    typeof adapter.removeIfHash === 'function' &&
    typeof adapter.removeEmptyFolder === 'function'
  ) {
    return 'package-directory'
  }
  if (adapter.mode === 'single-file' || !capabilities.multipleFiles) return 'portable-single-file'
  return 'unsupported'
}

export type ArisPortableFlushResult =
  | {
      readonly status: 'flushed'
      readonly sha256: string
      readonly byteLength: number
      readonly disposition: 'workspace' | 'download'
    }
  | { readonly status: 'unchanged'; readonly sha256: string }
  | { readonly status: 'failed'; readonly message: string }

export interface OpenArisPortableWorkspaceOptions {
  /**
   * Container file path. Defaults to the workspace's only file — but see the
   * `initialize` warning below: that default is only safe when the file
   * already *is* a portable container.
   */
  readonly path?: string
  /**
   * Treat a non-container file at `path` as an empty container instead of
   * failing. The caller must have decided that the file may be replaced.
   *
   * **A non-empty file at an auto-selected `path` is refused.** Without an
   * explicit `path`, the only candidate is the workspace's single file — in
   * this application that is typically the AML the user just opened.
   * Combining `initialize: true` with the auto-selected path would silently
   * repurpose that file as an empty container, and a later `flush()` would
   * overwrite the user's source export with a JSON container (§1.2, §7.4). An
   * auto-selected path is only accepted for `initialize` when its file is
   * already empty (a target the caller purpose-built for a new container, not
   * existing content). To open a new portable container for a workspace whose
   * only file has real content, pass an explicit sibling `path` — see
   * `arisPortableFileName()`.
   */
  readonly initialize?: boolean
  readonly limits?: ArisPortableLimits
}

/**
 * A portable session. Package operations run against `workspace` — the very
 * same code paths, guarantees and tests as directory mode — and `flush()`
 * writes the whole container back in one compare-and-set write.
 *
 * `workspace` and `store` are getters: after a failed flush the session
 * re-hydrates from the last committed container, so callers must read them at
 * the point of use rather than caching them across a flush.
 */
export class ArisPortableWorkspaceSession {
  readonly kind = 'portable-single-file' as const
  readonly path: string

  private readonly adapter: WorkspaceAdapter
  private readonly limits: ArisPortableLimits
  private readonly workspaceId: string
  private memory: MemoryWorkspaceAdapter
  private committed: ArisPortableContainerV1
  private committedHash: string | undefined

  private constructor(
    adapter: WorkspaceAdapter,
    path: string,
    container: ArisPortableContainerV1,
    committedHash: string | undefined,
    limits: ArisPortableLimits
  ) {
    this.adapter = adapter
    this.path = path
    this.limits = limits
    this.workspaceId = `portable:${adapter.id}:${path}`
    this.committed = container
    this.committedHash = committedHash
    this.memory = hydrateArisPortableContainer(container, this.workspaceId)
  }

  static async open(
    adapter: WorkspaceAdapter,
    options: OpenArisPortableWorkspaceOptions = {}
  ): Promise<ArisPortableWorkspaceSession> {
    const limits = options.limits ?? {}
    let path = options.path
    // The path is only "auto-selected" when the caller did not name one
    // explicitly. Auto-selection picks the workspace's one file, which in this
    // application is typically the AML the user just opened — see the
    // `unsafe-default-target` guard below.
    const autoSelected = !path
    if (!path) {
      const entries = await adapter.list('')
      const file = entries.find((entry) => entry.kind === 'file')
      if (!file) {
        throw new ArisPortableError(
          'not-found',
          'A portable workspace needs a container file to read or replace.'
        )
      }
      path = file.path
    }

    let container = EMPTY_ARIS_PORTABLE_CONTAINER
    let committedHash: string | undefined
    try {
      const snapshot = await adapter.read(path)
      committedHash = snapshot.hash
      if (looksLikeArisPortableContainer(snapshot.bytes)) {
        container = await parseArisPortableContainer(snapshot.bytes, limits)
      } else if (!options.initialize) {
        throw new ArisPortableError(
          'not-a-container',
          `"${path}" is not an OrbitPM portable ARIS package container.`
        )
      } else if (autoSelected && snapshot.bytes.byteLength > 0) {
        // Refuse the dangerous default: `initialize` on an auto-selected path
        // with real content would repurpose the workspace's only file — which
        // in this application is typically the AML the user just opened — as
        // an empty container, and a later `flush()` would silently overwrite
        // it. An auto-selected *empty* file is fine: it has no source content
        // to lose, and is exactly the shape a caller gets from purpose-building
        // a fresh single-file adapter for a new container. Anything else must
        // name its target explicitly.
        throw new ArisPortableError(
          'unsafe-default-target',
          `Refusing to initialize a portable container at the auto-selected path "${path}". ` +
            "That path is the workspace's only file, has existing content, and may be the " +
            'source the user opened; initializing it here would let a later flush() silently ' +
            'overwrite it. Pass an explicit `path` (see `arisPortableFileName()`) to open a new container.'
        )
      }
    } catch (error) {
      if (error instanceof ArisPortableError && error.code !== 'not-found') throw error
      // A missing file is a brand-new portable package.
      committedHash = undefined
    }
    return new ArisPortableWorkspaceSession(adapter, path, container, committedHash, limits)
  }

  /** Package-directory view used for planning, commits, saves and reads. */
  get workspace(): WorkspaceAdapter {
    return this.memory
  }

  get store(): ArisPackageStore {
    return new ArisPackageStore(this.memory)
  }

  get container(): ArisPortableContainerV1 {
    return this.committed
  }

  /** True when the in-memory tree differs from the last committed container. */
  async isDirty(): Promise<boolean> {
    const next = await collectArisPortableContainer(this.memory)
    return (
      new TextDecoder().decode(serializeArisPortableContainer(next)) !==
      new TextDecoder().decode(serializeArisPortableContainer(this.committed))
    )
  }

  /**
   * Serialize every package and replace the container file in one atomic write.
   * On failure the file keeps its previous bytes and the session is restored to
   * the last committed container, so no partial package can ever be observed.
   */
  async flush(): Promise<ArisPortableFlushResult> {
    const next = await collectArisPortableContainer(this.memory)
    const bytes = serializeArisPortableContainer(next)
    const digest = await sha256Hex(bytes)
    if (this.committedHash !== undefined && equalHash(digest, this.committedHash)) {
      return Object.freeze({ status: 'unchanged', sha256: digest })
    }

    let outcome: SaveOutcome
    try {
      outcome = await this.adapter.writeAtomic(this.path, bytes, this.committedHash)
    } catch (error) {
      return this.rollback(error instanceof Error ? error.message : String(error))
    }
    if (!outcome.ok) {
      return this.rollback(describeFailure(outcome))
    }

    this.committed = next
    this.committedHash = outcome.snapshot.hash
    return Object.freeze({
      status: 'flushed',
      sha256: outcome.snapshot.hash,
      byteLength: bytes.byteLength,
      disposition: outcome.disposition
    })
  }

  /** Discard uncommitted in-memory work and return to the committed container. */
  revert(): void {
    this.memory = hydrateArisPortableContainer(this.committed, this.workspaceId)
  }

  private rollback(message: string): ArisPortableFlushResult {
    this.revert()
    return Object.freeze({ status: 'failed', message })
  }
}

function describeFailure(outcome: Exclude<SaveOutcome, { ok: true }>): string {
  if (outcome.status === 'external-conflict') {
    return `The portable container changed outside OrbitPM (${outcome.reason}).`
  }
  if (outcome.status === 'stale-workspace') {
    return `The portable container belongs to workspace "${outcome.actualWorkspaceId}".`
  }
  return outcome.error.message
}

export interface ArisWorkspaceSession {
  readonly kind: 'package-directory' | 'portable-single-file'
  readonly workspace: WorkspaceAdapter
  readonly store: ArisPackageStore
  flush(): Promise<ArisPortableFlushResult>
}

/**
 * One entry point for both storage shapes. Callers plan and commit against
 * `session.workspace` and then call `session.flush()`; in directory mode the
 * flush is a no-op because every member was already written durably.
 */
export async function openArisWorkspace(
  adapter: WorkspaceAdapter,
  options: OpenArisPortableWorkspaceOptions = {}
): Promise<ArisWorkspaceSession> {
  const kind = classifyArisWorkspace(adapter)
  if (kind === 'package-directory') {
    const store = new ArisPackageStore(adapter)
    return Object.freeze({
      kind,
      workspace: adapter,
      store,
      flush: async () => Object.freeze({ status: 'unchanged' as const, sha256: '' })
    })
  }
  if (kind === 'portable-single-file') {
    return ArisPortableWorkspaceSession.open(adapter, options)
  }
  throw new ArisPortableError(
    'unsupported-workspace',
    'This workspace can neither host a package directory nor a portable container.'
  )
}

/** Import a portable container's packages into a package-directory workspace. */
export async function importArisPortableContainer(
  adapter: WorkspaceAdapter,
  container: ArisPortableContainerV1
): Promise<readonly string[]> {
  const restored: string[] = []
  for (const entry of container.packages) {
    const outcome = await restoreArisPackageArchive(adapter, arisPortableToPackageArchive(entry))
    if (outcome.status !== 'restored') {
      throw new ArisPackageError(
        'integrity-failure',
        `Restoring portable package "${entry.sourceSha256}" failed: ${outcome.error.message}`
      )
    }
    restored.push(entry.sourceSha256)
  }
  return Object.freeze(restored)
}

/** Read the exact original bytes of one package straight out of a container. */
export function readArisPortableOriginal(
  container: ArisPortableContainerV1,
  digest: string
): Uint8Array<ArrayBuffer> {
  const sourceSha256 = normalizeArisSourceDigest(digest)
  const entry = container.packages.find((value) => value.sourceSha256 === sourceSha256)
  const member = entry?.members.find((value) => value.path === 'original/source.xml')
  if (!member) {
    throw new ArisPortableError(
      'not-found',
      `The container holds no imported original for "${sourceSha256}".`
    )
  }
  return copyBytes(base64ToBytes(member.base64))
}
