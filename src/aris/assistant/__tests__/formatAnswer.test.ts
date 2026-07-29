import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import { formatAnswer } from '../formatAnswer'
import { routeQuestion } from '../questionRouter'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

describe('formatAnswer', () => {
  const digests = [buildDigest(buildSyntheticModel()), buildDigest(buildSecondSyntheticModel())]

  it('resolves message keys + vars into display strings per language, preserving chips', () => {
    const answer = routeQuestion(digests, 'What comes next after Register owner profile?', 'en')
    const formatted = formatAnswer('en', answer)
    expect(formatted.lines[0]?.text).toBe(
      'After Register owner profile, the process continues with:'
    )
    expect(formatted.chips.length).toBeGreaterThan(0)
  })

  it('resolves the Arabic dictionary for the same answer data', () => {
    const answer = routeQuestion(digests, 'What comes next after Register owner profile?', 'en')
    const formatted = formatAnswer('ar', answer)
    expect(formatted.lines[0]?.text).toContain('Register owner profile')
    expect(formatted.lines[0]?.text).not.toBe(
      'After Register owner profile, the process continues with:'
    )
  })
})
