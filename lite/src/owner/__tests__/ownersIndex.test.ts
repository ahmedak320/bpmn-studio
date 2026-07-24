import { describe, it, expect } from 'vitest'
import {
  collectOwners,
  filterOwners,
  mergeOwners,
  ownerAdditionsFromValues,
  upsertSessionOwners,
  type OwnerEntry,
  type SessionOwner
} from '../ownersIndex'

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

describe('mergeOwners', () => {
  const disk: OwnerEntry[] = [
    { name: 'Alice', type: 'individual', count: 5 },
    { name: 'Sales', type: 'department', count: 2 }
  ]

  it('returns the disk entries unchanged for an empty session', () => {
    expect(mergeOwners(disk, [])).toEqual(disk)
    expect(mergeOwners([], [])).toEqual([])
  })

  it('disk wins for an existing name: casing, type and count all kept', () => {
    const session: SessionOwner[] = [{ name: 'ALICE', type: 'department', count: 9 }]
    const merged = mergeOwners(disk, session)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual({ name: 'Alice', type: 'individual', count: 5 })
  })

  it('matches disk names case-insensitively (mixed-case session collision)', () => {
    const session: SessionOwner[] = [{ name: 'sales', count: 1 }]
    expect(mergeOwners(disk, session)).toHaveLength(2)
  })

  it('appends session-only names with their session count and type', () => {
    const session: SessionOwner[] = [{ name: 'Nadia', type: 'individual', count: 1 }]
    const merged = mergeOwners(disk, session)
    expect(merged.map((e) => e.name)).toEqual(['Alice', 'Sales', 'Nadia'])
    expect(merged[2]).toEqual({ name: 'Nadia', type: 'individual', count: 1 })
  })

  it('re-sorts count desc then name asc across disk + session entries', () => {
    const session: SessionOwner[] = [
      { name: 'Big Team', count: 7 },
      { name: 'Aaron', count: 2 } // ties Sales on count — wins on name
    ]
    expect(mergeOwners(disk, session).map((e) => e.name)).toEqual([
      'Big Team',
      'Alice',
      'Aaron',
      'Sales'
    ])
  })

  it('passes session owners through when the disk is empty', () => {
    const session: SessionOwner[] = [
      { name: 'Zed', count: 1 },
      { name: 'Amy', type: 'individual', count: 3 }
    ]
    expect(mergeOwners([], session).map((e) => e.name)).toEqual(['Amy', 'Zed'])
  })

  it('does not mutate its inputs', () => {
    const diskCopy = disk.map((e) => ({ ...e }))
    const session: SessionOwner[] = [{ name: 'Nadia', count: 1 }]
    const sessionCopy = session.map((e) => ({ ...e }))
    mergeOwners(disk, session)
    expect(disk).toEqual(diskCopy)
    expect(session).toEqual(sessionCopy)
  })
})

