import { describe, it, expect } from 'vitest'
import {
  checkPdfSize,
  checkAttachmentSize,
  buildPdfInstruction,
  buildImageInstruction,
  imageMediaTypeFromName,
  PDF_SIZE_LIMITS,
  IMAGE_SIZE_LIMITS,
  PDF_SOFT_WARN_BYTES,
  ACCEPTED_IMAGE_TYPES
} from '../pdf'

describe('checkPdfSize', () => {
  it('accepts a small PDF for every PDF-capable provider', () => {
    for (const p of ['anthropic', 'gemini', 'openrouter'] as const) {
      expect(checkPdfSize(p, 500 * 1024).ok).toBe(true)
    }
  })

  it('rejects an over-limit PDF with a split-the-file message (ORIG-4)', () => {
    const r = checkPdfSize('anthropic', PDF_SIZE_LIMITS.anthropic + 1)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/over the/i)
    // All providers now share the 20 MiB cap, so the advice is to split — no
    // longer "try Gemini (larger limit)".
    expect(r.message).toMatch(/split/i)
  })

  it('rejects a 30MB PDF on EVERY provider now that all caps are 20 MiB (ORIG-4)', () => {
    const thirtyMb = 30 * 1024 * 1024
    expect(checkPdfSize('gemini', thirtyMb).ok).toBe(false)
    expect(checkPdfSize('anthropic', thirtyMb).ok).toBe(false)
    expect(checkPdfSize('openrouter', thirtyMb).ok).toBe(false)
  })

  it('caps Gemini at 20 MiB (lowered; base64/JSON memory multiplier) (ORIG-4)', () => {
    expect(PDF_SIZE_LIMITS.gemini).toBe(20 * 1024 * 1024)
    expect(checkPdfSize('gemini', 20 * 1024 * 1024).ok).toBe(true)
    expect(checkPdfSize('gemini', 20 * 1024 * 1024 + 1).ok).toBe(false)
  })

  it('all three PDF-capable providers share the same 20 MiB cap', () => {
    expect(PDF_SIZE_LIMITS.anthropic).toBe(20 * 1024 * 1024)
    expect(PDF_SIZE_LIMITS.openrouter).toBe(20 * 1024 * 1024)
    expect(PDF_SIZE_LIMITS.gemini).toBe(20 * 1024 * 1024)
  })

  it('disables PDF for the custom endpoint', () => {
    const r = checkPdfSize('custom', 1024)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/not available for the Custom endpoint/i)
  })
})

describe('checkPdfSize soft warning (large-but-allowed files)', () => {
  it('adds no warning for a small file within the limit', () => {
    const r = checkPdfSize('gemini', 1 * 1024 * 1024)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
  })

  it('warns (but still accepts) a file above the 15 MiB soft threshold', () => {
    expect(PDF_SOFT_WARN_BYTES).toBe(15 * 1024 * 1024)
    const r = checkPdfSize('gemini', 20 * 1024 * 1024)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeTruthy()
    expect(r.warning).toMatch(/20\.0 MB/)
  })

  it('does not warn exactly at the soft threshold', () => {
    expect(checkPdfSize('gemini', PDF_SOFT_WARN_BYTES).warning).toBeUndefined()
  })
})

describe("checkAttachmentSize(kind: 'pdf') — byte-identical delegation to checkPdfSize", () => {
  it('returns EXACTLY what checkPdfSize returns for representative sizes and providers', () => {
    const sizes = [
      1024, // trivial
      500 * 1024, // small
      PDF_SOFT_WARN_BYTES, // at the soft threshold (no warning)
      16 * 1024 * 1024, // in the soft-warn band
      20 * 1024 * 1024, // at the hard cap
      20 * 1024 * 1024 + 1, // just over
      30 * 1024 * 1024 // far over
    ]
    for (const providerId of ['anthropic', 'gemini', 'openrouter', 'custom'] as const) {
      for (const size of sizes) {
        expect(checkAttachmentSize(providerId, 'pdf', size)).toEqual(
          checkPdfSize(providerId, size)
        )
      }
    }
  })
})

