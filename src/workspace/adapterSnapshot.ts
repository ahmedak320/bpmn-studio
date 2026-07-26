import type { LiteTreeNode, FileMeta } from '../fs/fsAccess'
import type { WorkspaceAdapter, WorkspaceEntry, WorkspaceFailure } from './adapters'
import { workspaceFailure } from './adapters'

export interface AdapterWorkspaceSnapshot {
  tree: LiteTreeNode
  files: FileMeta[]
  issues: WorkspaceFailure[]
}

function compareNodes(left: LiteTreeNode, right: LiteTreeNode): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, 'en-US', { sensitivity: 'base' })
}

function isInternalWorkspacePath(path: string): boolean {
  return path === '.orbitpm' || path.startsWith('.orbitpm/')
}

function makeTree(entries: readonly WorkspaceEntry[], rootName: string): LiteTreeNode {
  const root: LiteTreeNode = {
    name: rootName,
    relPath: '',
    type: 'directory',
    children: []
  }
  const directories = new Map<string, LiteTreeNode>([['', root]])
  const ordered = [...entries].sort((left, right) => {
    const depth = left.path.split('/').length - right.path.split('/').length
    return depth || left.path.localeCompare(right.path, 'en-US')
  })

  for (const entry of ordered) {
    if (isInternalWorkspacePath(entry.path)) continue
    if (entry.kind === 'file' && !/\.bpmn$/i.test(entry.name)) continue
    let parent = directories.get(entry.parentPath)
    if (!parent) {
      // A conforming recursive list includes parents. If a backing store
      // omits one, synthesize it so the visible tree remains navigable.
      const segments = entry.parentPath.split('/').filter(Boolean)
      let path = ''
      parent = root
      for (const segment of segments) {
        path = path ? `${path}/${segment}` : segment
        let child = directories.get(path)
        if (!child) {
          child = {
            name: segment,
            relPath: path,
            type: 'directory',
            children: []
          }
          parent.children!.push(child)
          directories.set(path, child)
        }
        parent = child
      }
    }
    const node: LiteTreeNode = {
      name: entry.name,
      relPath: entry.path,
      type: entry.kind,
      children: entry.kind === 'directory' ? [] : undefined
    }
    parent.children!.push(node)
    if (entry.kind === 'directory') directories.set(entry.path, node)
  }

  for (const directory of directories.values()) {
    directory.children?.sort(compareNodes)
  }
  return root
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(values[index])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Build one coherent adapter-backed view. Listing failures remain fatal, while
 * individual unreadable BPMN files are isolated and returned as diagnostics.
 */
export async function snapshotAdapterWorkspace(
  adapter: WorkspaceAdapter,
  rootName: string,
  options: { readConcurrency?: number } = {}
): Promise<AdapterWorkspaceSnapshot> {
  const entries = await adapter.list()
  const issues: WorkspaceFailure[] = entries
    .filter((entry) => !isInternalWorkspacePath(entry.path) && !entry.readable && entry.issue)
    .map((entry) => entry.issue!)
  const candidates = entries.filter(
    (entry) =>
      !isInternalWorkspacePath(entry.path) &&
      entry.kind === 'file' &&
      entry.readable &&
      /\.bpmn$/i.test(entry.name)
  )
  const loaded = await mapWithConcurrency(
    candidates,
    Math.max(1, Math.floor(options.readConcurrency ?? 8)),
    async (entry): Promise<FileMeta | null> => {
      try {
        const snapshot = await adapter.read(entry.path)
        return {
          relPath: entry.path,
          xml: new TextDecoder().decode(snapshot.bytes),
          lastModified: snapshot.modifiedAt,
          size: snapshot.size
        }
      } catch (error) {
        issues.push(workspaceFailure(error, 'read', entry.path))
        return null
      }
    }
  )
  return {
    tree: makeTree(entries, rootName),
    files: loaded
      .filter((file): file is FileMeta => file !== null)
      .sort((left, right) => left.relPath.localeCompare(right.relPath, 'en-US')),
    issues
  }
}
