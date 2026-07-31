/**
 * Safe decoder for the DMT organization-title-block logo carried by an ARIS OLE
 * attachment (plan Wave 9 P11, fixplan §3.2).
 *
 * ## What this decodes — and why it is deliberately narrow
 *
 * Each `<OLEDef>` in an AnimalWF export carries an `AT_IMAGE_FILE_BLOB`
 * attribute whose value is a self-contained, base64-encoded **PNG** of the
 * attachment's picture (the title-block logo decodes to 915×266 — verified
 * against the private reference export). The renderer paints that PNG at the
 * title-block bounds instead of the dashed placeholder.
 *
 * The value is **untrusted embedded binary**, so this module never trusts the
 * declared type. It validates the PNG signature and the leading `IHDR` chunk
 * itself, enforces hard base64-length / decoded-size / dimension caps, and
 * returns `null` — which keeps the `data-aris-ole-pending` placeholder — on
 * anything malformed, truncated, oversized, or non-PNG. It never inflates,
 * unzips, or interprets any other container (no EMF/DIB/zip walk, no
 * hand-rolled pixel parser): the browser decodes the PNG when the returned
 * `data:` URL is drawn. A returned value is always a
 * `data:image/png;base64,…` URL built from bytes this module has proven begin
 * with the PNG signature — never the raw AML string echoed through with an
 * attacker-chosen media type.
 *
 * There is no way for this function to throw or hang on hostile input: every
 * branch returns `null`, base64 decoding is guarded, and only the first 33
 * bytes are ever materialized for inspection (the full payload is never
 * decoded here — its size is derived arithmetically from the base64 length).
 */

/** Reject a base64 string longer than this (≈12M chars ≈ 9 MB) — zip/data-bomb guard. */
const MAX_BASE64_CHARS = 12 * 1024 * 1024
/** Reject a decoded payload larger than this (8 MB). The reference logo is ~59 KB. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
/** Reject an image wider/taller than this. The reference logo is 915×266. */
const MAX_DIMENSION = 8192

/** The 8-byte PNG file signature. */
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** `IHDR` — the type of the mandatory first PNG chunk, at byte offset 12. */
const IHDR_TYPE = Object.freeze([0x49, 0x48, 0x44, 0x52])
/** Bytes needed to reach the IHDR width/height fields (sig 8 + len 4 + type 4 + w/h 8 + spare). */
const MIN_PNG_HEAD_BYTES = 33
/** 44 base64 chars decode to exactly 33 bytes — the head we inspect. */
const HEAD_BASE64_CHARS = 44

/** Decode a base64 string to bytes, browser- and Node-safe; `null` on any failure. */
function decodeBase64(base64: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return bytes
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'))
    }
    return null
  } catch {
    return null
  }
}

/** The decoded byte length of a (padding-terminated) base64 string, without decoding it. */
function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  )
}

/**
 * Validate an `AT_IMAGE_FILE_BLOB` value as a bounded PNG and return a
 * `data:image/png;base64,…` URL for it, or `null` to keep the placeholder.
 *
 * `null` is returned for: an absent/empty value, a base64 string over the
 * length cap, non-base64 characters, a payload over the byte cap or below the
 * minimum PNG head, a wrong PNG signature, a missing leading `IHDR` chunk, or
 * an out-of-range image dimension.
 */
export function decodeArisOleImage(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length === 0) return null
  if (normalized.length > MAX_BASE64_CHARS) return null
  // A valid base64 body is a multiple of 4 and uses only the base64 alphabet.
  if (normalized.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) return null

  const byteLength = base64ByteLength(normalized)
  if (byteLength > MAX_IMAGE_BYTES) return null
  if (byteLength < MIN_PNG_HEAD_BYTES) return null

  // Only the head is decoded — never the full (up to multi-MB) payload here.
  const head = decodeBase64(normalized.slice(0, HEAD_BASE64_CHARS))
  if (head === null || head.length < 24) return null

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (head[index] !== PNG_SIGNATURE[index]) return null
  }
  // The first chunk of every PNG is IHDR; its 4-byte type sits at offset 12.
  for (let index = 0; index < IHDR_TYPE.length; index += 1) {
    if (head[12 + index] !== IHDR_TYPE[index]) return null
  }
  const width = readUInt32BE(head, 16)
  const height = readUInt32BE(head, 20)
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null

  return `data:image/png;base64,${normalized}`
}
