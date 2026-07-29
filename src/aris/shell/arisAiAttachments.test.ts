/**
 * Plan §16.3 limits and §16.2 attachment rules, asserted at their exact
 * boundaries. Every check runs against the real registry — nothing here mocks
 * `src/ai/pdf.ts` or `src/ai/providersLite.ts`, so a limit changing anywhere
 * fails here.
 */

import { describe, expect, it } from 'vitest'

import { defaultLiteModelId } from '../../ai/providersLite'
import {
  checkArisAiAttachment,
  classifyArisAiAttachmentFile,
  extractArisAiDocxText,
  isArisAiDocxFile,
  type ArisAiDocxParser
} from './arisAiAttachments'

const MIB = 1024 * 1024

const ANTHROPIC_MODEL = defaultLiteModelId('anthropic')
const GEMINI_MODEL = defaultLiteModelId('gemini')
const OPENROUTER_MODEL = defaultLiteModelId('openrouter')
/** A reviewed OpenRouter route with native image input that is NOT a Gemini route. */
const OPENROUTER_VISION_MODEL = 'anthropic/claude-opus-4.8'
/** A reviewed OpenRouter route that IS a Gemini route (GIF must stay blocked). */
const OPENROUTER_GEMINI_MODEL = 'google/gemini-3.6-flash'

function file(
  name: string,
  type: string,
  size: number
): {
  name: string
  type: string
  size: number
} {
  return { name, type, size }
}

describe('classifyArisAiAttachmentFile', () => {
  it('classifies by mime type, and falls back to the extension for a typeless File', () => {
    expect(classifyArisAiAttachmentFile(file('a.pdf', 'application/pdf', 1))).toEqual({
      kind: 'pdf',
      mediaType: 'application/pdf'
    })
    expect(classifyArisAiAttachmentFile(file('drawing.PNG', '', 1))).toEqual({
      kind: 'image',
      mediaType: 'image/png'
    })
    expect(classifyArisAiAttachmentFile(file('scan.PDF', '', 1))).toEqual({
      kind: 'pdf',
      mediaType: 'application/pdf'
    })
    expect(classifyArisAiAttachmentFile(file('notes.txt', 'text/plain', 1))).toBeNull()
  })

  it('rejects a file that is neither a PDF nor an accepted image', () => {
    const result = checkArisAiAttachment({
      providerId: 'anthropic',
      modelId: ANTHROPIC_MODEL,
      file: file('process.svg', 'image/svg+xml', 10)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('unsupported-type')
  })
})

describe('§16.3 PDF limits', () => {
  it.each(['anthropic', 'gemini', 'openrouter'] as const)(
    'accepts a PDF at exactly 20 MiB and rejects one byte more (%s)',
    (providerId) => {
      const modelId =
        providerId === 'anthropic'
          ? ANTHROPIC_MODEL
          : providerId === 'gemini'
            ? GEMINI_MODEL
            : OPENROUTER_MODEL

      const atLimit = checkArisAiAttachment({
        providerId,
        modelId,
        file: file('spec.pdf', 'application/pdf', 20 * MIB)
      })
      expect(atLimit.ok).toBe(true)

      const overLimit = checkArisAiAttachment({
        providerId,
        modelId,
        file: file('spec.pdf', 'application/pdf', 20 * MIB + 1)
      })
      expect(overLimit.ok).toBe(false)
      if (overLimit.ok) throw new Error('unreachable')
      expect(overLimit.code).toBe('too-large')
    }
  )

  it('warns above 15 MiB but still accepts, and stays silent at exactly 15 MiB', () => {
    const atThreshold = checkArisAiAttachment({
      providerId: 'anthropic',
      modelId: ANTHROPIC_MODEL,
      file: file('spec.pdf', 'application/pdf', 15 * MIB)
    })
    expect(atThreshold.ok).toBe(true)
    if (!atThreshold.ok) throw new Error('unreachable')
    expect(atThreshold.warning).toBeUndefined()

    const overThreshold = checkArisAiAttachment({
      providerId: 'anthropic',
      modelId: ANTHROPIC_MODEL,
      file: file('spec.pdf', 'application/pdf', 15 * MIB + 1)
    })
    expect(overThreshold.ok).toBe(true)
    if (!overThreshold.ok) throw new Error('unreachable')
    expect(overThreshold.warning).toBeTruthy()
  })
})

describe('§16.3 raw image limits', () => {
  it.each([
    ['anthropic', ANTHROPIC_MODEL, 5],
    ['openrouter', OPENROUTER_VISION_MODEL, 5],
    ['gemini', GEMINI_MODEL, 12]
  ] as const)('gates %s images at %s MiB', (providerId, modelId, limitMib) => {
    const atLimit = checkArisAiAttachment({
      providerId,
      modelId,
      file: file('drawing.png', 'image/png', limitMib * MIB)
    })
    expect(atLimit.ok).toBe(true)

    const overLimit = checkArisAiAttachment({
      providerId,
      modelId,
      file: file('drawing.png', 'image/png', limitMib * MIB + 1)
    })
    expect(overLimit.ok).toBe(false)
    if (overLimit.ok) throw new Error('unreachable')
    expect(overLimit.code).toBe('too-large')
  })

  it('accepts PNG, JPEG and WebP on a vision route', () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp']) {
      const result = checkArisAiAttachment({
        providerId: 'anthropic',
        modelId: ANTHROPIC_MODEL,
        file: file(`drawing.${mediaType.split('/')[1]}`, mediaType, MIB)
      })
      expect(result.ok, mediaType).toBe(true)
    }
  })
})

