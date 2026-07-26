import { describe, it, expect } from 'vitest'
import {
  emptyHistory,
  pushHistory,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  currentEntry,
  pruneHistory
} from '../workspace/navHistory'

const yes = (): boolean => true

function build(...keys: string[]): ReturnType<typeof emptyHistory> {
  return keys.reduce((h, k) => pushHistory(h, k), emptyHistory())
}

describe('pushHistory', () => {
  it('appends and moves the cursor to the end', () => {
    const h = build('a', 'b', 'c')
    expect(h.entries).toEqual(['a', 'b', 'c'])
    expect(currentEntry(h)).toBe('c')
  })
  it('re-pushing the current entry is a no-op', () => {
    const h = pushHistory(build('a', 'b'), 'b')
    expect(h.entries).toEqual(['a', 'b'])
  })
  it('pushing after going back truncates the forward entries', () => {
    let h = build('a', 'b', 'c')
    h = goBack(h, yes) // → b
    h = pushHistory(h, 'd')
    expect(h.entries).toEqual(['a', 'b', 'd'])
    expect(currentEntry(h)).toBe('d')
  })
})

describe('goBack / goForward', () => {
  it('walks the cursor back and forward', () => {
    let h = build('a', 'b', 'c')
    h = goBack(h, yes)
    expect(currentEntry(h)).toBe('b')
    h = goBack(h, yes)
    expect(currentEntry(h)).toBe('a')
    h = goBack(h, yes) // nowhere to go
    expect(currentEntry(h)).toBe('a')
    h = goForward(h, yes)
    expect(currentEntry(h)).toBe('b')
  })

  it('skips entries that no longer exist', () => {
    const h = build('a', 'b', 'c') // cursor at c
    const exists = (k: string): boolean => k !== 'b'
    const back = goBack(h, exists)
    expect(currentEntry(back)).toBe('a') // skipped the dead 'b'
  })

  it('canGoBack / canGoForward respect the predicate', () => {
    const h = build('a', 'b') // cursor at b
    expect(canGoBack(h, yes)).toBe(true)
    expect(canGoForward(h, yes)).toBe(false)
    // if the only earlier entry is dead, back is impossible
    expect(canGoBack(h, (k) => k === 'b')).toBe(false)
  })
})

describe('pruneHistory', () => {
  it('drops dead keys and keeps the cursor on the current entry', () => {
    let h = build('a', 'b', 'c', 'd')
    h = goBack(h, yes) // cursor at c
    const pruned = pruneHistory(h, (k) => k !== 'b')
    expect(pruned.entries).toEqual(['a', 'c', 'd'])
    expect(currentEntry(pruned)).toBe('c')
  })
  it('returns the same history when nothing is dead', () => {
    const h = build('a', 'b')
    expect(pruneHistory(h, yes)).toBe(h)
  })
})
