// Whole-workspace library import: reads a zip archive built by
// buildLibraryZip (or any reasonably well-formed zip) and extracts .bpmn
// entries as text. Archive-wide security violations (unsafe paths, malformed
// headers, encryption, decompression bombs, or exceeded resource limits)
// reject the whole import before expansion; undecodable candidate documents
// remain ordinary per-entry skips. A bare `.xml` entry is also accepted when
// its content sniffs as a real BPMN 2.0 diagram (many
// BPMN tools export with a plain .xml extension); it lands under a
// `.bpmn`-suffixed relPath so downstream file creation (which always writes
// `.bpmn`) treats it exactly like a native entry.
//
// Two ROOT-LEVEL extras our own export writes alongside the diagrams are
// recognized (rather than reported as skipped noise):
//   - `library-manifest.json` → parsed into `result.manifest`;
//   - `process-owners.csv`    → passed through verbatim as `result.ownersCsv`.
// The owners CSV is INFORMATIONAL only: process owners live in orbitpm:*
// attributes inside the .bpmn files themselves, which round-trip through
// export/import — nothing is (re)applied from the CSV.

import { looksLikeBpmnXml } from '../workspace/importDrop'
import {
  ArchivePreflightError,
  extractPreflightedZip,
  extractPreflightedZipSync,
  preflightZip,
  preflightZipAsync,
  type ZipPreflightEntry,
  type ZipPreflightResult,
  type ZipSafetyLimits
} from '../security/archivePreflight'
import { LIBRARY_MANIFEST_NAME, parseLibraryManifest, type LibraryManifest } from './libraryManifest'

/** Root-level owners-list extra written by the library export (see App's
 *  exportLibrary): recognized on import, surfaced verbatim, never applied. */
export const PROCESS_OWNERS_CSV_NAME = 'process-owners.csv'

export type SkipReason = 'not-bpmn' | 'unsafe-path' | 'too-large' | 'decode-failed'

export interface LibraryImportEntry {
  relPath: string
  xml: string
}

export interface LibraryImportSkipped {
  path: string
  reason: SkipReason
}

export interface LibraryImportResult {
  entries: LibraryImportEntry[]
  skipped: LibraryImportSkipped[]
  /** Parsed root-level `library-manifest.json`, when present and well-formed. */
  manifest?: LibraryManifest
  /** Raw text of a root-level `process-owners.csv`, when present. */
  ownersCsv?: string
}

export const LIBRARY_ZIP_LIMITS: ZipSafetyLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxEntries: 2_500,
  maxCentralDirectoryBytes: 8 * 1024 * 1024,
  maxEntryNameBytes: 1_024,
  maxEntryUncompressedBytes: 5 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxCompressionRatio: 250
}

export interface ReadLibraryZipOptions {
  signal?: AbortSignal
}

function isBpmnPath(path: string): boolean {
  return path.toLowerCase().endsWith('.bpmn')
}

// A bare `.xml` entry is only *provisionally* eligible — it still has to
// pass looksLikeBpmnXml against its decoded content below before it's
// accepted (see the loop in readLibraryZip).
function isXmlPath(path: string): boolean {
  return path.toLowerCase().endsWith('.xml')
}

/** Rewrite a `.xml` entry's path to the `.bpmn`-suffixed path it lands under
 *  once accepted, so it matches what a native `.bpmn` entry would produce
 *  (downstream consumers, e.g. App's confirmLibraryImport, derive the new
 *  file's base name by stripping a trailing `.bpmn` from relPath and always
 *  write the created file back out with a `.bpmn` extension). */
function xmlToBpmnPath(path: string): string {
  return path.replace(/\.xml$/i, '.bpmn')
}

function shouldExtract(entry: ZipPreflightEntry): boolean {
  const path = entry.normalizedName
  return (
    isBpmnPath(path) ||
    isXmlPath(path) ||
    path === LIBRARY_MANIFEST_NAME ||
    path === PROCESS_OWNERS_CSV_NAME
  )
}

