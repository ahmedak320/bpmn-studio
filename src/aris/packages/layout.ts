/**
 * Physical layout of an OrbitPM ARIS source package (plan §7.1).
 *
 * ```text
 * .orbitpm/aris/<source-sha256>/
 *   original/source.xml
 *   manifest.json
 *   accounting.v2.json
 *   working/current-revision.json
 *   working/revisions/<revision-id>.patch.json
 *   attachments/<source-id>/<safe-name>
 *   references/<safe-name>
 * ```
 *
 * Every path this module returns is validated by the shared workspace path
 * normalizer and is proven to stay inside its own package root. Names that
 * originate from imported source content (attachment names, reference asset
 * names, retained generation-source names) are never used verbatim: they are
 * sanitized into a portable, Windows-safe leaf and then re-asserted.
 */

import { isPathWithin, normalizeWorkspacePath } from '../../workspace/adapters/path'

/** Reserved workspace namespace that stores ARIS source packages. */
export const ARIS_PACKAGE_NAMESPACE = '.orbitpm/aris'

/** Maximum UTF-8 byte length of a single package member name. */
export const ARIS_MEMBER_NAME_MAX_BYTES = 120

export const ARIS_MANIFEST_FILE = 'manifest.json'
export const ARIS_ACCOUNTING_FILE = 'accounting.v2.json'
export const ARIS_ORIGINAL_DIRECTORY = 'original'
export const ARIS_ORIGINAL_SOURCE_FILE = 'source.xml'
export const ARIS_WORKING_DIRECTORY = 'working'
export const ARIS_CURRENT_REVISION_FILE = 'current-revision.json'
export const ARIS_REVISIONS_DIRECTORY = 'revisions'
export const ARIS_ATTACHMENTS_DIRECTORY = 'attachments'
export const ARIS_REFERENCES_DIRECTORY = 'references'

export type ArisPackagePathErrorCode =
  | 'invalid-digest'
  | 'invalid-name'
  | 'reserved-name'
  | 'name-too-long'
  | 'invalid-revision-id'
  | 'escapes-package'
  | 'immutable-member'

export class ArisPackagePathError extends Error {
  readonly code: ArisPackagePathErrorCode

  constructor(code: ArisPackagePathErrorCode, message: string) {
    super(message)
    this.name = 'ArisPackagePathError'
    this.code = code
  }
}

export interface ArisPackagePaths {
  /** `.orbitpm/aris/<digest>` */
  readonly root: string
  readonly originalDirectory: string
  readonly originalSource: string
  readonly manifest: string
  readonly accounting: string
  readonly workingDirectory: string
  readonly currentRevision: string
  readonly revisionsDirectory: string
  readonly attachmentsDirectory: string
  readonly referencesDirectory: string
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u
const REVISION_ID_PATTERN = /^r[0-9]{6}-[0-9a-f]{24}$/u
// C0/C1 controls, DEL, line/paragraph separators, BOM and bidirectional
// override characters. The bidi set matters because it can visually reorder a
// file name in a picker or report.
const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u
const CONTROL_CHARACTERS_GLOBAL = new RegExp(CONTROL_CHARACTERS.source, 'gu')
const ILLEGAL_CHARACTERS = /[<>:"|?*]/u
const ILLEGAL_CHARACTERS_GLOBAL = new RegExp(ILLEGAL_CHARACTERS.source, 'gu')
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9]|lpt[0-9])(?:\.|$)/iu

const utf8 = new TextEncoder()

function utf8Length(value: string): number {
  return utf8.encode(value).byteLength
}

/**
 * 32-bit FNV-1a of the raw input. It is used only to keep sanitized names
 * distinguishable after truncation or replacement; it is never a security or
 * integrity control (package integrity uses SHA-256).
 */
export function memberNameFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index) & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
    hash ^= value.charCodeAt(index) >>> 8
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function trimEdges(value: string): string {
  return value.replace(/^[.\s]+/u, '').replace(/[.\s]+$/u, '')
}

function truncateToBytes(name: string, fingerprint: string): string {
  if (utf8Length(name) <= ARIS_MEMBER_NAME_MAX_BYTES) return name
  const dot = name.lastIndexOf('.')
  let extension = dot > 0 ? name.slice(dot) : ''
  if (utf8Length(extension) > 16) extension = ''
  const suffix = `~${fingerprint}${extension}`
  const budget = ARIS_MEMBER_NAME_MAX_BYTES - utf8Length(suffix)
  const stemSource = dot > 0 ? name.slice(0, dot) : name
  let stem = ''
  let used = 0
  for (const character of stemSource) {
    const size = utf8Length(character)
    if (used + size > budget) break
    stem += character
    used += size
  }
  return `${trimEdges(stem)}${suffix}`
}

