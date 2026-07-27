import { describe, expect, it } from 'vitest'
import { boundHistoryPreview } from './preview'

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
      } else {
        return true
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

describe('bounded history preview', () => {
  it('counts code points exactly and never splits a supplementary character', () => {
    const source = `ab😀جcd`
    const bounded = boundHistoryPreview(source, 3)

    expect(bounded).toEqual({
      text: 'ab😀',
      shownCodePoints: 3,
      omittedCodePoints: 3,
      totalCodePoints: 6
    })
    expect(Array.from(bounded.text)).toHaveLength(3)
    expect(containsLoneSurrogate(bounded.text)).toBe(false)
  })

  it('replaces synthetic lone surrogates in display text without miscounting omissions', () => {
    const bounded = boundHistoryPreview(`A\ud83dB\udc00C`, 4)

    expect(bounded.text).toBe('A�B�')
    expect(bounded.shownCodePoints).toBe(4)
    expect(bounded.omittedCodePoints).toBe(1)
    expect(bounded.totalCodePoints).toBe(5)
    expect(containsLoneSurrogate(bounded.text)).toBe(false)
  })
})
