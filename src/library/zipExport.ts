// Whole-workspace library export: bundles workspace files (and optional
// extra plain-text artifacts, e.g. a manifest CSV) into a single deterministic
// zip archive using fflate. Entry order is made deterministic by sorting
// paths before building the tree object (object key insertion order is
// preserved by fflate's zipSync).

import { strToU8, zipSync } from 'fflate'

export interface LibraryZipFile {
  relPath: string
  xml: string
}

export interface LibraryZipExtra {
  relPath: string
  content: string
}

/** Build a zip archive (as raw bytes) from workspace files plus optional extras. */
export function buildLibraryZip(files: LibraryZipFile[], extras: LibraryZipExtra[] = []): Uint8Array {
  const entries: Array<{ path: string; content: string }> = [
    ...files.map((f) => ({ path: f.relPath, content: f.xml })),
    ...extras.map((e) => ({ path: e.relPath, content: e.content })),
  ]

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const tree: Record<string, Uint8Array> = {}
  for (const entry of entries) {
    tree[entry.path] = strToU8(entry.content)
  }

  return zipSync(tree)
}

/** Slugify a workspace/root name for use in a generated file name. */
function slug(rootName: string): string {
  const trimmed = rootName.trim()
  if (!trimmed) return 'workspace'
  const replaced = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
  return replaced || 'workspace'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Build the deterministic export file name: process-library-<slug>-<yyyy-mm-dd>.zip */
export function zipFileName(rootName: string, now?: Date): string {
  const date = now ?? new Date()
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  return `process-library-${slug(rootName)}-${y}-${m}-${d}.zip`
}