/**
 * Normalize an untrusted name into a safe package member leaf.
 *
 * Traversal segments, absolute/UNC/drive prefixes, control and bidi characters,
 * Windows-illegal characters, Windows device names, edge dots/spaces and
 * overlong names are all handled. The function never throws for string input:
 * an unusable name degrades to a deterministic `unnamed-<fingerprint>` leaf.
 */
export function sanitizeArisMemberName(input: string): string {
  if (typeof input !== 'string') {
    throw new ArisPackagePathError('invalid-name', 'A package member name must be a string.')
  }
  const fingerprint = memberNameFingerprint(input)
  const segments = input.normalize('NFC').split(/[\\/]/u)
  const base = segments[segments.length - 1] ?? ''
  let cleaned = base.replace(CONTROL_CHARACTERS_GLOBAL, '').replace(ILLEGAL_CHARACTERS_GLOBAL, '_')
  cleaned = trimEdges(cleaned)
  if (cleaned.length === 0) cleaned = `unnamed-${fingerprint}`
  if (RESERVED_DEVICE_NAME.test(cleaned)) cleaned = `_${cleaned}`
  cleaned = truncateToBytes(cleaned, fingerprint)
  try {
    assertArisMemberName(cleaned)
  } catch {
    // Defence in depth: an input that still fails the strict rule becomes a
    // fully synthetic, deterministic name rather than an unsafe path.
    return `unnamed-${fingerprint}`
  }
  return cleaned
}

/** Strict membership rule. Sanitized names must satisfy it; raw names may not. */
export function assertArisMemberName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ArisPackagePathError(
      'invalid-name',
      'A package member name must be a non-empty string.'
    )
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new ArisPackagePathError(
      'invalid-name',
      `Package member name "${name}" cannot contain a path separator.`
    )
  }
  if (name === '.' || name === '..') {
    throw new ArisPackagePathError('invalid-name', 'Package member names cannot be "." or "..".')
  }
  if (CONTROL_CHARACTERS.test(name)) {
    throw new ArisPackagePathError(
      'invalid-name',
      'Package member names cannot contain control or bidirectional-override characters.'
    )
  }
  if (ILLEGAL_CHARACTERS.test(name)) {
    throw new ArisPackagePathError(
      'invalid-name',
      `Package member name "${name}" contains a character that is illegal on Windows.`
    )
  }
  if (/^[.\s]/u.test(name) || /[.\s]$/u.test(name)) {
    throw new ArisPackagePathError(
      'invalid-name',
      `Package member name "${name}" cannot start or end with a dot or whitespace.`
    )
  }
  if (RESERVED_DEVICE_NAME.test(name)) {
    throw new ArisPackagePathError(
      'reserved-name',
      `Package member name "${name}" is a reserved Windows device name.`
    )
  }
  if (utf8Length(name) > ARIS_MEMBER_NAME_MAX_BYTES) {
    throw new ArisPackagePathError(
      'name-too-long',
      `Package member name exceeds ${ARIS_MEMBER_NAME_MAX_BYTES} UTF-8 bytes.`
    )
  }
  return name
}

/** Accept a mixed-case digest, return the canonical lower-case form. */
export function normalizeArisSourceDigest(digest: string): string {
  if (typeof digest !== 'string') {
    throw new ArisPackagePathError('invalid-digest', 'A source digest must be a string.')
  }
  const normalized = digest.trim().toLowerCase()
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new ArisPackagePathError(
      'invalid-digest',
      'A source digest must be 64 lower-case hexadecimal characters.'
    )
  }
  return normalized
}

export function assertArisRevisionId(revisionId: string): string {
  if (typeof revisionId !== 'string' || !REVISION_ID_PATTERN.test(revisionId)) {
    throw new ArisPackagePathError(
      'invalid-revision-id',
      `Revision id "${String(revisionId)}" must match r<6 digits>-<24 hex>.`
    )
  }
  return revisionId
}

export function arisPackageRoot(digest: string): string {
  return `${ARIS_PACKAGE_NAMESPACE}/${normalizeArisSourceDigest(digest)}`
}

function member(digest: string, ...segments: readonly string[]): string {
  const root = arisPackageRoot(digest)
  for (const segment of segments) assertArisMemberName(segment)
  const path = normalizeWorkspacePath([root, ...segments].join('/'))
  if (!isPathWithin(path, root) || path === root) {
    throw new ArisPackagePathError(
      'escapes-package',
      `Resolved package path "${path}" escapes package root "${root}".`
    )
  }
  return path
}

