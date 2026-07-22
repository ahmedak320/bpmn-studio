// File System Access API adapter — the browser-side stand-in for the desktop
// app's main-process workspace (src/main/workspace). Everything here operates
// on a live FileSystemDirectoryHandle rooted at the folder the user opened, so
// it is deliberately free of `window`, IndexedDB and React — that makes the
// path-walking / tree-building / read-write glue unit-testable with in-memory
// mock handles (see src/__tests__/fsAccess.test.ts).
//
// relPaths are always posix-style and relative to the opened root; '' is the
// root itself. Only `.bpmn` files are surfaced in the tree (folders are always
// shown so the user can organize), mirroring the desktop tree.

export interface LiteTreeNode {
  name: string
  /** posix path relative to the opened root; '' for the root node. */
  relPath: string
  type: 'file' | 'directory'
  children?: LiteTreeNode[]
}

const BPMN_RE = /\.bpmn$/i

/** Split a relPath into clean, non-empty segments. */
export function segments(relPath: string): string[] {
  return relPath.split('/').filter((s) => s.length > 0)
}

/** Join a parent relPath and a child name into a posix relPath. */
export function joinRel(parentRelPath: string, name: string): string {
  const p = parentRelPath.replace(/\/+$/g, '')
  return p ? `${p}/${name}` : name
}

/** The directory part of a file relPath ('' when the file is at the root). */
export function dirOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

/** The final path segment (file or folder name). */
export function baseOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

/**
 * Walk from `root` to the directory handle at `relDir`, optionally creating
 * intermediate directories. `relDir === ''` returns `root` itself.
 */
export async function resolveDir(
  root: FileSystemDirectoryHandle,
  relDir: string,
  options: { create?: boolean } = {}
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const seg of segments(relDir)) {
    dir = await dir.getDirectoryHandle(seg, { create: options.create })
  }
  return dir
}

/** Resolve (optionally creating) the file handle at a file relPath. */
export async function resolveFile(
  root: FileSystemDirectoryHandle,
  relPath: string,
  options: { create?: boolean } = {}
): Promise<FileSystemFileHandle> {
  const dir = await resolveDir(root, dirOf(relPath), { create: options.create })
  return dir.getFileHandle(baseOf(relPath), { create: options.create })
}

/** Read a file's text by relPath. */
export async function readFileAt(root: FileSystemDirectoryHandle, relPath: string): Promise<string> {
  const handle = await resolveFile(root, relPath)
  const file = await handle.getFile()
  return file.text()
}

/** Write text to a file by relPath, creating it (and any parent dirs) if needed. */
export async function writeFileAt(
  root: FileSystemDirectoryHandle,
  relPath: string,
  content: string
): Promise<void> {
  const handle = await resolveFile(root, relPath, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

/** Create a folder under `parentRelPath`; returns the new folder's relPath. */
export async function createFolderAt(
  root: FileSystemDirectoryHandle,
  parentRelPath: string,
  name: string
): Promise<string> {
  const parent = await resolveDir(root, parentRelPath, { create: true })
  await parent.getDirectoryHandle(name, { create: true })
  return joinRel(parentRelPath, name)
}

/**
 * Create a `.bpmn` file named `<slug>.bpmn` under `parentRelPath`, writing the
 * given XML. Returns the new file's relPath.
 */
export async function createBpmnFileAt(
  root: FileSystemDirectoryHandle,
  parentRelPath: string,
  slug: string,
  xml: string
): Promise<string> {
  const relPath = joinRel(parentRelPath, `${slug}.bpmn`)
  await writeFileAt(root, relPath, xml)
  return relPath
}

/** Delete a file or folder (folders removed recursively). */
export async function deleteAt(
  root: FileSystemDirectoryHandle,
  relPath: string,
  type: 'file' | 'directory'
): Promise<void> {
  const parent = await resolveDir(root, dirOf(relPath))
  await parent.removeEntry(baseOf(relPath), { recursive: type === 'directory' })
}

/** Recursively copy a directory subtree from `fromRel` to a fresh `toRel`. */
async function copyTree(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  toRel: string
): Promise<void> {
  const src = await resolveDir(root, fromRel)
  await resolveDir(root, toRel, { create: true })
  for await (const [name, handle] of src.entries()) {
    const childFrom = joinRel(fromRel, name)
    const childTo = joinRel(toRel, name)
    if (handle.kind === 'directory') {
      await copyTree(root, childFrom, childTo)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      await writeFileAt(root, childTo, await file.text())
    }
  }
}

/**
 * Rename a file or folder within its own parent directory. The File System
 * Access API has no native move/rename, so this is implemented as copy + delete
 * (a file copies its bytes; a folder is copied recursively). Returns the new
 * relPath. Throws if the target name already exists in the parent.
 */
export async function renameAt(
  root: FileSystemDirectoryHandle,
  relPath: string,
  newName: string,
  type: 'file' | 'directory'
): Promise<string> {
  const parentRel = dirOf(relPath)
  const newRel = joinRel(parentRel, newName)
  if (newRel === relPath) return relPath

  const parent = await resolveDir(root, parentRel)
  // Refuse to clobber an existing entry with the same name.
  let clash = false
  for await (const [name] of parent.entries()) {
    if (name === newName) {
      clash = true
      break
    }
  }
  if (clash) throw new Error(`"${newName}" already exists here.`)

  if (type === 'file') {
    const content = await readFileAt(root, relPath)
    await writeFileAt(root, newRel, content)
    await deleteAt(root, relPath, 'file')
  } else {
    await copyTree(root, relPath, newRel)
    await deleteAt(root, relPath, 'directory')
  }
  return newRel
}

/** Does a bare slug (no extension) already exist as `<slug>.bpmn` in a folder? */
export async function bpmnSlugsIn(
  root: FileSystemDirectoryHandle,
  parentRelPath: string
): Promise<Set<string>> {
  const taken = new Set<string>()
  let dir: FileSystemDirectoryHandle
  try {
    dir = await resolveDir(root, parentRelPath)
  } catch {
    return taken
  }
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && BPMN_RE.test(name)) {
      taken.add(name.slice(0, name.length - '.bpmn'.length).toLowerCase())
    }
  }
  return taken
}

