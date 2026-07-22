import { describe, it, expect } from 'vitest'
import {
  deriveProcessId,
  buildNewProcessDoc,
  deriveFileBaseName
} from '../editor/newProcessDoc'

// Codex ORIG-6: two problems with non-Latin process ids.
//  (a) A MIXED name (Arabic + a tiny ASCII residue) — "طلب A" vs "موافقة A" —
//      strips to the same short residue ("_a"), so both collapsed to the single
//      shared id "Process__a", silently cross-wiring their call links. When the
//      ASCII residue is too short to be meaningful (<3 letters) we must hash
//      instead, giving each name a distinct, stable id.
//  (b) The derived id must be de-duplicated against the LIVE process index at the
//      call sites, so ANY collision (even a hash clash) gets a numeric suffix.

describe('deriveProcessId — mixed Arabic/ASCII names with a short residue (ORIG-6a)', () => {
  it('gives DIFFERENT ids to "طلب A" and "موافقة A" (both had residue "_a")', () => {
    const a = deriveProcessId(deriveFileBaseName('طلب A'))
    const b = deriveProcessId(deriveFileBaseName('موافقة A'))
    expect(a).toMatch(/^Process_[0-9a-f]{8}$/)
    expect(b).toMatch(/^Process_[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    // Specifically NOT the old shared "Process__a".
    expect(a).not.toBe('Process__a')
    expect(b).not.toBe('Process__a')
  })

  it('is deterministic for the same mixed name', () => {
    expect(deriveProcessId(deriveFileBaseName('طلب A'))).toBe(
      deriveProcessId(deriveFileBaseName('طلب A'))
    )
  })

  it('still uses the ASCII residue when it is meaningful (>=3 letters)', () => {
    // A 3+ letter residue is kept (link-compatible with a same-named desktop
    // file); the stripped Arabic + dash leaves the residue "_abc".
    expect(deriveProcessId('طلب-abc')).toBe('Process__abc')
  })

  it('does NOT regress pure-Latin or empty names', () => {
    expect(deriveProcessId('order')).toBe('Process_order')
    expect(deriveProcessId('order-refund')).toBe('Process_order_refund')
    expect(deriveProcessId('')).toBe('Process_process')
    expect(deriveProcessId('***')).toBe('Process_process')
  })
})

describe('buildNewProcessDoc — mixed names get distinct ids (ORIG-6a)', () => {
  it('two mixed Arabic/ASCII names produce two different <process id>s', () => {
    const a = buildNewProcessDoc('طلب A')
    const b = buildNewProcessDoc('موافقة A')
    expect(a.processId).not.toBe(b.processId)
    expect(a.processId).toMatch(/^Process_[0-9a-f]{8}$/)
  })
})

describe('buildNewProcessDoc — id de-dup against the live index (ORIG-6b)', () => {
  it('suffixes _2 when the derived (hashed) id already exists in the index', () => {
    const base = buildNewProcessDoc('طلب العميل') // hashed id
    const taken = new Set([base.processId])
    const doc = buildNewProcessDoc('طلب العميل', undefined, (candidate) => taken.has(candidate))
    expect(doc.processId).toBe(`${base.processId}_2`)
  })

  it('leaves the id unchanged when the index has no collision', () => {
    const doc = buildNewProcessDoc('طلب العميل', undefined, () => false)
    expect(doc.processId).toMatch(/^Process_[0-9a-f]{8}$/)
  })
})
