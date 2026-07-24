// Workspace-wide call-activity link graph: which .bpmn file references which
// other file via `<callActivity calledElement="…">`, resolved through the
// process index (processId → file). Pure and dependency-free so it can be
// rebuilt cheaply from App's `useMemo(() => buildLinkGraph(files, index),
// [files, processIndex])` on every workspace snapshot, and unit-tested in
// plain node.
//
// Self-references (a file calling a process defined in the same file) are
// KEPT in the graph — consumers that must not recurse into them (the folder
// tree's linked-children rows) filter via their own per-branch visited sets.

import type { ProcessIndex } from '@app/shared/processIndex'

/** One resolved parent→child reference (deduped per parent+child file). */
export interface LinkEdge {
  parentRelPath: string
  /** The parent file's own (first) process id, when the index knows it. */
  parentProcessId?: string
  childRelPath: string
  childProcessId: string
  calledElement: string
}

export interface LinkGraph {
  /** parent relPath → its resolved children. Deduped by (parent, childRelPath);
   *  document/insertion order preserved. Files without edges have no entry. */
  childrenByFile: Map<string, LinkEdge[]>
  /** child relPath → the edges pointing at it (same LinkEdge objects). */
  parentsByFile: Map<string, LinkEdge[]>
  /** parent relPath → calledElement values that resolve to no known process
   *  (deduped per file). Empty/absent calledElement is not "unresolved". */
  unresolvedByFile: Map<string, string[]>
}

// Replicated from @app/shared/processIndex (module-private there): matches
// `<bpmn:callActivity …>` / `<callActivity …>` with any namespace prefix,
// self-closing or not, and pulls `calledElement` out of the start tag.
const CALL_ACTIVITY_TAG_RE = /<(?:[a-zA-Z_][\w.-]*:)?callActivity\b([^>]*?)\/?>/g
const CALLED_ELEMENT_ATTR_RE = /\bcalledElement\s*=\s*(?:"([^"]*)"|'([^']*)')/

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function getOrCreate<K, V>(map: Map<K, V[]>, key: K): V[] {
  let list = map.get(key)
  if (!list) {
    list = []
    map.set(key, list)
  }
  return list
}

/**
 * Build the link graph for a workspace snapshot. Pure: never mutates `files`
 * or `index`, deterministic for identical inputs (file order and per-file
 * document order drive edge order).
 */
export function buildLinkGraph(
  files: ReadonlyArray<{ relPath: string; xml: string }>,
  index: ProcessIndex
): LinkGraph {
  // Reverse lookup: relPath → its first process id. The index maps
  // processId → entry in insertion order (files order, per-file document
  // order), so "first seen for a relPath" is that file's first process.
  const processIdByFile = new Map<string, string>()
  for (const entry of index.values()) {
    if (!processIdByFile.has(entry.relPath)) processIdByFile.set(entry.relPath, entry.processId)
  }

  const childrenByFile = new Map<string, LinkEdge[]>()
  const parentsByFile = new Map<string, LinkEdge[]>()
  const unresolvedByFile = new Map<string, string[]>()
  // Dedup keyed by parent relPath (not per array item) so even a duplicated
  // input entry cannot produce duplicate (parent, childRelPath) edges.
  const seenChildren = new Map<string, Set<string>>()
  const seenUnresolved = new Map<string, Set<string>>()

  for (const file of files) {
    if (!file.xml) continue
    CALL_ACTIVITY_TAG_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CALL_ACTIVITY_TAG_RE.exec(file.xml)) !== null) {
      const attrs = match[1] ?? ''
      const calledMatch = CALLED_ELEMENT_ATTR_RE.exec(attrs)
      if (!calledMatch) continue
      const calledElement = decodeXmlEntities(calledMatch[1] ?? calledMatch[2] ?? '')
      if (!calledElement) continue

      const target = index.get(calledElement)
      if (!target) {
        const seen = getOrCreateSet(seenUnresolved, file.relPath)
        if (seen.has(calledElement)) continue
        seen.add(calledElement)
        getOrCreate(unresolvedByFile, file.relPath).push(calledElement)
        continue
      }

      const seen = getOrCreateSet(seenChildren, file.relPath)
      if (seen.has(target.relPath)) continue
      seen.add(target.relPath)

      const edge: LinkEdge = {
        parentRelPath: file.relPath,
        parentProcessId: processIdByFile.get(file.relPath),
        childRelPath: target.relPath,
        childProcessId: target.processId,
        calledElement
      }
      getOrCreate(childrenByFile, file.relPath).push(edge)
      getOrCreate(parentsByFile, target.relPath).push(edge)
    }
  }

  return { childrenByFile, parentsByFile, unresolvedByFile }
}

function getOrCreateSet<K>(map: Map<K, Set<string>>, key: K): Set<string> {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  return set
}
