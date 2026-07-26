import { describe, expect, it } from 'vitest'
import { sha256Hex, stableHash } from './hash'

describe('deterministic hashes', () => {
  it('matches published SHA-256 vectors without a Node dependency', () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    expect(sha256Hex(encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(sha256Hex(encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('creates stable, input-sensitive non-cryptographic signatures', () => {
    expect(stableHash('same')).toBe(stableHash('same'))
    expect(stableHash('same')).not.toBe(stableHash('different'))
    expect(stableHash('same')).toMatch(/^[0-9a-f]{16}$/)
  })
})

