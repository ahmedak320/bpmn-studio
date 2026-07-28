/**
 * `accounting.v2.json` — the source accounting document (plan §7.1/§10).
 *
 * Phase 4 owns the *container*: a deterministic, validated, digestible document
 * whose SHA-256 is recorded in the manifest, plus the fidelity summary derived
 * from it. Phase 7 fills it with a complete census of AML records; until then
 * this module is a faithful but deliberately small stub — it validates and
 * serializes whatever entries a producer supplies and never invents any.
 */

import { z } from 'zod'
import { canonicalJsonBytes } from './canonicalJson'
import type { ArisFidelityIssue, ArisFidelitySummary } from './manifest'
import { ARIS_FIDELITY_ISSUE_CODES } from './manifest'
import { sha256Hex } from '../../workspace/adapters/hash'

export const ARIS_ACCOUNTING_FORMAT = 'orbitpm-aris-accounting'
export const ARIS_ACCOUNTING_VERSION = 2

export const ARIS_ACCOUNTING_DISPOSITIONS = Object.freeze([
  'editable-native',
  'visual-only',
  'side-panel',
  'attachment',
  'raw-source-only',
  'proposed-repair',
  'unsupported'
] as const)

export type ArisAccountingDisposition = (typeof ARIS_ACCOUNTING_DISPOSITIONS)[number]

export interface ArisAccountingEntry {
  /** Lexical location of the record inside the imported source. Unique. */
  readonly sourcePath: string
  readonly sourceId?: string
  /** Source entity kind. Phase 7 narrows this to `ArisEntityKind`. */
  readonly kind: string
  readonly disposition: ArisAccountingDisposition
  readonly targetIds: readonly string[]
  readonly reason?: string
}

export type ArisAccountingTotals = Readonly<Record<ArisAccountingDisposition, number>> & {
  readonly total: number
}

export interface ArisAccountingDocumentV2 {
  readonly format: typeof ARIS_ACCOUNTING_FORMAT
  readonly version: typeof ARIS_ACCOUNTING_VERSION
  readonly sourceSha256: string
  /** Independent lexical record count; `total` may not exceed it (§10.3). */
  readonly censusRecords: number
  readonly entries: readonly ArisAccountingEntry[]
  readonly totals: ArisAccountingTotals
}

const TEXT = z.string().max(4096)
const COUNT = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

const entrySchema = z.strictObject({
  sourcePath: TEXT.min(1),
  sourceId: TEXT.min(1).optional(),
  kind: TEXT.min(1),
  disposition: z.enum(ARIS_ACCOUNTING_DISPOSITIONS),
  targetIds: z.array(TEXT.min(1)).max(10_000),
  reason: TEXT.optional()
})

export const arisAccountingDocumentSchema = z
  .strictObject({
    format: z.literal(ARIS_ACCOUNTING_FORMAT),
    version: z.literal(ARIS_ACCOUNTING_VERSION),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    censusRecords: COUNT,
    entries: z.array(entrySchema).max(2_000_000),
    totals: z.strictObject({
      'editable-native': COUNT,
      'visual-only': COUNT,
      'side-panel': COUNT,
      attachment: COUNT,
      'raw-source-only': COUNT,
      'proposed-repair': COUNT,
      unsupported: COUNT,
      total: COUNT
    })
  })
  .refine((value) => {
    const paths = value.entries.map((entry) => entry.sourcePath)
    return (
      new Set(paths).size === paths.length &&
      paths.every((path, index) => index === 0 || (paths[index - 1] as string) < path)
    )
  }, 'Accounting entries must have unique source paths in ascending order.')
  .refine(
    (value) => value.totals.total === value.entries.length,
    'Accounting totals must match the number of entries.'
  )
  .refine((value) => {
    const recomputed = countDispositions(value.entries as readonly ArisAccountingEntry[])
    return ARIS_ACCOUNTING_DISPOSITIONS.every(
      (disposition) => value.totals[disposition] === recomputed[disposition]
    )
  }, 'Accounting totals must match the per-disposition entry counts.')
  .refine(
    (value) => value.censusRecords >= value.entries.length,
    'The lexical census cannot be smaller than the number of accounted records.'
  )

