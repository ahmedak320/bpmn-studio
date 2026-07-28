// Section 17.2 indexing: mode-aware file filtering + a revision/content-hash
// cache that invalidates only the models that actually changed. This module
// is synchronous bookkeeping on top of `buildDigest` — for building a large
// FRESH index (e.g. opening a big workspace for the first time) prefer
// `browserAssistantIndexer.ts`'s `buildDigestsInBrowser`, which runs the same
// digesting work in a worker, then seed a cache from the result. Incremental
// re-indexing (a handful of models changed) stays on this synchronous path;
// it is cheap by construction because unchanged models are never rebuilt.

import { buildAllDigests, buildDigest } from './digest'
import type { ArisAssistantModelInput, ArisProcessDigest } from './types'

export type ArisAssistantIndexMode = 'directory' | 'portable' | 'single-file'

export interface ArisAssistantIndexEntryInput {
  readonly relPath: string
  readonly model: ArisAssistantModelInput
}

export interface ArisAssistantIndexInput {
  readonly mode: ArisAssistantIndexMode
  readonly entries: readonly ArisAssistantIndexEntryInput[]
}

export interface ArisAssistantIndex {
  readonly mode: ArisAssistantIndexMode
  readonly digests: readonly ArisProcessDigest[]
}

const SUPPORTED_DIRECTORY_EXTENSIONS = /\.(aml|xml)$/i

/** True for any path with a `.orbitpm` segment — the app's own internal working-copy/export duplicates. */
export function isOrbitpmInternalPath(relPath: string): boolean {
  return /(^|\/)\.orbitpm(\/|$)/.test(relPath)
}

/**
 * Apply the Section 17.2 mode rules: directory mode is scoped to supported
 * AML/workspace file extensions; portable and single-file mode index
 * whatever entries the caller already scoped to imported/active models. All
 * three modes exclude `.orbitpm` internals so a working file is never
 * double-counted against its own internal duplicate.
 */
export function filterIndexableEntries(
  mode: ArisAssistantIndexMode,
  entries: readonly ArisAssistantIndexEntryInput[]
): ArisAssistantIndexEntryInput[] {
  return entries.filter((entry) => {
    if (isOrbitpmInternalPath(entry.relPath)) return false
    if (mode === 'directory') return SUPPORTED_DIRECTORY_EXTENSIONS.test(entry.relPath)
    return true
  })
}

/** One-shot, cache-free index build — mode filtering + digesting, no revision tracking. */
export function buildAssistantIndex(input: ArisAssistantIndexInput): ArisAssistantIndex {
  const filtered = filterIndexableEntries(input.mode, input.entries)
  return { mode: input.mode, digests: buildAllDigests(filtered.map((e) => e.model)) }
}

interface CacheEntry {
  readonly key: string
  readonly digest: ArisProcessDigest
}

export interface AssistantIndexUpdateResult {
  readonly digests: readonly ArisProcessDigest[]
  /** Model ids that were actually rebuilt this update — everything else reused its prior digest object. */
  readonly changedModelIds: readonly string[]
}

/**
 * Caches one digest per `modelId`, keyed by `${revision}::${sourceDigest}`.
 * A model whose revision AND source digest are unchanged reuses the exact
 * same `ArisProcessDigest` object reference from the previous `update()` —
 * this is what "invalidate only changed models" means in practice, and is
 * directly provable with an identity (`===`) check in a test. Models absent
 * from a given `update()` call are dropped from the cache (they left the
 * index); this never rebuilds or otherwise touches surviving entries.
 */
export class AssistantIndexCache {
  private entries = new Map<string, CacheEntry>()

  update(models: readonly ArisAssistantModelInput[]): AssistantIndexUpdateResult {
    const nextEntries = new Map<string, CacheEntry>()
    const digests: ArisProcessDigest[] = []
    const changedModelIds: string[] = []
    for (const model of models) {
      const key = `${model.revision}::${model.sourceDigest}`
      const existing = this.entries.get(model.modelId)
      if (existing && existing.key === key) {
        nextEntries.set(model.modelId, existing)
        digests.push(existing.digest)
        continue
      }
      const digest = buildDigest(model)
      nextEntries.set(model.modelId, { key, digest })
      digests.push(digest)
      changedModelIds.push(model.modelId)
    }
    this.entries = nextEntries
    return { digests, changedModelIds }
  }

  /** Current cached digests without recomputing anything, in no particular order. */
  snapshot(): ArisProcessDigest[] {
    return [...this.entries.values()].map((e) => e.digest)
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Mode-aware indexing on top of `AssistantIndexCache`, applying the same file filtering as `buildAssistantIndex`. */
export function updateAssistantIndex(
  cache: AssistantIndexCache,
  input: ArisAssistantIndexInput
): ArisAssistantIndex & AssistantIndexUpdateResult {
  const filtered = filterIndexableEntries(input.mode, input.entries)
  const result = cache.update(filtered.map((e) => e.model))
  return { mode: input.mode, ...result }
}
