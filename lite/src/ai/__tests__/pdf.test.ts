import { describe, it, expect } from 'vitest'
import { checkPdfSize, buildPdfInstruction, PDF_SIZE_LIMITS, PDF_SOFT_WARN_BYTES } from '../pdf'

describe('checkPdfSize', () => {
  it('accepts a small PDF for every PDF-capable provider', () => {
    for (const p of ['anthropic', 'gemini', 'openrouter'] as const) {
      expect(checkPdfSize(p, 500 * 1024).ok).toBe(true)
    }
  })

  it('rejects an over-limit PDF with a provider-aware message', () => {
    const r = checkPdfSize('anthropic', PDF_SIZE_LIMITS.anthropic + 1)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/over the/i)
    expect(r.message).toMatch(/Gemini/i) // suggests the larger-limit provider
  })

  it('accepts a 30MB PDF on Gemini but rejects it on Anthropic', () => {
    const thirtyMb = 30 * 1024 * 1024
    expect(checkPdfSize('gemini', thirtyMb).ok).toBe(true)
    expect(checkPdfSize('anthropic', thirtyMb).ok).toBe(false)
  })

  it('caps Gemini at 32 MiB (aligned safety margin)', () => {
    expect(PDF_SIZE_LIMITS.gemini).toBe(32 * 1024 * 1024)
    expect(checkPdfSize('gemini', 32 * 1024 * 1024).ok).toBe(true)
    expect(checkPdfSize('gemini', 32 * 1024 * 1024 + 1).ok).toBe(false)
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
