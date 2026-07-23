// Parse an HTML5 drag-and-drop DataTransfer into the .bpmn files it carries,
// for the "drag .bpmn files (and folders) from Explorer onto the app" import.
// Prefers the Chromium File System Access handle API (so a dropped FOLDER can
// be walked recursively, preserving its subtree), and falls back to the flat
// `DataTransfer.files` list on browsers that lack it. Kept free of React/DOM
// state so the parsing is unit-testable with fake DataTransfer-like objects.

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

export function isBpmnName(name: string): boolean {
  return BPMN_RE.test(name)
}

/** True for an ARIS (.apc) export — accepted for the experimental AML → BPMN
 *  import; the actual conversion happens later in the App import flow. */
export function isApcName(name: string): boolean {
  return APC_RE.test(name)
}

/** Either an importable BPMN file or an ARIS export. */
export function isImportableName(name: string): boolean {
  return isBpmnName(name) || isApcName(name)
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
 * Collect every `.bpmn` file a drop carries. When the browser exposes
 * `getAsFileSystemHandle` on the drag items, dropped folders are walked
 * recursively (subtree preserved). Otherwise only the flat `files` list is
 * used (loose files, no folders). Non-.bpmn entries are ignored.
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
