import { describe, it, expect } from 'vitest'
import {
  writeFileAt,
  buildTree,
  scanWorkspaceFiles,
  snapshotWorkspace,
  type LiteTreeNode
} from '../fs/fsAccess'
import { MockDirectoryHandle, newRoot } from './mockFs'

// Codex NEW-minor (single-refresh coherence): the tree and the flat file-meta
// list must derive from ONE filesystem traversal, so the tree and the indexes
// built from the file list can never disagree (one showing a file the other
// missed) because an external write landed between two independent walks.

function collectTreeFiles(node: LiteTreeNode | null): string[] {
  if (!node) return []
  if (node.type === 'file') return [node.relPath]
  return (node.children ?? []).flatMap(collectTreeFiles)
}

/** A root that GAINS an extra .bpmn between its first and second top-level
 *  enumeration — modelling an external write that lands between two independent
 *  walks of the same folder. */
async function mutatingRoot(): Promise<FileSystemDirectoryHandle> {
  const root = newRoot('ws') as unknown as MockDirectoryHandle
  await writeFileAt(root as unknown as FileSystemDirectoryHandle, 'a.bpmn', '<a/>')
  await writeFileAt(root as unknown as FileSystemDirectoryHandle, 'sub/b.bpmn', '<b/>')
  root.onEnumerate = (dir, count) => {
    if (count === 2 && !dir.entriesMap.has('late.bpmn')) {
      // Insert directly so we don't recurse through the async writer.
      const late = new (Object.getPrototypeOf(dir).constructor)('late.bpmn')
      late.kind = 'file'
      late.bytes = new TextEncoder().encode('<late/>')
      late.getFile = async () => ({
        text: async () => '<late/>',
        arrayBuffer: async () => new ArrayBuffer(0),
        lastModified: Date.now(),
        size: 7
      })
      dir.entriesMap.set('late.bpmn', late)
    }
  }
  return root as unknown as FileSystemDirectoryHandle
}

describe('snapshotWorkspace single-traversal coherence (NEW-minor)', () => {
  it('derives tree and files from ONE listing — they always agree', async () => {
    const root = await mutatingRoot()
    const snap = await snapshotWorkspace(root, 'ws')
    const treeFiles = collectTreeFiles(snap.tree).sort()
    const scanFiles = snap.files.map((f) => f.relPath).sort()
    expect(treeFiles).toEqual(scanFiles)
    // And the file metas carry the same fields as the standalone scan.
    expect(snap.files.every((f) => typeof f.size === 'number')).toBe(true)
  })

  it('matches the standalone functions on a STABLE (non-mutating) tree', async () => {
    const root = newRoot()
    await writeFileAt(root, 'x.bpmn', '<x/>')
    await writeFileAt(root, 'Sub/y.bpmn', '<y/>')
    const snap = await snapshotWorkspace(root, root.name)
    const tree = await buildTree(root, root.name)
    const files = await scanWorkspaceFiles(root)
    expect(collectTreeFiles(snap.tree).sort()).toEqual(collectTreeFiles(tree).sort())
    expect(snap.files.map((f) => f.relPath).sort()).toEqual(files.map((f) => f.relPath).sort())
  })

  it('the OLD two-walk approach CAN disagree — the incoherence this fixes', async () => {
    const root = await mutatingRoot()
    const tree = await buildTree(root, 'ws') // enumeration #1 — no late.bpmn
    const files = await scanWorkspaceFiles(root) // enumeration #2 — late.bpmn appears
    const treeFiles = collectTreeFiles(tree).sort()
    const scanFiles = files.map((f) => f.relPath).sort()
    // Two independent walks observed different directory states.
    expect(treeFiles).not.toEqual(scanFiles)
    expect(scanFiles).toContain('late.bpmn')
    expect(treeFiles).not.toContain('late.bpmn')
  })
})
