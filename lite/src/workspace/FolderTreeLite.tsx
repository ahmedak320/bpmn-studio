import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LiteTreeNode } from '../fs/fsAccess'

export interface FolderTreeLiteProps {
  root: LiteTreeNode | null
  activePath?: string | null
  onOpenFile: (relPath: string) => void
  /** folderRelPath is '' for the workspace root. */
  onNewProcess: (folderRelPath: string) => void
  onNewFolder: (folderRelPath: string) => void
  onRename: (node: LiteTreeNode) => void
  onDelete: (node: LiteTreeNode) => void
}

interface MenuState {
  x: number
  y: number
  node: LiteTreeNode
}

interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}

/**
 * Folder tree over a File-System-Access-backed workspace. Ported from the
 * desktop renderer's FolderTree (same visuals + context-menu behavior) but
 * driven by LiteTreeNode and callbacks instead of the Electron workspace IPC —
 * App wires the actual create/rename/delete to the fsAccess adapter.
 */
export function FolderTreeLite({
  root,
  activePath,
  onOpenFile,
  onNewProcess,
  onNewFolder,
  onRename,
  onDelete
}: FolderTreeLiteProps): JSX.Element {
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

  const openMenu = useCallback((event: React.MouseEvent, node: LiteTreeNode) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }, [])

  const buildMenuItems = useCallback(
    (node: LiteTreeNode): MenuItem[] => {
      const folderRel = node.type === 'directory' ? node.relPath : parentOf(node.relPath)
      const items: MenuItem[] = [
        { label: 'New process', onClick: () => onNewProcess(folderRel) },
        { label: 'New folder', onClick: () => onNewFolder(folderRel) }
      ]
      if (node.relPath !== '') {
        items.push({ label: 'Rename', onClick: () => onRename(node) })
        items.push({ label: 'Delete', onClick: () => onDelete(node), danger: true })
      }
      return items
    },
    [onNewProcess, onNewFolder, onRename, onDelete]
  )

  const rows = useMemo(() => {
    if (!root) return null
    return (
      <TreeLevel
        node={root}
        depth={0}
        expanded={expanded}
        activePath={activePath ?? null}
        onToggle={toggle}
        onOpenFile={onOpenFile}
        onContextMenu={openMenu}
      />
    )
  }, [root, expanded, activePath, toggle, onOpenFile, openMenu])

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

interface TreeLevelProps {
  node: LiteTreeNode
  depth: number
  expanded: Set<string>
  activePath: string | null
  onToggle: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onContextMenu: (event: React.MouseEvent, node: LiteTreeNode) => void
}

function TreeLevel({
  node,
  depth,
  expanded,
  activePath,
  onToggle,
  onOpenFile,
  onContextMenu
}: TreeLevelProps): JSX.Element {
  const isRoot = depth === 0
  const isOpen = isRoot || expanded.has(node.relPath)
  const isActive = node.type === 'file' && node.relPath === activePath

  return (
    <div>
      {!isRoot && (
        <div
          onClick={() => {
            if (node.type === 'directory') onToggle(node.relPath)
            else onOpenFile(node.relPath)
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
            whiteSpace: 'nowrap',
            background: isActive ? 'var(--orbitpm-hover)' : 'transparent'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = isActive ? 'var(--orbitpm-hover)' : 'transparent')
          }
          title={node.relPath}
        >
          <span style={{ opacity: 0.6, width: 12, display: 'inline-block' }}>
            {node.type === 'directory' ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span>{node.type === 'directory' ? '📁' : '📄'}</span>
          <span>{node.name}</span>
        </div>
      )}
      {node.type === 'directory' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeLevel
              key={child.relPath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
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

function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 2000,
        minWidth: 160,
        background: 'var(--orbitpm-panel-bg)',
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        padding: 4
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onClick()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            border: 'none',
            background: 'transparent',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            color: item.danger ? '#d0473f' : 'inherit'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--orbitpm-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default FolderTreeLite
