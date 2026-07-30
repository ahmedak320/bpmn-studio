// Workspace-wide ARIS AML link scanner. Turns a workspace listing and an
// adapter into the `ProcessIndex` + `ProcessHierarchyGraph` that
// `buildProcessHierarchy` already consumes.
//
// The scanner is deliberately tolerant: per-file read/decode failures are
// swallowed so a single missing or corrupt file cannot break the whole
// workspace view. Duplicate model ids fail closed (omitted from the index,
// flagged ambiguous), matching `src/links/linkGraph.ts`.

import type { ProcessIndex } from '@/core/processIndex'
import { processLinkKey } from '@/links/linkGraph'
import type { ProcessHierarchyGraph, ProcessHierarchyLink } from '@/workspace/processHierarchy'
import { sha256Hex } from '@/workspace/adapters/hash'
import type { FileSnapshot, WorkspaceAdapter, WorkspaceEntry } from '@/workspace/adapters/types'
import {
  scanArisModelSource,
  deriveArisLinksFromDocument as deriveFromDocument,
  type ArisModelScanResult
} from './arisModelScan'

export { deriveFromDocument as deriveArisLinksFromDocument }

/** Public workspace link state produced by `scanArisWorkspaceLinks`. */
export interface ArisWorkspaceLinkState {
  readonly index: ProcessIndex
  readonly graph: ProcessHierarchyGraph
  readonly scannedFileCount: number
}

/** Internal extension that keeps per-file results so `merge` can rebuild. */
interface InternalArisWorkspaceLinkState extends ArisWorkspaceLinkState {
  readonly byPath: ReadonlyMap<string, ArisModelScanResult>
}

export interface ArisLinkScanCacheEntry {
  readonly size: number | undefined
  readonly modifiedAt: number | undefined
  readonly hash: string
  readonly result: ArisModelScanResult
}

export interface ArisLinkScanCache {
  readonly byPath: Map<string, ArisLinkScanCacheEntry>
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export const EMPTY_ARIS_LINK_STATE: ArisWorkspaceLinkState = {
  index: new Map(),
  graph: { links: [], ambiguousProcessIds: new Set() },
  scannedFileCount: 0,
  byPath: new Map()
} as ArisWorkspaceLinkState

export function createArisLinkScanCache(): ArisLinkScanCache {
  return { byPath: new Map() }
}

export function isArisLinkScanCandidate(entry: WorkspaceEntry): boolean {
  return (
    entry.kind === 'file' &&
    /\.(?:aml|xml)$/iu.test(entry.name) &&
    !entry.path.startsWith('.orbitpm/')
  )
}

async function scanFile(
  adapter: Pick<WorkspaceAdapter, 'read'>,
  entry: WorkspaceEntry,
  cache: ArisLinkScanCache
): Promise<ArisModelScanResult | undefined> {
  const cached = cache.byPath.get(entry.path)

  // Metadata-only match: the file's size and mtime have not changed.
  if (
    cached &&
    cached.size !== undefined &&
    cached.modifiedAt !== undefined &&
    cached.size === entry.size &&
    cached.modifiedAt === entry.modifiedAt
  ) {
    return cached.result
  }

  let snapshot: FileSnapshot
  try {
    snapshot = await adapter.read(entry.path)
  } catch {
    return undefined
  }

  const hash = await sha256Hex(snapshot.bytes)

  // Content match: the bytes hash to something we have already scanned.
  // This also covers a moved file (new path, same content).
  const contentMatch =
    cached?.hash === hash
      ? cached
      : Array.from(cache.byPath.values()).find((candidate) => candidate.hash === hash)
  if (contentMatch) {
    cache.byPath.set(entry.path, {
      size: snapshot.size,
      modifiedAt: snapshot.modifiedAt,
      hash,
      result: contentMatch.result
    })
    return contentMatch.result
  }

  let result: ArisModelScanResult
  try {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes)
    result = scanArisModelSource(xml)
  } catch {
    return undefined
  }

  cache.byPath.set(entry.path, {
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt,
    hash,
    result
  })
  return result
}

