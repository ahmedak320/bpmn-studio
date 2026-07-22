// Flatten the workspace tree into a depth-indented list of folder options for
// the AI panel's "target folder" select. Pure (TreeNode is a global ambient
// type in the renderer) so it is trivial to reason about and reuse.

export interface FolderOption {
  /** Workspace-relative folder path ('' = root). */
  relPath: string
  /** Indented display label. */
  label: string
}

const INDENT = '  '

export function collectFolders(root: TreeNode | null): FolderOption[] {
  if (!root) return []
  const out: FolderOption[] = []

  function walk(node: TreeNode, depth: number): void {
    if (node.type !== 'folder') return
    const label =
      node.relPath === '' ? '/ (workspace root)' : `${INDENT.repeat(depth)}${node.name}`
    out.push({ relPath: node.relPath, label })
    for (const child of node.children ?? []) {
      if (child.type === 'folder') walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return out
}
