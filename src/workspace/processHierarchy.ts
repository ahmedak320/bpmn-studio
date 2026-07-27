import type { ProcessIndex } from '@/core/processIndex'
import type { LiteTreeNode } from '../fs/fsAccess'

export const DEFAULT_MAX_REFERENCE_DEPTH = 8

export interface ProcessHierarchyLink {
  key: string
  parentProcessId: string
  childProcessId: string
  parentRelPath: string
  childRelPath: string
  callActivityIds: readonly string[]
  count: number
}

export interface ProcessHierarchyGraph {
  links: readonly ProcessHierarchyLink[]
  ambiguousProcessIds: ReadonlySet<string>
}

export interface ProcessHierarchyOptions {
  maxReferenceDepth?: number
}

export interface HierarchyNavigation {
  processId: string
  canonicalPath: string
  canonicalRowKey: string
  ancestorDirectoryPaths: readonly string[]
  /** Actionable owner rows that must be expanded to reveal an owned child. */
  ancestorRowKeys: readonly string[]
}

export interface HierarchyDirectoryRow {
  kind: 'directory'
  key: string
  name: string
  relPath: string
  node: LiteTreeNode
  actionable: true
  readOnly: false
  children: readonly HierarchyPhysicalRow[]
}

export interface HierarchyFileRow {
  kind: 'file'
  key: string
  name: string
  relPath: string
  canonicalPath: string
  node: LiteTreeNode
  actionable: true
  readOnly: false
  canonical: true
  processIds: readonly string[]
  ancestorDirectoryPaths: readonly string[]
  ancestorRowKeys: readonly string[]
  shared: boolean
  sharedProcessIds: readonly string[]
  distinctParentCount: number
  /** True when this actionable file is visually nested beneath its owner. */
  owned: boolean
  ownerParentProcessId: string | null
  ownerCallActivityIds: readonly string[]
  ownerCallCount: number
  /** Canonical owned subprocess files; removed from their physical top level. */
  ownedChildren: readonly HierarchyFileRow[]
  /** Reuse/self/back links only. Owned links are represented by ownedChildren. */
  references: readonly HierarchyReferenceRow[]
}

export interface HierarchyReferenceRow {
  kind: 'reference'
  key: string
  label: string
  processId: string
  sourceParentProcessId: string
  canonicalPath: string
  navigation: HierarchyNavigation
  actionable: false
  readOnly: true
  canonical: false
  callActivityIds: readonly string[]
  count: number
  shared: boolean
  distinctParentCount: number
  /** `self` for P→P, `back` when the child is an owner-tree ancestor. */
  cycle: 'self' | 'back' | null
  /** Reused links are leaves; the canonical owned tree carries descendants. */
  expandable: false
  referenceDepth: number
  children: readonly HierarchyReferenceChild[]
}

export interface HierarchyDepthCapRow {
  kind: 'depth-cap'
  key: string
  actionable: false
  readOnly: true
  parentProcessId: string
  referenceDepth: number
  omittedReferenceCount: number
}

export type HierarchyReferenceChild = HierarchyReferenceRow | HierarchyDepthCapRow
export type HierarchyPhysicalRow = HierarchyDirectoryRow | HierarchyFileRow

export interface ProcessHierarchy {
  root: HierarchyPhysicalRow | null
  canonicalByProcessId: ReadonlyMap<string, HierarchyFileRow>
  canonicalByRelPath: ReadonlyMap<string, HierarchyFileRow>
  canonicalPathByProcessId: ReadonlyMap<string, string>
  sharedProcessIds: ReadonlySet<string>
  ambiguousProcessIds: ReadonlySet<string>
  maxReferenceDepth: number
}

type MutableFileRow = Omit<
  HierarchyFileRow,
  | 'ancestorDirectoryPaths'
  | 'ancestorRowKeys'
  | 'ownerCallActivityIds'
  | 'ownedChildren'
  | 'references'
> & {
  ancestorDirectoryPaths: string[]
  ancestorRowKeys: string[]
  ownerCallActivityIds: string[]
  ownedChildren: MutableFileRow[]
  references: HierarchyReferenceRow[]
}

