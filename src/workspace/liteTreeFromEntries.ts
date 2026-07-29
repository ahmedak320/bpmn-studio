import type { WorkspaceEntry } from './adapters/types'
import type { LiteTreeNode } from '../fs/fsAccess'
import type { ProcessHierarchyGraph } from './processHierarchy'
import type { ProcessIndex } from '@/core/processIndex'
import type { MoveFolderOption } from './MoveDialog'

export interface LiteTreeFromEntriesOptions {
  /** Top-level directory subtrees hidden from the tree. Default ['.orbitpm']. */
  readonly hiddenRootDirs?: readonly string[]
  /** File filter. Default: /\.(?:aml|apc|xml|bpmn)$/i test on entry.name. */
  readonly includeFile?: (entry: WorkspaceEntry) => boolean
}

const DEFAULT_HIDDEN_ROOT_DIRS: readonly string[] = ['.orbitpm']

const DEFAULT_INCLUDE_RE = /\.(?:aml|apc|xml|bpmn)$/i

const defaultIncludeFile = (entry: WorkspaceEntry): boolean => DEFAULT_INCLUDE_RE.test(entry.name)

function joinRel(dirRel: string, name: string): string {
  if (!dirRel) return name
  return `${dirRel}/${name}`
}

function sortNodes(nodes: LiteTreeNode[]): LiteTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function firstSegment(path: string): string {
  const idx = path.indexOf('/')
  return idx === -1 ? path : path.slice(0, idx)
}

function insertEntry(
  root: LiteTreeNode,
  entry: WorkspaceEntry,
  includeFile: (entry: WorkspaceEntry) => boolean
): void {
  if (entry.kind === 'file' && !includeFile(entry)) return

  const segments = entry.path.split('/')
  let current = root
  let relPath = ''

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const isLast = i === segments.length - 1
    relPath = joinRel(relPath, segment)

    const existing = current.children?.find((child) => child.name === segment)
    if (existing) {
      current = existing
      continue
    }

    if (isLast) {
      if (entry.kind === 'directory') {
        current.children = current.children ?? []
        const dirNode: LiteTreeNode = {
          name: segment,
          relPath,
          type: 'directory',
          children: []
        }
        current.children.push(dirNode)
      } else {
        current.children = current.children ?? []
        current.children.push({
          name: segment,
          relPath,
          type: 'file'
        })
      }
    } else {
      current.children = current.children ?? []
      const dirNode: LiteTreeNode = {
        name: segment,
        relPath,
        type: 'directory',
        children: []
      }
      current.children.push(dirNode)
      current = dirNode
    }
  }
}

export function buildLiteTreeFromEntries(
  entries: readonly WorkspaceEntry[],
  rootName: string,
  options?: LiteTreeFromEntriesOptions
): LiteTreeNode {
  const hiddenRootDirs = new Set(options?.hiddenRootDirs ?? DEFAULT_HIDDEN_ROOT_DIRS)
  const includeFile = options?.includeFile ?? defaultIncludeFile

  const root: LiteTreeNode = {
    name: rootName,
    relPath: '',
    type: 'directory',
    children: []
  }

  for (const entry of entries) {
    if (hiddenRootDirs.has(firstSegment(entry.path))) continue
    insertEntry(root, entry, includeFile)
  }

  function sortRecursive(node: LiteTreeNode): LiteTreeNode {
    if (node.type === 'file') return node
    const children = sortNodes(node.children ?? []).map(sortRecursive)
    return { ...node, children }
  }

  return sortRecursive(root)
}

export function collectFolderOptions(root: LiteTreeNode, rootLabel: string): MoveFolderOption[] {
  const options: MoveFolderOption[] = []

  function walk(node: LiteTreeNode, label: string): void {
    options.push({ relPath: node.relPath, label })
    if (node.type === 'file') return
    for (const child of sortNodes(node.children ?? [])) {
      if (child.type === 'directory') {
        walk(child, child.relPath)
      }
    }
  }

  walk(root, rootLabel)
  return options
}

export function countTreeFiles(root: LiteTreeNode | null): number {
  if (!root) return 0
  if (root.type === 'file') return 1
  let total = 0
  for (const child of root.children ?? []) total += countTreeFiles(child)
  return total
}

export function uniquePathIn(
  takenPaths: ReadonlySet<string>,
  dirRel: string,
  fileName: string
): string {
  function insertSuffix(name: string, suffix: number): string {
    const lastDot = name.lastIndexOf('.')
    if (lastDot === -1 || lastDot === 0) return `${name}-${suffix}`
    return `${name.slice(0, lastDot)}-${suffix}${name.slice(lastDot)}`
  }

  const normalized = new Set([...takenPaths].map((p) => p.toLowerCase()))
  let candidate = joinRel(dirRel, fileName)
  let suffix = 2
  while (normalized.has(candidate.toLowerCase())) {
    candidate = joinRel(dirRel, insertSuffix(fileName, suffix))
    suffix += 1
  }
  return candidate
}

export const EMPTY_PROCESS_INDEX: ProcessIndex = new Map()

export const EMPTY_PROCESS_GRAPH: ProcessHierarchyGraph = Object.freeze({
  links: [],
  ambiguousProcessIds: new Set<string>()
})