describe('upsertSessionOwners', () => {
  it('adds a new trimmed owner with count 1 and a validated type', () => {
    const next = upsertSessionOwners([], [{ name: '  Nadia  ', type: 'individual' }])
    expect(next).toEqual([{ name: 'Nadia', count: 1, type: 'individual' }])
  })

  it('increments the count per addition, case-insensitively, keeping first-seen casing', () => {
    let owners = upsertSessionOwners([], [{ name: 'Bob Smith' }])
    owners = upsertSessionOwners(owners, [{ name: 'BOB SMITH' }])
    owners = upsertSessionOwners(owners, [{ name: 'bob smith' }])
    expect(owners).toEqual([{ name: 'Bob Smith', count: 3 }])
  })

  it('a non-empty incoming type fills an UNSET type but never clobbers a set one', () => {
    let owners = upsertSessionOwners([], [{ name: 'Erin' }])
    expect(owners[0].type).toBeUndefined()
    owners = upsertSessionOwners(owners, [{ name: 'Erin', type: 'department' }])
    expect(owners[0].type).toBe('department')
    owners = upsertSessionOwners(owners, [{ name: 'Erin', type: 'individual' }])
    expect(owners[0]).toEqual({ name: 'Erin', count: 3, type: 'department' })
  })

  it('ignores invalid type strings', () => {
    const owners = upsertSessionOwners([], [{ name: 'Frank', type: 'bogus' }])
    expect(owners).toEqual([{ name: 'Frank', count: 1 }])
  })

  it('skips blank names and returns the SAME array when nothing valid was added', () => {
    const prev: SessionOwner[] = [{ name: 'Alice', count: 1 }]
    expect(upsertSessionOwners(prev, [{ name: '' }, { name: '   ' }])).toBe(prev)
    expect(upsertSessionOwners(prev, [])).toBe(prev)
  })

  it('is immutable: prev is never mutated by an upsert', () => {
    const prev: SessionOwner[] = [{ name: 'Alice', count: 1 }]
    const next = upsertSessionOwners(prev, [{ name: 'Alice' }, { name: 'New Person' }])
    expect(prev).toEqual([{ name: 'Alice', count: 1 }])
    expect(next).toEqual([
      { name: 'Alice', count: 2 },
      { name: 'New Person', count: 1 }
    ])
    expect(next).not.toBe(prev)
  })

  it('handles several additions from one apply in a single call', () => {
    const next = upsertSessionOwners(
      [],
      [
        { name: 'Operations', type: 'department' },
        { name: 'Sara', type: 'individual' },
        { name: 'Omar', type: 'individual' }
      ]
    )
    expect(next.map((e) => e.name)).toEqual(['Operations', 'Sara', 'Omar'])
    expect(next.every((e) => e.count === 1)).toBe(true)
  })
})

describe('ownerAdditionsFromValues', () => {
  it('emits the owner field with its type', () => {
    expect(
      ownerAdditionsFromValues({ owner: 'Operations', ownerType: 'department', respList: '' })
    ).toEqual([{ name: 'Operations', type: 'department' }])
  })

  it('emits the owner without a type key when the type is blank', () => {
    expect(ownerAdditionsFromValues({ owner: 'Alice', ownerType: '', respList: '' })).toEqual([
      { name: 'Alice' }
    ])
  })

  it('skips a blank owner field', () => {
    expect(ownerAdditionsFromValues({ owner: '   ', ownerType: 'individual', respList: '' })).toEqual(
      []
    )
  })

  it('extracts each respList person as an individual, splitting "Name — Role" lines', () => {
    expect(
      ownerAdditionsFromValues({
        owner: '',
        ownerType: '',
        respList: 'Sara — Approver\nOmar'
      })
    ).toEqual([
      { name: 'Sara', type: 'individual' },
      { name: 'Omar', type: 'individual' }
    ])
  })

  it('splits ONLY on the exact space-em-dash-space separator', () => {
    expect(
      ownerAdditionsFromValues({
        owner: '',
        ownerType: '',
        respList: 'Jean-Pierre\nA—B\nSara — Lead'
      })
    ).toEqual([
      { name: 'Jean-Pierre', type: 'individual' },
      { name: 'A—B', type: 'individual' },
      { name: 'Sara', type: 'individual' }
    ])
  })

  it('splits on the FIRST separator only', () => {
    expect(
      ownerAdditionsFromValues({ owner: '', ownerType: '', respList: 'Sara — Lead — Ops' })
    ).toEqual([{ name: 'Sara', type: 'individual' }])
  })

  it('drops blank respList lines and combines owner + respList additions', () => {
    expect(
      ownerAdditionsFromValues({
        owner: 'Operations',
        ownerType: 'department',
        respList: '\n  \nSara — Approver\n'
      })
    ).toEqual([
      { name: 'Operations', type: 'department' },
      { name: 'Sara', type: 'individual' }
    ])
  })
})
