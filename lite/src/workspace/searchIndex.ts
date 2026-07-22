// Pure, dependency-light search indexer for the workspace. Builds a lazy
// content index from the already-in-memory .bpmn file list (one entry per
// file) and answers instant substring queries across four fields:
//   - process display names   (<*:process name="...">)
//   - file names               (foo.bpmn)
//   - process ids              (<*:process id="...">, the call-activity target)
//   - diagram text content      (every element's name="..." + <documentation>)
// No React / DOM / File-System-Access here, so the whole thing is unit-tested
// in plain node (see src/__tests__/searchIndex.test.ts). App builds the index
// with useMemo over the scanned files and re-derives it on every tree change.

import { parseProcessesFromXml } from '@app/shared/processIndex'
import { dirOf, baseOf } from '../fs/fsAccess'

/** Per-spec: only files at or below this size contribute their FULL diagram
 *  text to the index; larger ones still contribute file name + process
 *  names/ids (cheap, always available) so they remain findable, just not by
 *  deep body text. BPMN files are almost always a few KB, so this only guards
 *  a pathological outlier from bloating the in-memory index. */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024

export interface IndexedProcess {
  id: string
  name?: string
}

export interface SearchDoc {
  relPath: string
  fileName: string
  /** Folder path containing the file ('' for the workspace root). */
  folder: string
  processes: IndexedProcess[]
  /** Lowercased process display names, joined with spaces. */
  namesText: string
  /** Lowercased process ids, joined with spaces. */
  idsText: string
  /** Lowercased full diagram text (element names + documentation). */
  contentText: string
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const NAME_ATTR_GLOBAL = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const DOCUMENTATION_TAG =
  /<(?:[a-zA-Z_][\w.-]*:)?documentation\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z_][\w.-]*:)?documentation>/g

/**
 * Pull the human-readable text out of a BPMN file's XML: every element's
 * `name="..."` (task/event/gateway/flow labels, the process name, etc.) plus
 * any `<*:documentation>` body text. Returned de-duplicated, original case.
 */
export function extractDiagramText(xml: string): string[] {
  if (!xml) return []
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string): void => {
    const text = decodeXmlEntities(raw).trim()
    if (!text) return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(text)
  }

  NAME_ATTR_GLOBAL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NAME_ATTR_GLOBAL.exec(xml)) !== null) push(m[1] ?? m[2] ?? '')

  DOCUMENTATION_TAG.lastIndex = 0
  while ((m = DOCUMENTATION_TAG.exec(xml)) !== null) {
    // Strip any nested tags inside documentation, keep the text.
    push((m[1] ?? '').replace(/<[^>]*>/g, ' '))
  }
  return out
}

export function buildSearchDoc(
  file: { relPath: string; xml: string; size?: number },
  maxContentBytes: number = MAX_CONTENT_BYTES
): SearchDoc {
  const fileName = baseOf(file.relPath)
  const folder = dirOf(file.relPath)
  const entries = parseProcessesFromXml(file.xml, file.relPath)
  const processes: IndexedProcess[] = entries.map((e) => ({ id: e.processId, name: e.processName }))
  const size = typeof file.size === 'number' ? file.size : file.xml.length
  // Exclude the processes' OWN display names from the file-level content text —
  // those belong to the per-process `name` field. Leaving them in would let a
  // file-level content match emit EVERY process in the file for a query that
  // only hit one process's name (Codex MINOR: over-broad search emission).
  const ownNames = new Set(processes.map((p) => (p.name ?? '').toLowerCase()).filter(Boolean))
  const contentText =
    size <= maxContentBytes
      ? extractDiagramText(file.xml)
          .filter((txt) => !ownNames.has(txt.toLowerCase()))
          .join(' • ')
          .toLowerCase()
      : ''
  return {
    relPath: file.relPath,
    fileName,
    folder,
    processes,
    namesText: processes
      .map((p) => p.name ?? '')
      .join(' ')
      .toLowerCase(),
    idsText: processes
      .map((p) => p.id)
      .join(' ')
      .toLowerCase(),
    contentText
  }
}

