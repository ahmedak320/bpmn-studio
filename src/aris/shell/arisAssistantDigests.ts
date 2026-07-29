/**
 * Folder-aware assistant index for the mounted shell (plan §17.1/§17.2).
 *
 * `src/aris/assistant` is a pure lane: it declares the structural shape of a
 * working document it needs (`seamAdapter.ts`), turns models into
 * `ArisProcessDigest`s (`digest.ts`), caches those digests by model revision and
 * source digest (`assistantIndex.ts`), and answers questions from them with no
 * provider and no key (`answer.ts` + `questionRouter.ts`). The lane has no
 * barrel, so each module is imported directly.
 *
 * This module supplies the two facts the working document itself cannot carry:
 * the workspace path a model came from and the source digest that keys the
 * cache. Indexing goes through `AssistantIndexCache`, so a re-render that did
 * not change a model reuses that model's exact digest object — §17.2's
 * "invalidate only changed models", not a full rebuild per keystroke.
 *
 * §17.2 also says to index current working revisions rather than duplicate
 * originals, and to exclude `.orbitpm` internals. Both are the index's own
 * rules (`filterIndexableEntries`); the caller's job is only to pass the LIVE
 * document for each source, once.
 */

import {
  AssistantIndexCache,
  updateAssistantIndex,
  type ArisAssistantIndexEntryInput,
  type ArisAssistantIndexMode
} from '../assistant/assistantIndex'
import { adaptArisWorkingDocument } from '../assistant/seamAdapter'
import type { ArisProcessDigest } from '../assistant/types'
import type { ArisWorkingDocument } from '../model/types'

export interface ArisAssistantSourceInput {
  /** Workspace-relative path, or a stable virtual label for an unsaved source. */
  readonly relPath: string
  /** The document to index: the live one when the canvas has published it. */
  readonly document: ArisWorkingDocument
  /** Content hash of the imported bytes — the §17.2 cache key. */
  readonly sourceDigest: string
}

/** Flatten one source's models into index entries. */
function entriesFor(source: ArisAssistantSourceInput): ArisAssistantIndexEntryInput[] {
  const relPathByModelId = new Map<string, string>()
  const sourceDigestByModelId = new Map<string, string>()
  for (const modelId of source.document.models.keys()) {
    relPathByModelId.set(modelId, source.relPath)
    sourceDigestByModelId.set(modelId, source.sourceDigest)
  }
  return adaptArisWorkingDocument(source.document, relPathByModelId, sourceDigestByModelId).map(
    (model) => ({ relPath: source.relPath, model })
  )
}

/**
 * Build the digest list for every open source through a caller-owned cache.
 *
 * Model ids are unique inside one ARIS export but two different sources can
 * still declare the same id; the cache is keyed by model id, so the caller must
 * keep sources distinct if that ever matters. In this shell it does not: a
 * second source with a colliding id would simply win, which is visible rather
 * than silent because the digest carries the winning `relPath`.
 */
export function buildArisAssistantDigests(
  sources: readonly ArisAssistantSourceInput[],
  cache: AssistantIndexCache,
  mode: ArisAssistantIndexMode = 'single-file'
): readonly ArisProcessDigest[] {
  const entries = sources.flatMap(entriesFor)
  return Object.freeze(updateAssistantIndex(cache, { mode, entries }).digests)
}

export { AssistantIndexCache, type ArisAssistantIndexMode }
