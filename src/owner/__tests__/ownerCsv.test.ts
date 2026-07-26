import { describe, it, expect } from 'vitest'
import { ownersToCsv } from '../ownerCsv'
import type { OwnerEntry } from '../ownersIndex'

describe('ownersToCsv', () => {
  it('starts with a UTF-8 BOM', () => {
    const csv = ownersToCsv([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('emits the header row with CRLF line endings', () => {
    const csv = ownersToCsv([])
    expect(csv).toBe('﻿' + 'name,type,usage_count' + '\r\n')
  })

  it('emits one row per entry with type defaulting to empty', () => {
    const entries: OwnerEntry[] = [
      { name: 'Alice', type: 'individual', count: 3 },
      { name: 'Sales', count: 1 }
    ]
    const csv = ownersToCsv(entries)
    const expected =
      '﻿' +
      'name,type,usage_count\r\n' +
      'Alice,individual,3\r\n' +
      'Sales,,1\r\n'
    expect(csv).toBe(expected)
  })

  it('quotes fields containing commas', () => {
    const csv = ownersToCsv([{ name: 'Doe, Jane', count: 1 }])
    expect(csv).toContain('"Doe, Jane",,1')
  })

  it('quotes fields containing double quotes and doubles the inner quote', () => {
    const csv = ownersToCsv([{ name: 'The "Boss"', count: 1 }])
    expect(csv).toContain('"The ""Boss""",,1')
  })

  it('quotes fields containing newlines', () => {
    const csv = ownersToCsv([{ name: 'Line1\nLine2', count: 1 }])
    expect(csv).toContain('"Line1\nLine2",,1')
  })

  it('does not quote plain fields', () => {
    const csv = ownersToCsv([{ name: 'Plain', type: 'department', count: 5 }])
    expect(csv).toContain('Plain,department,5')
  })

  it('quotes fields containing carriage returns', () => {
    const csv = ownersToCsv([{ name: 'Weird\rName', count: 1 }])
    expect(csv).toContain('"Weird\rName",,1')
  })
})
