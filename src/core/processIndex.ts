// Pure, dependency-free helpers for building and querying a
// `processId -> file` index across the workspace's .bpmn files, and for
// spotting call activities whose `calledElement` doesn't resolve to any
// known process. No Electron/DOM imports here so this module can be
// required from the main process (future use), the renderer, and vitest
// without any environment shimming.

/** One `<bpmn:process id="..." name="...">` found inside a single file. */
export interface ProcessEntry {
  processId: string
  processName?: string
  /** posix-style path relative to the workspace root, e.g. "sub/dir/file.bpmn" */
  relPath: string
}

/** processId -> the entry describing where it lives. Last file scanned for
 * a given id wins (workspace-wide ids are expected to be unique; a
 * duplicate is a workspace authoring problem, not something we adjudicate
 * here). */
export type ProcessIndex = Map<string, ProcessEntry>

// Matches `<bpmn:process ...>` / `<process ...>` / any other namespace
// prefix (`<foo:process ...>`), tag-attribute order independent, and pulls
// out `id="..."` and `name="..."` (single or double quoted) from within the
// opening tag regardless of their order or presence. Deliberately regex
// based (not a full XML parse) per spec: resilient to namespace prefixes
// and attribute order, cheap to run across a whole workspace on every
// tree-changed event.
const PROCESS_TAG_RE = /<(?:[a-zA-Z_][\w.-]*:)?process\b([^>]*?)\/?>/g
const ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/
const NAME_ATTR_RE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Parse the `<*:process id="..." name="...">` tags out of a single .bpmn
 * file's XML content. Returns zero, one, or many entries (a file may
 * declare multiple top-level processes).
 */
export function parseProcessesFromXml(xml: string, relPath: string): ProcessEntry[] {
  if (!xml) return []
  const entries: ProcessEntry[] = []
  PROCESS_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PROCESS_TAG_RE.exec(xml)) !== null) {
    const attrs = match[1] ?? ''
    const idMatch = ID_ATTR_RE.exec(attrs)
    if (!idMatch) continue
    const processId = decodeXmlEntities(idMatch[1] ?? idMatch[2] ?? '')
    if (!processId) continue
    const nameMatch = NAME_ATTR_RE.exec(attrs)
    const processName = nameMatch
      ? decodeXmlEntities(nameMatch[1] ?? nameMatch[2] ?? '')
      : undefined
    entries.push({ processId, processName, relPath })
  }
  return entries
}

/** Build a fresh index from a flat list of (relPath, xml content) pairs. */
export function buildProcessIndex(files: Array<{ relPath: string; xml: string }>): ProcessIndex {
  const index: ProcessIndex = new Map()
  for (const file of files) {
    for (const entry of parseProcessesFromXml(file.xml, file.relPath)) {
      index.set(entry.processId, entry)
    }
  }
  return index
}

// --- Unresolved calledElement lint -----------------------------------

/** Matches `<bpmn:callActivity ...>` / `<callActivity ...>`, any namespace
 * prefix, self-closing or not. */
const CALL_ACTIVITY_TAG_RE = /<(?:[a-zA-Z_][\w.-]*:)?callActivity\b([^>]*?)\/?>/g
const CALLED_ELEMENT_ATTR_RE = /\bcalledElement\s*=\s*(?:"([^"]*)"|'([^']*)')/
const CALL_ACTIVITY_ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/

export interface UnresolvedCalledElement {
  /** The id of the bpmn:CallActivity element itself (its diagram element id, not a process id). */
  elementId?: string
  calledElement: string
}

/**
 * Scan a single file's XML for `bpmn:CallActivity` elements whose
 * `calledElement` is set but does not resolve to any process id in the
 * given index. Empty/absent `calledElement` is not "unresolved" — that's
 * simply an unlinked call activity, a different (unlinked, not broken)
 * state the UI already distinguishes elsewhere.
 */
export function listUnresolvedCalledElements(
  xml: string,
  index: ProcessIndex
): UnresolvedCalledElement[] {
  if (!xml) return []
  const unresolved: UnresolvedCalledElement[] = []
  CALL_ACTIVITY_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CALL_ACTIVITY_TAG_RE.exec(xml)) !== null) {
    const attrs = match[1] ?? ''
    const calledMatch = CALLED_ELEMENT_ATTR_RE.exec(attrs)
    if (!calledMatch) continue
    const calledElement = decodeXmlEntities(calledMatch[1] ?? calledMatch[2] ?? '')
    if (!calledElement) continue
    if (index.has(calledElement)) continue
    const idMatch = CALL_ACTIVITY_ID_ATTR_RE.exec(attrs)
    const elementId = idMatch ? decodeXmlEntities(idMatch[1] ?? idMatch[2] ?? '') : undefined
    unresolved.push({ elementId, calledElement })
  }
  return unresolved
}