type MutableDirectoryRow = Omit<HierarchyDirectoryRow, 'children'> & {
  children: Array<MutableDirectoryRow | MutableFileRow>
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePhysicalNodes(a: LiteTreeNode, b: LiteTreeNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return (
    compareText(a.name.toLocaleLowerCase('en-US'), b.name.toLocaleLowerCase('en-US')) ||
    compareText(a.name, b.name) ||
    compareText(a.relPath, b.relPath)
  )
}

function compareLinks(a: ProcessHierarchyLink, b: ProcessHierarchyLink): number {
  return (
    compareText(a.parentProcessId, b.parentProcessId) ||
    compareText(a.childProcessId, b.childProcessId) ||
    compareText(a.key, b.key) ||
    compareText(a.callActivityIds.join('\u0000'), b.callActivityIds.join('\u0000'))
  )
}

function normalizeMaxDepth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_REFERENCE_DEPTH
  }
  return Math.max(1, Math.floor(value))
}

function semanticFileKey(processIds: readonly string[], relPath: string): string {
  return processIds.length > 0
    ? `file:${JSON.stringify(processIds)}`
    : `file-path:${JSON.stringify(relPath)}`
}

function referenceKey(parentProcessId: string, childProcessId: string): string {
  return `reference:${JSON.stringify([parentProcessId, childProcessId])}`
}

function maxOf(values: readonly number[]): number {
  let max = 0
  for (const value of values) max = Math.max(max, value)
  return max
}

function breakOwnershipCycles(ownerByChild: Map<string, string>): void {
  for (;;) {
    let cycle: string[] | null = null
    const globallyDone = new Set<string>()
    for (const start of [...ownerByChild.keys()].sort(compareText)) {
      if (globallyDone.has(start)) continue
      const path: string[] = []
      const indexById = new Map<string, number>()
      let current: string | undefined = start
      while (current && ownerByChild.has(current)) {
        const seenAt = indexById.get(current)
        if (seenAt !== undefined) {
          cycle = path.slice(seenAt)
          break
        }
        if (globallyDone.has(current)) break
        indexById.set(current, path.length)
        path.push(current)
        current = ownerByChild.get(current)
      }
      for (const id of path) globallyDone.add(id)
      if (cycle) break
    }
    if (!cycle) return
    // The lexically first process becomes the visible root; every other
    // ownership edge in the cycle remains useful and deterministic.
    cycle.sort(compareText)
    ownerByChild.delete(cycle[0])
  }
}
/**
 * Build one actionable owned-process tree:
 *
 * - a subprocess referenced by one parent is nested beneath that parent;
 * - a reused subprocess has one deterministic canonical owner and read-only
 *   references beneath its other parents;
 * - owned files are removed from their physical top level;
 * - cycles are cut deterministically and represented as back references.
 */