/**
 * Count the `.bpmn` files anywhere in a built tree. Zero means the workspace
 * has no processes yet — the signal the UI uses to show the "No processes yet"
 * empty-state card (with its create-your-first-process button) instead of a
 * blank tree, which was the original dead-end: an opened-but-empty folder
 * rendered nothing and offered no obvious way to start.
 */
export function countBpmnFiles(node: LiteTreeNode | null): number {
  if (!node) return 0
  if (node.type === 'file') return 1
  let total = 0
  for (const child of node.children ?? []) total += countBpmnFiles(child)
  return total
}

function sortNodes(nodes: LiteTreeNode[]): LiteTreeNode[] {
  // Folders first, then files; each alphabetical, case-insensitive.
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/**
 * Recursively build the workspace tree from a directory handle. Only `.bpmn`
 * files are included; empty folders are kept (so the user can create into
 * them). The root node has `relPath === ''`.
 */
export async function buildTree(
  root: FileSystemDirectoryHandle,
  rootName: string
): Promise<LiteTreeNode> {
  async function walk(
    dir: FileSystemDirectoryHandle,
    relPath: string,
    name: string
  ): Promise<LiteTreeNode> {
    const children: LiteTreeNode[] = []
    for await (const [childName, handle] of dir.entries()) {
      const childRel = joinRel(relPath, childName)
      if (handle.kind === 'directory') {
        children.push(await walk(handle as FileSystemDirectoryHandle, childRel, childName))
      } else if (BPMN_RE.test(childName)) {
        children.push({ name: childName, relPath: childRel, type: 'file' })
      }
    }
    return { name, relPath, type: 'directory', children: sortNodes(children) }
  }
  return walk(root, '', rootName)
}

/**
 * Flatten every `.bpmn` file in the workspace into `{ relPath, xml }` pairs —
 * the input the shared `buildProcessIndex` needs to power call-activity
 * linking and the unresolved-link badge.
 */
export async function listBpmnFiles(
  root: FileSystemDirectoryHandle
): Promise<Array<{ relPath: string; xml: string }>> {
  const out: Array<{ relPath: string; xml: string }> = []
  async function walk(dir: FileSystemDirectoryHandle, relPath: string): Promise<void> {
    for await (const [childName, handle] of dir.entries()) {
      const childRel = joinRel(relPath, childName)
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, childRel)
      } else if (BPMN_RE.test(childName)) {
        const file = await (handle as FileSystemFileHandle).getFile()
        out.push({ relPath: childRel, xml: await file.text() })
      }
    }
  }
  await walk(root, '')
  return out
}