describe('§16.3 GIF is gated on the verified provider/model route', () => {
  it('accepts GIF on a verified non-Gemini vision route', () => {
    for (const [providerId, modelId] of [
      ['anthropic', ANTHROPIC_MODEL],
      ['openrouter', OPENROUTER_VISION_MODEL]
    ] as const) {
      const result = checkArisAiAttachment({
        providerId,
        modelId,
        file: file('drawing.gif', 'image/gif', MIB)
      })
      expect(result.ok, `${providerId}/${modelId}`).toBe(true)
    }
  })

  it('refuses GIF on both the direct Gemini route and Gemini-through-OpenRouter', () => {
    for (const [providerId, modelId] of [
      ['gemini', GEMINI_MODEL],
      ['openrouter', OPENROUTER_GEMINI_MODEL]
    ] as const) {
      const result = checkArisAiAttachment({
        providerId,
        modelId,
        file: file('drawing.gif', 'image/gif', MIB)
      })
      expect(result.ok, `${providerId}/${modelId}`).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.code).toBe('gif-route')
    }
  })

  it('reports an unusable image route as image-unsupported, not as a GIF problem', () => {
    const result = checkArisAiAttachment({
      providerId: 'openrouter',
      // The curated default OpenRouter route is text+document only.
      modelId: OPENROUTER_MODEL,
      file: file('drawing.gif', 'image/gif', MIB)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('image-unsupported')
  })
})

describe('§16.6 step 1 — capability is checked before size', () => {
  it('fails closed for a model the registry has not reviewed', () => {
    const result = checkArisAiAttachment({
      providerId: 'openrouter',
      modelId: 'someone/unreviewed-model',
      file: file('spec.pdf', 'application/pdf', MIB)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('model-unverified')
  })

  it('reports the capability refusal for a wildly oversized file on an unusable route', () => {
    // Ordering matters: an unreviewed route must not be reported as "too large",
    // because shrinking the file would not make the request sendable.
    const result = checkArisAiAttachment({
      providerId: 'openrouter',
      modelId: 'someone/unreviewed-model',
      file: file('huge.pdf', 'application/pdf', 999 * MIB)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('model-unverified')
  })

  it('refuses an image on a reviewed document-only route', () => {
    const result = checkArisAiAttachment({
      providerId: 'openrouter',
      modelId: OPENROUTER_MODEL,
      file: file('drawing.png', 'image/png', MIB)
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.code).toBe('image-unsupported')
  })
})

describe('§16.2 DOCX is extracted locally', () => {
  it('recognizes a .docx by mime type and by extension', () => {
    expect(
      isArisAiDocxFile({
        name: 'x',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1
      })
    ).toBe(true)
    expect(isArisAiDocxFile({ name: 'Process.DOCX', type: '', size: 1 })).toBe(true)
    expect(isArisAiDocxFile({ name: 'process.pdf', type: 'application/pdf', size: 1 })).toBe(false)
  })

  it('returns the parsed text and never encodes the bytes for a provider', async () => {
    const seen: File[] = []
    const parse: ArisAiDocxParser = async (target) => {
      seen.push(target)
      return 'Step one. Step two.'
    }
    const docx = new File([new Uint8Array([1, 2, 3])], 'process.docx')
    const extraction = await extractArisAiDocxText(docx, { parse })

    // The parser receives the File itself; the only value that leaves this
    // function is text.
    expect(seen).toEqual([docx])
    expect(extraction).toEqual({
      fileName: 'process.docx',
      text: 'Step one. Step two.',
      characterCount: 'Step one. Step two.'.length
    })
    expect(Object.keys(extraction)).not.toContain('base64')
  })
})
