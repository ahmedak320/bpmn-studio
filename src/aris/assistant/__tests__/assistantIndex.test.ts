import { describe, expect, it } from 'vitest'

import {
  AssistantIndexCache,
  buildAssistantIndex,
  filterIndexableEntries,
  isOrbitpmInternalPath,
  updateAssistantIndex,
  type ArisAssistantIndexEntryInput
} from '../assistantIndex'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

function entry(relPath: string, model = buildSyntheticModel()): ArisAssistantIndexEntryInput {
  return { relPath, model: { ...model, relPath } }
}

describe('isOrbitpmInternalPath / filterIndexableEntries', () => {
  it('flags any path with a .orbitpm segment', () => {
    expect(isOrbitpmInternalPath('.orbitpm/export.aml')).toBe(true)
    expect(isOrbitpmInternalPath('processes/.orbitpm/backup.aml')).toBe(true)
    expect(isOrbitpmInternalPath('processes/owner-registration.aml')).toBe(false)
  })

  it('directory mode keeps only supported AML/XML extensions and excludes .orbitpm', () => {
    const entries = [
      entry('processes/owner-registration.aml'),
      entry('processes/notes.txt'),
      entry('.orbitpm/export.xml')
    ]
    const kept = filterIndexableEntries('directory', entries).map((e) => e.relPath)
    expect(kept).toEqual(['processes/owner-registration.aml'])
  })

  it('portable mode keeps caller-scoped entries but still excludes .orbitpm', () => {
    const entries = [entry('packages/pack-a/model.aml'), entry('packages/pack-a/.orbitpm/dup.aml')]
    const kept = filterIndexableEntries('portable', entries).map((e) => e.relPath)
    expect(kept).toEqual(['packages/pack-a/model.aml'])
  })

  it('single-file mode keeps caller-scoped entries but still excludes .orbitpm', () => {
    const entries = [entry('active.aml'), entry('.orbitpm/active.aml')]
    const kept = filterIndexableEntries('single-file', entries).map((e) => e.relPath)
    expect(kept).toEqual(['active.aml'])
  })
})

describe('buildAssistantIndex', () => {
  it('digests every kept entry for the given mode', () => {
    const index = buildAssistantIndex({
      mode: 'directory',
      entries: [entry('processes/owner-registration.aml'), entry('.orbitpm/dup.aml')]
    })
    expect(index.digests).toHaveLength(1)
    expect(index.digests[0].modelId).toBe('m1')
  })
})

describe('AssistantIndexCache — invalidate only changed models', () => {
  it('reuses the exact same digest object for an unrelated model when only one model changes', () => {
    const cache = new AssistantIndexCache()
    const m1 = buildSyntheticModel()
    const m2 = buildSecondSyntheticModel()

    const first = cache.update([m1, m2])
    expect([...first.changedModelIds].sort()).toEqual(['m1', 'm2'])
    const m2DigestFirst = first.digests.find((d) => d.modelId === 'm2')

    const m1Revised = { ...m1, revision: 2, sourceDigest: 'digest-m1-rev2' }
    const second = cache.update([m1Revised, m2])

    expect(second.changedModelIds).toEqual(['m1'])
    const m2DigestSecond = second.digests.find((d) => d.modelId === 'm2')
    // Identity, not just equality: m2's cache entry was never touched.
    expect(m2DigestSecond).toBe(m2DigestFirst)

    const m1DigestSecond = second.digests.find((d) => d.modelId === 'm1')
    expect(m1DigestSecond).not.toBe(first.digests.find((d) => d.modelId === 'm1'))
  })

  it('does not rebuild when neither revision nor source digest changed', () => {
    const cache = new AssistantIndexCache()
    const m1 = buildSyntheticModel()
    const first = cache.update([m1])
    const second = cache.update([m1])
    expect(second.changedModelIds).toEqual([])
    expect(second.digests[0]).toBe(first.digests[0])
  })

  it('rebuilds when the source digest changes even if the revision counter did not', () => {
    const cache = new AssistantIndexCache()
    const m1 = buildSyntheticModel()
    const first = cache.update([m1])
    const second = cache.update([{ ...m1, sourceDigest: 'different-hash' }])
    expect(second.changedModelIds).toEqual(['m1'])
    expect(second.digests[0]).not.toBe(first.digests[0])
  })

  it('drops a model from the cache when it is absent from a later update', () => {
    const cache = new AssistantIndexCache()
    const m1 = buildSyntheticModel()
    const m2 = buildSecondSyntheticModel()
    cache.update([m1, m2])
    cache.update([m1])
    expect(
      cache
        .snapshot()
        .map((d) => d.modelId)
        .sort()
    ).toEqual(['m1'])
  })

  it('updateAssistantIndex applies mode filtering before caching', () => {
    const cache = new AssistantIndexCache()
    const result = updateAssistantIndex(cache, {
      mode: 'directory',
      entries: [entry('processes/owner-registration.aml'), entry('.orbitpm/dup.aml')]
    })
    expect(result.digests).toHaveLength(1)
    expect(result.mode).toBe('directory')
  })
})
