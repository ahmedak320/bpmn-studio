/**
 * Working revisions (plan §7.1 `working/`, §7.4 "save writes working revision
 * commands").
 *
 * `working/current-revision.json` is a pointer plus an append-only ledger.
 * `working/revisions/<revision-id>.patch.json` files are immutable once
 * written: a revision is added, never edited. Editing an imported model can
 * therefore never touch `original/source.xml`.
 *
 * Revision ids are deterministic — SHA-256 over the canonical revision content
 * combined with a monotonic ordinal — so replaying the same edit sequence on
 * another machine produces the same ids. No `Date.now()` or `Math.random()` is
 * involved anywhere in this module.
 */

import { z } from 'zod'
import { sha256Hex } from '../../workspace/adapters/hash'
import { canonicalJsonBytes, canonicalJsonText, type JsonValue } from './canonicalJson'
import { assertArisRevisionId } from './layout'
import { assertNoSecretMaterial } from './secrets'

export const ARIS_REVISION_FORMAT = 'orbitpm-aris-revision'
export const ARIS_REVISION_VERSION = 1
export const ARIS_CURRENT_REVISION_FORMAT = 'orbitpm-aris-current-revision'
export const ARIS_CURRENT_REVISION_VERSION = 1

/** Command applied by a revision. Phase 5 narrows `type` and `payload`. */
export interface ArisRevisionCommand {
  readonly type: string
  readonly payload: JsonValue
}

export type ArisRevisionKind = 'baseline' | 'edit' | 'restore'

export interface ArisRevisionPatchV1 {
  readonly format: typeof ARIS_REVISION_FORMAT
  readonly version: typeof ARIS_REVISION_VERSION
  readonly sourceSha256: string
  readonly revisionId: string
  /** Monotonic counter; revision zero is always the baseline. */
  readonly ordinal: number
  readonly parentRevisionId: string | null
  readonly kind: ArisRevisionKind
  readonly commands: readonly ArisRevisionCommand[]
  readonly commandsSha256: string
  /** Set only for `kind: 'restore'`. */
  readonly restoredFromRevisionId?: string
}

export interface ArisRevisionLedgerEntry {
  readonly revisionId: string
  readonly ordinal: number
  readonly parentRevisionId: string | null
  readonly kind: ArisRevisionKind
  readonly commandsSha256: string
}

export interface ArisCurrentRevisionV1 {
  readonly format: typeof ARIS_CURRENT_REVISION_FORMAT
  readonly version: typeof ARIS_CURRENT_REVISION_VERSION
  readonly sourceSha256: string
  readonly currentRevisionId: string
  readonly ordinal: number
  /** Append-only ledger, ordered by ordinal. */
  readonly revisions: readonly ArisRevisionLedgerEntry[]
}

export const ARIS_RESTORE_COMMAND_TYPE = 'aris.revision.restore'
export const ARIS_BASELINE_COMMAND_TYPE = 'aris.baseline.aml'

export type ArisRevisionErrorCode =
  | 'schema'
  | 'invalid-json'
  | 'revision-collision'
  | 'broken-chain'
  | 'unknown-revision'
  | 'digest-mismatch'
  | 'source-mismatch'

export class ArisRevisionError extends Error {
  readonly code: ArisRevisionErrorCode
  readonly issues: readonly string[]

  constructor(code: ArisRevisionErrorCode, message: string, issues: readonly string[] = []) {
    super(message)
    this.name = 'ArisRevisionError'
    this.code = code
    this.issues = Object.freeze([...issues])
  }
}

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u)
const REVISION_ID = z.string().regex(/^r[0-9]{6}-[0-9a-f]{24}$/u)
const ORDINAL = z.number().int().min(0).max(999_999)
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

const commandSchema = z.strictObject({
  type: z.string().min(1).max(160),
  payload: jsonValueSchema
})

export const arisRevisionPatchSchema = z
  .strictObject({
    format: z.literal(ARIS_REVISION_FORMAT),
    version: z.literal(ARIS_REVISION_VERSION),
    sourceSha256: SHA256,
    revisionId: REVISION_ID,
    ordinal: ORDINAL,
    parentRevisionId: REVISION_ID.nullable(),
    kind: z.enum(['baseline', 'edit', 'restore']),
    commands: z.array(commandSchema).max(100_000),
    commandsSha256: SHA256,
    restoredFromRevisionId: REVISION_ID.optional()
  })
  .refine(
    (value) => (value.ordinal === 0) === (value.parentRevisionId === null),
    'Only revision zero may have a null parent.'
  )
  .refine(
    (value) => (value.ordinal === 0) === (value.kind === 'baseline'),
    'Revision zero must be the baseline and no other revision may be.'
  )
  .refine(
    (value) => (value.kind === 'restore') === (value.restoredFromRevisionId !== undefined),
    'Only a restore revision may name a restored revision.'
  )