function buildState(
  byPath: ReadonlyMap<string, ArisModelScanResult>,
  scannedFileCount: number
): InternalArisWorkspaceLinkState {
  // Count declarations per model id across all files.
  const declarationCounts = new Map<string, number>()
  for (const result of byPath.values()) {
    for (const model of result.models) {
      declarationCounts.set(model.modelId, (declarationCounts.get(model.modelId) ?? 0) + 1)
    }
  }

  const ambiguousProcessIds = new Set<string>()
  for (const [processId, count] of declarationCounts) {
    if (count > 1) ambiguousProcessIds.add(processId)
  }

  // Build ProcessIndex from unambiguous models. If a model id appears only once
  // but in a file that also declares it again elsewhere in the same file, the
  // per-file scanner already emits it twice; declarationCounts catches that.
  const index: ProcessIndex = new Map()
  for (const [relPath, result] of byPath) {
    for (const model of result.models) {
      if (ambiguousProcessIds.has(model.modelId)) continue
      index.set(model.modelId, {
        processId: model.modelId,
        processName: model.name ?? undefined,
        relPath
      })
    }
  }

  // Aggregate links by (parent, child) across all files.
  const aggregates = new Map<string, ProcessHierarchyLink & { _occIds: string[]; _count: number }>()
  for (const [, result] of byPath) {
    for (const assignment of result.assignments) {
      if (ambiguousProcessIds.has(assignment.parentModelId)) continue
      if (ambiguousProcessIds.has(assignment.childModelId)) continue
      const parentEntry = index.get(assignment.parentModelId)
      const childEntry = index.get(assignment.childModelId)
      if (!parentEntry || !childEntry) continue

      const key = processLinkKey(assignment.parentModelId, assignment.childModelId)
      const existing = aggregates.get(key)
      if (existing) {
        existing._occIds.push(...assignment.occurrenceIds)
        existing._count += assignment.count
      } else {
        aggregates.set(key, {
          key,
          parentProcessId: assignment.parentModelId,
          childProcessId: assignment.childModelId,
          parentRelPath: parentEntry.relPath,
          childRelPath: childEntry.relPath,
          callActivityIds: [...assignment.occurrenceIds],
          count: assignment.count,
          _occIds: [...assignment.occurrenceIds],
          _count: assignment.count
        })
      }
    }
  }

  const links: ProcessHierarchyLink[] = Array.from(aggregates.values())
    .map((a) => ({
      key: a.key,
      parentProcessId: a.parentProcessId,
      childProcessId: a.childProcessId,
      parentRelPath: a.parentRelPath,
      childRelPath: a.childRelPath,
      callActivityIds: [...new Set(a._occIds)].sort(compareText),
      count: a._count
    }))
    .sort(
      (a, b) =>
        compareText(a.parentProcessId, b.parentProcessId) ||
        compareText(a.childProcessId, b.childProcessId)
    )

  const graph: ProcessHierarchyGraph = {
    links,
    ambiguousProcessIds
  }

  return {
    index,
    graph,
    scannedFileCount,
    byPath
  }
}

/**
 * Scan every AML/XML candidate in the workspace listing and build the
 * corresponding process index and hierarchy graph. Cached results are reused
 * when size+mtime or content hash match, avoiding re-reads of unchanged files.
 */
export async function scanArisWorkspaceLinks(
  adapter: Pick<WorkspaceAdapter, 'read'>,
  entries: readonly WorkspaceEntry[],
  cache: ArisLinkScanCache
): Promise<ArisWorkspaceLinkState> {
  const candidates = entries
    .filter(isArisLinkScanCandidate)
    .sort((a, b) => compareText(a.path, b.path))

  const byPath = new Map<string, ArisModelScanResult>()
  for (const entry of candidates) {
    const result = await scanFile(adapter, entry, cache)
    if (result) byPath.set(entry.path, result)
  }

  return buildState(byPath, candidates.length)
}

/**
 * Rebuild the workspace link state by replacing each overlaid relPath's
 * contribution with the overlay's scan result. Other files remain untouched.
 */
export function mergeArisLinkState(
  base: ArisWorkspaceLinkState,
  overlays: ReadonlyMap<string, ArisModelScanResult>
): ArisWorkspaceLinkState {
  const internal = base as InternalArisWorkspaceLinkState
  const merged = new Map<string, ArisModelScanResult>(internal.byPath)
  for (const [relPath, result] of overlays) {
    merged.set(relPath, result)
  }
  return buildState(merged, internal.scannedFileCount)
}
