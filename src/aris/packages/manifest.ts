/**
 * `manifest.json` — the ARIS source-package manifest (plan §7.2).
 *
 * The interface is the plan's `ArisSourcePackageManifestV1` verbatim, with one
 * documented extension: a generated origin may carry a `generation` block that
 * records provider, model and the outbound-request digest required by §7.5.4.
 * That block is validated to contain no credential material.
 *
 * Serialization is deterministic: object keys are sorted, numbers must be safe
 * integers, non-ASCII is escaped, and collections must already be in their
 * canonical order. The same logical manifest therefore always produces the same
 * bytes, independent of key-insertion order or host locale.
 */

import { z } from 'zod'
import { canonicalJsonBytes, canonicalJsonText } from './canonicalJson'
import { assertArisMemberName, sanitizeArisMemberName } from './layout'
import { assertNoSecretMaterial, containsSecretLikeText } from './secrets'

export const ARIS_MANIFEST_FORMAT = 'orbitpm-aris-source-package'
export const ARIS_MANIFEST_VERSION = 1

export type ArisGeneratedOriginKind = 'description' | 'spreadsheet' | 'pdf' | 'image'

export const ARIS_FIDELITY_ISSUE_CODES = Object.freeze([
  'missing-font',
  'missing-template',
  'unknown-symbol',
  'unsupported-brush-or-pen',
  'unsupported-ole',
  'text-wrap-difference',
  'missing-reference-export',
  'substituted-visual-resource',
  'unsupported-record'
] as const)

export type ArisFidelityIssueCode = (typeof ARIS_FIDELITY_ISSUE_CODES)[number]

export interface ArisFidelityIssue {
  readonly code: ArisFidelityIssueCode
  readonly count: number
  readonly detail?: string
}

export interface ArisFidelitySummary {
  readonly totalRecords: number
  readonly accountedRecords: number
  readonly unaccountedRecords: number
  readonly editableNative: number
  readonly visualOnly: number
  readonly sidePanel: number
  readonly attachments: number
  readonly rawSourceOnly: number
  readonly proposedRepair: number
  readonly unsupported: number
  readonly issues: readonly ArisFidelityIssue[]
}

export interface ArisModelManifestEntry {
  readonly modelId: string
  readonly name: string
  readonly modelType: string
  readonly objectCount: number
  readonly connectionCount: number
  /** Lexical location of the model record inside the imported source. */
  readonly sourcePath: string
}

export interface ArisAttachmentManifestEntry {
  readonly attachmentId: string
  readonly sourceId: string
  /** Sanitized leaf name, exactly as written under `attachments/`. */
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: string
  /** Package-relative path, e.g. `attachments/<source-id>/<safe-name>`. */
  readonly path: string
}

export interface ArisReferenceManifestEntry {
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: string
  readonly path: string
}

/**
 * Provenance for an AI-generated package. The API key is structurally absent:
 * only the provider name, the model name and a digest of the outbound request
 * are retained, and each is rejected if it looks like credential material.
 */
export interface ArisGenerationProvenance {
  readonly provider: string
  readonly model: string
  /** SHA-256 of the exact outbound request body, never its headers. */
  readonly requestSha256: string
  /** Package-relative path of the retained generation source, when kept. */
  readonly retainedSourcePath: string | null
}

export type ArisPackageOrigin =
  | { readonly kind: 'imported-aml' }
  | {
      readonly kind: ArisGeneratedOriginKind
      readonly generation?: ArisGenerationProvenance
    }

export interface ArisSourcePackageManifestV1 {
  readonly format: typeof ARIS_MANIFEST_FORMAT
  readonly version: typeof ARIS_MANIFEST_VERSION
  readonly source: {
    readonly name: string
    readonly mediaType: string
    readonly byteLength: number
    readonly sha256: string
    readonly arisVersion?: string
  }
  readonly origin: ArisPackageOrigin
  readonly currentRevisionId: string
  readonly models: readonly ArisModelManifestEntry[]
  readonly attachments: readonly ArisAttachmentManifestEntry[]
  readonly references: readonly ArisReferenceManifestEntry[]
  readonly accountingSha256: string
  readonly fidelity: ArisFidelitySummary
}

