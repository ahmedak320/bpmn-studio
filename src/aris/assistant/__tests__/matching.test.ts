import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import { bestTokenMatch } from '../matching'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

describe('bestTokenMatch — positive-confidence-only matching rule', () => {
  const m1 = buildDigest(buildSyntheticModel())
  const m2 = buildDigest(buildSecondSyntheticModel())

  it('returns null when no candidate shares any token with the query', () => {
    const candidates = m1.steps.map((s) => ({ digest: m1, tokens: [s.name], value: s }))
    expect(bestTokenMatch(candidates, 'xyzzy qwertyzzz')).toBeNull()
  })

  it('returns null on an exact score tie between two candidates', () => {
    const candidates = [
      { digest: m1, tokens: ['alpha', 'beta'], value: 'a' },
      { digest: m1, tokens: ['alpha', 'gamma'], value: 'b' }
    ]
    // Both candidates share exactly one token ("alpha") with the query — a tie.
    expect(bestTokenMatch(candidates, 'alpha')).toBeNull()
  })

  it('returns null when a close (non-tied) rival sits in a DIFFERENT model, even though the top score is unique', () => {
    const candidates = [
      { digest: m1, tokens: ['alpha', 'beta', 'gamma', 'delta'], value: 'a' },
      { digest: m2, tokens: ['alpha', 'beta'], value: 'b' }
    ]
    // m1 scores 3 (alpha/beta/gamma), m2 scores 2 (alpha/beta) — a unique top
    // score, but within 1 point of a rival in a DIFFERENT model, so the match
    // is refused rather than guessed.
    expect(bestTokenMatch(candidates, 'alpha beta gamma')).toBeNull()
  })

  it('confidently resolves a unique, unambiguous winner', () => {
    const candidates = [
      { digest: m1, tokens: ['register', 'owner', 'profile'], value: 'fn1' },
      { digest: m2, tokens: ['administer', 'vaccine'], value: 'fn2' }
    ]
    const match = bestTokenMatch(candidates, 'Register owner profile')
    expect(match?.value).toBe('fn1')
    expect(match?.digest).toBe(m1)
  })

  it('is deterministic', () => {
    const candidates = [
      { digest: m1, tokens: ['register', 'owner', 'profile'], value: 'fn1' },
      { digest: m2, tokens: ['administer', 'vaccine'], value: 'fn2' }
    ]
    const first = bestTokenMatch(candidates, 'Register owner profile')
    const second = bestTokenMatch(candidates, 'Register owner profile')
    expect(second).toEqual(first)
  })
})