describe("checkAttachmentSize(kind: 'image')", () => {
  it('encodes the verified conservative caps: 5 MiB Anthropic/OpenRouter, 12 MiB Gemini, 0 custom', () => {
    // Anthropic direct API: ≤10 MB base64-encoded per image (5 MiB raw ≈ 7 MB
    // base64); OpenRouter forwards downstream so it shares that gate; Gemini
    // inline requests cap the WHOLE request at 20 MB (12 MiB raw ≈ 16 MiB
    // base64 + prompt headroom). Sources in pdf.ts's IMAGE_SIZE_LIMITS comment.
    expect(IMAGE_SIZE_LIMITS.anthropic).toBe(5 * 1024 * 1024)
    expect(IMAGE_SIZE_LIMITS.openrouter).toBe(5 * 1024 * 1024)
    expect(IMAGE_SIZE_LIMITS.gemini).toBe(12 * 1024 * 1024)
    expect(IMAGE_SIZE_LIMITS.custom).toBe(0)
  })

  it('accepts images at each provider limit and rejects one byte over', () => {
    for (const providerId of ['anthropic', 'openrouter', 'gemini'] as const) {
      const limit = IMAGE_SIZE_LIMITS[providerId]
      expect(checkAttachmentSize(providerId, 'image', limit).ok).toBe(true)
      const over = checkAttachmentSize(providerId, 'image', limit + 1)
      expect(over.ok).toBe(false)
      expect(over.message).toMatch(/over the/i)
    }
  })

  it('interpolates the size and the provider limit into the over-limit message', () => {
    const r = checkAttachmentSize('anthropic', 'image', 8 * 1024 * 1024)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('8.0 MB')
    expect(r.message).toContain('5.0 MB')
  })

  it('never soft-warns for images (all image caps sit below the PDF soft threshold)', () => {
    for (const providerId of ['anthropic', 'openrouter', 'gemini'] as const) {
      const r = checkAttachmentSize(providerId, 'image', IMAGE_SIZE_LIMITS[providerId])
      expect(r.ok).toBe(true)
      expect(r.warning).toBeUndefined()
    }
  })

  it('rejects images outright for the custom endpoint (no verified image path)', () => {
    const r = checkAttachmentSize('custom', 'image', 1024)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/not available for this provider/i)
  })
})

describe('accepted image types + extension fallback', () => {
  it('accepts exactly png/jpeg/webp/gif', () => {
    expect([...ACCEPTED_IMAGE_TYPES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    ])
  })

  it('maps file extensions to mimes (for Files with an empty type)', () => {
    expect(imageMediaTypeFromName('flow.png')).toBe('image/png')
    expect(imageMediaTypeFromName('Whiteboard.JPG')).toBe('image/jpeg')
    expect(imageMediaTypeFromName('scan.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeFromName('shot.webp')).toBe('image/webp')
    expect(imageMediaTypeFromName('anim.gif')).toBe('image/gif')
    expect(imageMediaTypeFromName('doc.pdf')).toBeNull()
    expect(imageMediaTypeFromName('archive.zip')).toBeNull()
    expect(imageMediaTypeFromName('no-extension')).toBeNull()
  })
})

describe('buildPdfInstruction', () => {
  it('includes a no-hint branch when the hint is blank', () => {
    const text = buildPdfInstruction('   ')
    expect(text).toMatch(/did not specify which process/i)
    expect(text).toMatch(/most complete/i)
  })

  it('embeds an English hint verbatim', () => {
    const text = buildPdfInstruction('the employee onboarding flow')
    expect(text).toContain('"the employee onboarding flow"')
    expect(text).toMatch(/use this hint to pick the right one/i)
  })

  it('embeds an Arabic hint verbatim (no translation, RTL-safe)', () => {
    const arabic = 'عملية توظيف الموظفين الجدد'
    const text = buildPdfInstruction(arabic)
    expect(text).toContain(arabic)
    // The Arabic is placed inside the "specifically wants" clause.
    expect(text).toMatch(/specifically wants this process modeled/i)
  })
})

describe('buildImageInstruction', () => {
  it('frames the attachment as a process DRAWING (flowchart/whiteboard/scan)', () => {
    const text = buildImageInstruction('')
    expect(text).toMatch(/flowchart/i)
    expect(text).toMatch(/whiteboard/i)
    expect(text).toMatch(/sketch|scanned/i)
  })

  it('tells the model to follow arrows for sequence and swimlanes for roles', () => {
    const text = buildImageInstruction('')
    expect(text).toMatch(/follow the arrows/i)
    expect(text).toMatch(/swimlanes/i)
    expect(text).toMatch(/roles or departments/i)
  })

  it('mentions Arabic/RTL labels so mixed-language drawings are read as-is', () => {
    const text = buildImageInstruction('')
    expect(text).toMatch(/arabic/i)
    expect(text).toMatch(/right-to-left/i)
  })

  it('includes a no-hint branch when the hint is blank', () => {
    const text = buildImageInstruction('  ')
    expect(text).toMatch(/did not specify which process/i)
    expect(text).toMatch(/most complete/i)
  })

  it('embeds an English hint verbatim', () => {
    const text = buildImageInstruction('the refund approval swimlane')
    expect(text).toContain('"the refund approval swimlane"')
    expect(text).toMatch(/use this hint to pick the right one/i)
  })

  it('embeds an Arabic hint verbatim (no translation, RTL-safe)', () => {
    const arabic = 'عملية صرف المستحقات'
    const text = buildImageInstruction(arabic)
    expect(text).toContain(arabic)
    expect(text).toMatch(/specifically wants this process modeled/i)
  })
})