export const arisCurrentRevisionSchema = z
  .strictObject({
    format: z.literal(ARIS_CURRENT_REVISION_FORMAT),
    version: z.literal(ARIS_CURRENT_REVISION_VERSION),
    sourceSha256: SHA256,
    currentRevisionId: REVISION_ID,
    ordinal: ORDINAL,
    revisions: z
      .array(
        z.strictObject({
          revisionId: REVISION_ID,
          ordinal: ORDINAL,
          parentRevisionId: REVISION_ID.nullable(),
          kind: z.enum(['baseline', 'edit', 'restore']),
          commandsSha256: SHA256
        })
      )
      .min(1)
      .max(1_000_000)
  })
  .refine(
    (value) => value.revisions.every((entry, index) => entry.ordinal === index),
    'The revision ledger must be contiguous and ordered from zero.'
  )
  .refine((value) => {
    const ids = value.revisions.map((entry) => entry.revisionId)
    return new Set(ids).size === ids.length
  }, 'The revision ledger cannot contain duplicate revision ids.')
  .refine((value) => {
    const last = value.revisions[value.revisions.length - 1]
    return last !== undefined && last.revisionId === value.currentRevisionId
  }, 'The current revision must be the last ledger entry.')
  .refine(
    (value) => value.ordinal === value.revisions.length - 1,
    'The current ordinal must match the ledger length.'
  )
  .refine(
    (value) =>
      value.revisions.every(
        (entry, index) =>
          entry.parentRevisionId ===
          (index === 0 ? null : (value.revisions[index - 1]?.revisionId ?? null))
      ),
    'Each ledger entry must name the previous revision as its parent.'
  )

export function validateArisRevisionPatch(value: unknown): ArisRevisionPatchV1 {
  const result = arisRevisionPatchSchema.safeParse(value)
  if (!result.success) {
    throw new ArisRevisionError(
      'schema',
      'The ARIS revision patch is invalid.',
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    )
  }
  return Object.freeze(result.data as ArisRevisionPatchV1)
}

export function validateArisCurrentRevision(value: unknown): ArisCurrentRevisionV1 {
  const result = arisCurrentRevisionSchema.safeParse(value)
  if (!result.success) {
    throw new ArisRevisionError(
      'schema',
      'The ARIS current-revision pointer is invalid.',
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    )
  }
  return Object.freeze(result.data as ArisCurrentRevisionV1)
}

function canonicalCommands(commands: readonly ArisRevisionCommand[]): JsonValue {
  return commands.map((command) => ({ type: command.type, payload: command.payload }))
}

export function arisRevisionCommandsDigest(
  commands: readonly ArisRevisionCommand[]
): Promise<string> {
  return sha256Hex(canonicalJsonBytes(canonicalCommands(commands)))
}

export interface ArisRevisionIdentityInput {
  readonly sourceSha256: string
  readonly ordinal: number
  readonly parentRevisionId: string | null
  readonly kind: ArisRevisionKind
  readonly commandsSha256: string
  readonly restoredFromRevisionId?: string
}

/**
 * Deterministic revision id: `r<ordinal>-<24 hex>` where the hex is derived from
 * the source digest, the ordinal, the parent and the command digest. Identical
 * content at an identical position always yields an identical id.
 */
export async function computeArisRevisionId(input: ArisRevisionIdentityInput): Promise<string> {
  const digest = await sha256Hex(
    canonicalJsonBytes({
      format: ARIS_REVISION_FORMAT,
      version: ARIS_REVISION_VERSION,
      sourceSha256: input.sourceSha256,
      ordinal: input.ordinal,
      parentRevisionId: input.parentRevisionId,
      kind: input.kind,
      commandsSha256: input.commandsSha256,
      restoredFromRevisionId: input.restoredFromRevisionId ?? null
    })
  )
  return assertArisRevisionId(`r${String(input.ordinal).padStart(6, '0')}-${digest.slice(0, 24)}`)
}

export interface CreateArisRevisionInput {
  readonly sourceSha256: string
  readonly ordinal: number
  readonly parentRevisionId: string | null
  readonly kind: ArisRevisionKind
  readonly commands: readonly ArisRevisionCommand[]
  readonly restoredFromRevisionId?: string
}

