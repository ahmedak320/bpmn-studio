import { describe, expect, it } from 'vitest'

import { decodeArisOleImage } from './oleImage'

/**
 * Security acceptance for the OLE image decoder (plan Wave 9 P11).
 *
 * The input is untrusted embedded binary. Every hostile shape must safely
 * resolve to `null` (→ the `data-aris-ole-pending` placeholder stays), never
 * throw, hang, or allocate the whole payload. The happy path returns a
 * `data:image/png;base64,…` URL built only from bytes proven to start with the
 * PNG signature.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function toBase64(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString('base64')
}

/** A minimal, syntactically valid PNG head: signature + IHDR(width,height). */
function pngHead(width: number, height: number, trailing: readonly number[] = []): number[] {
  const be = (n: number): number[] => [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff
  ]
  return [
    ...PNG_SIGNATURE,
    ...be(13), // IHDR chunk length
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    ...be(width),
    ...be(height),
    0x08,
    0x06,
    0x00,
    0x00,
    0x00, // bit depth, colour type, compression, filter, interlace
    ...trailing
  ]
}

/** A canonical 1×1 PNG (real, browser-decodable). */
const VALID_1X1_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('decodeArisOleImage — happy path', () => {
  it('returns a data:image/png URL for a valid PNG value', () => {
    const url = decodeArisOleImage(VALID_1X1_PNG)
    expect(url).toBe(`data:image/png;base64,${VALID_1X1_PNG}`)
  })

  it('normalizes surrounding whitespace/newlines (as AML wraps blob values)', () => {
    const wrapped = `\n  ${VALID_1X1_PNG.slice(0, 40)}\n${VALID_1X1_PNG.slice(40)}\t\n`
    const url = decodeArisOleImage(wrapped)
    expect(url).toBe(`data:image/png;base64,${VALID_1X1_PNG}`)
  })

  it('accepts a larger valid PNG head within the dimension cap (915×266, the DMT logo size)', () => {
    // Pad to a realistic body length so it clears the minimum-head floor.
    const bytes = pngHead(915, 266, new Array(64).fill(0))
    const url = decodeArisOleImage(toBase64(bytes))
    expect(url).not.toBeNull()
    expect(url!.startsWith('data:image/png;base64,')).toBe(true)
  })
})

describe('decodeArisOleImage — hostile inputs all yield null (placeholder stays)', () => {
  it('absent value (null/undefined)', () => {
    expect(decodeArisOleImage(null)).toBeNull()
    expect(decodeArisOleImage(undefined)).toBeNull()
  })

  it('empty / whitespace-only value', () => {
    expect(decodeArisOleImage('')).toBeNull()
    expect(decodeArisOleImage('    \n\t  ')).toBeNull()
  })

  it('garbage base64 (illegal characters)', () => {
    expect(decodeArisOleImage('not*valid*base64!!!!')).toBeNull()
    expect(decodeArisOleImage('@@@@')).toBeNull()
  })

  it('base64 length not a multiple of 4', () => {
    expect(decodeArisOleImage('iVBORw0KGgo')).toBeNull()
  })

  it('valid base64 but wrong magic (non-PNG bytes)', () => {
    const notPng = new Array(64).fill(0x41) // "AAAA…", ≥33 bytes, no PNG signature
    expect(decodeArisOleImage(toBase64(notPng))).toBeNull()
  })

  it('a ZIP/EMF payload is rejected (only PNG is accepted — no container walk)', () => {
    const zipMagic = [0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0)] // "PK\x03\x04…"
    expect(decodeArisOleImage(toBase64(zipMagic))).toBeNull()
  })

  it('truncated PNG (signature only, below the minimum head)', () => {
    expect(decodeArisOleImage(toBase64(PNG_SIGNATURE))).toBeNull()
  })

  it('PNG signature but missing the leading IHDR chunk', () => {
    const noIhdr = [...PNG_SIGNATURE, ...new Array(40).fill(0)] // zeros where IHDR should be
    expect(decodeArisOleImage(toBase64(noIhdr))).toBeNull()
  })

  it('oversized image dimensions (width beyond the cap)', () => {
    const huge = pngHead(65536, 266, new Array(32).fill(0))
    expect(decodeArisOleImage(toBase64(huge))).toBeNull()
  })

  it('oversized image dimensions (height beyond the cap)', () => {
    const huge = pngHead(915, 100000, new Array(32).fill(0))
    expect(decodeArisOleImage(toBase64(huge))).toBeNull()
  })

  it('zero dimension', () => {
    const zero = pngHead(0, 266, new Array(32).fill(0))
    expect(decodeArisOleImage(toBase64(zero))).toBeNull()
  })

  it('base64 over the length cap is rejected without decoding (bomb guard)', () => {
    // 12M+4 chars of valid base64 alphabet — never decoded, rejected on length.
    const bomb = 'A'.repeat(12 * 1024 * 1024 + 4)
    expect(decodeArisOleImage(bomb)).toBeNull()
  })

  it('never throws on adversarial input', () => {
    const inputs = ['=', '====', 'A===', '\0\0\0\0', 'iVBORw0KGgo=', VALID_1X1_PNG.slice(0, 12)]
    for (const input of inputs) {
      expect(() => decodeArisOleImage(input)).not.toThrow()
    }
  })
})
