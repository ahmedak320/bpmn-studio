// Workspace filesystem operations. All paths accepted from callers are
// relative to the workspace root and go through resolveWithinRoot before
// touching disk — nothing here trusts a caller-supplied absolute path.

import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { atomicWrite } from './atomicWrite'
import { emptyBpmnXml } from './bpmnTemplate'
import type { TreeNode } from './ipcContract'
import { PathGuardError, resolveWithinRoot } from './pathGuard'

export type { TreeNode }

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.DS_Store'])

export class WorkspaceFsError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'WorkspaceFsError'
  }
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** Resolves and validates a caller-supplied relative path against root. */
function safeResolve(root: string, relPath: string): string {
  try {
    return resolveWithinRoot(root, relPath)
  } catch (err) {
    if (err instanceof PathGuardError) {
      throw new WorkspaceFsError(err.message, 'EPATHGUARD')
    }
    throw err
  }
}

export async function listTree(root: string): Promise<TreeNode> {
  async function walk(dirAbs: string, dirRel: string): Promise<TreeNode> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true })
    const folders: TreeNode[] = []
    const files: TreeNode[] = []

    for (const entry of entries) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue

      const childAbs = join(dirAbs, entry.name)
      const childRel = toPosix(dirRel ? `${dirRel}/${entry.name}` : entry.name)

      if (entry.isDirectory()) {
        folders.push(await walk(childAbs, childRel))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bpmn')) {
        files.push({ name: entry.name, relPath: childRel, type: 'file' })
      }
    }

    folders.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))

    return {
      name: dirRel ? basename(dirAbs) : basename(dirAbs),
      relPath: dirRel,
      type: 'folder',
      children: [...folders, ...files]
    }
  }

  return walk(root, '')
}

export async function readFileText(root: string, relPath: string): Promise<string> {
  const abs = safeResolve(root, relPath)
  return fs.readFile(abs, 'utf-8')
}

export async function writeFileText(root: string, relPath: string, content: string): Promise<void> {
  const abs = safeResolve(root, relPath)
  await atomicWrite(fs, abs, content)
}

export async function createFolder(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath)
  await fs.mkdir(abs, { recursive: true })
}

export async function createBpmnFile(
  root: string,
  relPath: string,
  processId: string,
  processName: string
): Promise<void> {
  const abs = safeResolve(root, relPath)
  try {
    await fs.access(abs)
    throw new WorkspaceFsError(`File already exists: ${relPath}`, 'EEXISTS')
  } catch (err) {
    if (err instanceof WorkspaceFsError) throw err
    // ENOENT is expected (file must not exist yet)
  }
  await fs.mkdir(dirname(abs), { recursive: true })
  await atomicWrite(fs, abs, emptyBpmnXml(processId, processName))
}

export async function renameEntry(root: string, relPath: string, newName: string): Promise<string> {
  const abs = safeResolve(root, relPath)
  const newAbs = join(dirname(abs), newName)
  // Validate the destination is still inside the root (guards a newName like "../../evil").
  const newRel = toPosix(relative(root, newAbs))
  safeResolve(root, newRel)
  await fs.rename(abs, newAbs)
  return newRel
}

export async function moveEntry(root: string, fromRelPath: string, toRelPath: string): Promise<void> {
  const fromAbs = safeResolve(root, fromRelPath)
  const toAbs = safeResolve(root, toRelPath)
  await fs.mkdir(dirname(toAbs), { recursive: true })
  await fs.rename(fromAbs, toAbs)
}

/** Injectable so callers can pass Electron's shell.trashItem without this module importing electron. */
export type TrashFn = (absPath: string) => Promise<void>

export async function deleteEntry(root: string, relPath: string, trash: TrashFn): Promise<void> {
  const abs = safeResolve(root, relPath)
  await trash(abs)
}