export function arisPackagePaths(digest: string): ArisPackagePaths {
  const root = arisPackageRoot(digest)
  return Object.freeze({
    root,
    originalDirectory: member(digest, ARIS_ORIGINAL_DIRECTORY),
    originalSource: member(digest, ARIS_ORIGINAL_DIRECTORY, ARIS_ORIGINAL_SOURCE_FILE),
    manifest: member(digest, ARIS_MANIFEST_FILE),
    accounting: member(digest, ARIS_ACCOUNTING_FILE),
    workingDirectory: member(digest, ARIS_WORKING_DIRECTORY),
    currentRevision: member(digest, ARIS_WORKING_DIRECTORY, ARIS_CURRENT_REVISION_FILE),
    revisionsDirectory: member(digest, ARIS_WORKING_DIRECTORY, ARIS_REVISIONS_DIRECTORY),
    attachmentsDirectory: member(digest, ARIS_ATTACHMENTS_DIRECTORY),
    referencesDirectory: member(digest, ARIS_REFERENCES_DIRECTORY)
  })
}

export function arisRevisionPath(digest: string, revisionId: string): string {
  return member(
    digest,
    ARIS_WORKING_DIRECTORY,
    ARIS_REVISIONS_DIRECTORY,
    `${assertArisRevisionId(revisionId)}.patch.json`
  )
}

/** `attachments/<safe source id>/<safe name>`. Both segments are sanitized. */
export function arisAttachmentPath(digest: string, sourceId: string, name: string): string {
  return member(
    digest,
    ARIS_ATTACHMENTS_DIRECTORY,
    sanitizeArisMemberName(sourceId),
    sanitizeArisMemberName(name)
  )
}

export function arisAttachmentDirectory(digest: string, sourceId: string): string {
  return member(digest, ARIS_ATTACHMENTS_DIRECTORY, sanitizeArisMemberName(sourceId))
}

export function arisReferencePath(digest: string, name: string): string {
  return member(digest, ARIS_REFERENCES_DIRECTORY, sanitizeArisMemberName(name))
}

/**
 * A retained generation source (description, workbook, PDF, image) for a
 * package that has no imported AML original. It lives beside `source.xml`
 * inside the immutable `original/` directory and may never take its name.
 */
export function arisGenerationSourcePath(digest: string, name: string): string {
  const safe = sanitizeArisMemberName(name)
  if (safe.toLowerCase() === ARIS_ORIGINAL_SOURCE_FILE) {
    throw new ArisPackagePathError(
      'immutable-member',
      'A retained generation source cannot be named "source.xml".'
    )
  }
  return member(digest, ARIS_ORIGINAL_DIRECTORY, safe)
}

/** Every member of `original/` is write-once. */
export function isArisImmutableMemberPath(path: string): boolean {
  const digest = arisPackageDigestFromPath(path)
  if (!digest) return false
  const normalized = normalizeWorkspacePath(path)
  return isPathWithin(normalized, `${arisPackageRoot(digest)}/${ARIS_ORIGINAL_DIRECTORY}`)
}

export function assertArisMutableMemberPath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  if (isArisImmutableMemberPath(normalized)) {
    throw new ArisPackagePathError(
      'immutable-member',
      `"${normalized}" belongs to the immutable original source and can never be rewritten.`
    )
  }
  return normalized
}

/** Return the owning package digest for any path inside the ARIS namespace. */
export function arisPackageDigestFromPath(path: string): string | null {
  let normalized: string
  try {
    normalized = normalizeWorkspacePath(path, { allowRoot: true })
  } catch {
    return null
  }
  const segments = normalized.split('/')
  if (segments.length < 3) return null
  if (segments[0] !== '.orbitpm' || segments[1] !== 'aris') return null
  try {
    return normalizeArisSourceDigest(segments[2] ?? '')
  } catch {
    return null
  }
}

export function isArisPackagePath(path: string): boolean {
  return arisPackageDigestFromPath(path) !== null
}

/** Directories that must exist before any package member is written. */
export function arisPackageDirectories(digest: string): readonly string[] {
  const paths = arisPackagePaths(digest)
  return Object.freeze([
    '.orbitpm',
    ARIS_PACKAGE_NAMESPACE,
    paths.root,
    paths.originalDirectory,
    paths.workingDirectory,
    paths.revisionsDirectory
  ])
}
