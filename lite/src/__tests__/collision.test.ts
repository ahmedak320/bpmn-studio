import { describe, it, expect } from 'vitest'
import { slugify, dedupeSlug } from '@app/shared/slug'

// The collision-suffix contract shared by New process, AI placement AND the
// W2B import flow: slugify the intended name, then dedupeSlug against the
// slugs already present in the target folder so a second "Order" becomes
// "order-2", a third "order-3", etc.
describe('collision-suffix naming (import / new process)', () => {
  it('returns the base slug when the folder is free', () => {
    expect(dedupeSlug(slugify('Order'), () => false)).toBe('order')
  })

  it('suffixes -2, -3 … as slugs collide', () => {
    const taken = new Set(['order'])
    const second = dedupeSlug(slugify('Order'), (c) => taken.has(c))
    expect(second).toBe('order-2')
    taken.add(second)
    const third = dedupeSlug(slugify('Order'), (c) => taken.has(c))
    expect(third).toBe('order-3')
  })

  it('simulates importing three same-named files sequentially', () => {
    const taken = new Set<string>()
    const results: string[] = []
    for (let i = 0; i < 3; i++) {
      const slug = dedupeSlug(slugify('invoice approval'), (c) => taken.has(c))
      results.push(slug)
      taken.add(slug)
    }
    expect(results).toEqual(['invoice-approval', 'invoice-approval-2', 'invoice-approval-3'])
  })
})
