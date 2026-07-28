import { describe, expect, it } from 'vitest'
import {
  detectMimeFromContent,
  prepareAttachmentDownload,
  removeAttachment,
  sanitizeDisplayName,
  scanAttachment,
  type DetectedMimeType,
} from './attachments'
import type { ArisDetailsAttachment } from './seam'

function makeAttachment(name: string, bytes: Uint8Array): ArisDetailsAttachment {
  return {
    id: `att-${name}`,
    oleDefinitionId: 'ole-def-1',
    oleOccurrenceId: null,
    modelId: null,
    position: null,
    size: null,
    displayName: name,
    blobs: [{ index: 0, base64: Buffer.from(bytes).toString('base64') }],
  }
}

function expectMime(bytes: Uint8Array, expected: DetectedMimeType): void {
  expect(detectMimeFromContent(bytes)).toBe(expected)
}

describe('attachment security', () => {
  it('sanitizes a path-traversal display name', () => {
    const sanitized = sanitizeDisplayName('../../evil.exe')
    expect(sanitized).not.toContain('..')
    expect(sanitized).not.toContain('/')
    expect(sanitized).not.toContain('\\')
    expect(sanitized).toBe('evil.exe')
  })

  it('detects MIME from content, not from declared extension', () => {
    // PNG magic but .jpg name
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const att = makeAttachment('trick.jpg', pngBytes)
    expect(detectMimeFromContent(pngBytes)).toBe('image/png')
    expect(att.displayName.endsWith('.jpg')).toBe(true)
  })

  it('refuses to preview an SVG containing a script tag', async () => {
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>')
    expect(detectMimeFromContent(svg)).toBe('image/svg+xml')
    const scan = await scanAttachment(makeAttachment('icon.svg', svg))
    expect(scan.safeToPreview).toBe(false)
  })

  it('detects an HTML payload', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>x</body></html>')
    expectMime(html, 'text/html')
  })

  it('treats OLE compound-document blobs as placeholders only', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const scan = await scanAttachment(makeAttachment('document.ole', ole))
    expect(scan.isOle).toBe(true)
    expect(scan.safeToPreview).toBe(false)
    expect(scan.detectedMime).toBe('application/octet-stream')
  })

  it('handles a zero-byte attachment', async () => {
    const scan = await scanAttachment(makeAttachment('empty.txt', new Uint8Array(0)))
    expect(scan.size).toBe(0)
    expect(scan.detectedMime).toBe('unknown')
  })

  it('sanitizes a very long unicode name', () => {
    const longName = '文'.repeat(500)
    const sanitized = sanitizeDisplayName(longName)
    expect(sanitized.length).toBeLessThanOrEqual(255)
  })

  it('preserves exact bytes in a download', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const att = makeAttachment('binary.bin', bytes)
    const download = prepareAttachmentDownload(att, {
      id: att.id,
      displayName: att.displayName,
      declaredMime: null,
      detectedMime: 'application/octet-stream',
      size: bytes.length,
      safeToPreview: false,
      isOle: false,
      sha256: 'deadbeef',
    })
    expect(download.bytes).toEqual(bytes)
  })

  it('requires confirmation before removal', () => {
    const attachments = new Map<string, ArisDetailsAttachment>([['a', makeAttachment('a.txt', new Uint8Array([1]))]])
    const doc = { attachments }
    const withoutConfirmation = removeAttachment(doc, 'a', false)
    expect(withoutConfirmation.removed).toBe(false)
    expect(withoutConfirmation.attachments.size).toBe(1)

    const withConfirmation = removeAttachment(doc, 'a', true)
    expect(withConfirmation.removed).toBe(true)
    expect(withConfirmation.attachments.size).toBe(0)
  })
})
