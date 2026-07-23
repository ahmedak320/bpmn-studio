// Whole-workspace library import: reads a zip archive built by
// buildLibraryZip (or any reasonably well-formed zip) and extracts .bpmn
// entries as text, while defensively rejecting unsafe/oversized/undecodable
// entries instead of throwing for the whole archive. A bare `.xml` entry is
// also accepted when its content sniffs as a real BPMN 2.0 diagram (many
// BPMN tools export with a plain .xml extension); it lands under a
// `.bpmn`-suffixed relPath so downstream file creation (which always writes
// `.bpmn`) treats it exactly like a native entry.

import { unzipSync } from 'fflate'
import { looksLikeBpmnXml } from '../workspace/importDrop'

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
}

const MAX_ENTRY_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

// C0 control characters (\x00–\x1F) plus DEL (\x7F). Written with escape
// sequences, NOT literal control bytes: a raw-byte character class survives
// node/vitest but Vite's production build mangles the bytes into an invalid
// range ("Range out of order in character class") once this module is bundled
// into the browser app (Lane B5 first wires it into App.tsx).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

function normalizePath(path: string): string {
  let p = path.replace(/\\/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

function isUnsafePath(path: string): boolean {
  if (path.startsWith('/')) return true
  if (path.includes('..')) return true
  if (/^[A-Za-z]:/.test(path)) return true
  if (CONTROL_CHARS.test(path)) return true
  return false
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

export function readLibraryZip(data: Uint8Array): LibraryImportResult {
  const unzipped = unzipSync(data)

  const entries: LibraryImportEntry[] = []
  const skipped: LibraryImportSkipped[] = []
  let totalAccepted = 0

  const paths = Object.keys(unzipped).sort();
  for (const rawPath of paths) {
    const bytes = unzipped[rawPath]
    const normalized = normalizePath(rawPath)

    // Directory entries: skip silently (not reported).
    if (normalized === '' || normalized.endsWith('/') || (bytes.length === 0 && rawPath.endsWith('/'))) {
      continue
    }

    if (isUnsafePath(normalized)) {
      skipped.push({ path: normalized, reason: 'unsafe-path' })
      continue
    }

    if (bytes.length > MAX_ENTRY_BYTES) {
      skipped.push({ path: normalized, reason: 'too-large' })
      continue
    }

    const bpmnPath = isBpmnPath(normalized)
    const xmlPath = !bpmnPath && isXmlPath(normalized)

    if (!bpmnPath && !xmlPath) {
      skipped.push({ path: normalized, reason: 'not-bpmn' })
      continue
    }

    let xml: string
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      xml = decoder.decode(bytes)
    } catch {
      skipped.push({ path: normalized, reason: 'decode-failed' })
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
    totalAccepted += bytes.length
  }

  if (totalAccepted > MAX_TOTAL_BYTES) {
    throw new Error('Library too large (max 50 MB)')
  }

  return { entries, skipped }
}
