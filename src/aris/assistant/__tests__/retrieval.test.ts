import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import {
  digestToContext,
  expandToken,
  normalizeToken,
  rankDigests,
  selectContextDigests,
  tokenize
} from '../retrieval'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

describe('tokenize', () => {
  it('keeps Unicode letters/digits and drops sub-2-char tokens', () => {
    expect(tokenize('Register Owner-Profile v2!')).toEqual(['register', 'owner', 'profile', 'v2'])
  })

  it('tokenizes Arabic text on non-letter boundaries', () => {
    expect(tokenize('تسجيل ملف المالك')).toEqual(['تسجيل', 'ملف', 'المالك'])
  })
})

describe('Arabic normalization — normalizeToken', () => {
  it('strips tashkeel diacritics (and, like every normalization here, also folds taa marbuta)', () => {
    // "مُوَافَقَة" (approval) with full diacritics normalizes to "موافقه".
    expect(normalizeToken('مُوَافَقَة')).toBe('موافقه')
  })

  it('strips tatweel elongation', () => {
    expect(normalizeToken('مـــوافقة')).toBe('موافقه')
  })

  it('unifies alef/hamza variants (أ إ آ ٱ) to bare alef', () => {
    expect(normalizeToken('أحمد')).toBe('احمد')
    expect(normalizeToken('إدارة')).toBe('اداره')
    expect(normalizeToken('آلة')).toBe('اله')
  })

  it('normalizes alef maqsura (ى) to yaa (ي)', () => {
    expect(normalizeToken('مستشفى')).toBe('مستشفي')
  })

  it('normalizes taa marbuta (ة) to haa (ه)', () => {
    expect(normalizeToken('شهادة')).toBe('شهاده')
    expect(normalizeToken('موافقة')).toBe('موافقه')
  })
})

describe('Arabic definite-article and clitic expansion — expandToken', () => {
  it('keeps the surface form and adds a de-cliticized variant for المالك (the owner)', () => {
    expect(expandToken('المالك')).toEqual(expect.arrayContaining(['المالك', 'مالك']))
  })

  it('strips the longer وال (and-the) clitic before the bare ال', () => {
    // "والموافقة" (and-the-approval) -> variant "موافقه" after taa-marbuta normalization.
    expect(expandToken('والموافقة')).toEqual(expect.arrayContaining(['والموافقه', 'موافقه']))
  })

  it('does not strip a false-positive-looking prefix when fewer than 2 letters would remain', () => {
    // "ال" alone is just the clitic with nothing left to strip.
    expect(expandToken('ال')).toEqual(['ال'])
  })

  it('adds a light-plural singular variant for English tokens', () => {
    expect(expandToken('processes')).toEqual(expect.arrayContaining(['processes', 'processe']))
    expect(expandToken('systems')).toEqual(expect.arrayContaining(['systems', 'system']))
  })

  it('never singularizes a double-s ending', () => {
    expect(expandToken('class')).toEqual(['class'])
  })
})

describe('rankDigests / selectContextDigests — ARIS-specific bands', () => {
  const m1 = buildDigest(buildSyntheticModel())
  const m2 = buildDigest(buildSecondSyntheticModel())
  const digests = [m1, m2]

  it('ranks by process code', () => {
    const ranked = rankDigests(digests, 'REG-001')
    expect(ranked[0]?.digest.modelId).toBe('m1')
  })

  it('ranks by an owner/responsibility term', () => {
    const ranked = rankDigests(digests, 'veterinarian')
    expect(ranked[0]?.digest.modelId).toBe('m1')
  })

  it('ranks by an Arabic step name using the definite-article clitic variant', () => {
    // Query has the definite article; the fixture step name does not — the
    // clitic-stripped variant is what makes them match.
    const ranked = rankDigests(digests, 'الموافقة على الطلب')
    expect(ranked[0]?.digest.modelId).toBe('m1')
  })

  it('ranks by a decision outcome term', () => {
    const ranked = rankDigests(digests, 'Rejected')
    expect(ranked[0]?.digest.modelId).toBe('m1')
  })

  it('ranks by an assigned/linked model id', () => {
    const ranked = rankDigests(digests, 'm2-committee-review')
    expect(ranked[0]?.digest.modelId).toBe('m1')
  })

  it('returns nothing (positive-confidence-only) for a query sharing no tokens with any digest', () => {
    expect(selectContextDigests(digests, 'xyzzy qwertyzzz flibbertigibbet')).toEqual([])
  })

  it('is deterministic across repeated calls', () => {
    const first = rankDigests(digests, 'registration')
    const second = rankDigests(digests, 'registration')
    expect(second).toEqual(first)
  })
})

describe('digestToContext', () => {
  it('renders a bounded plain-text brief including process code, owners, triggers, steps, decisions', () => {
    const digest = buildDigest(buildSyntheticModel())
    const context = digestToContext(digest)
    expect(context).toContain('Owner Registration')
    expect(context).toContain('Process code: REG-001')
    expect(context).toContain('Owners: Animal Welfare Division')
    expect(context).toContain('Triggers: Registration requested')
    expect(context).toContain('Decision (XOR)')
  })

  it('truncates on whole lines under a character budget', () => {
    const digest = buildDigest(buildSyntheticModel())
    const context = digestToContext(digest, 120)
    expect(context.length).toBeLessThanOrEqual(160)
    expect(context).toMatch(/… \(\+\d+ more lines\)$/)
  })
})
