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

/** Read a file's raw BYTES by relPath (binary-safe companion to readFileAt). */
export async function readBytesAt(
  root: FileSystemDirectoryHandle,
  relPath: string
): Promise<ArrayBuffer> {
  const handle = await resolveFile(root, relPath)
  const file = await handle.getFile()
  return file.arrayBuffer()
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

/** Write raw BYTES to a file by relPath (binary-safe), creating parents. */
export async function writeBytesAt(
  root: FileSystemDirectoryHandle,
  relPath: string,
  data: ArrayBuffer
): Promise<void> {
  const handle = await resolveFile(root, relPath, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
  } finally {
    await writable.close()
  }
}

/**
 * Binary-safe single-file copy: reads the source's raw bytes via
 * `arrayBuffer()` and writes them verbatim. Never decodes through
 * `file.text()` — that round-trip silently corrupts NON-text files (PDF, PNG,
 * xlsx…), which is exactly what a folder move/rename used to do before it then
 * deleted the originals (Codex CRITICAL-2).
 */
async function copyFileBytes(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  toRel: string
): Promise<void> {
  const src = await resolveFile(root, fromRel)
  const file = await src.getFile()
  const bytes = await file.arrayBuffer()
  await writeBytesAt(root, toRel, bytes)
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

/** Does a file named exactly `name` exist directly in `dir`? Uses a
 *  `getFileHandle(create:false)` probe — the at-write-time existence check. */
async function fileExistsIn(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false })
    return true
  } catch {
    return false
  }
}

/**
 * Create `<slug>.bpmn` under `parentRelPath`, RE-CHECKING existence at write
 * time and re-suffixing (`slug-2`, `slug-3`, …) if the name is already taken —
 * so a file that appeared since the caller precomputed its slug (an external
 * create, or a concurrent in-app op racing for the same slug) is never silently
 * overwritten (Codex MAJOR-3). Callers serialize through the app-level mutex so
 * the probe→write window of two in-app ops cannot interleave. Returns the new
 * file's relPath.
 */
