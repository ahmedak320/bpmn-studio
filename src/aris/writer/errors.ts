/**
 * Errors raised by the ARIS AML writer (plan section 9).
 *
 * The writer never throws a bare `Error`: every failure carries a stable machine-readable
 * code so callers (and the export pipeline) can distinguish "the caller asked for something
 * impossible" from "the derived document would be invalid".
 */
export type ArisWriterErrorCode =
  /** A span was out of bounds, inverted, or not an integer pair. */
  | 'invalid-span'
  /** Two edits addressed intersecting byte ranges. Never resolved by last-writer-wins. */
  | 'overlapping-edits'
  /** A value contained a character that XML 1.0 cannot represent (or a lone surrogate). */
  | 'invalid-character'
  /** A referenced record (by source id or path) does not exist in the source view. */
  | 'unknown-record'
  /** An anchor for an insertion/replacement could not be determined unambiguously. */
  | 'ambiguous-anchor'
  /** An ARIS id was malformed for its kind, or collided after the allocator's retry budget. */
  | 'invalid-id'
  /** The id allocator could not find a free id within its retry budget. */
  | 'id-exhausted'
  /** Export validation (plan section 9.3) rejected the derived document. */
  | 'validation-failed'

export class ArisWriterError extends Error {
  readonly code: ArisWriterErrorCode
  /** Character offset in the source/derived document the failure relates to, when known. */
  readonly offset: number | null
  /** Extra machine-readable context (ids, paths, conflicting edit labels). */
  readonly detail: Readonly<Record<string, string | number>>

  constructor(
    code: ArisWriterErrorCode,
    message: string,
    options?: { offset?: number | null; detail?: Readonly<Record<string, string | number>> }
  ) {
    super(message)
    this.name = 'ArisWriterError'
    this.code = code
    this.offset = options?.offset ?? null
    this.detail = Object.freeze({ ...(options?.detail ?? {}) })
  }
}
