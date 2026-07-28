import { ArisWriterError } from './errors'

/**
 * A half-open range `[start, end)` addressed in UTF-16 code units of the decoded source text.
 *
 * The tokenizer records both a UTF-16 `offset` and a UTF-8 `byteOffset` for every point. The
 * writer patches on the decoded text because that is what the tokenizer consumes and what a
 * `TextDecoder`/`TextEncoder` pair round-trips exactly; byte-level accounting is derived from
 * the same text with {@link byteLength}. `start === end` denotes an insertion point.
 */
export interface WriterSpan {
  readonly start: number
  readonly end: number
}

const encoder = new TextEncoder()

/** UTF-8 byte length of a string. */
export function byteLength(text: string): number {
  return encoder.encode(text).length
}

/** Encode text to the bytes that would be written to disk. */
export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text)
}

export function makeSpan(start: number, end: number): WriterSpan {
  return Object.freeze({ start, end })
}

export function spanLength(span: WriterSpan): number {
  return span.end - span.start
}

export function isInsertionPoint(span: WriterSpan): boolean {
  return span.start === span.end
}

/** Slice the text a span addresses. */
export function sliceSpan(text: string, span: WriterSpan): string {
  return text.slice(span.start, span.end)
}

/**
 * Two spans conflict when their interiors intersect. A zero-length insertion point conflicts
 * with a non-empty span only when it sits strictly inside it: inserting exactly at a boundary
 * is well defined, inserting into the middle of a range that is simultaneously being replaced
 * is not.
 */
export function spansConflict(a: WriterSpan, b: WriterSpan): boolean {
  const aEmpty = isInsertionPoint(a)
  const bEmpty = isInsertionPoint(b)
  if (aEmpty && bEmpty) return false
  if (aEmpty) return a.start > b.start && a.start < b.end
  if (bEmpty) return b.start > a.start && b.start < a.end
  return a.start < b.end && b.start < a.end
}

export function assertValidSpan(span: WriterSpan, textLength: number, label: string): void {
  const { start, end } = span
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new ArisWriterError('invalid-span', `Edit "${label}" has a non-integer span.`, {
      detail: { label, start, end }
    })
  }
  if (start < 0 || end < start || end > textLength) {
    throw new ArisWriterError(
      'invalid-span',
      `Edit "${label}" addresses [${start}, ${end}) which is outside the document [0, ${textLength}).`,
      { offset: start, detail: { label, start, end, textLength } }
    )
  }
}

/**
 * The single structural seam between the writer and the tokenizer/semantic-index layers.
 *
 * Those layers expose spans as `{ start: XmlPoint; end: XmlPoint }`. The writer deliberately
 * does not import their concrete types — it accepts the minimal structural shape below and
 * converts once, here, so a reshape upstream cannot ripple through the writer.
 */
export interface PointLike {
  readonly offset: number
}

export interface SpanLike {
  readonly start: PointLike
  readonly end: PointLike
}

/** Adapt an upstream `{ start: { offset }, end: { offset } }` span to a {@link WriterSpan}. */
export function toWriterSpan(span: SpanLike): WriterSpan {
  return makeSpan(span.start.offset, span.end.offset)
}
