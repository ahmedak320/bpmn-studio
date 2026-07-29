import { ArisWriterError } from './errors'
import {
  assertValidSpan,
  byteLength,
  encodeUtf8,
  isInsertionPoint,
  makeSpan,
  sliceSpan,
  spansConflict,
  type WriterSpan
} from './spans'

/**
 * A single addressed change to the original document.
 *
 * `span` addresses the ORIGINAL text. All edits in a set are expressed against the same
 * original offsets — they are never rebased against each other — which is what makes an edit
 * set order-independent and reviewable.
 */
export interface AmlEdit {
  /** Half-open range in the original text. `start === end` inserts without deleting. */
  readonly span: WriterSpan
  /** Replacement text. Empty string deletes. */
  readonly replacement: string
  /** Human/machine label used in conflict diagnostics. */
  readonly label: string
}

/** Convenience constructors. */
export function replaceEdit(span: WriterSpan, replacement: string, label: string): AmlEdit {
  return Object.freeze({ span, replacement, label })
}

export function insertEdit(at: number, replacement: string, label: string): AmlEdit {
  return Object.freeze({ span: makeSpan(at, at), replacement, label })
}

export function deleteEdit(span: WriterSpan, label: string): AmlEdit {
  return Object.freeze({ span, replacement: '', label })
}

/** An applied edit, reported with the range it occupies in the derived text. */
export interface AppliedAmlEdit {
  readonly label: string
  readonly originalSpan: WriterSpan
  readonly derivedSpan: WriterSpan
  readonly removed: string
  readonly inserted: string
}

export interface AmlPatchResult {
  /** The derived document text. */
  readonly text: string
  /** UTF-8 bytes of the derived document. */
  readonly bytes: Uint8Array
  /** Edits in canonical (ascending-offset, then input-order) sequence. */
  readonly applied: readonly AppliedAmlEdit[]
  readonly originalLength: number
  readonly derivedLength: number
  readonly originalByteLength: number
  readonly derivedByteLength: number
  /** True when at least one edit actually changed bytes. */
  readonly changed: boolean
}

interface OrderedEdit extends AmlEdit {
  readonly order: number
}

/**
 * Canonical edit order: ascending by span start, then by span end, then by the edit's position
 * in the input array. The tie-break on input order is what makes several insertions at the
 * same anchor reproducible instead of dependent on sort stability.
 */
function canonicalOrder(a: OrderedEdit, b: OrderedEdit): number {
  if (a.span.start !== b.span.start) return a.span.start - b.span.start
  if (a.span.end !== b.span.end) return a.span.end - b.span.end
  return a.order - b.order
}

/**
 * Reject any pair of edits whose target ranges intersect.
 *
 * This is a hard error by design (plan section 9.1): silently letting the last writer win
 * would let two independent commands corrupt each other's spans and produce a derived document
 * that no longer corresponds to either intent.
 */
export function assertNoOverlappingEdits(edits: readonly AmlEdit[], textLength: number): void {
  const ordered: OrderedEdit[] = edits.map((edit, order) => {
    assertValidSpan(edit.span, textLength, edit.label)
    return { ...edit, order }
  })
  ordered.sort(canonicalOrder)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (spansConflict(previous.span, current.span)) {
      throw new ArisWriterError(
        'overlapping-edits',
        `Edits "${previous.label}" [${previous.span.start}, ${previous.span.end}) and ` +
          `"${current.label}" [${current.span.start}, ${current.span.end}) overlap. ` +
          'Overlapping edits are never resolved by last-writer-wins.',
        {
          offset: current.span.start,
          detail: {
            first: previous.label,
            second: current.label,
            firstStart: previous.span.start,
            firstEnd: previous.span.end,
            secondStart: current.span.start,
            secondEnd: current.span.end
          }
        }
      )
    }
  }
}

/**
 * Produce a derived document by applying `edits` to `original`.
 *
 * Span preservation is structural, not best-effort: the output is assembled from *slices of the
 * original string* plus the explicit replacement text of each edit. Any byte the caller did not
 * address by span is copied verbatim, so whitespace, comments, unknown elements, attribute
 * order, and quote style survive automatically — there is no re-serialization step that could
 * normalize them away.
 *
 * Application walks the canonical order in descending direction and prepends chunks, which
 * keeps the operation linear and makes the result independent of how the caller ordered the
 * input array.
 */
export function applyAmlEdits(original: string, edits: readonly AmlEdit[]): AmlPatchResult {
  assertNoOverlappingEdits(edits, original.length)

  const ordered: OrderedEdit[] = edits.map((edit, order) => ({ ...edit, order }))
  ordered.sort(canonicalOrder)

  const chunks: string[] = []
  const applied: AppliedAmlEdit[] = []
  let tail = original.length

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const edit = ordered[index]!
    chunks.unshift(original.slice(edit.span.end, tail))
    chunks.unshift(edit.replacement)
    tail = edit.span.start
  }
  chunks.unshift(original.slice(0, tail))

  const text = chunks.join('')

  // Second pass: derived offsets, computed from the running length delta.
  let delta = 0
  for (const edit of ordered) {
    const derivedStart = edit.span.start + delta
    const derivedEnd = derivedStart + edit.replacement.length
    delta += edit.replacement.length - (edit.span.end - edit.span.start)
    applied.push(
      Object.freeze({
        label: edit.label,
        originalSpan: edit.span,
        derivedSpan: makeSpan(derivedStart, derivedEnd),
        removed: sliceSpan(original, edit.span),
        inserted: edit.replacement
      })
    )
  }

  return Object.freeze({
    text,
    bytes: encodeUtf8(text),
    applied: Object.freeze(applied),
    originalLength: original.length,
    derivedLength: text.length,
    originalByteLength: byteLength(original),
    derivedByteLength: byteLength(text),
    changed: applied.some((edit) => edit.removed !== edit.inserted)
  })
}

