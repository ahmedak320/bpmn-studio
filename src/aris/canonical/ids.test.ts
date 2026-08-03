import { describe, expect, it } from 'vitest'

import {
  CANONICAL_SAFE_ID_PATTERN,
  assertSafeCanonicalId,
  isSafeCanonicalId,
  mintCanonicalId
} from './ids'

describe('isSafeCanonicalId', () => {
  it('accepts letters, digits, dot, underscore, hyphen (ULID/UUID/prefixed shapes)', () => {
    for (const id of [
      'n-start',
      'node_01J9XABCDEFGHJKMNPQRSTVWXYZ',
      'decision_6f9619ff-8b86-d011-b42d-00cf4fc964ff',
      'role.survey-section',
      'a',
      'A1._-'
    ]) {
      expect(isSafeCanonicalId(id)).toBe(true)
    }
  })

  it('rejects the colon that the projection reserves as a delimiter', () => {
    expect(isSafeCanonicalId('has:colon')).toBe(false)
    // The concrete collision the safe alphabet prevents: two id pairs that would
    // otherwise map to the same `xo:<decisionId>:<outcomeId>` draft id.
    expect(isSafeCanonicalId('d:1')).toBe(false)
  })

  it('rejects whitespace, slashes, other punctuation, unicode, and the empty string', () => {
    for (const id of ['has space', 'has/slash', 'has#hash', 'has%pct', '', 'مرحبا', 'a\tb', 'a\nb']) {
      expect(isSafeCanonicalId(id)).toBe(false)
    }
  })

  it('is anchored (a safe core with an unsafe suffix/prefix is rejected)', () => {
    expect(isSafeCanonicalId('ok:then')).toBe(false)
    expect(isSafeCanonicalId(':lead')).toBe(false)
    expect(isSafeCanonicalId('trail:')).toBe(false)
  })
})

describe('assertSafeCanonicalId', () => {
  it('does not throw for a safe id', () => {
    expect(() => assertSafeCanonicalId('node_01J9X')).not.toThrow()
  })

  it('throws a message naming the offending id and the pattern', () => {
    expect(() => assertSafeCanonicalId('bad:id')).toThrow(/bad:id/)
    expect(() => assertSafeCanonicalId('bad:id')).toThrow(/\[A-Za-z0-9\._-\]/)
  })

  it('includes the caller-supplied context in the message', () => {
    expect(() => assertSafeCanonicalId('bad:prefix', 'canonical id prefix')).toThrow(
      /canonical id prefix/
    )
  })
})

describe('mintCanonicalId', () => {
  it('produces <prefix>_<entropy> and is deterministic under an injected entropy source', () => {
    expect(mintCanonicalId('node', () => '01J9XABC')).toBe('node_01J9XABC')
    expect(mintCanonicalId('decision', () => '01J9XABC')).toBe('decision_01J9XABC')
  })

  it('always returns a safe id (default UUID entropy)', () => {
    const id = mintCanonicalId('role')
    expect(isSafeCanonicalId(id)).toBe(true)
    expect(id.startsWith('role_')).toBe(true)
  })

  it('is collision-resistant: two default mints differ', () => {
    expect(mintCanonicalId('node')).not.toBe(mintCanonicalId('node'))
  })

  it('rejects an unsafe prefix at the mint site', () => {
    expect(() => mintCanonicalId('bad:prefix')).toThrow(/canonical id prefix/)
  })

  it('rejects injected entropy that would make the assembled id unsafe', () => {
    expect(() => mintCanonicalId('node', () => 'has:colon')).toThrow(/minted canonical id/)
  })
})

describe('CANONICAL_SAFE_ID_PATTERN', () => {
  it('is exported for adapters that want to validate their own id sets', () => {
    expect(CANONICAL_SAFE_ID_PATTERN.test('node_1')).toBe(true)
    expect(CANONICAL_SAFE_ID_PATTERN.test('node:1')).toBe(false)
  })
})
