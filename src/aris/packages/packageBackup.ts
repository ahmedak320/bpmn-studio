/**
 * Package-level backup and restore (plan §7.4: "backup/restore includes
 * original, revisions, reports, attachments, and reference assets").
 *
 * The workspace ZIP backup in `src/workspace/adapters/backup.ts` already copies
 * every workspace file, including the reserved `.orbitpm` namespace, and its
 * importer treats non-`.bpmn` files as opaque bytes. An ARIS source package
 * therefore already survives a whole-workspace backup byte-for-byte and that
 * code needs no change.
 *
 * This module adds what the whole-workspace archive cannot express:
 *
 * - a deterministic, digest-verified serialization of a *single* package, for
 *   per-package export/transfer;
 * - a restore that honours write-once semantics — an existing original is never
 *   overwritten, a byte-identical member is a no-op, and a differing member is
 *   a hard failure;
 * - a round-trip verifier used by the exit-gate tests.
 */

import { copyBytes, equalHash, sha256Hex } from '../../workspace/adapters/hash'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'
import {
  writeArisPackageMembersAtomically,
  type AtomicPackageWriteResult
} from './atomicWrite'
import { canonicalJsonBytes } from './canonicalJson'
import {
  arisPackageDirectories,
  arisPackagePaths,
  assertArisMemberName,
  normalizeArisSourceDigest
} from './layout'
import { ArisPackageError, ArisPackageStore } from './store'

export const ARIS_PACKAGE_ARCHIVE_FORMAT = 'orbitpm-aris-package-archive'
export const ARIS_PACKAGE_ARCHIVE_VERSION = 1

export interface ArisPackageArchiveMember {
  /** Package-relative path, e.g. `original/source.xml`. */
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  readonly bytes: Uint8Array
}

export interface ArisPackageArchive {
  readonly format: typeof ARIS_PACKAGE_ARCHIVE_FORMAT
  readonly version: typeof ARIS_PACKAGE_ARCHIVE_VERSION
  readonly sourceSha256: string
  /** Ordered by path so two exports of the same package are identical. */
  readonly members: readonly ArisPackageArchiveMember[]
  readonly directories: readonly string[]
}

/**
 * Read every member of one package. Every file below the package root is
 * included: original, manifest, accounting report, current-revision pointer,
 * all revision patches, attachments and reference assets.
 */
export async function collectArisPackageArchive(
  adapter: WorkspaceAdapter,
  digest: string
): Promise<ArisPackageArchive> {
  const sourceSha256 = normalizeArisSourceDigest(digest)
  const root = arisPackagePaths(sourceSha256).root
  const store = new ArisPackageStore(adapter)
  const entries = await adapter.list(root)
  const members: ArisPackageArchiveMember[] = []
  const directories = new Set<string>()

  for (const entry of entries) {
    const relative = entry.path.slice(root.length + 1)
    if (entry.kind === 'directory') {
      directories.add(relative)
      continue
    }
    const snapshot = await store.readMember(entry.path)
    members.push(
      Object.freeze({
        path: relative,
        sha256: snapshot.hash,
        byteLength: snapshot.size,
        bytes: copyBytes(snapshot.bytes)
      })
    )
  }

  members.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return Object.freeze({
    format: ARIS_PACKAGE_ARCHIVE_FORMAT,
    version: ARIS_PACKAGE_ARCHIVE_VERSION,
    sourceSha256,
    members: Object.freeze(members),
    directories: Object.freeze([...directories].sort())
  })
}

/** Deterministic archive listing (no payload bytes) suitable for hashing. */
export function serializeArisPackageArchiveIndex(
  archive: ArisPackageArchive
): Uint8Array<ArrayBuffer> {
  return canonicalJsonBytes({
    format: archive.format,
    version: archive.version,
    sourceSha256: archive.sourceSha256,
    directories: [...archive.directories].sort(),
    members: [...archive.members]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
      .map((member) => ({
        path: member.path,
        sha256: member.sha256,
        byteLength: member.byteLength
      }))
  })
}

