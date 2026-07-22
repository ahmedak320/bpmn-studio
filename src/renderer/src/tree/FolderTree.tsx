import { useCallback, useMemo, useState } from 'react'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'

export interface FolderTreeProps {
  root: TreeNode | null
  onOpenFile: (relPath: string) => void
  onRefresh: () => void
}

interface MenuState {
  x: number
  y: number
  node: TreeNode
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'process'
  )
}

/** Folder tree: folders sorted first, .bpmn files only, expand/collapse,
 * context menu (new process / new folder / rename / delete), double-click
 * a file to open it. */
function FolderTree({ root, onOpenFile, onRefresh }: FolderTreeProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [menu, setMenu] = useState<MenuState | null>(null)

  const toggle = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])

  const handleNewProcess = useCallback(
    async (folder: TreeNode) => {
      const name = window.prompt('New process name:', 'Untitled Process')
      if (!name) return
      const slug = slugify(name)
      const relPath = folder.relPath ? `${folder.relPath}/${slug}.bpmn` : `${slug}.bpmn`
      const processId = `Process_${slug.replace(/-/g, '_')}`
      const result = await window.orbitpm.workspace.createBpmnFile(relPath, processId, name)
      if (!result.ok) {
        window.alert(`Could not create process: ${result.error}`)
        return
      }
      onRefresh()
      onOpenFile(relPath)
    },
    [onOpenFile, onRefresh]
  )

  const handleNewFolder = useCallback(
    async (folder: TreeNode) => {
      const name = window.prompt('New folder name:', 'New Folder')
      if (!name) return
      const relPath = folder.relPath ? `${folder.relPath}/${name}` : name
      const result = await window.orbitpm.workspace.createFolder(relPath)
      if (!result.ok) {
        window.alert(`Could not create folder: ${result.error}`)
        return
      }
      onRefresh()
    },
    [onRefresh]
  )

  const handleRename = useCallback(
    async (node: TreeNode) => {
      const currentName = node.name
      const name = window.prompt('Rename to:', currentName)
      if (!name || name === currentName) return
      const result = await window.orbitpm.workspace.rename(node.relPath, name)
      if (!result.ok) {
        window.alert(`Could not rename: ${result.error}`)
        return
      }
      onRefresh()
    },
    [onRefresh]
  )

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      const confirmed = window.confirm(`Move "${node.name}" to the Recycle Bin?`)
      if (!confirmed) return
      const result = await window.orbitpm.workspace.delete(node.relPath)
      if (!result.ok) {
        window.alert(`Could not delete: ${result.error}`)
        return
      }
      onRefresh()
    },
    [onRefresh]
  )

  const buildMenuItems = useCallback(
    (node: TreeNode): ContextMenuItem[] => {
      const items: ContextMenuItem[] = []
      const folderForNewItems = node.type === 'folder' ? node : { ...node, relPath: parentOf(node.relPath) }
      items.push({ label: 'New process', onClick: () => handleNewProcess(folderForNewItems) })
      items.push({ label: 'New folder', onClick: () => handleNewFolder(folderForNewItems) })
      if (node.relPath !== '') {
        items.push({ label: 'Rename', onClick: () => handleRename(node) })
        items.push({ label: 'Delete', onClick: () => handleDelete(node), danger: true })
      }
      return items
    },
    [handleDelete, handleNewFolder, handleNewProcess, handleRename]
  )

  const openMenu = useCallback(
    (event: React.MouseEvent, node: TreeNode) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({ x: event.clientX, y: event.clientY, node })
    },
    []
  )

  const rows = useMemo(() => {
    if (!root) return null
    return (
      <TreeLevel
        node={root}
        depth={0}
        expanded={expanded}
        onToggle={toggle}
        onOpenFile={onOpenFile}
        onContextMenu={openMenu}
      />
    )
  }, [root, expanded, toggle, onOpenFile, openMenu])

  return (
    <div style={{ userSelect: 'none' }} onContextMenu={(e) => root && openMenu(e, root)}>
      {rows}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

interface TreeLevelProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void
}

function TreeLevel({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  onContextMenu
}: TreeLevelProps): JSX.Element {
  const isRoot = depth === 0
  const isOpen = isRoot || expanded.has(node.relPath)

  return (
    <div>
      {!isRoot && (
        <div
          onClick={() => onToggle(node.relPath)}
          onDoubleClick={() => {
            if (node.type === 'file') onOpenFile(node.relPath)
          }}
          onContextMenu={(e) => onContextMenu(e, node)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 6px',
            paddingLeft: 8 + depth * 14,
            cursor: 'pointer',
            fontSize: 13,
            borderRadius: 4,
            whiteSpace: 'nowrap'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(127,127,127,0.12)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          title={node.relPath}
        >
          <span style={{ opacity: 0.6, width: 12, display: 'inline-block' }}>
            {node.type === 'folder' ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span>{node.type === 'folder' ? '📁' : '📄'}</span>
          <span>{node.name}</span>
        </div>
      )}
      {node.type === 'folder' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeLevel
              key={child.relPath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default FolderTree