export function buildSearchIndex(
  files: Array<{ relPath: string; xml: string; size?: number }>,
  maxContentBytes: number = MAX_CONTENT_BYTES
): SearchDoc[] {
  return files.map((f) => buildSearchDoc(f, maxContentBytes))
}

export type MatchField = 'name' | 'file' | 'id' | 'content'

export interface SearchHit {
  relPath: string
  fileName: string
  folder: string
  processId?: string
  processName?: string
  /** The strongest field the query matched (drives the "why" label). */
  matchedOn: MatchField
}

export interface SearchGroup {
  /** '' for the workspace root. */
  folder: string
  hits: SearchHit[]
}

/** Split a raw query into lowercased, non-empty terms (whitespace-separated,
 *  AND-combined). */
export function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

function everyTermIn(haystack: string, terms: string[]): boolean {
  return terms.every((t) => haystack.includes(t))
}

/**
 * Run an instant search over a prebuilt index. A file matches when every query
 * term appears somewhere across its four fields (AND semantics, so
 * `"invoice approval"` narrows). One hit is emitted per process in a matching
 * file (so results map to the openable file), or a single file-level hit when
 * the file declares no process. Results are grouped by folder, folders and
 * hits alphabetical. An empty query yields no groups (the UI shows the tree /
 * catalog instead of a results panel).
 */
export function searchWorkspace(index: SearchDoc[], query: string): SearchGroup[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const byFolder = new Map<string, SearchHit[]>()
  for (const doc of index) {
    const fileText = doc.fileName.toLowerCase()
    // Cheap early skip: if no field anywhere in the file holds every term, no
    // process in it can match either.
    const combined = `${fileText} ${doc.namesText} ${doc.idsText} ${doc.contentText}`
    if (!everyTermIn(combined, terms)) continue

    // File-level fields (shared by every process in the file).
    const fileMatched = everyTermIn(fileText, terms)
    const contentMatched = everyTermIn(doc.contentText, terms)
    const hits = byFolder.get(doc.folder) ?? []

    if (doc.processes.length === 0) {
      // No process to attribute to — keep it only on a genuine file-level match.
      if (fileMatched || contentMatched) {
        hits.push({
          relPath: doc.relPath,
          fileName: doc.fileName,
          folder: doc.folder,
          matchedOn: fileMatched ? 'file' : 'content'
        })
      }
    } else {
      for (const proc of doc.processes) {
        // A process is emitted only when its OWN name/id holds every term, or a
        // file-level field does. Priority name > file > id > content drives the
        // "why" label. A process none of whose fields match is skipped, so an
        // unrelated sibling process is no longer dragged into the results.
        let matchedOn: MatchField | null = null
        if (everyTermIn((proc.name ?? '').toLowerCase(), terms)) matchedOn = 'name'
        else if (fileMatched) matchedOn = 'file'
        else if (everyTermIn(proc.id.toLowerCase(), terms)) matchedOn = 'id'
        else if (contentMatched) matchedOn = 'content'
        if (!matchedOn) continue
        hits.push({
          relPath: doc.relPath,
          fileName: doc.fileName,
          folder: doc.folder,
          processId: proc.id,
          processName: proc.name,
          matchedOn
        })
      }
    }
    if (hits.length > 0) byFolder.set(doc.folder, hits)
  }

  return [...byFolder.entries()]
    .map(([folder, hits]) => ({
      folder,
      hits: hits.sort((a, b) =>
        (a.processName ?? a.fileName).localeCompare(b.processName ?? b.fileName, undefined, {
          sensitivity: 'base'
        })
      )
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }))
}

/** Total hit count across all groups (drives the "N results" summary). */
export function countHits(groups: SearchGroup[]): number {
  return groups.reduce((sum, g) => sum + g.hits.length, 0)
}