/**
 * Drop edits that replace a span with exactly the bytes already there.
 *
 * A no-op edit set must produce a byte-identical derived document; filtering here also means
 * `AmlPatchResult.changed` reports intent accurately rather than counting inert edits.
 */
export function pruneNoOpEdits(original: string, edits: readonly AmlEdit[]): readonly AmlEdit[] {
  return edits.filter(
    (edit) =>
      !(isInsertionPoint(edit.span) && edit.replacement === '') &&
      sliceSpan(original, edit.span) !== edit.replacement
  )
}

export interface UnchangedRegionReport {
  /** Number of contiguous regions that were copied verbatim from the original. */
  readonly regions: number
  readonly unchangedCharacters: number
  readonly unchangedBytes: number
  readonly replacedCharacters: number
  readonly insertedCharacters: number
}

/**
 * Prove that every byte the edit set did not address was copied verbatim.
 *
 * Walks the gaps between applied edits and compares them character-for-character against the
 * corresponding gaps in the original. This is the strongest available statement of the section
 * 9.1 guarantee, and it scales to a multi-megabyte document: for a one-attribute edit on a 4 MB
 * export it verifies all ~4 million surrounding bytes, not just the neighbourhood of the edit.
 */
export function verifyUnchangedRegions(
  original: string,
  result: AmlPatchResult
): UnchangedRegionReport {
  let originalCursor = 0
  let derivedCursor = 0
  let unchangedCharacters = 0
  let unchangedBytes = 0
  let regions = 0
  let replacedCharacters = 0
  let insertedCharacters = 0

  const verifyGap = (originalEnd: number, derivedEnd: number): void => {
    const originalGap = original.slice(originalCursor, originalEnd)
    const derivedGap = result.text.slice(derivedCursor, derivedEnd)
    if (originalGap !== derivedGap) {
      throw new ArisWriterError(
        'invalid-span',
        `Bytes outside the edited spans changed: original [${originalCursor}, ${originalEnd}) ` +
          `does not match derived [${derivedCursor}, ${derivedEnd}).`,
        { offset: originalCursor }
      )
    }
    if (originalGap.length > 0) {
      regions += 1
      unchangedCharacters += originalGap.length
      unchangedBytes += byteLength(originalGap)
    }
  }

  for (const edit of result.applied) {
    verifyGap(edit.originalSpan.start, edit.derivedSpan.start)
    replacedCharacters += edit.removed.length
    insertedCharacters += edit.inserted.length
    originalCursor = edit.originalSpan.end
    derivedCursor = edit.derivedSpan.end
  }
  verifyGap(original.length, result.text.length)

  return Object.freeze({
    regions,
    unchangedCharacters,
    unchangedBytes,
    replacedCharacters,
    insertedCharacters
  })
}

/** A contiguous region in which two texts differ. */
export interface TextDifference {
  readonly originalSpan: WriterSpan
  readonly derivedSpan: WriterSpan
  readonly originalText: string
  readonly derivedText: string
}

/**
 * Compute the single minimal differing region between two texts by trimming the common prefix
 * and the common suffix.
 *
 * Used by the byte-exactness tests: for a single localized edit this collapses to exactly one
 * region, and asserting on that region proves that every other byte in the document — the
 * whole 4 MB of it, in the AnimalWF case — is untouched.
 */
export function diffTexts(original: string, derived: string): TextDifference | null {
  if (original === derived) return null
  const maxPrefix = Math.min(original.length, derived.length)
  let prefix = 0
  while (prefix < maxPrefix && original[prefix] === derived[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < maxPrefix - prefix &&
    original[original.length - 1 - suffix] === derived[derived.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return Object.freeze({
    originalSpan: makeSpan(prefix, original.length - suffix),
    derivedSpan: makeSpan(prefix, derived.length - suffix),
    originalText: original.slice(prefix, original.length - suffix),
    derivedText: derived.slice(prefix, derived.length - suffix)
  })
}

/**
 * Assert that `derived` differs from `original` only inside `expected`.
 *
 * Returns the differing region so a caller can inspect it; throws when any byte outside the
 * expected range moved.
 */
export function assertOnlySpanChanged(
  original: string,
  derived: string,
  expected: WriterSpan
): TextDifference | null {
  const difference = diffTexts(original, derived)
  if (difference === null) return null
  if (
    difference.originalSpan.start < expected.start ||
    difference.originalSpan.end > expected.end
  ) {
    throw new ArisWriterError(
      'invalid-span',
      `Derived document changed [${difference.originalSpan.start}, ${difference.originalSpan.end}) ` +
        `but only [${expected.start}, ${expected.end}) was expected to change.`,
      { offset: difference.originalSpan.start }
    )
  }
  return difference
}
