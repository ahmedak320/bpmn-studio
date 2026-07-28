/**
 * Deterministic JSON encoding for every OrbitPM ARIS source-package artifact.
 *
 * Package members are content-addressed and digested, so two runs that produce
 * the same logical document must produce byte-identical files. `JSON.stringify`
 * cannot be trusted for that: it preserves key-insertion order, emits raw
 * non-ASCII bytes, and formats numbers with engine-defined shortest-round-trip
 * rules. This encoder therefore:
 *
 * - sorts object keys by UTF-16 code unit,
 * - drops `undefined` members instead of ordering them,
 * - escapes every non-ASCII code unit as `\uXXXX`,
 * - accepts only safe integers, so no float formatting can ever differ.
 *
 * The output contains no timestamps, locale data, or machine identity: callers
 * must not place any into a canonical document.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type CanonicalJsonErrorCode =
  | 'unsupported-type'
  | 'non-finite-number'
  | 'non-integer-number'
  | 'unsafe-integer'
  | 'cyclic-value'

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode
  readonly path: string

  constructor(code: CanonicalJsonErrorCode, path: string, message: string) {
    super(message)
    this.name = 'CanonicalJsonError'
    this.code = code
    this.path = path
  }
}

const SHORT_ESCAPES: Readonly<Record<number, string>> = Object.freeze({
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\'
})

function encodeString(value: string): string {
  let out = '"'
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    const short = SHORT_ESCAPES[code]
    if (short !== undefined) {
      out += short
      continue
    }
    // Printable ASCII only. Everything else becomes a fixed \uXXXX escape so
    // the encoded bytes never depend on the host's Unicode handling.
    if (code >= 0x20 && code <= 0x7e) {
      out += value[index]
      continue
    }
    out += `\\u${code.toString(16).padStart(4, '0')}`
  }
  return `${out}"`
}

function encodeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      'non-finite-number',
      path,
      `Canonical JSON cannot encode the non-finite number at "${path}".`
    )
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalJsonError(
      'non-integer-number',
      path,
      `Canonical JSON accepts integers only; "${path}" is fractional.`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(
      'unsafe-integer',
      path,
      `Canonical JSON accepts safe integers only; "${path}" exceeds the safe range.`
    )
  }
  // `String(-0)` is "0"; this keeps negative zero from producing two encodings.
  return String(value === 0 ? 0 : value)
}

function encodeValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return encodeString(value)
    case 'number':
      return encodeNumber(value, path)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'object':
      break
    default:
      throw new CanonicalJsonError(
        'unsupported-type',
        path,
        `Canonical JSON cannot encode a value of type "${typeof value}" at "${path}".`
      )
  }

  const record = value as object
  if (seen.has(record)) {
    throw new CanonicalJsonError(
      'cyclic-value',
      path,
      `Canonical JSON cannot encode the cyclic value at "${path}".`
    )
  }
  seen.add(record)
  try {
    if (Array.isArray(record)) {
      const items = record.map((item, index) => encodeValue(item, `${path}[${index}]`, seen))
      return `[${items.join(',')}]`
    }
    if (
      Object.getPrototypeOf(record) !== Object.prototype &&
      Object.getPrototypeOf(record) !== null
    ) {
      throw new CanonicalJsonError(
        'unsupported-type',
        path,
        `Canonical JSON accepts plain objects only; "${path}" has a non-plain prototype.`
      )
    }
    const entries = Object.entries(record as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    const encoded = entries.map(
      ([key, item]) => `${encodeString(key)}:${encodeValue(item, `${path}.${key}`, seen)}`
    )
    return `{${encoded.join(',')}}`
  } finally {
    seen.delete(record)
  }
}

/** Deterministic UTF-8 (in practice ASCII) text for a JSON-like value. */
export function canonicalJsonText(value: unknown): string {
  return encodeValue(value, '$', new Set<object>())
}

/**
 * Deterministic document bytes. A single trailing newline keeps the artifacts
 * diff-friendly and is part of the hashed content.
 */
export function canonicalJsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const text = `${canonicalJsonText(value)}\n`
  const bytes = new TextEncoder().encode(text)
  const owned = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  owned.set(bytes)
  return owned
}
