import { describe, it, expect } from 'vitest'
import { slugify, dedupeSlug, FALLBACK_SLUG } from '../../src/shared/slug'

describe('slugify', () => {
  it('lowercases and dashes arbitrary names', () => {
    expect(slugify('Order Process')).toBe('order-process')
    expect(slugify('  Hello,   World!! ')).toBe('hello-world')
    expect(slugify('Approve/Reject Loan')).toBe('approve-reject-loan')
  })

  it('falls back when the name has no slug-able characters', () => {
    expect(slugify('')).toBe(FALLBACK_SLUG)
    expect(slugify('   ')).toBe(FALLBACK_SLUG)
    expect(slugify('!!!')).toBe(FALLBACK_SLUG)
  })

  it('neutralizes Windows reserved device names (case-insensitive)', () => {
    expect(slugify('CON')).toBe('con-file')
    expect(slugify('con')).toBe('con-file')
    expect(slugify('PRN')).toBe('prn-file')
    expect(slugify('AUX')).toBe('aux-file')
    expect(slugify('NUL')).toBe('nul-file')
    expect(slugify('CoM3')).toBe('com3-file')
    expect(slugify('lpt9')).toBe('lpt9-file')
  })

  it('does NOT treat lookalikes as reserved', () => {
    expect(slugify('com10')).toBe('com10') // only COM1-9 are reserved
    expect(slugify('lpt0')).toBe('lpt0')
    expect(slugify('console')).toBe('console')
    expect(slugify('AUX report')).toBe('aux-report') // has a suffix -> not reserved
  })
})

describe('dedupeSlug', () => {
  it('returns the base when nothing is taken', () => {
    expect(dedupeSlug('order', () => false)).toBe('order')
  })

  it('suffixes -2, -3, … skipping taken candidates', () => {
    const taken = new Set(['order'])
    expect(dedupeSlug('order', (c) => taken.has(c))).toBe('order-2')

    taken.add('order-2')
    expect(dedupeSlug('order', (c) => taken.has(c))).toBe('order-3')

    taken.add('order-3')
    expect(dedupeSlug('order', (c) => taken.has(c))).toBe('order-4')
  })

  it('handles a gap where an intermediate suffix is free', () => {
    const taken = new Set(['order', 'order-3']) // -2 is free
    expect(dedupeSlug('order', (c) => taken.has(c))).toBe('order-2')
  })
})
