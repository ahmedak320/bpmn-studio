import { describe, expect, it } from 'vitest'

import type {
  CanonicalControl,
  CanonicalInformationObject,
  CanonicalProcessV1,
  CanonicalRole,
  CanonicalSystem
} from './contract'
import { computeDefaults, computeSuppressedSatelliteDraftIds } from './defaults'

/** Minimal well-typed process carrying only the satellite arrays a case needs. */
function mk(partial: {
  roles?: readonly CanonicalRole[]
  systems?: readonly CanonicalSystem[]
  informationObjects?: readonly CanonicalInformationObject[]
  controls?: readonly CanonicalControl[]
}): CanonicalProcessV1 {
  return {
    version: 1,
    identity: { id: 'p', names: { en: 'P' }, confidence: 'high' },
    nodes: [],
    decisions: [],
    edges: [],
    roles: partial.roles ?? [],
    systems: partial.systems ?? [],
    informationObjects: partial.informationObjects ?? [],
    controls: partial.controls ?? [],
    facts: [],
    unknowns: []
  }
}

const role = (
  id: string,
  nodeIds: readonly string[],
  extra: { owner?: boolean; en?: string } = {}
): CanonicalRole => ({
  id,
  names: { en: extra.en ?? id },
  nodeIds,
  ...(extra.owner !== undefined ? { owner: extra.owner } : {}),
  confidence: 'high'
})

const system = (
  id: string,
  nodeIds: readonly string[],
  extra: { default?: boolean } = {}
): CanonicalSystem => ({
  id,
  names: { en: id },
  nodeIds,
  ...(extra.default !== undefined ? { default: extra.default } : {}),
  confidence: 'high'
})

describe('computeDefaults — owner', () => {
  it('declared: a single role.owner:true wins', () => {
    const defaults = computeDefaults(
      mk({ roles: [role('r-a', ['n1']), role('r-owner', ['n2'], { owner: true, en: 'Team' })] })
    )
    expect(defaults.owner).toEqual({ id: 'r-owner', names: { en: 'Team' } })
  })

  it('declared conflict: two owner:true roles yield NO owner default', () => {
    const defaults = computeDefaults(
      mk({ roles: [role('r-a', ['n1'], { owner: true }), role('r-b', ['n2'], { owner: true })] })
    )
    expect(defaults.owner).toBeUndefined()
  })

  it('auto-majority: >=60% of the owner set with a unique top wins', () => {
    // owner set {n1,n2,n3,n4}; r-a = 3/4 = 75% >= 60%, unique.
    const defaults = computeDefaults(
      mk({ roles: [role('r-a', ['n1', 'n2', 'n3']), role('r-b', ['n4'])] })
    )
    expect(defaults.owner?.id).toBe('r-a')
  })

  it('tie: two roles sharing the top count yield NO default', () => {
    // owner set {n1,n2,n3,n4}; both 2/4 — a tie.
    const defaults = computeDefaults(
      mk({ roles: [role('r-a', ['n1', 'n2']), role('r-b', ['n3', 'n4'])] })
    )
    expect(defaults.owner).toBeUndefined()
  })

  it('sub-majority: a unique top below 60% yields NO default', () => {
    // owner set {n1..n5}; r-a = 2/5 = 40% < 60% though it is the unique top.
    const defaults = computeDefaults(
      mk({
        roles: [
          role('r-a', ['n1', 'n2']),
          role('r-b', ['n3']),
          role('r-c', ['n4']),
          role('r-d', ['n5'])
        ]
      })
    )
    expect(defaults.owner).toBeUndefined()
  })
})

describe('computeDefaults — system / information / control + mixed', () => {
  it('declared system.default:true wins over a would-be majority', () => {
    const defaults = computeDefaults(
      mk({
        systems: [system('s-big', ['n1', 'n2', 'n3']), system('s-small', ['n4'], { default: true })]
      })
    )
    expect(defaults.system?.id).toBe('s-small')
  })

  it('two system.default:true yield NO system default', () => {
    const defaults = computeDefaults(
      mk({
        systems: [
          system('s-a', ['n1'], { default: true }),
          system('s-b', ['n2'], { default: true })
        ]
      })
    )
    expect(defaults.system).toBeUndefined()
  })

  it('mixed: declared owner + auto-majority system in one process', () => {
    const defaults = computeDefaults(
      mk({
        roles: [role('r-owner', ['n1'], { owner: true })],
        systems: [system('s-main', ['n1', 'n2', 'n3']), system('s-side', ['n4'])]
      })
    )
    expect(defaults.owner?.id).toBe('r-owner')
    expect(defaults.system?.id).toBe('s-main') // 3/4 = 75%
    expect(defaults.informationObject).toBeUndefined()
    expect(defaults.control).toBeUndefined()
  })

  it('information object majority unions input + output owner nodes', () => {
    const defaults = computeDefaults(
      mk({
        informationObjects: [
          {
            id: 'io-a',
            names: { en: 'A' },
            inputToNodeIds: ['n1'],
            outputOfNodeIds: ['n2', 'n3'],
            confidence: 'high'
          },
          {
            id: 'io-b',
            names: { en: 'B' },
            inputToNodeIds: ['n4'],
            outputOfNodeIds: [],
            confidence: 'high'
          }
        ]
      })
    )
    // owner set {n1,n2,n3,n4}; io-a = 3/4 = 75%.
    expect(defaults.informationObject?.id).toBe('io-a')
  })
})

describe('computeSuppressedSatelliteDraftIds', () => {
  it('drops a default satellite only where it is the SOLE satellite of its kind', () => {
    // r-owner on n1 (alone) and n2 (shared with r-vet). Suppress r:r-owner@n1
    // only; n2 keeps BOTH (r-vet is an override that must stay visible).
    const process = mk({
      roles: [role('r-owner', ['n1', 'n2'], { owner: true }), role('r-vet', ['n2'])]
    })
    const defaults = computeDefaults(process)
    expect(defaults.owner?.id).toBe('r-owner')
    const suppressed = computeSuppressedSatelliteDraftIds(process, defaults)
    expect([...suppressed]).toEqual(['r:r-owner@n1'])
    expect(suppressed.has('r:r-owner@n2')).toBe(false)
    expect(suppressed.has('r:r-vet@n2')).toBe(false)
  })

  it('suppresses every occurrence of a default that never has an override', () => {
    const process = mk({ roles: [role('r-owner', ['n1', 'n2', 'n3'], { owner: true })] })
    const suppressed = computeSuppressedSatelliteDraftIds(process, computeDefaults(process))
    expect([...suppressed].sort()).toEqual(['r:r-owner@n1', 'r:r-owner@n2', 'r:r-owner@n3'])
  })

  it('suppresses nothing when there is no default for the kind', () => {
    // Tie → no owner default → no suppression.
    const process = mk({ roles: [role('r-a', ['n1']), role('r-b', ['n2'])] })
    const suppressed = computeSuppressedSatelliteDraftIds(process, computeDefaults(process))
    expect(suppressed.size).toBe(0)
  })
})