export class ArisAccountingError extends Error {
  readonly issues: readonly string[]

  constructor(message: string, issues: readonly string[] = []) {
    super(message)
    this.name = 'ArisAccountingError'
    this.issues = Object.freeze([...issues])
  }
}

function countDispositions(
  entries: readonly ArisAccountingEntry[]
): Record<ArisAccountingDisposition, number> {
  const counts = Object.fromEntries(
    ARIS_ACCOUNTING_DISPOSITIONS.map((disposition) => [disposition, 0])
  ) as Record<ArisAccountingDisposition, number>
  for (const entry of entries) counts[entry.disposition] += 1
  return counts
}

export interface CreateArisAccountingInput {
  readonly sourceSha256: string
  readonly entries?: readonly ArisAccountingEntry[]
  /** Independent lexical census; defaults to the number of supplied entries. */
  readonly censusRecords?: number
}

export function createArisAccountingDocument(
  input: CreateArisAccountingInput
): ArisAccountingDocumentV2 {
  const entries = [...(input.entries ?? [])].sort((left, right) =>
    left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0
  )
  const counts = countDispositions(entries)
  const candidate = {
    format: ARIS_ACCOUNTING_FORMAT,
    version: ARIS_ACCOUNTING_VERSION,
    sourceSha256: input.sourceSha256,
    censusRecords: input.censusRecords ?? entries.length,
    entries,
    totals: { ...counts, total: entries.length }
  }
  return validateArisAccountingDocument(candidate)
}

export function validateArisAccountingDocument(value: unknown): ArisAccountingDocumentV2 {
  const result = arisAccountingDocumentSchema.safeParse(value)
  if (!result.success) {
    throw new ArisAccountingError(
      'The ARIS source accounting document is invalid.',
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    )
  }
  return Object.freeze(result.data as ArisAccountingDocumentV2)
}

export function serializeArisAccounting(
  document: ArisAccountingDocumentV2
): Uint8Array<ArrayBuffer> {
  return canonicalJsonBytes(validateArisAccountingDocument(document))
}

export function parseArisAccounting(input: Uint8Array | string): ArisAccountingDocumentV2 {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ArisAccountingError('The accounting document is not valid JSON.', [
      error instanceof Error ? error.message : String(error)
    ])
  }
  return validateArisAccountingDocument(parsed)
}

export function arisAccountingDigest(document: ArisAccountingDocumentV2): Promise<string> {
  return sha256Hex(serializeArisAccounting(document))
}

/**
 * Derive the manifest fidelity summary from the accounting document. Records
 * counted by the lexical census but missing an accounting entry are reported as
 * unaccounted rather than dropped (§1.2, §10.3).
 */
export function summarizeArisFidelity(
  document: ArisAccountingDocumentV2,
  issues: readonly ArisFidelityIssue[] = []
): ArisFidelitySummary {
  const counts = countDispositions(document.entries)
  const merged = new Map<string, ArisFidelityIssue>()
  for (const issue of issues) {
    if (!ARIS_FIDELITY_ISSUE_CODES.includes(issue.code)) {
      throw new ArisAccountingError(`Unknown fidelity issue code "${issue.code}".`)
    }
    const existing = merged.get(issue.code)
    merged.set(
      issue.code,
      existing
        ? { ...existing, count: existing.count + issue.count }
        : { ...issue, count: issue.count }
    )
  }
  return Object.freeze({
    totalRecords: document.censusRecords,
    accountedRecords: document.entries.length,
    unaccountedRecords: document.censusRecords - document.entries.length,
    editableNative: counts['editable-native'],
    visualOnly: counts['visual-only'],
    sidePanel: counts['side-panel'],
    attachments: counts.attachment,
    rawSourceOnly: counts['raw-source-only'],
    proposedRepair: counts['proposed-repair'],
    unsupported: counts.unsupported,
    issues: Object.freeze(
      [...merged.values()].sort((left, right) =>
        left.code < right.code ? -1 : left.code > right.code ? 1 : 0
      )
    )
  })
}
