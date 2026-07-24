// The library zip's machine-readable table of contents: which .bpmn files the
// export contains and how they nest via callActivity links. Written as a
// root-level `library-manifest.json` extra by the whole-workspace export and
// recognized back by readLibraryZip on import.
//
// Deliberately timestamp-free: identical workspace content must produce
// byte-identical manifest text (and therefore byte-identical zip bytes — see
// zipExport.ts's determinism contract and zip.test.ts). To that end `files`
// is sorted, and `hierarchy` is sorted by (parentFile, childFile) regardless
// of graph iteration order.

import type { ProcessIndex } from '@app/shared/processIndex'
import type { LinkGraph } from '../links/linkGraph'

export const LIBRARY_MANIFEST_NAME = 'library-manifest.json'

export interface LibraryManifestEdge {
  parentFile: string
  parentProcessId: string
  childFile: string
  childProcessId: string
  via: 'callActivity'
}

export interface LibraryManifest {
  version: 1
  generator: string
  /** Sorted relPaths of every exported .bpmn file — deterministic. */
  files: string[]
  /** Resolved parent→child links, sorted by (parentFile, childFile). */
  hierarchy: LibraryManifestEdge[]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Build the manifest for a workspace snapshot from its process index and
 *  link graph (self-references included — the graph keeps them). */
export function buildLibraryManifest(
  files: ReadonlyArray<{ relPath: string }>,
  index: ProcessIndex,
  graph: LinkGraph
): LibraryManifest {
  // Fallback source for a parent's own process id when the edge lacks one
  // (buildLinkGraph fills it from the same index, but a hand-built graph
  // may not).
  const processIdByFile = new Map<string, string>()
  for (const entry of index.values()) {
    if (!processIdByFile.has(entry.relPath)) processIdByFile.set(entry.relPath, entry.processId)
  }

  const hierarchy: LibraryManifestEdge[] = []
  for (const edges of graph.childrenByFile.values()) {
    for (const edge of edges) {
      hierarchy.push({
        parentFile: edge.parentRelPath,
        parentProcessId: edge.parentProcessId ?? processIdByFile.get(edge.parentRelPath) ?? '',
        childFile: edge.childRelPath,
        childProcessId: edge.childProcessId,
        via: 'callActivity'
      })
    }
  }
  hierarchy.sort(
    (a, b) => compare(a.parentFile, b.parentFile) || compare(a.childFile, b.childFile)
  )

  return {
    version: 1,
    generator: 'orbitpm-lite',
    files: files.map((f) => f.relPath).sort(compare),
    hierarchy
  }
}

export function serializeLibraryManifest(manifest: LibraryManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/**
 * Defensive parse: returns a CLEAN manifest object (known fields only,
 * fresh arrays) or `undefined` for anything malformed — bad JSON, wrong
 * version, wrong field types, or a hierarchy entry that isn't a full
 * callActivity edge. Never throws.
 */
export function parseLibraryManifest(text: string): LibraryManifest | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>

  if (obj.version !== 1) return undefined
  if (typeof obj.generator !== 'string') return undefined
  if (!Array.isArray(obj.files)) return undefined
  if (!obj.files.every((f): f is string => typeof f === 'string')) return undefined
  if (!Array.isArray(obj.hierarchy)) return undefined

  const hierarchy: LibraryManifestEdge[] = []
  for (const entry of obj.hierarchy) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const edge = entry as Record<string, unknown>
    if (edge.via !== 'callActivity') return undefined
    if (
      typeof edge.parentFile !== 'string' ||
      typeof edge.parentProcessId !== 'string' ||
      typeof edge.childFile !== 'string' ||
      typeof edge.childProcessId !== 'string'
    ) {
      return undefined
    }
    hierarchy.push({
      parentFile: edge.parentFile,
      parentProcessId: edge.parentProcessId,
      childFile: edge.childFile,
      childProcessId: edge.childProcessId,
      via: 'callActivity'
    })
  }

  return {
    version: 1,
    generator: obj.generator,
    files: [...obj.files],
    hierarchy
  }
}
