import type { LiteTreeNode, FileMeta } from '../fs/fsAccess'
import type { WorkspaceAdapter, WorkspaceEntry, WorkspaceFailure } from './adapters'
import { normalizeWorkspacePath, workspaceParentPath, workspacePathName } from './adapters'
import {
  assertWorkspaceListingWithinLimits,
  isInternalWorkspacePath,
  isWorkspaceBpmnEntry,
  readBoundedWorkspaceBpmn,
  resolveWorkspaceBpmnScanLimits,
  throwIfWorkspaceScanAborted,
  type WorkspaceBpmnScanOptions
} from './boundedBpmnScan'
import { decodeUtf8Strict } from './utf8'

export {
  DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS,
  MAX_WORKSPACE_BPMN_SCAN_CONCURRENCY,
  resolveWorkspaceBpmnReadConcurrency,
  resolveWorkspaceBpmnScanLimits,
  type WorkspaceBpmnScanLimits,
  type WorkspaceBpmnScanOptions
} from './boundedBpmnScan'

export interface AdapterWorkspaceSnapshot {
  tree: LiteTreeNode
  files: FileMeta[]
  issues: WorkspaceFailure[]
}

export interface AdapterWorkspaceTreeSnapshot {
  tree: LiteTreeNode
  issues: WorkspaceFailure[]
}

export type CommittedWorkspaceProjectionDelta =
  | { readonly kind: 'upsert-bpmn'; readonly path: string }
  | { readonly kind: 'create-directory'; readonly path: string }
  | {
      readonly kind: 'relocate'
      readonly from: string
      readonly to: string
      readonly entryKind: 'file' | 'directory'
    }
  | {
      readonly kind: 'remove'
      readonly path: string
      readonly entryKind: 'file' | 'directory'
    }

interface FlatTreeNode {
  readonly name: string
  readonly type: 'file' | 'directory'
}

function compareNodes(left: LiteTreeNode, right: LiteTreeNode): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, 'en-US', { sensitivity: 'base' })
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

function flattenTree(tree: LiteTreeNode): Map<string, FlatTreeNode> | null {
  if (tree.type !== 'directory' || tree.relPath !== '') return null
  const flattened = new Map<string, FlatTreeNode>()
  const pending = (tree.children ?? []).map((node) => ({ node, parentPath: '' }))
  while (pending.length > 0) {
    const current = pending.pop()!
    const { node, parentPath } = current
    let path: string
    try {
      path = normalizeWorkspacePath(node.relPath)
    } catch {
      return null
    }
    if (
      path !== node.relPath ||
      workspaceParentPath(path) !== parentPath ||
      workspacePathName(path) !== node.name ||
      isInternalWorkspacePath(path) ||
      flattened.has(path)
    ) {
      return null
    }
    if (node.type === 'file' && !/\.bpmn$/iu.test(path)) return null
    flattened.set(path, { name: node.name, type: node.type })
    if (node.type === 'directory') {
      for (const child of node.children ?? []) pending.push({ node: child, parentPath: path })
    } else if (node.children?.length) {
      return null
    }
  }
  return flattened
}

function treeFromFlatNodes(
  rootName: string,
  flattened: ReadonlyMap<string, FlatTreeNode>
): LiteTreeNode | null {
  const root: LiteTreeNode = {
    name: rootName,
    relPath: '',
    type: 'directory',
    children: []
  }
  const directories = new Map<string, LiteTreeNode>([['', root]])
  const ordered = [...flattened.entries()].sort(([left], [right]) => {
    const depth = left.split('/').length - right.split('/').length
    return depth || left.localeCompare(right, 'en-US')
  })
  for (const [path, entry] of ordered) {
    const parent = directories.get(workspaceParentPath(path))
    if (!parent) return null
    const node: LiteTreeNode = {
      name: entry.name,
      relPath: path,
      type: entry.type,
      children: entry.type === 'directory' ? [] : undefined
    }
    parent.children!.push(node)
    if (entry.type === 'directory') directories.set(path, node)
  }
  for (const directory of directories.values()) directory.children?.sort(compareNodes)
  return root
}

function atOrWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`)
}

function hasIssueAtOrAbove(issues: readonly WorkspaceFailure[], path: string): boolean {
  return issues.some(
    (issue) =>
      issue.path !== undefined && (issue.path === path || path.startsWith(`${issue.path}/`))
  )
}

function addDirectoryPath(flattened: Map<string, FlatTreeNode>, path: string): boolean {
  let current = ''
  for (const segment of path.split('/')) {
    current = current ? `${current}/${segment}` : segment
    const existing = flattened.get(current)
    if (existing?.type === 'file') return false
    if (!existing) flattened.set(current, { name: segment, type: 'directory' })
  }
  return true
}

/**
 * Apply an exact, locally committed structural mutation to the cached tree.
 *
 * This reducer never infers unchanged file content from size or mtime. It
 * returns `null` when the prior projection or diagnostics cannot be updated
 * truthfully, requiring the caller to perform a full bounded scan.
 */
export function applyCommittedWorkspaceProjectionDelta(
  previous: AdapterWorkspaceTreeSnapshot,
  delta: CommittedWorkspaceProjectionDelta
): AdapterWorkspaceTreeSnapshot | null {
  const flattened = flattenTree(previous.tree)
  if (!flattened) return null

  if (delta.kind === 'upsert-bpmn') {
    let path: string
    try {
      path = normalizeWorkspacePath(delta.path)
    } catch {
      return null
    }
    if (
      isInternalWorkspacePath(path) ||
      !/\.bpmn$/iu.test(path) ||
      hasIssueAtOrAbove(previous.issues, path)
    ) {
      return null
    }
    const existing = flattened.get(path)
    if (existing?.type === 'directory') return null
    const parent = workspaceParentPath(path)
    if (parent && !addDirectoryPath(flattened, parent)) return null
    flattened.set(path, { name: workspacePathName(path), type: 'file' })
  } else if (delta.kind === 'create-directory') {
    let path: string
    try {
      path = normalizeWorkspacePath(delta.path)
    } catch {
      return null
    }
    if (isInternalWorkspacePath(path) || hasIssueAtOrAbove(previous.issues, path)) return null
    if (!addDirectoryPath(flattened, path)) return null
  } else if (delta.kind === 'remove') {
    let path: string
    try {
      path = normalizeWorkspacePath(delta.path)
    } catch {
      return null
    }
    const source = flattened.get(path)
    if (!source || source.type !== delta.entryKind) return null
    for (const candidate of [...flattened.keys()]) {
      if (atOrWithin(candidate, path)) flattened.delete(candidate)
    }
  } else {
    let from: string
    let to: string
    try {
      from = normalizeWorkspacePath(delta.from)
      to = normalizeWorkspacePath(delta.to)
    } catch {
      return null
    }
    const source = flattened.get(from)
    if (from === to) {
      if (!source || source.type !== delta.entryKind) return null
      return {
        tree: treeFromFlatNodes(previous.tree.name, flattened) ?? previous.tree,
        issues: [...previous.issues]
      }
    }
    if (
      !source ||
      source.type !== delta.entryKind ||
      flattened.has(to) ||
      isInternalWorkspacePath(to) ||
      (source.type === 'file' && !/\.bpmn$/iu.test(to)) ||
      (source.type === 'directory' && atOrWithin(to, from)) ||
      previous.issues.some(
        (issue) =>
          issue.path !== undefined &&
          (atOrWithin(issue.path, from) || issue.path === to || to.startsWith(`${issue.path}/`))
      )
    ) {
      return null
    }
    const destinationParent = workspaceParentPath(to)
    if (destinationParent && flattened.get(destinationParent)?.type !== 'directory') {
      return null
    }
    const affected = [...flattened.entries()].filter(([path]) => atOrWithin(path, from))
    const affectedPaths = new Set(affected.map(([path]) => path))
    const moved = affected.map(([path, entry]) => {
      const destination = `${to}${path.slice(from.length)}`
      return [destination, { ...entry, name: workspacePathName(destination) }] as const
    })
    if (
      moved.some(([destination]) => flattened.has(destination) && !affectedPaths.has(destination))
    ) {
      return null
    }
    for (const path of affectedPaths) flattened.delete(path)
    for (const [path, entry] of moved) flattened.set(path, entry)
  }

  const tree = treeFromFlatNodes(previous.tree.name, flattened)
  if (!tree) return null
  const issues =
    delta.kind === 'remove'
      ? previous.issues.filter(
          (issue) => !issue.path || !atOrWithin(issue.path, normalizeWorkspacePath(delta.path))
        )
      : [...previous.issues]
  return { tree, issues }
}

function listingIssues(
  entries: readonly WorkspaceEntry[],
  includeBpmn: boolean
): WorkspaceFailure[] {
  const issues: WorkspaceFailure[] = []
  for (const entry of entries) {
    if (
      isInternalWorkspacePath(entry.path) ||
      entry.readable ||
      (!includeBpmn && isWorkspaceBpmnEntry(entry))
    ) {
      continue
    }
    issues.push(
      entry.issue ?? {
        code: 'storage-failure',
        operation: 'read',
        path: entry.path,
        message: `Workspace entry "${entry.path}" is unreadable.`
      }
    )
  }
  return issues
}

/**
 * Refresh only the directory projection. This is used after a locally
 * committed mutation whose exact file bytes are already reflected in the live
 * index; it deliberately performs no BPMN reads.
 */
export async function snapshotAdapterWorkspaceTree(
  adapter: WorkspaceAdapter,
  rootName: string,
  options: WorkspaceBpmnScanOptions = {}
): Promise<AdapterWorkspaceTreeSnapshot> {
  throwIfWorkspaceScanAborted(options.signal)
  const limits = resolveWorkspaceBpmnScanLimits(options.limits)
  let entries: WorkspaceEntry[]
  try {
    entries = await adapter.list('', {
      maxEntries: limits.maxEntries,
      maxDepth: limits.maxDepth,
      signal: options.signal
    })
  } catch (error) {
    throwIfWorkspaceScanAborted(options.signal)
    throw error
  }
  throwIfWorkspaceScanAborted(options.signal)
  assertWorkspaceListingWithinLimits(entries, limits)
  return {
    tree: makeTree(entries, rootName),
    issues: listingIssues(entries, true)
  }
}

/**
 * Build one coherent adapter-backed view. Listing failures remain fatal, while
 * individual unreadable BPMN files are isolated and returned as diagnostics.
 */
export async function snapshotAdapterWorkspace(
  adapter: WorkspaceAdapter,
  rootName: string,
  options: WorkspaceBpmnScanOptions = {}
): Promise<AdapterWorkspaceSnapshot> {
  throwIfWorkspaceScanAborted(options.signal)
  const limits = resolveWorkspaceBpmnScanLimits(options.limits)
  let entries: WorkspaceEntry[]
  try {
    entries = await adapter.list('', {
      maxEntries: limits.maxEntries,
      maxDepth: limits.maxDepth,
      signal: options.signal
    })
  } catch (error) {
    throwIfWorkspaceScanAborted(options.signal)
    throw error
  }
  throwIfWorkspaceScanAborted(options.signal)
  assertWorkspaceListingWithinLimits(entries, limits)
  const loaded = await readBoundedWorkspaceBpmn(adapter, entries, {
    ...options,
    limits,
    defaultConcurrency: 8,
    failClosed: false,
    transform: (entry, snapshot): FileMeta => ({
      relPath: entry.path,
      xml: decodeUtf8Strict(snapshot.bytes, {
        operation: 'read',
        path: entry.path
      }),
      lastModified: snapshot.modifiedAt,
      size: snapshot.size
    })
  })
  return {
    tree: makeTree(entries, rootName),
    files: loaded.values.sort((left, right) => left.relPath.localeCompare(right.relPath, 'en-US')),
    issues: [...listingIssues(entries, false), ...loaded.issues]
  }
}