const SHA256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, 'Digests must be 64 lower-case hexadecimal characters.')
const REVISION_ID = z
  .string()
  .regex(/^r[0-9]{6}-[0-9a-f]{24}$/u, 'Revision ids must match r<6 digits>-<24 hex>.')
const COUNT = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const MEDIA_TYPE = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u, 'Invalid media type.')
const CREDENTIAL_FREE = z
  .string()
  .refine((value) => !containsSecretLikeText(value), 'Credential-shaped text is not allowed.')
const SAFE_TEXT = CREDENTIAL_FREE.max(4096)

const SAFE_MEMBER_NAME = z.string().refine((value) => {
  try {
    assertArisMemberName(value)
    return true
  } catch {
    return false
  }
}, 'Package member names must be portable, non-reserved and within the length limit.')

const fidelityIssueSchema = z.strictObject({
  code: z.enum(ARIS_FIDELITY_ISSUE_CODES),
  count: COUNT,
  detail: SAFE_TEXT.optional()
})

const fidelitySummarySchema = z
  .strictObject({
    totalRecords: COUNT,
    accountedRecords: COUNT,
    unaccountedRecords: COUNT,
    editableNative: COUNT,
    visualOnly: COUNT,
    sidePanel: COUNT,
    attachments: COUNT,
    rawSourceOnly: COUNT,
    proposedRepair: COUNT,
    unsupported: COUNT,
    issues: z.array(fidelityIssueSchema).max(1000)
  })
  .refine(
    (value) => value.accountedRecords + value.unaccountedRecords === value.totalRecords,
    'Accounted and unaccounted records must sum to the total record count.'
  )
  .refine((value) => {
    const codes = value.issues.map((issue) => issue.code)
    return new Set(codes).size === codes.length && isSorted(codes)
  }, 'Fidelity issues must be unique and ordered by code.')

const modelEntrySchema = z.strictObject({
  modelId: SAFE_TEXT.min(1).max(512),
  name: SAFE_TEXT.max(1024),
  modelType: SAFE_TEXT.min(1).max(256),
  objectCount: COUNT,
  connectionCount: COUNT,
  sourcePath: SAFE_TEXT.min(1).max(2048)
})

const attachmentEntrySchema = z.strictObject({
  attachmentId: SAFE_TEXT.min(1).max(512),
  sourceId: SAFE_TEXT.min(1).max(512),
  name: SAFE_MEMBER_NAME,
  mediaType: MEDIA_TYPE,
  byteLength: COUNT,
  sha256: SHA256,
  path: SAFE_TEXT.min(1).max(2048)
})

const referenceEntrySchema = z.strictObject({
  name: SAFE_MEMBER_NAME,
  mediaType: MEDIA_TYPE,
  byteLength: COUNT,
  sha256: SHA256,
  path: SAFE_TEXT.min(1).max(2048)
})

const generationSchema = z.strictObject({
  provider: CREDENTIAL_FREE.min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/u),
  model: CREDENTIAL_FREE.min(1)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/-]*$/u),
  requestSha256: SHA256,
  retainedSourcePath: SAFE_TEXT.min(1).max(2048).nullable()
})

const originSchema = z.union([
  z.strictObject({ kind: z.literal('imported-aml') }),
  z.strictObject({
    kind: z.enum(['description', 'spreadsheet', 'pdf', 'image']),
    generation: generationSchema.optional()
  })
])