export function arisPackageArchiveDigest(archive: ArisPackageArchive): Promise<string> {
  return sha256Hex(serializeArisPackageArchiveIndex(archive))
}

export type ArisPackageRestoreOutcome =
  | { readonly status: 'restored'; readonly sourceSha256: string; readonly writtenPaths: readonly string[] }
  | (Extract<AtomicPackageWriteResult, { status: 'rolled-back' | 'rollback-failed' }> & {
      readonly sourceSha256: string
    })

/**
 * Restore a package archive into a workspace. Members are created, never
 * overwritten: a byte-identical member already present is skipped, and a
 * conflicting member aborts the restore and rolls back everything created.
 */
export async function restoreArisPackageArchive(
  adapter: WorkspaceAdapter,
  archive: ArisPackageArchive
): Promise<ArisPackageRestoreOutcome> {
  const sourceSha256 = normalizeArisSourceDigest(archive.sourceSha256)
  const root = arisPackagePaths(sourceSha256).root

  for (const member of archive.members) {
    const segments = member.path.split('/')
    if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
      throw new ArisPackageError('integrity-failure', `Archive member "${member.path}" is malformed.`)
    }
    for (const segment of segments) assertArisMemberName(segment)
    const recomputed = await sha256Hex(member.bytes)
    if (!equalHash(recomputed, member.sha256)) {
      throw new ArisPackageError(
        'integrity-failure',
        `Archive member "${member.path}" failed digest verification.`
      )
    }
  }

  const memberDirectories = new Set<string>()
  for (const member of archive.members) {
    const segments = member.path.split('/')
    let current = root
    for (const segment of segments.slice(0, -1)) {
      current = `${current}/${segment}`
      memberDirectories.add(current)
    }
  }
  const directories = [
    ...new Set([
      ...arisPackageDirectories(sourceSha256),
      ...[...memberDirectories].sort()
    ])
  ]

  const result = await writeArisPackageMembersAtomically(adapter, {
    directories,
    members: archive.members.map((member) => ({
      path: `${root}/${member.path}`,
      bytes: member.bytes,
      sha256: member.sha256
    })),
    skipIdentical: true
  })

  if (result.status !== 'committed') return Object.freeze({ ...result, sourceSha256 })
  return Object.freeze({
    status: 'restored',
    sourceSha256,
    writtenPaths: result.writtenPaths
  })
}

export interface ArisPackageRoundTripReport {
  readonly sourceSha256: string
  readonly memberCount: number
  readonly archiveDigest: string
  readonly identical: boolean
  readonly differences: readonly string[]
}

/** Compare two archives of the same package member-by-member. */
export async function compareArisPackageArchives(
  left: ArisPackageArchive,
  right: ArisPackageArchive
): Promise<ArisPackageRoundTripReport> {
  const differences: string[] = []
  if (left.sourceSha256 !== right.sourceSha256) differences.push('source digest')
  const leftByPath = new Map(left.members.map((member) => [member.path, member]))
  const rightByPath = new Map(right.members.map((member) => [member.path, member]))
  for (const [path, member] of leftByPath) {
    const other = rightByPath.get(path)
    if (!other) {
      differences.push(`missing after restore: ${path}`)
      continue
    }
    if (!equalHash(member.sha256, other.sha256)) differences.push(`content changed: ${path}`)
    if (member.byteLength !== other.byteLength) differences.push(`length changed: ${path}`)
  }
  for (const path of rightByPath.keys()) {
    if (!leftByPath.has(path)) differences.push(`unexpected after restore: ${path}`)
  }
  return Object.freeze({
    sourceSha256: left.sourceSha256,
    memberCount: left.members.length,
    archiveDigest: await arisPackageArchiveDigest(left),
    identical: differences.length === 0,
    differences: Object.freeze(differences)
  })
}