function buildLibraryImportResult(
  preflight: ZipPreflightResult,
  unzipped: Record<string, Uint8Array>,
  signal?: AbortSignal
): LibraryImportResult {
  const entries: LibraryImportEntry[] = []
  const skipped: LibraryImportSkipped[] = []
  let manifest: LibraryManifest | undefined
  let ownersCsv: string | undefined

  const archiveEntries = [...preflight.entries].sort((left, right) =>
    left.normalizedName.localeCompare(right.normalizedName)
  )
  for (const archiveEntry of archiveEntries) {
    if (signal?.aborted) {
      throw new ArchivePreflightError('aborted', 'Archive processing was cancelled')
    }
    const normalized = archiveEntry.normalizedName
    if (archiveEntry.directory) continue

    const bpmnPath = isBpmnPath(normalized)
    const xmlPath = !bpmnPath && isXmlPath(normalized)
    // Our own export's extras, by EXACT root-level name only — a nested
    // `sub/library-manifest.json` is somebody's diagram folder content and
    // falls through to the ordinary skip reporting below.
    const rootExtra =
      normalized === LIBRARY_MANIFEST_NAME || normalized === PROCESS_OWNERS_CSV_NAME

    if (!bpmnPath && !xmlPath && !rootExtra) {
      skipped.push({ path: normalized, reason: 'not-bpmn' })
      continue
    }
    const bytes = unzipped[normalized]
    if (!bytes) {
      // The preflighted extraction contract requires every selected entry.
      throw new Error(`ZIP extraction omitted ${normalized}`)
    }

    let xml: string
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      xml = decoder.decode(bytes)
    } catch {
      skipped.push({ path: normalized, reason: 'decode-failed' })
      continue
    }

    if (rootExtra) {
      if (normalized === PROCESS_OWNERS_CSV_NAME) {
        ownersCsv = xml
        continue
      }
      const parsed = parseLibraryManifest(xml)
      if (parsed) {
        manifest = parsed
        continue
      }
      // Unparseable manifest (foreign zip reusing the name, corrupt JSON):
      // fall through to the existing skip handling for unknown entries.
      skipped.push({ path: normalized, reason: 'not-bpmn' })
      continue
    }

    if (xmlPath && !looksLikeBpmnXml(xml)) {
      // The extension alone can't distinguish a BPMN 2.0 export from
      // arbitrary XML. SkipReason is a closed enum surfaced verbatim via the
      // i18n key `library.skip.<reason>` (see dictionaries.ts), and adding a
      // dedicated reason here would need a new dictionary key we're not
      // touching — so a .xml entry that fails the content sniff is reported
      // under the same 'not-bpmn' reason as a non-.bpmn file. The existing
      // copy ("not a .bpmn file") reads fine either way: the entry isn't
      // going to become a BPMN diagram.
      skipped.push({ path: normalized, reason: 'not-bpmn' })
      continue
    }

    entries.push({ relPath: xmlPath ? xmlToBpmnPath(normalized) : normalized, xml })
  }

  const result: LibraryImportResult = { entries, skipped }
  if (manifest) result.manifest = manifest
  if (ownersCsv !== undefined) result.ownersCsv = ownersCsv
  return result
}

/**
 * Synchronous compatibility wrapper for the current App call site. All limits
 * and headers are checked before the filtered inflater is invoked.
 */
export function readLibraryZip(
  data: Uint8Array,
  options: ReadLibraryZipOptions = {}
): LibraryImportResult {
  const preflight = preflightZip(data, LIBRARY_ZIP_LIMITS, options.signal)
  const unzipped = extractPreflightedZipSync(data, preflight, {
    signal: options.signal,
    include: shouldExtract
  })
  return buildLibraryImportResult(preflight, unzipped, options.signal)
}

/**
 * Worker-friendly/cancellable API for import flows that can await archive
 * processing without blocking on the synchronous compatibility wrapper.
 */
export async function readLibraryZipAsync(
  data: Uint8Array,
  options: ReadLibraryZipOptions = {}
): Promise<LibraryImportResult> {
  const preflight = await preflightZipAsync(data, LIBRARY_ZIP_LIMITS, options.signal)
  const unzipped = await extractPreflightedZip(data, preflight, {
    signal: options.signal,
    include: shouldExtract
  })
  return buildLibraryImportResult(preflight, unzipped, options.signal)
}