export async function createBpmnFileUnique(
  root: FileSystemDirectoryHandle,
  parentRelPath: string,
  baseSlug: string,
  xml: string
): Promise<string> {
  const dir = await resolveDir(root, parentRelPath, { create: true })
  let slug = baseSlug || 'process'
  let n = 1
  while (await fileExistsIn(dir, `${slug}.bpmn`)) {
    n += 1
    slug = `${baseSlug || 'process'}-${n}`
  }
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

/** How many files a move/rename carried, split so the toast can surface the
 *  non-BPMN ones that would otherwise be relocated invisibly. */
export interface RelocateResult {
  destRel: string
  /** Total files copied (0 for a no-op). */
  files: number
  /** Of `files`, how many were NOT `.bpmn` (PDFs, images, spreadsheets…). */
  nonBpmn: number
}

/** Recursively copy a directory subtree from `fromRel` to a fresh `toRel`,
 *  copying every file's raw BYTES (binary-safe). Returns the file counts.
 *  Exported for retry-safety testing (Codex NEW-minor). */
export async function copyTree(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  toRel: string
): Promise<{ files: number; nonBpmn: number }> {
  const src = await resolveDir(root, fromRel)
  // Retry-safety: a prior FAILED attempt may have left a partial/stale `toRel`.
  // Start from a clean destination so the copy is deterministic — the result is
  // EXACTLY the source subtree, never source ∪ leftovers (Codex NEW-minor).
  await removeIfExists(root, toRel, 'directory')
  await resolveDir(root, toRel, { create: true })
  let files = 0
  let nonBpmn = 0
  for await (const [name, handle] of src.entries()) {
    const childFrom = joinRel(fromRel, name)
    const childTo = joinRel(toRel, name)
    if (handle.kind === 'directory') {
      const sub = await copyTree(root, childFrom, childTo)
      files += sub.files
      nonBpmn += sub.nonBpmn
    } else {
      await copyFileBytes(root, childFrom, childTo)
      files += 1
      if (!BPMN_RE.test(name)) nonBpmn += 1
    }
  }
  return { files, nonBpmn }
}

/** Delete an entry if present; a missing entry is a silent no-op. Used to make
 *  the copy paths retry-safe (clean a partial/stale destination or a leftover
 *  temp from an interrupted prior attempt). */
async function removeIfExists(
  root: FileSystemDirectoryHandle,
  relPath: string,
  type: 'file' | 'directory'
): Promise<void> {
  try {
    await deleteAt(root, relPath, type)
  } catch {
    /* already absent — fine */
  }
}

/** Distinctive temp suffix for the safe two-step self-rename (long + unlikely to
 *  collide with a real workspace name). */
const SELF_RENAME_TMP = '.__orbitpm_rename_tmp__'

/**
 * True when `destRel` resolves to the SAME underlying entry as `fromRel` — the
 * case-only rename on a CASE-INSENSITIVE filesystem (macOS/Windows), where
 * `Order.bpmn` and `order.bpmn` are one file. Detected by a case-insensitive
 * name match in the SAME parent, then confirmed (where the platform exposes it)
 * via `isSameEntry` handle identity. A cross-parent move is never the same
 * entry; on a genuinely case-SENSITIVE fs the dest name does not resolve, so
 * this returns false and the normal copy+delete path runs (Codex NEW-CRITICAL-1).
 */
async function isSameEntryTarget(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  destRel: string,
  type: 'file' | 'directory'
): Promise<boolean> {
  if (dirOf(fromRel) !== dirOf(destRel)) return false
  const fromName = baseOf(fromRel)
  const destName = baseOf(destRel)
  // Byte-identical names are the caller's no-op (handled above); only a case-only
  // difference is interesting here.
  if (fromName === destName) return false
  if (fromName.toLowerCase() !== destName.toLowerCase()) return false
  let parent: FileSystemDirectoryHandle
  try {
    parent = await resolveDir(root, dirOf(fromRel))
  } catch {
    return false
  }
  try {
    const from =
      type === 'file'
        ? await parent.getFileHandle(fromName)
        : await parent.getDirectoryHandle(fromName)
    const dest =
      type === 'file'
        ? await parent.getFileHandle(destName)
        : await parent.getDirectoryHandle(destName)
    const a = from as unknown as { isSameEntry?: (o: unknown) => Promise<boolean> }
    if (typeof a.isSameEntry === 'function') return a.isSameEntry(dest)
    // No isSameEntry on this platform: a case-insensitive name match in the same
    // parent is our best (and safe) signal — treat as the same entry.
    return true
  } catch {
    // The dest name did not resolve ⇒ a distinct, not-yet-existing entry
    // (case-sensitive fs) ⇒ NOT the same target.
    return false
  }
}

/**
 * Safe two-step self-rename via a temp name, used when source and destination
 * are the SAME entry on a case-insensitive fs. A plain copy-then-delete would
 * DELETE the file it just wrote (source and dest are one inode), so we stage
 * through a distinct temp name: copy → delete source → copy temp → delete temp.
 * Covers both files and folders.
 */
async function safeSelfRename(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  destRel: string,
  type: 'file' | 'directory'
): Promise<RelocateResult> {
  const parentRel = dirOf(fromRel)
  const tmpRel = joinRel(parentRel, `${baseOf(fromRel)}${SELF_RENAME_TMP}`)
  // Clean any leftover temp from a prior interrupted attempt (retry-safety).
  await removeIfExists(root, tmpRel, type)
  if (type === 'file') {
    await copyFileBytes(root, fromRel, tmpRel)
    await deleteAt(root, fromRel, 'file')
    await copyFileBytes(root, tmpRel, destRel)
    await deleteAt(root, tmpRel, 'file')
    return { destRel, files: 1, nonBpmn: BPMN_RE.test(baseOf(destRel)) ? 0 : 1 }
  }
  const counts = await copyTree(root, fromRel, tmpRel)
  await deleteAt(root, fromRel, 'directory')
  await copyTree(root, tmpRel, destRel)
  await deleteAt(root, tmpRel, 'directory')
  return { destRel, ...counts }
}

/**
 * Relocate a file or folder from `fromRel` to `destRel` (a full relPath,
 * possibly in a different parent). The File System Access API has no native
 * move/rename, so this is copy + delete (a file copies its bytes; a folder is
 * copied recursively). Returns `destRel`. Throws if an entry with the target
 * name already exists in the destination parent. Shared by both {@link renameAt}
 * (same parent, new name) and {@link moveAt} (new parent, same name) so the two
 * can never drift.
 */
async function relocate(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  destRel: string,
  type: 'file' | 'directory'
): Promise<RelocateResult> {
  if (destRel === fromRel) return { destRel: fromRel, files: 0, nonBpmn: 0 }

  // Case-only rename / same underlying entry on a case-insensitive filesystem:
  // route through a temp-name two-step so the copy-then-delete never deletes the
  // just-written file (Codex NEW-CRITICAL-1).
  if (await isSameEntryTarget(root, fromRel, destRel, type)) {
    return safeSelfRename(root, fromRel, destRel, type)
  }

  const destParentRel = dirOf(destRel)
  const destName = baseOf(destRel)
  // create:true so a move can target a folder created earlier in the same op;
  // for a rename the parent already exists, so this is a no-op there.
  const parent = await resolveDir(root, destParentRel, { create: true })
  // Refuse to clobber an existing entry with the same name.
  for await (const [name] of parent.entries()) {
    if (name === destName) throw new Error(`"${destName}" already exists here.`)
  }

  if (type === 'file') {
    // Binary-safe: copy raw bytes, never text() (a moved non-.bpmn attachment
    // must round-trip intact before its original is deleted).
    await copyFileBytes(root, fromRel, destRel)
    await deleteAt(root, fromRel, 'file')
    return { destRel, files: 1, nonBpmn: BPMN_RE.test(destName) ? 0 : 1 }
  }
  const counts = await copyTree(root, fromRel, destRel)
  await deleteAt(root, fromRel, 'directory')
  return { destRel, ...counts }
}

/** True when `name` embeds a path separator — illegal for a single rename
 *  segment (a `/` or `\` would silently turn a rename into a move + mkdir). */
export function hasPathSeparator(name: string): boolean {
  return /[/\\]/.test(name)
}

/** Keep a file's `.bpmn` extension, auto-appending it when the user stripped
 *  it — otherwise the renamed process vanishes from the `.bpmn`-only tree. */
export function ensureBpmnExtension(name: string): string {
  return BPMN_RE.test(name) ? name : `${name}.bpmn`
}

/**
 * Rename a file or folder within its own parent directory. Returns the move
 * result (new relPath + file counts). Rejects names containing a path
 * separator, and preserves the `.bpmn` extension for files. Throws if the
 * target name already exists in the parent.
 */
export async function renameAt(
  root: FileSystemDirectoryHandle,
  relPath: string,
  newName: string,
  type: 'file' | 'directory'
): Promise<RelocateResult> {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('A name cannot be empty.')
  if (hasPathSeparator(trimmed)) throw new Error('A name cannot contain "/" or "\\".')
  const finalName = type === 'file' ? ensureBpmnExtension(trimmed) : trimmed
  return relocate(root, relPath, joinRel(dirOf(relPath), finalName), type)
}

/**
 * Move a file or folder INTO a different parent folder, keeping its own name.
 * `toParentRelPath === ''` moves it to the workspace root. Returns the moved
 * entry's new relPath. Guards against moving a folder into itself or one of its
 * own descendants (which would recurse forever) and against clobbering an
 * existing entry of the same name in the destination.
 */
export async function moveAt(
  root: FileSystemDirectoryHandle,
  fromRel: string,
  toParentRelPath: string,
  type: 'file' | 'directory'
): Promise<RelocateResult> {
  const name = baseOf(fromRel)
  const destRel = joinRel(toParentRelPath, name)
  if (destRel === fromRel) return { destRel: fromRel, files: 0, nonBpmn: 0 } // already there
  if (
    type === 'directory' &&
    (toParentRelPath === fromRel || toParentRelPath.startsWith(fromRel + '/'))
  ) {
    throw new Error('Cannot move a folder into itself or one of its subfolders.')
  }
  return relocate(root, fromRel, destRel, type)
}

/** Count the direct entries (files + subfolders, any type) inside a folder.
 *  Used to decide whether a folder delete needs the type-the-name confirm:
 *  an empty folder deletes with a plain confirm; a non-empty one is a heavier
 *  action worth guarding. Returns 0 for a missing folder. */
export async function countDirEntries(
  root: FileSystemDirectoryHandle,
  relDir: string
): Promise<number> {
  let dir: FileSystemDirectoryHandle
  try {
    dir = await resolveDir(root, relDir)
  } catch {
    return 0
  }
  let n = 0
  for await (const _entry of dir.entries()) n += 1
  return n
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

/** One scanned `.bpmn` file: its content plus the filesystem metadata the
 *  catalog (last-modified column) and the search-content guard (≤2MB) need. */
export interface FileMeta {
  relPath: string
  xml: string
  /** epoch ms of the file's last modification (0 if the platform omits it). */
  lastModified: number
  /** byte size of the file (falls back to the content length if unavailable). */
  size: number
}

/** One coherent workspace snapshot: the folder tree and the flat `.bpmn`
 *  file-meta list, both derived from the SAME traversal. */
export interface WorkspaceSnapshot {
  tree: LiteTreeNode
  files: FileMeta[]
}

/**
 * ONE filesystem traversal that yields BOTH the folder tree and the flat
 * `.bpmn` file-meta list, so the tree and everything derived from the file list
 * (process index, catalog, search, unresolved links) are always coherent — they
 * can never disagree because a single walk observed one directory state, rather
 * than two independent walks racing an external write (Codex NEW-minor:
 * single-refresh coherence).
 */
export async function snapshotWorkspace(
  root: FileSystemDirectoryHandle,
  rootName: string
): Promise<WorkspaceSnapshot> {
  const files: FileMeta[] = []
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
        // Read the file ONCE and populate BOTH outputs from that single read, so
        // the tree node and the file-meta entry can never disagree.
        const file = await (handle as FileSystemFileHandle).getFile()
        const xml = await file.text()
        files.push({
          relPath: childRel,
          xml,
          lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
          size: typeof file.size === 'number' ? file.size : xml.length
        })
        children.push({ name: childName, relPath: childRel, type: 'file' })
      }
    }
    return { name, relPath, type: 'directory', children: sortNodes(children) }
  }
  const tree = await walk(root, '', rootName)
  return { tree, files }
}

/**
 * Like {@link listBpmnFiles} but also captures each file's `lastModified` and
 * `size`. This is the SINGLE disk read that refreshes the whole workspace: the
 * process index, the catalog, the search index and the unresolved-links list
 * are all derived from its result in memory, so a tree change re-reads every
 * `.bpmn` exactly once (mirroring the desktop app's on-refresh scan).
 */
export async function scanWorkspaceFiles(
  root: FileSystemDirectoryHandle
): Promise<FileMeta[]> {
  const out: FileMeta[] = []
  async function walk(dir: FileSystemDirectoryHandle, relPath: string): Promise<void> {
    for await (const [childName, handle] of dir.entries()) {
      const childRel = joinRel(relPath, childName)
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, childRel)
      } else if (BPMN_RE.test(childName)) {
        const file = await (handle as FileSystemFileHandle).getFile()
        const xml = await file.text()
        out.push({
          relPath: childRel,
          xml,
          lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
          size: typeof file.size === 'number' ? file.size : xml.length
        })
      }
    }
  }
  await walk(root, '')
  return out
}