export const arisSourcePackageManifestSchema = z
  .strictObject({
    format: z.literal(ARIS_MANIFEST_FORMAT),
    version: z.literal(ARIS_MANIFEST_VERSION),
    source: z.strictObject({
      name: SAFE_MEMBER_NAME,
      mediaType: MEDIA_TYPE,
      byteLength: COUNT,
      sha256: SHA256,
      arisVersion: SAFE_TEXT.min(1).max(120).optional()
    }),
    origin: originSchema,
    currentRevisionId: REVISION_ID,
    models: z.array(modelEntrySchema).max(50_000),
    attachments: z.array(attachmentEntrySchema).max(50_000),
    references: z.array(referenceEntrySchema).max(50_000),
    accountingSha256: SHA256,
    fidelity: fidelitySummarySchema
  })
  .refine((value) => {
    const ids = value.models.map((model) => model.modelId)
    return new Set(ids).size === ids.length && isSorted(ids)
  }, 'Manifest models must have unique ids in ascending order.')
  .refine((value) => {
    const paths = value.attachments.map((attachment) => attachment.path)
    return new Set(paths).size === paths.length && isSorted(paths)
  }, 'Manifest attachments must have unique paths in ascending order.')
  .refine((value) => {
    const paths = value.references.map((reference) => reference.path)
    return new Set(paths).size === paths.length && isSorted(paths)
  }, 'Manifest references must have unique paths in ascending order.')

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] as string) < value)
}

export type ArisManifestErrorCode = 'invalid-json' | 'schema' | 'credential-material'

export class ArisManifestError extends Error {
  readonly code: ArisManifestErrorCode
  readonly issues: readonly string[]

  constructor(code: ArisManifestErrorCode, message: string, issues: readonly string[] = []) {
    super(message)
    this.name = 'ArisManifestError'
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface CreateArisManifestInput {
  readonly source: ArisSourcePackageManifestV1['source']
  readonly origin: ArisPackageOrigin
  readonly currentRevisionId: string
  readonly models?: readonly ArisModelManifestEntry[]
  readonly attachments?: readonly ArisAttachmentManifestEntry[]
  readonly references?: readonly ArisReferenceManifestEntry[]
  readonly accountingSha256: string
  readonly fidelity: ArisFidelitySummary
}

/**
 * Build a canonical, validated manifest. Collections are sorted here so that
 * two callers who discovered the same content in different orders still produce
 * byte-identical bytes.
 */
export function createArisManifest(input: CreateArisManifestInput): ArisSourcePackageManifestV1 {
  const candidate = {
    format: ARIS_MANIFEST_FORMAT,
    version: ARIS_MANIFEST_VERSION,
    source: {
      name: sanitizeArisMemberName(input.source.name),
      mediaType: input.source.mediaType,
      byteLength: input.source.byteLength,
      sha256: input.source.sha256,
      ...(input.source.arisVersion !== undefined ? { arisVersion: input.source.arisVersion } : {})
    },
    origin: input.origin,
    currentRevisionId: input.currentRevisionId,
    models: [...(input.models ?? [])].sort((left, right) => compare(left.modelId, right.modelId)),
    attachments: [...(input.attachments ?? [])].sort((left, right) =>
      compare(left.path, right.path)
    ),
    references: [...(input.references ?? [])].sort((left, right) => compare(left.path, right.path)),
    accountingSha256: input.accountingSha256,
    fidelity: {
      ...input.fidelity,
      issues: [...input.fidelity.issues].sort((left, right) => compare(left.code, right.code))
    }
  }
  return validateArisManifest(candidate)
}

/** Strict validation. Rejects unknown keys, malformed values and secrets. */
export function validateArisManifest(value: unknown): ArisSourcePackageManifestV1 {
  const result = arisSourcePackageManifestSchema.safeParse(value)
  if (!result.success) {
    throw new ArisManifestError(
      'schema',
      'The ARIS source-package manifest is invalid.',
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    )
  }
  const manifest = result.data as ArisSourcePackageManifestV1
  assertNoSecretMaterial('manifest.json', canonicalJsonText(manifest))
  return Object.freeze(manifest)
}

/** Deterministic manifest bytes. Identical input always yields identical bytes. */
export function serializeArisManifest(
  manifest: ArisSourcePackageManifestV1
): Uint8Array<ArrayBuffer> {
  return canonicalJsonBytes(validateArisManifest(manifest))
}

export function parseArisManifest(input: Uint8Array | string): ArisSourcePackageManifestV1 {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ArisManifestError('invalid-json', 'The manifest is not valid JSON.', [
      error instanceof Error ? error.message : String(error)
    ])
  }
  return validateArisManifest(parsed)
}
