import { describe, it, expect } from 'vitest'
import { collectOwners, filterOwners, type OwnerEntry } from '../ownersIndex'

describe('collectOwners', () => {
  it('aggregates across multiple tags and files', () => {
    const files = [
      {
        relPath: 'a.bpmn',
        xml: `<bpmn:process id="P1"><bpmn:task id="T1" orbitpm:owner="Alice" orbitpm:ownerType="individual"/><bpmn:task id="T2" orbitpm:owner="Alice" orbitpm:ownerType="individual"/></bpmn:process>`
      },
      {
        relPath: 'b.bpmn',
        xml: `<bpmn:startEvent id="S1" orbitpm:owner="Sales" orbitpm:ownerType="department"/>`
      }
    ]
    const entries = collectOwners(files)
    expect(entries).toHaveLength(2)
    const alice = entries.find((e) => e.name === 'Alice')
    expect(alice).toEqual<OwnerEntry>({ name: 'Alice', type: 'individual', count: 2 })
    const sales = entries.find((e) => e.name === 'Sales')
    expect(sales).toEqual<OwnerEntry>({ name: 'Sales', type: 'department', count: 1 })
  })

  it('merges names case-insensitively and keeps first-seen casing', () => {
    const files = [
      { relPath: 'a.bpmn', xml: `<task orbitpm:owner="Bob Smith"/>` },
      { relPath: 'b.bpmn', xml: `<task orbitpm:owner="BOB SMITH"/>` },
      { relPath: 'c.bpmn', xml: `<task orbitpm:owner="bob smith"/>` }
    ]
    const entries = collectOwners(files)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Bob Smith')
    expect(entries[0].count).toBe(3)
  })

  it('decodes XML entities in owner and ownerType values', () => {
    const files = [
      {
        relPath: 'a.bpmn',
        xml: `<task orbitpm:owner="R&amp;D Team" orbitpm:ownerType="department"/>`
      }
    ]
    const entries = collectOwners(files)
    expect(entries[0].name).toBe('R&D Team')
  })

  it('trims whitespace and skips empty owner values', () => {
    const files = [
      { relPath: 'a.bpmn', xml: `<task orbitpm:owner="  Carol  "/>` },
      { relPath: 'b.bpmn', xml: `<task orbitpm:owner=""/>` },
      { relPath: 'c.bpmn', xml: `<task orbitpm:owner="   "/>` }
    ]
    const entries = collectOwners(files)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Carol')
  })

  it('supports single-quoted attributes', () => {
    const files = [{ relPath: 'a.bpmn', xml: `<task orbitpm:owner='Dana' orbitpm:ownerType='individual'/>` }]
    const entries = collectOwners(files)
    expect(entries[0]).toEqual({ name: 'Dana', type: 'individual', count: 1 })
  })

  it('picks the most frequent non-empty type for a merged owner', () => {
    const files = [
      { relPath: 'a.bpmn', xml: `<task orbitpm:owner="Erin" orbitpm:ownerType="individual"/>` },
      { relPath: 'b.bpmn', xml: `<task orbitpm:owner="Erin" orbitpm:ownerType="department"/>` },
      { relPath: 'c.bpmn', xml: `<task orbitpm:owner="Erin" orbitpm:ownerType="department"/>` },
      { relPath: 'd.bpmn', xml: `<task orbitpm:owner="Erin"/>` }
    ]
    const entries = collectOwners(files)
    expect(entries[0]).toEqual({ name: 'Erin', type: 'department', count: 4 })
  })

  it('ignores unknown ownerType values', () => {
    const files = [{ relPath: 'a.bpmn', xml: `<task orbitpm:owner="Frank" orbitpm:ownerType="bogus"/>` }]
    const entries = collectOwners(files)
    expect(entries[0].type).toBeUndefined()
  })

  it('leaves type undefined when never provided', () => {
    const files = [{ relPath: 'a.bpmn', xml: `<task orbitpm:owner="Grace"/>` }]
    const entries = collectOwners(files)
    expect(entries[0].type).toBeUndefined()
  })

  it('scans every tag, not just process tags', () => {
    const files = [
      {
        relPath: 'a.bpmn',
        xml: `<bpmn:process id="P1" orbitpm:owner="ProcOwner"><bpmn:callActivity id="C1" orbitpm:owner="CallOwner"/><bpmn:endEvent id="E1" orbitpm:owner="EndOwner"/></bpmn:process>`
      }
    ]
    const entries = collectOwners(files)
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['CallOwner', 'EndOwner', 'ProcOwner'])
  })

  it('sorts by count desc then name asc', () => {
    const files = [
      { relPath: 'a.bpmn', xml: `<task orbitpm:owner="Zed"/><task orbitpm:owner="Zed"/>` },
      { relPath: 'b.bpmn', xml: `<task orbitpm:owner="Amy"/><task orbitpm:owner="Amy"/>` },
      { relPath: 'c.bpmn', xml: `<task orbitpm:owner="Bea"/>` }
    ]
    const entries = collectOwners(files)
    expect(entries.map((e) => e.name)).toEqual(['Amy', 'Zed', 'Bea'])
  })

  it('handles empty file list and empty xml', () => {
    expect(collectOwners([])).toEqual([])
    expect(collectOwners([{ relPath: 'a.bpmn', xml: '' }])).toEqual([])
  })
})

describe('filterOwners', () => {
  const entries: OwnerEntry[] = [
    { name: 'Alice', type: 'individual', count: 3 },
    { name: 'Bob Smith', type: 'individual', count: 2 },
    { name: 'Sales', type: 'department', count: 1 }
  ]

  it('returns all entries for an empty or whitespace query', () => {
    expect(filterOwners(entries, '')).toEqual(entries)
    expect(filterOwners(entries, '   ')).toEqual(entries)
  })

  it('matches case-insensitive substrings', () => {
    expect(filterOwners(entries, 'bob').map((e) => e.name)).toEqual(['Bob Smith'])
    expect(filterOwners(entries, 'ALI').map((e) => e.name)).toEqual(['Alice'])
  })

  it('trims the query before matching', () => {
    expect(filterOwners(entries, '  sales  ').map((e) => e.name)).toEqual(['Sales'])
  })

  it('returns empty array when nothing matches', () => {
    expect(filterOwners(entries, 'zzz')).toEqual([])
  })
})