export function buildProcessHierarchy(
  root: LiteTreeNode | null,
  processIndex: ProcessIndex,
  graph: ProcessHierarchyGraph,
  options: ProcessHierarchyOptions = {}
): ProcessHierarchy {
  const maxReferenceDepth = normalizeMaxDepth(options.maxReferenceDepth)
  const ambiguousProcessIds = new Set(graph.ambiguousProcessIds)
  const sortedLinks = [...graph.links]
    .filter(
      (link) =>
        !ambiguousProcessIds.has(link.parentProcessId) &&
        !ambiguousProcessIds.has(link.childProcessId)
    )
    .sort(compareLinks)

  const parentIdsByChild = new Map<string, Set<string>>()
  const linksByParent = new Map<string, ProcessHierarchyLink[]>()
  const linkByPair = new Map<string, ProcessHierarchyLink>()
  for (const link of sortedLinks) {
    const outgoing = linksByParent.get(link.parentProcessId) ?? []
    outgoing.push(link)
    linksByParent.set(link.parentProcessId, outgoing)
    linkByPair.set(`${link.parentProcessId}\u0000${link.childProcessId}`, link)
    if (link.parentProcessId === link.childProcessId) continue
    const parents = parentIdsByChild.get(link.childProcessId) ?? new Set<string>()
    parents.add(link.parentProcessId)
    parentIdsByChild.set(link.childProcessId, parents)
  }

  const sharedProcessIds = new Set<string>()
  for (const [processId, parents] of parentIdsByChild) {
    if (parents.size > 1) sharedProcessIds.add(processId)
  }

  const processIdsByPath = new Map<string, string[]>()
  for (const [processId, entry] of processIndex) {
    if (ambiguousProcessIds.has(processId)) continue
    const ids = processIdsByPath.get(entry.relPath) ?? []
    ids.push(processId)
    processIdsByPath.set(entry.relPath, ids)
  }
  for (const ids of processIdsByPath.values()) ids.sort(compareText)

  const canonicalByRelPath = new Map<string, MutableFileRow>()
  const seenFilePaths = new Set<string>()

  const projectPhysical = (node: LiteTreeNode): MutableDirectoryRow | MutableFileRow | null => {
    if (node.type === 'file') {
      if (seenFilePaths.has(node.relPath)) return null
      seenFilePaths.add(node.relPath)
      const processIds = [...(processIdsByPath.get(node.relPath) ?? [])]
      const sharedIds = processIds.filter((id) => sharedProcessIds.has(id))
      const distinctCounts = processIds.map((id) => parentIdsByChild.get(id)?.size ?? 0)
      const row: MutableFileRow = {
        kind: 'file',
        key: semanticFileKey(processIds, node.relPath),
        name: node.name,
        relPath: node.relPath,
        canonicalPath: node.relPath,
        node,
        actionable: true,
        readOnly: false,
        canonical: true,
        processIds,
        ancestorDirectoryPaths: [],
        ancestorRowKeys: [],
        shared: sharedIds.length > 0,
        sharedProcessIds: sharedIds,
        distinctParentCount: maxOf(distinctCounts),
        owned: false,
        ownerParentProcessId: null,
        ownerCallActivityIds: [],
        ownerCallCount: 0,
        ownedChildren: [],
        references: []
      }
      canonicalByRelPath.set(node.relPath, row)
      return row
    }

    const children = [...(node.children ?? [])]
      .sort(comparePhysicalNodes)
      .map(projectPhysical)
      .filter((child): child is MutableDirectoryRow | MutableFileRow => child !== null)
    return {
      kind: 'directory',
      key: `directory:${node.relPath}`,
      name: node.name,
      relPath: node.relPath,
      node,
      actionable: true,
      readOnly: false,
      children
    }
  }

  const projectedRoot = root ? projectPhysical(root) : null
  const canonicalByProcessId = new Map<string, MutableFileRow>()
  const canonicalPathByProcessId = new Map<string, string>()
  for (const [processId, entry] of processIndex) {
    if (ambiguousProcessIds.has(processId)) continue
    const row = canonicalByRelPath.get(entry.relPath)
    if (!row) continue
    canonicalByProcessId.set(processId, row)
    canonicalPathByProcessId.set(processId, row.canonicalPath)
  }

  // Choose one deterministic owner for every resolvable non-self subprocess.
  const ownerByChild = new Map<string, string>()
  for (const [childId, parents] of parentIdsByChild) {
    if (!canonicalByProcessId.has(childId)) continue
    const candidates = [...parents]
      .filter(
        (parentId) =>
          canonicalByProcessId.has(parentId) &&
          canonicalByProcessId.get(parentId) !== canonicalByProcessId.get(childId)
      )
      .sort(compareText)
    if (candidates[0]) ownerByChild.set(childId, candidates[0])
  }
  breakOwnershipCycles(ownerByChild)

  // A physical file can move as one unit only when all of its declared
  // processes agree on the same owner.
  const ownerByFile = new Map<MutableFileRow, string>()
  for (const row of canonicalByRelPath.values()) {
    if (row.processIds.length === 0) continue
    const owners = row.processIds.map((id) => ownerByChild.get(id))
    if (
      owners.every((owner): owner is string => typeof owner === 'string' && owner === owners[0])
    ) {
      const owner = owners[0] as string
      if (canonicalByProcessId.get(owner) !== row) ownerByFile.set(row, owner)
    }
  }

  const removeOwnedFiles = (row: MutableDirectoryRow | MutableFileRow): void => {
    if (row.kind === 'file') return
    row.children = row.children.filter((child) => {
      if (child.kind === 'file' && ownerByFile.has(child)) return false
      removeOwnedFiles(child)
      return true
    })
  }
  if (projectedRoot) removeOwnedFiles(projectedRoot)

  for (const [childRow, ownerId] of [...ownerByFile].sort((a, b) =>
    compareText(a[0].key, b[0].key)
  )) {
    const ownerRow = canonicalByProcessId.get(ownerId)
    if (!ownerRow || ownerRow === childRow) continue
    const ownedIds = childRow.processIds.filter((id) => ownerByChild.get(id) === ownerId)
    const links = ownedIds
      .map((id) => linkByPair.get(`${ownerId}\u0000${id}`))
      .filter((link): link is ProcessHierarchyLink => Boolean(link))
    childRow.owned = true
    childRow.ownerParentProcessId = ownerId
    childRow.ownerCallActivityIds = [
      ...new Set(links.flatMap((link) => link.callActivityIds))
    ].sort(compareText)
    childRow.ownerCallCount = links.reduce((total, link) => total + link.count, 0)
    ownerRow.ownedChildren.push(childRow)
  }
  for (const row of canonicalByRelPath.values()) {
    row.ownedChildren.sort((a, b) => compareText(a.key, b.key))
  }

  // Visible reveal ancestry follows the owner tree, not the file's original
  // physical directory (the canonical path remains unchanged for file I/O).
  const assignVisibleAncestry = (
    row: MutableDirectoryRow | MutableFileRow,
    directoryPaths: readonly string[],
    ownerRowKeys: readonly string[]
  ): void => {
    if (row.kind === 'directory') {
      const nextDirectories = row.relPath === '' ? [''] : [...directoryPaths, row.relPath]
      for (const child of row.children) {
        assignVisibleAncestry(child, nextDirectories, ownerRowKeys)
      }
      return
    }
    row.ancestorDirectoryPaths = [...directoryPaths]
    row.ancestorRowKeys = [...ownerRowKeys]
    for (const child of row.ownedChildren) {
      assignVisibleAncestry(child, directoryPaths, [...ownerRowKeys, row.key])
    }
  }
  if (projectedRoot) assignVisibleAncestry(projectedRoot, [], [])

  const isOwnerAncestor = (parentProcessId: string, childProcessId: string): boolean => {
    let current: string | undefined = parentProcessId
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (current === childProcessId) return true
      seen.add(current)
      current = ownerByChild.get(current)
    }
    return false
  }

  for (const parentRow of canonicalByRelPath.values()) {
    const references: HierarchyReferenceRow[] = []
    for (const parentProcessId of parentRow.processIds) {
      for (const link of linksByParent.get(parentProcessId) ?? []) {
        const childRow = canonicalByProcessId.get(link.childProcessId)
        if (!childRow) continue
        if (
          link.childProcessId !== parentProcessId &&
          ownerByChild.get(link.childProcessId) === parentProcessId &&
          ownerByFile.get(childRow) === parentProcessId
        ) {
          continue
        }
        const cycle =
          link.childProcessId === parentProcessId
            ? 'self'
            : isOwnerAncestor(parentProcessId, link.childProcessId)
              ? 'back'
              : null
        const distinctParentCount = parentIdsByChild.get(link.childProcessId)?.size ?? 0
        references.push({
          kind: 'reference',
          key: referenceKey(parentProcessId, link.childProcessId),
          label: processIndex.get(link.childProcessId)?.processName || link.childProcessId,
          processId: link.childProcessId,
          sourceParentProcessId: parentProcessId,
          canonicalPath: childRow.canonicalPath,
          navigation: {
            processId: link.childProcessId,
            canonicalPath: childRow.canonicalPath,
            canonicalRowKey: childRow.key,
            ancestorDirectoryPaths: childRow.ancestorDirectoryPaths,
            ancestorRowKeys: childRow.ancestorRowKeys
          },
          actionable: false,
          readOnly: true,
          canonical: false,
          callActivityIds: [...new Set(link.callActivityIds)].sort(compareText),
          count: link.count,
          shared: distinctParentCount > 1,
          distinctParentCount,
          cycle,
          expandable: false,
          referenceDepth: 1,
          children: []
        })
      }
    }
    parentRow.references = references.sort(
      (a, b) =>
        compareText(a.processId, b.processId) ||
        compareText(a.sourceParentProcessId, b.sourceParentProcessId) ||
        compareText(a.key, b.key)
    )
  }

  return {
    root: projectedRoot,
    canonicalByProcessId,
    canonicalByRelPath,
    canonicalPathByProcessId,
    sharedProcessIds,
    ambiguousProcessIds,
    maxReferenceDepth
  }
}
