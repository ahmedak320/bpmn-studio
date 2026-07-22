// Pure builder + sort/filter for the process catalog (the "browse all of the
// company's processes" home view). One row per <process> across every .bpmn
// file in the workspace, annotated with folder, last-modified, and whether the
// file has any unresolved call-activity links. No React/DOM here so the row
// derivation and sorting are unit-tested in plain node.

import { parseProcessesFromXml, listUnresolvedCalledElements } from '@app/shared/processIndex'
import type { ProcessIndex } from '@app/shared/processIndex'
import { dirOf, baseOf } from '../fs/fsAccess'
import { extractDiagramText } from './searchIndex'

export interface CatalogRow {
  relPath: string
  fileName: string
  /** Folder path ('' for the workspace root). */
  folder: string
  processId?: string
  processName?: string
  /** epoch ms; undefined when the platform didn't report it (0 is normalized to undefined). */
  lastModified?: number
  /** Count of unresolved calledElements in the SOURCE FILE (badge on the row). */
  unresolvedCount: number
}

export interface CatalogFileInput {
  relPath: string
  xml: string
  lastModified?: number
}

/**
 * Build the catalog rows. Each `<process>` in each file becomes a row; a file
 * with no parseable process still yields one file-level row (so nothing is
 * silently missing). `unresolvedCount` is computed per file against the shared
 * process index and copied onto each of that file's rows.
 */
export function buildCatalog(files: CatalogFileInput[], index: ProcessIndex): CatalogRow[] {
  const rows: CatalogRow[] = []
  for (const file of files) {
    const fileName = baseOf(file.relPath)
    const folder = dirOf(file.relPath)
    const lastModified =
      typeof file.lastModified === 'number' && file.lastModified > 0
        ? file.lastModified
        : undefined
    const unresolvedCount = listUnresolvedCalledElements(file.xml, index).length
    const processes = parseProcessesFromXml(file.xml, file.relPath)
    if (processes.length === 0) {
      rows.push({ relPath: file.relPath, fileName, folder, lastModified, unresolvedCount })
      continue
    }
    for (const proc of processes) {
      rows.push({
        relPath: file.relPath,
        fileName,
        folder,
        processId: proc.processId,
        processName: proc.processName,
        lastModified,
        unresolvedCount
      })
    }
  }
  return rows
}

export type CatalogSortKey = 'name' | 'folder' | 'modified'
export type SortDir = 'asc' | 'desc'

/** Display label for a row (process name, else the file name without .bpmn). */
export function rowLabel(row: CatalogRow): string {
  return row.processName?.trim() || row.fileName.replace(/\.bpmn$/i, '')
}

export function sortCatalog(
  rows: CatalogRow[],
  key: CatalogSortKey,
  dir: SortDir = 'asc'
): CatalogRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const cmp = (a: CatalogRow, b: CatalogRow): number => {
    if (key === 'modified') {
      // Unknown timestamps sort last regardless of direction.
      const au = a.lastModified === undefined
      const bu = b.lastModified === undefined
      if (au && !bu) return 1
      if (bu && !au) return -1
      if (!au && !bu && a.lastModified !== b.lastModified) {
        return ((a.lastModified as number) - (b.lastModified as number)) * sign
      }
      return rowLabel(a).localeCompare(rowLabel(b), undefined, { sensitivity: 'base' })
    }
    if (key === 'folder') {
      const fc = a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' })
      if (fc !== 0) return fc * sign
      return rowLabel(a).localeCompare(rowLabel(b), undefined, { sensitivity: 'base' })
    }
    return rowLabel(a).localeCompare(rowLabel(b), undefined, { sensitivity: 'base' }) * sign
  }
  return [...rows].sort(cmp)
}

/**
 * Filter catalog rows by the same instant query the search box uses, so the
 * catalog honors the header search. Matches (AND over whitespace-separated
 * terms) against the row's process name, file name, process id, folder, and —
 * for a small extra reach on the home view — the file's diagram text. The xml
 * is passed alongside so callers can reuse their already-scanned content.
 */
export function filterCatalog(
  rows: CatalogRow[],
  query: string,
  xmlByPath?: Map<string, string>
): CatalogRow[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (terms.length === 0) return rows
  const contentCache = new Map<string, string>()
  return rows.filter((row) => {
    let hay = `${rowLabel(row).toLowerCase()} ${row.fileName.toLowerCase()} ${(
      row.processId ?? ''
    ).toLowerCase()} ${row.folder.toLowerCase()}`
    const xml = xmlByPath?.get(row.relPath)
    if (xml) {
      let content = contentCache.get(row.relPath)
      if (content === undefined) {
        content = extractDiagramText(xml).join(' ').toLowerCase()
        contentCache.set(row.relPath, content)
      }
      hay += ' ' + content
    }
    return terms.every((t) => hay.includes(t))
  })
}