export async function createArisRevision(
  input: CreateArisRevisionInput
): Promise<ArisRevisionPatchV1> {
  const commandsSha256 = await arisRevisionCommandsDigest(input.commands)
  const revisionId = await computeArisRevisionId({
    sourceSha256: input.sourceSha256,
    ordinal: input.ordinal,
    parentRevisionId: input.parentRevisionId,
    kind: input.kind,
    commandsSha256,
    ...(input.restoredFromRevisionId !== undefined
      ? { restoredFromRevisionId: input.restoredFromRevisionId }
      : {})
  })
  return validateArisRevisionPatch({
    format: ARIS_REVISION_FORMAT,
    version: ARIS_REVISION_VERSION,
    sourceSha256: input.sourceSha256,
    revisionId,
    ordinal: input.ordinal,
    parentRevisionId: input.parentRevisionId,
    kind: input.kind,
    commands: input.commands.map((command) => ({ type: command.type, payload: command.payload })),
    commandsSha256,
    ...(input.restoredFromRevisionId !== undefined
      ? { restoredFromRevisionId: input.restoredFromRevisionId }
      : {})
  })
}

/** Build revision zero. Imported packages pass no commands; generated ones pass the baseline AML. */
export function createArisBaselineRevision(
  sourceSha256: string,
  commands: readonly ArisRevisionCommand[] = []
): Promise<ArisRevisionPatchV1> {
  return createArisRevision({
    sourceSha256,
    ordinal: 0,
    parentRevisionId: null,
    kind: 'baseline',
    commands
  })
}

export function createArisCurrentRevision(baseline: ArisRevisionPatchV1): ArisCurrentRevisionV1 {
  return validateArisCurrentRevision({
    format: ARIS_CURRENT_REVISION_FORMAT,
    version: ARIS_CURRENT_REVISION_VERSION,
    sourceSha256: baseline.sourceSha256,
    currentRevisionId: baseline.revisionId,
    ordinal: baseline.ordinal,
    revisions: [ledgerEntry(baseline)]
  })
}

function ledgerEntry(patch: ArisRevisionPatchV1): ArisRevisionLedgerEntry {
  return Object.freeze({
    revisionId: patch.revisionId,
    ordinal: patch.ordinal,
    parentRevisionId: patch.parentRevisionId,
    kind: patch.kind,
    commandsSha256: patch.commandsSha256
  })
}

/**
 * Pure ledger append with a collision check. The same revision id may never be
 * reused for different content, and the appended revision must continue the
 * chain exactly.
 */
export function appendArisRevision(
  current: ArisCurrentRevisionV1,
  patch: ArisRevisionPatchV1
): ArisCurrentRevisionV1 {
  if (patch.sourceSha256 !== current.sourceSha256) {
    throw new ArisRevisionError(
      'source-mismatch',
      'A revision cannot be appended to a different source package.'
    )
  }
  const existing = current.revisions.find((entry) => entry.revisionId === patch.revisionId)
  if (existing) {
    throw new ArisRevisionError(
      'revision-collision',
      `Revision id "${patch.revisionId}" already exists in the ledger.`
    )
  }
  if (patch.ordinal !== current.ordinal + 1) {
    throw new ArisRevisionError(
      'broken-chain',
      `Revision ordinal ${patch.ordinal} does not follow ${current.ordinal}.`
    )
  }
  if (patch.parentRevisionId !== current.currentRevisionId) {
    throw new ArisRevisionError(
      'broken-chain',
      'A revision must name the current revision as its parent.'
    )
  }
  return validateArisCurrentRevision({
    format: ARIS_CURRENT_REVISION_FORMAT,
    version: ARIS_CURRENT_REVISION_VERSION,
    sourceSha256: current.sourceSha256,
    currentRevisionId: patch.revisionId,
    ordinal: patch.ordinal,
    revisions: [...current.revisions, ledgerEntry(patch)]
  })
}

export interface ArisRevisionReplay {
  readonly revisionId: string
  readonly ordinal: number
  /** Effective command sequence after replaying every revision from zero. */
  readonly commands: readonly ArisRevisionCommand[]
  /** Effective command sequence at each revision id. */
  readonly statesByRevisionId: ReadonlyMap<string, readonly ArisRevisionCommand[]>
}

/**
 * Replay the whole chain from revision zero, verifying ordinals, parents,
 * source binding and command digests. A `restore` revision resets the effective
 * command sequence to the restored revision's state.
 */
