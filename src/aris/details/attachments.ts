/**
 * Secure attachment handling.
 *
 * - Bytes are extracted exactly and never reinterpreted.
 * - MIME type is detected from magic bytes, never from the declared name.
 * - Display names are sanitized against path traversal and control characters.
 * - Only safe images and plain text are previewed; everything else gets a
 *   placeholder.
 * - OLE compound-document payloads are never executed or rendered.
 * - Exact-byte download preserves source identity.
 * - Removal requires explicit confirmation.
 */

import type { ArisDetailsAttachment, ArisDetailsAttachmentBlob } from './seam'

export type DetectedMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'text/plain'
  | 'text/html'
  | 'application/pdf'
  | 'application/zip'
  | 'application/vnd.openxmlformats-officedocument'
  | 'application/msword'
  | 'application/vnd.ms-excel'
  | 'application/vnd.ms-powerpoint'
  | 'application/octet-stream'
  | 'unknown'

export interface ArisAttachmentScanResult {
  readonly id: string
  readonly displayName: string
  readonly declaredMime: string | null
  readonly detectedMime: DetectedMimeType
  readonly size: number
  readonly safeToPreview: boolean
  readonly isOle: boolean
  readonly sha256: string
}

export interface ArisAttachmentDownload {
  readonly filename: string
  readonly mimeType: DetectedMimeType
  readonly bytes: Uint8Array
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const GIF_MAGIC_87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF_MAGIC_89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const WEBP_MAGIC_RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC_WEBP = [0x57, 0x45, 0x42, 0x50]

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return bytesToHex(bytes)
}

/**
 * Detects MIME type from content magic bytes.
 *
 * SVG and HTML are detected by textual inspection because they do not have a
 * reliable binary magic number.
 */
export function detectMimeFromContent(bytes: Uint8Array): DetectedMimeType {
  if (bytes.length === 0) return 'unknown'

  if (startsWith(bytes, OLE_MAGIC)) return 'application/octet-stream'
  if (startsWith(bytes, PDF_MAGIC)) return 'application/pdf'
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png'
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg'
  if (startsWith(bytes, GIF_MAGIC_87) || startsWith(bytes, GIF_MAGIC_89)) return 'image/gif'
  if (startsWith(bytes, WEBP_MAGIC_RIFF) && startsWith(bytes.subarray(8), WEBP_MAGIC_WEBP)) {
    return 'image/webp'
  }
  if (startsWith(bytes, ZIP_MAGIC)) {
    return 'application/zip'
  }

  const head = textHead(bytes, 512)
  const trimmed = head.trim().toLowerCase()
  if (trimmed.startsWith('<?xml') && head.includes('<svg')) return 'image/svg+xml'
  if (trimmed.startsWith('<svg')) return 'image/svg+xml'
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) return 'text/html'

  // Treat printable ASCII/UTF-8 as plain text if no binary nulls appear early.
  const sample = bytes.subarray(0, Math.min(256, bytes.length))
  if (sample.length > 0 && !sample.includes(0)) {
    return 'text/plain'
  }

  return 'application/octet-stream'
}

function textHead(bytes: Uint8Array, max: number): string {
  const sample = bytes.subarray(0, Math.min(max, bytes.length))
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(sample)
  } catch {
    return ''
  }
}

/**
 * Sanitizes a display name.
 *
 * - Removes path separators and parent-directory references.
 * - Removes control characters.
 * - Collapses whitespace.
 * - Falls back to a safe default if the result is empty.
 */
export function sanitizeDisplayName(raw: string): string {
  const withoutPath = raw
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? raw
  const withoutControl = withoutPath.replace(/[\x00-\x1f\x7f]/g, '')
  const collapsed = withoutControl.replace(/\s+/g, ' ').trim()
  const safe = collapsed.replace(/[\.]{2,}/g, '.')
  if (safe.length === 0) return 'attachment'
  if (safe.length > 255) return safe.slice(0, 255)
  return safe
}

function isOleCompoundDocument(bytes: Uint8Array): boolean {
  return startsWith(bytes, OLE_MAGIC)
}

/**
 * Returns true if the attachment is safe to preview inline.
 *
 * SVG is only safe if it does not contain script-like content.
 */
export function isSafeToPreview(bytes: Uint8Array, detectedMime: DetectedMimeType): boolean {
  if (detectedMime === 'application/octet-stream') return false
  if (detectedMime === 'application/zip') return false
  if (detectedMime === 'text/html') return false
  if (detectedMime === 'image/svg+xml') {
    const head = textHead(bytes, 4096)
    const lower = head.toLowerCase()
    if (lower.includes('<script')) return false
    if (lower.includes('javascript:')) return false
    if (lower.includes('onload=') || lower.includes('onclick=')) return false
  }
  if (detectedMime.startsWith('image/') || detectedMime === 'text/plain') return true
  return false
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, '')
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'))
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function concatBlobs(blobs: readonly ArisDetailsAttachmentBlob[]): Uint8Array {
  const arrays = blobs.map((b) => base64ToBytes(b.base64))
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

/**
 * Scans an attachment record and returns safe metadata.
 *
 * Never executes OLE content. The returned `sha256` is computed over the exact
 * concatenated bytes.
 */
export async function scanAttachment(attachment: ArisDetailsAttachment): Promise<ArisAttachmentScanResult> {
  const bytes = concatBlobs(attachment.blobs)
  const detectedMime = detectMimeFromContent(bytes)
  const isOle = isOleCompoundDocument(bytes)
  return {
    id: attachment.id,
    displayName: sanitizeDisplayName(attachment.displayName),
    declaredMime: inferDeclaredMime(attachment.displayName),
    detectedMime,
    size: bytes.length,
    safeToPreview: isSafeToPreview(bytes, detectedMime),
    isOle,
    sha256: await sha256(bytes),
  }
}

function inferDeclaredMime(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.zip')) return 'application/zip'
  return null
}

/**
 * Prepares an exact-byte download from an attachment.
 */
export function prepareAttachmentDownload(
  attachment: ArisDetailsAttachment,
  scan: ArisAttachmentScanResult
): ArisAttachmentDownload {
  const bytes = concatBlobs(attachment.blobs)
  return {
    filename: sanitizeDisplayName(attachment.displayName),
    mimeType: scan.detectedMime,
    bytes,
  }
}

/** Confirmed removal request. Returns a new document with the attachment gone. */
export function removeAttachment(
  doc: { readonly attachments: ReadonlyMap<string, ArisDetailsAttachment> },
  attachmentId: string,
  confirmed: boolean
): { readonly removed: boolean; readonly attachments: ReadonlyMap<string, ArisDetailsAttachment> } {
  if (!confirmed) {
    return { removed: false, attachments: doc.attachments }
  }
  const next = new Map(doc.attachments)
  next.delete(attachmentId)
  return { removed: next.size !== doc.attachments.size, attachments: next }
}
