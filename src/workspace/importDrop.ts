// Parse an HTML5 drag-and-drop DataTransfer into the .bpmn (plus .apc and
// .xml) files it carries, for the "drag .bpmn files (and folders) from
// Explorer onto the app" import. A bare `.xml` file is accepted by name here
// (many BPMN tools export BPMN 2.0 XML with a plain .xml extension); the
// caller is expected to content-sniff it with `looksLikeBpmnXml` before
// treating it as a real diagram, since only the caller can surface a
// per-file "skipped" toast. Prefers the Chromium File System Access handle
// API (so a dropped FOLDER can be walked recursively, preserving its
// subtree), and falls back to the flat `DataTransfer.files` list on browsers
// that lack it. Kept free of React/DOM state so the parsing is
// unit-testable with fake DataTransfer-like objects.

/** Marks an in-app tree drag (move) so an external Explorer drop (import) can be
 *  told apart from a node being dragged within the tree. */
export const INTERNAL_DND_MIME = 'application/x-orbitpm-node'

export interface DroppedBpmn {
  /** Posix sub-path to create under the drop target ('sub/order.bpmn' when a
   *  folder was dropped; just 'order.bpmn' for a loose file). */
  relPath: string
  /** The file's own base name. */
  name: string
  getText: () => Promise<string>
}

const BPMN_RE = /\.bpmn$/i
const APC_RE = /\.apc$/i
const XML_RE = /\.xml$/i

export function isBpmnName(name: string): boolean {
  return BPMN_RE.test(name)
}

/** True for an ARIS (.apc) export — accepted for the experimental AML → BPMN
 *  import; the actual conversion happens later in the App import flow. */
export function isApcName(name: string): boolean {
  return APC_RE.test(name)
}

/** True for a bare `.xml` file. Many BPMN tools export BPMN 2.0 XML under a
 *  plain .xml extension rather than .bpmn, so the name alone can't tell a
 *  real BPMN diagram from unrelated XML — pair this with `looksLikeBpmnXml`
 *  against the file's content before treating it as a diagram. */
export function isXmlName(name: string): boolean {
  return XML_RE.test(name)
}

/** An importable BPMN file (.bpmn), a bare .xml export that still needs a
 *  `looksLikeBpmnXml` content check downstream, or an ARIS (.apc) export. */
export function isImportableName(name: string): boolean {
  return isBpmnName(name) || isApcName(name) || isXmlName(name)
}

// The BPMN 2.0 "MODEL" namespace every conformant <definitions> root is
// bound to, whichever prefix (or none) is used for it.
const BPMN_MODEL_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL'

// A <definitions> (or <prefix:definitions>) start tag, searched anywhere in
// the text rather than anchored to its start — so a leading BOM, an
// `<?xml ...?>` declaration, comments, or processing instructions ahead of
// the root element never block a match. `\b` after the literal keeps
// "definitionsFoo"-style element names from matching.
const DEFINITIONS_TAG_RE = /<(?:[A-Za-z_][\w.-]*:)?definitions\b/

/**
 * Pure string/regex sniff for "is this text a BPMN 2.0 diagram" — used to
 * decide whether a bare `.xml` file (see `isXmlName`) is really a BPMN
 * export before importing it. Deliberately NOT a real XML parser: no
 * DOMParser, because this must also run under node/vitest, not just a
 * browser DOM. Instead it ANDs two loose checks:
 *   1. some `<definitions>` / `<prefix:definitions>` start tag exists, and
 *   2. the BPMN 2.0 MODEL namespace URI string appears somewhere in the text.
 *
 * Precision/looseness tradeoff: this does NOT verify the namespace URI is
 * actually bound (via `xmlns[:prefix]=`) to the prefix the `<definitions>`
 * tag uses — that needs a real namespace-aware parse. A pathological
 * document with an unrelated `<definitions>`-named tag AND an unrelated
 * mention of the URI elsewhere would false-positive. In exchange this is
 * dependency-free, and handles arbitrary attribute order and single/double
 * quotes for free (attributes are never parsed, just searched for a
 * substring). It correctly rejects the negative case this mainly guards
 * against: XML that only *mentions* the namespace (e.g. inside a comment)
 * without ever declaring a `<definitions>` element anywhere.
 */
export function looksLikeBpmnXml(text: string): boolean {
  if (!text || !text.trim()) return false
  return DEFINITIONS_TAG_RE.test(text) && text.includes(BPMN_MODEL_NS)
}

/** True when the drag originated inside our own tree (a move), not from
 *  outside the browser (an import). */
export function isInternalDrag(dt: Pick<DataTransfer, 'types'>): boolean {
  const types = dt.types
  if (!types) return false
  // `types` is a DOMStringList in the browser and a string[] in tests.
  return Array.from(types as ArrayLike<string>).includes(INTERNAL_DND_MIME)
}

interface HandleLike {
  kind: 'file' | 'directory'
  name: string
  getFile?: () => Promise<{ text: () => Promise<string> }>
  entries?: () => AsyncIterableIterator<[string, HandleLike]>
}

async function walkHandle(handle: HandleLike, prefix: string, out: DroppedBpmn[]): Promise<void> {
  if (handle.kind === 'file') {
    if (!isImportableName(handle.name)) return
    const relPath = prefix ? `${prefix}/${handle.name}` : handle.name
    out.push({
      relPath,
      name: handle.name,
      getText: async () => {
        const file = await handle.getFile!()
        return file.text()
      }
    })
    return
  }
  // Directory: descend, preserving this folder's name in the destination path.
  const nextPrefix = prefix ? `${prefix}/${handle.name}` : handle.name
  if (!handle.entries) return
  for await (const [, child] of handle.entries()) {
    await walkHandle(child, nextPrefix, out)
  }
}

interface DataTransferItemLike {
  kind: string
  getAsFileSystemHandle?: () => Promise<HandleLike | null>
}

interface DataTransferLike {
  items?: ArrayLike<DataTransferItemLike> | null
  files?: ArrayLike<{ name: string; text: () => Promise<string> }> | null
}

/**
 * Collect every `.bpmn` (plus `.apc` and `.xml`) file a drop carries — see
 * `isImportableName`. When the browser exposes `getAsFileSystemHandle` on
 * the drag items, dropped folders are walked recursively (subtree
 * preserved). Otherwise only the flat `files` list is used (loose files, no
 * folders). Entries that don't match `isImportableName` are ignored. A
 * `.xml` entry is accepted purely by name here, same as `.bpmn`/`.apc` —
 * content-sniffing it with `looksLikeBpmnXml` is left to the caller, which
 * is the one able to show a per-file "skipped" toast for a false-positive
 * name.
 */
export async function collectDroppedBpmn(dt: DataTransferLike): Promise<DroppedBpmn[]> {
  const out: DroppedBpmn[] = []
  const items = dt.items ? Array.from(dt.items) : []
  const fileItems = items.filter((it) => it.kind === 'file')
  const handleCapable =
    fileItems.length > 0 && fileItems.some((it) => typeof it.getAsFileSystemHandle === 'function')

  if (handleCapable) {
    for (const it of fileItems) {
      if (typeof it.getAsFileSystemHandle !== 'function') continue
      const handle = await it.getAsFileSystemHandle()
      if (handle) await walkHandle(handle, '', out)
    }
    return out
  }

  for (const file of Array.from(dt.files ?? [])) {
    if (!isImportableName(file.name)) continue
    out.push({ relPath: file.name, name: file.name, getText: () => file.text() })
  }
  return out
}