export async function replayArisRevisions(
  patches: readonly ArisRevisionPatchV1[]
): Promise<ArisRevisionReplay> {
  if (patches.length === 0) {
    throw new ArisRevisionError('broken-chain', 'A revision chain must start at revision zero.')
  }
  const ordered = [...patches].sort((left, right) => left.ordinal - right.ordinal)
  const states = new Map<string, readonly ArisRevisionCommand[]>()
  let accumulated: readonly ArisRevisionCommand[] = []
  let parent: string | null = null
  const sourceSha256 = ordered[0]?.sourceSha256 ?? ''

  for (const [index, patch] of ordered.entries()) {
    if (patch.ordinal !== index) {
      throw new ArisRevisionError(
        'broken-chain',
        `Revision "${patch.revisionId}" has ordinal ${patch.ordinal} at position ${index}.`
      )
    }
    if (patch.sourceSha256 !== sourceSha256) {
      throw new ArisRevisionError(
        'source-mismatch',
        `Revision "${patch.revisionId}" belongs to a different source package.`
      )
    }
    if (patch.parentRevisionId !== parent) {
      throw new ArisRevisionError(
        'broken-chain',
        `Revision "${patch.revisionId}" does not continue the chain.`
      )
    }
    const digest = await arisRevisionCommandsDigest(patch.commands)
    if (digest !== patch.commandsSha256) {
      throw new ArisRevisionError(
        'digest-mismatch',
        `Revision "${patch.revisionId}" command digest does not match its content.`
      )
    }
    const expectedId = await computeArisRevisionId({
      sourceSha256: patch.sourceSha256,
      ordinal: patch.ordinal,
      parentRevisionId: patch.parentRevisionId,
      kind: patch.kind,
      commandsSha256: patch.commandsSha256,
      ...(patch.restoredFromRevisionId !== undefined
        ? { restoredFromRevisionId: patch.restoredFromRevisionId }
        : {})
    })
    if (expectedId !== patch.revisionId) {
      throw new ArisRevisionError(
        'digest-mismatch',
        `Revision "${patch.revisionId}" id does not match its deterministic content id.`
      )
    }

    if (patch.kind === 'restore') {
      const target = patch.restoredFromRevisionId ?? ''
      const snapshot = states.get(target)
      if (!snapshot) {
        throw new ArisRevisionError(
          'unknown-revision',
          `Revision "${patch.revisionId}" restores unknown revision "${target}".`
        )
      }
      accumulated = Object.freeze([...snapshot])
    } else {
      accumulated = Object.freeze([...accumulated, ...patch.commands])
    }
    states.set(patch.revisionId, accumulated)
    parent = patch.revisionId
  }

  const last = ordered[ordered.length - 1] as ArisRevisionPatchV1
  return Object.freeze({
    revisionId: last.revisionId,
    ordinal: last.ordinal,
    commands: accumulated,
    statesByRevisionId: states
  })
}

/**
 * Build the revision that restores an earlier state. Restoring never rewrites
 * or deletes history: it appends a new revision that points at the target.
 */
export async function createArisRestoreRevision(
  current: ArisCurrentRevisionV1,
  targetRevisionId: string
): Promise<ArisRevisionPatchV1> {
  if (!current.revisions.some((entry) => entry.revisionId === targetRevisionId)) {
    throw new ArisRevisionError(
      'unknown-revision',
      `Revision "${targetRevisionId}" is not part of this package's ledger.`
    )
  }
  return createArisRevision({
    sourceSha256: current.sourceSha256,
    ordinal: current.ordinal + 1,
    parentRevisionId: current.currentRevisionId,
    kind: 'restore',
    restoredFromRevisionId: targetRevisionId,
    commands: [{ type: ARIS_RESTORE_COMMAND_TYPE, payload: { targetRevisionId } }]
  })
}

/**
 * Command types whose payload is retained source content rather than something
 * OrbitPM authored. Exactly like an imported original, retained content is
 * preserved verbatim and is therefore outside the credential guard; the
 * package-level scanner still reports findings inside it.
 */
const RETAINED_SOURCE_COMMAND_TYPES: ReadonlySet<string> = new Set([ARIS_BASELINE_COMMAND_TYPE])

/** Text used for the credential guard: the whole patch minus retained content. */
function revisionGuardText(patch: ArisRevisionPatchV1): string {
  return canonicalJsonText({
    ...patch,
    commands: patch.commands.map((command) =>
      RETAINED_SOURCE_COMMAND_TYPES.has(command.type) ? { type: command.type } : command
    )
  })
}

export function serializeArisRevision(patch: ArisRevisionPatchV1): Uint8Array<ArrayBuffer> {
  const validated = validateArisRevisionPatch(patch)
  assertNoSecretMaterial(`${validated.revisionId}.patch.json`, revisionGuardText(validated))
  return canonicalJsonBytes(validated)
}

export function parseArisRevision(input: Uint8Array | string): ArisRevisionPatchV1 {
  return validateArisRevisionPatch(parseJson(input, 'revision patch'))
}

export function serializeArisCurrentRevision(
  current: ArisCurrentRevisionV1
): Uint8Array<ArrayBuffer> {
  const validated = validateArisCurrentRevision(current)
  assertNoSecretMaterial('current-revision.json', canonicalJsonText(validated))
  return canonicalJsonBytes(validated)
}

export function parseArisCurrentRevision(input: Uint8Array | string): ArisCurrentRevisionV1 {
  return validateArisCurrentRevision(parseJson(input, 'current-revision pointer'))
}

function parseJson(input: Uint8Array | string, label: string): unknown {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ArisRevisionError('invalid-json', `The ${label} is not valid JSON.`, [
      error instanceof Error ? error.message : String(error)
    ])
  }
}
